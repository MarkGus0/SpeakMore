const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createRightAltListenerService } = require('./right-alt-listener-service');

function createFakeProcess() {
  const process = new EventEmitter();
  process.killed = false;
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = () => {
    process.killed = true;
  };
  return process;
}

test('handleListenerLine 将普通按键 payload 转交给 relay', () => {
  const handled = [];
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"RightAlt","isKeydown":true}');

  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});

test('handleListenerLine 遇到 Escape keydown 时调用专用回调，不进入 relay', () => {
  let escapeCount = 0;
  let relayCount = 0;
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    handleEscapeKeydown: () => {
      escapeCount += 1;
    },
    createRelay: () => ({
      handlePayload: () => {
        relayCount += 1;
      },
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"Escape","isKeydown":true}');

  assert.equal(escapeCount, 1);
  assert.equal(relayCount, 0);
});

test('handleListenerLine 忽略非右侧 Option 协议键', () => {
  const handled = [];
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"LeftAlt","isKeydown":true}');
  service.handleListenerLine('{"key":"Option","isKeydown":true}');
  service.handleListenerLine('{"key":"RightAlt","isKeydown":true}');

  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});

test('handleListenerLine 将 RightCommand payload 转交给 relay', () => {
  const handled = [];
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"RightCommand","isKeydown":true}');

  assert.deepEqual(handled, [{ key: 'RightCommand', isKeydown: true }]);
});

test('handleListenerLine 忽略左 Command 协议键', () => {
  const handled = [];
  const service = createRightAltListenerService({
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  service.handleListenerLine('{"key":"LeftCommand","isKeydown":true}');

  assert.deepEqual(handled, []);
});

test('macOS Option 监听器只按右 Option keycode 映射 RightAlt', () => {
  const source = fs.readFileSync(path.join(__dirname, 'macos-option-listener.c'), 'utf8');

  assert.match(source, /KEY_CODE_RIGHT_OPTION\s*=\s*61/);
  assert.match(source, /NX_DEVICERALTKEYMASK/);
  assert.match(source, /key_code\s*==\s*KEY_CODE_RIGHT_OPTION/);
  assert.doesNotMatch(source, /kCGEventFlagMaskAlternate\)\s*!=\s*0/);
});

test('start 在非 Windows 平台不启动监听进程', () => {
  let spawned = false;
  const service = createRightAltListenerService({
    processPlatform: 'linux',
    spawnProcess: () => {
      spawned = true;
      return createFakeProcess();
    },
  });

  assert.equal(service.start(), false);
  assert.equal(spawned, false);
});

test('start 在 Windows 平台启动 PowerShell 并路由 stdout 行', () => {
  const child = createFakeProcess();
  const handled = [];
  const service = createRightAltListenerService({
    processPlatform: 'win32',
    rightAltListenerPath: () => 'D:\\right-alt-listener.ps1',
    spawnProcess: () => child,
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  assert.equal(service.start(), true);
  child.stdout.emit('data', '{"key":"RightAlt","isKeydown":true}\n');

  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});

test('start 在 macOS 平台编译并启动 Option 监听器，随后路由 stdout 行', () => {
  const child = createFakeProcess();
  const handled = [];
  const spawnCalls = [];
  const compileCalls = [];
  const service = createRightAltListenerService({
    processPlatform: 'darwin',
    macosOptionListenerPath: () => '/repo/electron-app/macos-option-listener.c',
    macosOptionListenerExecutablePath: () => '/tmp/speakmore-macos-option-listener',
    clangExecutablePath: () => '/usr/bin/clang',
    spawnSyncProcess: (command, args) => {
      compileCalls.push({ command, args });
      return { status: 0, stderr: '' };
    },
    spawnProcess: (command, args) => {
      spawnCalls.push({ command, args });
      return child;
    },
    emitKeyboardState: () => undefined,
    createRelay: () => ({
      handlePayload: (payload) => handled.push(payload),
      dispose: () => undefined,
    }),
  });

  assert.equal(service.start(), true);
  child.stdout.emit('data', '{"key":"RightAlt","isKeydown":true}\n');

  assert.deepEqual(compileCalls, [{
    command: '/usr/bin/clang',
    args: [
      '-framework',
      'ApplicationServices',
      '/repo/electron-app/macos-option-listener.c',
      '-o',
      '/tmp/speakmore-macos-option-listener',
    ],
  }]);
  assert.deepEqual(spawnCalls, [{
    command: '/tmp/speakmore-macos-option-listener',
    args: [],
  }]);
  assert.deepEqual(handled, [{ key: 'RightAlt', isKeydown: true }]);
});

test('start 在 macOS Option 监听器编译失败时不启动子进程', () => {
  let spawned = false;
  const service = createRightAltListenerService({
    processPlatform: 'darwin',
    macosOptionListenerPath: () => '/repo/electron-app/macos-option-listener.c',
    spawnSyncProcess: () => ({ status: 1, stderr: 'compile failed' }),
    spawnProcess: () => {
      spawned = true;
      return createFakeProcess();
    },
  });

  assert.equal(service.start(), false);
  assert.equal(spawned, false);
});
