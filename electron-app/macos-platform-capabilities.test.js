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

test('createMacosPlatformCapabilities 读取 macOS 选区并归一化为自由提问上下文', async () => {
  const helperCommands = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      helperCommands.push(args[0]);
      if (args[0] === 'focused-info') {
        return createFakeChild({
          stdout: JSON.stringify({
            success: true,
            source: 'macos_ax',
            confidence: 'confirmed',
            appInfo: {
              app_name: 'TextEdit',
              app_identifier: 'com.apple.TextEdit',
              window_title: 'note.txt',
              app_type: 'native_app',
              app_metadata: {
                bundle_id: 'com.apple.TextEdit',
                process_id: 42,
              },
              browser_context: null,
            },
            elementInfo: {
              role: 'AXTextArea',
              focused: true,
              editable: true,
              selected: true,
              bounds: { x: 1, y: 2, width: 300, height: 40 },
            },
          }),
        });
      }
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          text: '  选中的上下文  ',
          source: 'macos_ax',
          confidence: 'confirmed',
          reason: 'macos_selected_text_confirmed',
          selection_scope: 'focused_element',
          role: 'AXTextArea',
          app_identifier: 'com.apple.TextEdit',
          process_id: 42,
        }),
      });
    },
  });

  const snapshot = await service.getSelectionSnapshot();

  assert.equal(snapshot.success, true);
  assert.equal(snapshot.text, '选中的上下文');
  assert.equal(snapshot.source, 'uia');
  assert.equal(snapshot.confidence, 'confirmed');
  assert.equal(snapshot.platformSource, 'macos_ax');
  assert.equal(snapshot.selectionScope, 'focused_element');
  assert.equal(snapshot.focusInfo.appInfo.app_identifier, 'com.apple.TextEdit');
  assert.equal(snapshot.focusInfo.elementInfo.selected, true);
  assert.deepEqual(helperCommands, ['focused-info', 'selected-text']);
});

test('createMacosPlatformCapabilities 在 macOS 选区权限缺失时返回空选区和焦点信息', async () => {
  const helperCommands = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      helperCommands.push(args[0]);
      if (args[0] === 'focused-info') {
        return createFakeChild({
          stdout: JSON.stringify({
            success: false,
            source: 'macos_ax',
            confidence: 'none',
            reason: 'macos_accessibility_permission_missing',
            appInfo: {
              app_name: 'TextEdit',
              app_identifier: 'com.apple.TextEdit',
              window_title: '',
              app_type: 'native_app',
              app_metadata: { bundle_id: 'com.apple.TextEdit', process_id: 42 },
              browser_context: null,
            },
            elementInfo: {
              role: '',
              focused: false,
              editable: false,
              selected: false,
              bounds: { x: 0, y: 0, width: 0, height: 0 },
            },
          }),
        });
      }
      return createFakeChild({
        stdout: JSON.stringify({
          success: false,
          text: '',
          source: 'macos_ax',
          confidence: 'none',
          reason: 'macos_accessibility_permission_missing',
          selection_scope: 'focused_element',
        }),
      });
    },
  });

  const snapshot = await service.getSelectionSnapshot();

  assert.equal(snapshot.success, false);
  assert.equal(snapshot.text, '');
  assert.equal(snapshot.source, 'none');
  assert.equal(snapshot.confidence, 'none');
  assert.equal(snapshot.reason, 'macos_accessibility_permission_missing');
  assert.equal(snapshot.focusInfo.appInfo.app_identifier, 'com.apple.TextEdit');
  assert.deepEqual(helperCommands, ['focused-info', 'selected-text']);
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

test('createMacosPlatformCapabilities 读取 macOS 自动学习观察文本', async () => {
  const helperCommands = [];
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: (_command, args) => {
      helperCommands.push(args[0]);
      return createFakeChild({
        stdout: JSON.stringify({
          success: true,
          text: ' Client2API ',
          source: 'macos_ax',
          confidence: 'confirmed',
          reason: 'macos_observed_text_read',
          app_identifier: 'com.apple.TextEdit',
          app_family: 'com.apple.TextEdit',
          process_id: 42,
          role: 'AXTextArea',
          subrole: '',
          bounds: { x: 1, y: 2, width: 300, height: 40 },
        }),
      });
    },
  });

  const result = await service.getFocusedTextForObservation({
    startFocusInfo: {
      appInfo: {
        app_identifier: 'com.apple.TextEdit',
        app_metadata: { process_id: 42 },
      },
      elementInfo: {
        role: 'AXTextArea',
        bounds: { x: 1, y: 2, width: 300, height: 40 },
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.text, 'Client2API');
  assert.equal(result.appIdentifier, 'com.apple.TextEdit');
  assert.equal(result.processId, 42);
  assert.deepEqual(helperCommands, ['focused-text-observation']);
});

test('createMacosPlatformCapabilities 在 macOS 观察目标漂移时拒绝读取文本', async () => {
  const service = createMacosPlatformCapabilities({
    processPlatform: 'darwin',
    helperSourcePath: () => '/repo/electron-app/macos-platform-helper.m',
    helperExecutablePath: () => '/tmp/speakmore-macos-platform-helper',
    spawnSyncProcess: () => ({ status: 0, stdout: '', stderr: '' }),
    spawnProcess: () => createFakeChild({
      stdout: JSON.stringify({
        success: true,
        text: 'new target text',
        source: 'macos_ax',
        confidence: 'confirmed',
        reason: 'macos_observed_text_read',
        app_identifier: 'com.apple.TextEdit',
        app_family: 'com.apple.TextEdit',
        process_id: 42,
        role: 'AXTextArea',
        subrole: '',
        bounds: { x: 1, y: 2, width: 300, height: 40 },
      }),
    }),
  });

  const result = await service.getFocusedTextForObservation({
    startFocusInfo: {
      appInfo: {
        app_identifier: 'com.microsoft.VSCode',
        app_metadata: { process_id: 42 },
      },
      elementInfo: {
        role: 'AXTextArea',
        bounds: { x: 1, y: 2, width: 300, height: 40 },
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.text, '');
  assert.equal(result.reason, 'macos_observation_target_changed');
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
