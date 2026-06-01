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
