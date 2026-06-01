const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createMacosPlatformCapabilities } = require('./macos-platform-capabilities');

function createFakeChild({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('exit', exitCode);
  });
  return child;
}

function createRichClipboard() {
  let data = {
    text: '旧文本',
    html: '<b>旧文本</b>',
    rtf: '{\\rtf1 old}',
    image: { isEmpty: () => false, id: 'image-1' },
  };

  return {
    readText: () => data.text || '',
    readHTML: () => data.html || '',
    readRTF: () => data.rtf || '',
    readImage: () => data.image || { isEmpty: () => true },
    writeText: (text) => {
      data = { text: String(text || '') };
    },
    write: (nextData) => {
      data = { ...nextData };
    },
    current: () => data,
  };
}

test('createMacosPlatformCapabilities 在非 macOS 平台返回结构化不可用结果', async () => {
  const service = createMacosPlatformCapabilities({
    processPlatform: 'win32',
  });

  assert.deepEqual(await service.getAccessibilityStatus(), {
    success: false,
    source: 'macos_platform',
    confidence: 'none',
    reason: 'macos_capability_unavailable',
  });
  assert.deepEqual(await service.getDiagnostics(), {
    success: false,
    source: 'macos_platform',
    confidence: 'none',
    reason: 'macos_capability_unavailable',
  });
});

test('createMacosPlatformCapabilities 编译 helper 后解析命令输出', async () => {
  const compileCalls = [];
  const spawnCalls = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    processEnv: { TMPDIR: '/tmp' },
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: (command, args) => {
      compileCalls.push([command, args]);
      return { status: 0, stdout: '', stderr: '' };
    },
    spawnProcess: (command, args) => {
      spawnCalls.push([command, args]);
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          source: 'macos_ax',
          confidence: 'confirmed',
          trusted: true,
          reason: 'accessibility_trusted',
        }),
      });
    },
  });

  const result = await service.getAccessibilityStatus();

  assert.equal(result.success, true);
  assert.equal(result.trusted, true);
  assert.equal(compileCalls[0][0], '/usr/bin/clang');
  assert.deepEqual(compileCalls[0][1].slice(0, 7), [
    '-fobjc-arc',
    '-framework',
    'ApplicationServices',
    '-framework',
    'AppKit',
    '-framework',
    'Foundation',
  ]);
  assert.deepEqual(spawnCalls[0], ['/tmp/speakmore-macos-platform-helper', ['accessibility-status']]);
});

test('createMacosPlatformCapabilities 编译失败时返回明确 reason', async () => {
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    spawnSyncProcess: () => ({ status: 1, stderr: 'clang failed', stdout: '' }),
    logger: { error: () => undefined },
  });

  assert.deepEqual(await service.getAccessibilityStatus(), {
    success: false,
    source: 'macos_platform',
    confidence: 'none',
    reason: 'macos_helper_compile_failed',
    detail: 'clang failed',
  });
});

test('createMacosPlatformCapabilities 剪贴板诊断会恢复原始内容', () => {
  const clipboard = createRichClipboard();
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    clipboard,
  });

  assert.deepEqual(service.diagnoseClipboardRoundTrip(), {
    success: true,
    source: 'macos_clipboard',
    confidence: 'confirmed',
    reason: 'macos_clipboard_roundtrip_ok',
  });
  assert.equal(clipboard.current().text, '旧文本');
  assert.equal(clipboard.current().html, '<b>旧文本</b>');
  assert.equal(clipboard.current().image.id, 'image-1');
});

test('createMacosPlatformCapabilities 在可信目标中执行 macOS 自动粘贴并恢复剪贴板', async () => {
  const clipboard = createRichClipboard();
  const helperCommands = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    clipboard,
    pasteSettleMs: 0,
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      helperCommands.push(args[0]);
      if (args[0] === 'focused-text-target') {
        return createFakeChild({
          stdout: JSON.stringify({
            success: true,
            source: 'macos_ax',
            confidence: 'confirmed',
            reason: 'macos_focused_target_confirmed',
            text_pattern: true,
            control_type: 'AXTextField',
            app_family: 'com.apple.TextEdit',
            foreground_hwnd: 'com.apple.TextEdit',
            focus_hwnd: '42',
            matched_signals: ['frontmost_app', 'role:AXTextField'],
          }),
        });
      }
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          source: 'macos_cgevent',
          confidence: 'sent',
          reason: 'macos_event_injection_sent',
        }),
      });
    },
  });

  const result = await service.pasteText('hello', {
    startFocusInfo: {
      appInfo: {
        app_identifier: 'com.apple.TextEdit',
        app_metadata: { process_id: 42 },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.platform, 'darwin');
  assert.deepEqual(helperCommands, ['focused-text-target', 'send-paste-shortcut']);
  assert.equal(clipboard.current().text, '旧文本');
  assert.equal(clipboard.current().html, '<b>旧文本</b>');
});

test('createMacosPlatformCapabilities 在焦点漂移时拒绝自动粘贴', async () => {
  const clipboard = createRichClipboard();
  const helperCommands = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    clipboard,
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      helperCommands.push(args[0]);
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          source: 'macos_ax',
          confidence: 'confirmed',
          reason: 'macos_focused_target_confirmed',
          text_pattern: true,
          control_type: 'AXTextField',
          app_family: 'com.apple.TextEdit',
          foreground_hwnd: 'com.apple.TextEdit',
          focus_hwnd: '42',
          matched_signals: ['frontmost_app', 'role:AXTextField'],
        }),
      });
    },
  });

  const result = await service.pasteText('hello', {
    startFocusInfo: {
      appInfo: {
        app_identifier: 'com.microsoft.VSCode',
        app_metadata: { process_id: 42 },
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'macos_focused_target_changed');
  assert.deepEqual(helperCommands, ['focused-text-target']);
  assert.equal(clipboard.current().text, '旧文本');
});

test('createMacosPlatformCapabilities 自动粘贴会报告剪贴板恢复失败', async () => {
  const clipboard = createRichClipboard();
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    clipboard,
    pasteSettleMs: 0,
    restoreClipboardSnapshot: () => {
      throw new Error('restore failed');
    },
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      if (args[0] === 'focused-text-target') {
        return createFakeChild({
          stdout: JSON.stringify({
            success: true,
            source: 'macos_ax',
            confidence: 'confirmed',
            text_pattern: true,
            control_type: 'AXTextField',
            foreground_hwnd: 'com.apple.TextEdit',
            focus_hwnd: '42',
            matched_signals: ['frontmost_app', 'role:AXTextField'],
          }),
        });
      }
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          source: 'macos_cgevent',
          confidence: 'sent',
          reason: 'macos_event_injection_sent',
        }),
      });
    },
  });

  const result = await service.pasteText('hello');

  assert.equal(result.success, false);
  assert.equal(result.reason, 'macos_clipboard_restore_failed');
  assert.equal(result.restoreResult.detail, 'restore failed');
});
