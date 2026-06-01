const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { createTextObserverService } = require('./text-observer-service');

function createFakeProcess() {
  const process = new EventEmitter();
  process.killed = false;
  process.stdin = {
    writable: true,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
      return true;
    },
  };
  process.stdout = new EventEmitter();
  process.stdout.setEncoding = () => {};
  process.stderr = new EventEmitter();
  process.stderr.setEncoding = () => {};
  process.kill = () => {
    process.killed = true;
  };
  return process;
}

async function waitForHelperWrite(child) {
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.stdin.writes.length > 0, true);
}

async function waitUntil(predicate, timeoutMs = 200) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true);
}

function emitObserveStarted(child, audioId, overrides = {}) {
  child.stdout.emit('data', `${JSON.stringify({
    type: 'observe-started',
    audioId,
    success: true,
    code: null,
    text: null,
    ...overrides,
  })}\n`);
}

test('createTextObserverService 启动时向 helper 发送 observe-start', async () => {
  const child = createFakeProcess();
  const spawnCalls = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      return child;
    },
    learnCorrection: async () => undefined,
    createSessionManager: undefined,
  });

  const startPromise = service.textObservationManager.start({
    audioId: 'audio-1',
    pastedText: 'hello',
    focusInfo: null,
  });

  await waitForHelperWrite(child);
  emitObserveStarted(child, 'audio-1');
  const result = await startPromise;

  assert.equal(result.success, true);
  assert.equal(spawnCalls.length, 1);
  assert.match(child.stdin.writes[0], /"type":"observe-start"/);
  await service.textObservationManager.stop('test');
});

test('createTextObserverService 观察到文本修改后会调用 learnCorrection', async () => {
  const child = createFakeProcess();
  const learned = [];
  const dictionaryChanges = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: () => child,
    learnCorrection: async (candidate) => {
      learned.push(candidate);
      return { candidates: [{ id: 'candidate-1' }], promotedEntry: null };
    },
    emitDictionaryChanged: (payload) => dictionaryChanges.push(payload),
  });

  const startPromise = service.textObservationManager.start({
    audioId: 'audio-2',
    pastedText: 'client to api',
    focusInfo: null,
  });
  await waitForHelperWrite(child);
  emitObserveStarted(child, 'audio-2');
  await startPromise;
  const result = await service.textObservationManager.handleObservedText({
    audioId: 'audio-2',
    text: 'Client2API',
  });

  assert.equal(result.success, true);
  assert.equal(learned.length > 0, true);
  assert.deepEqual(dictionaryChanges, [{ reason: 'auto-learning-candidate' }]);
  assert.equal(child.stdin.writes.some((chunk) => chunk.includes('"type":"observe-stop"')), true);
  await service.textObservationManager.stop('test');
});

test('createTextObserverService 没有提取到纠错候选时不广播词典变更', async () => {
  const child = createFakeProcess();
  const dictionaryChanges = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: () => child,
    learnCorrection: async () => {
      throw new Error('不应调用学习');
    },
    emitDictionaryChanged: (payload) => dictionaryChanges.push(payload),
  });

  const startPromise = service.textObservationManager.start({
    audioId: 'audio-3',
    pastedText: 'hello',
    focusInfo: null,
  });
  await waitForHelperWrite(child);
  emitObserveStarted(child, 'audio-3');
  await startPromise;
  const result = await service.textObservationManager.handleObservedText({
    audioId: 'audio-3',
    text: 'hello',
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(dictionaryChanges, []);
  await service.textObservationManager.stop('test');
});

test('createTextObserverService 写入 helper stdin 失败时降级为观察不可用', async () => {
  const child = createFakeProcess();
  child.stdin.write = () => {
    const error = new Error('write EPIPE');
    error.code = 'EPIPE';
    throw error;
  };
  const errors = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: () => child,
    logger: { error: (...args) => errors.push(args) },
  });

  const result = await service.textObservationManager.start({
    audioId: 'audio-4',
    pastedText: 'Using Superpower',
    focusInfo: null,
  });

  assert.deepEqual(result, { success: false, code: 'native_observer_unavailable' });
  assert.equal(service.getProcess(), null);
  assert.equal(errors.length, 1);
});

test('createTextObserverService 等待 helper 返回真实 observe-started 失败结果', async () => {
  const child = createFakeProcess();
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    spawnProcess: () => child,
  });

  const startPromise = service.textObservationManager.start({
    audioId: 'audio-start-failed',
    pastedText: '微信输入',
    focusInfo: null,
  });

  try {
    await waitForHelperWrite(child);
    emitObserveStarted(child, 'audio-start-failed', {
      success: false,
      code: 'text_pattern_unavailable',
    });

    assert.deepEqual(await startPromise, {
      success: false,
      code: 'text_pattern_unavailable',
    });
  } finally {
    await service.textObservationManager.stop('test');
  }
});

test('createTextObserverService 启动 helper 时注入本地 dotnet runtime', async () => {
  const child = createFakeProcess();
  const spawnCalls = [];
  const service = createTextObserverService({
    processPlatform: 'win32',
    exePath: 'C:\\helper.exe',
    dotnetRoot: 'D:\\CodeWorkSpace\\typeless\\.tmp-dotnet',
    processEnv: {
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
    },
    fileExists: (targetPath) => (
      targetPath === 'C:\\helper.exe'
      || targetPath === 'D:\\CodeWorkSpace\\typeless\\.tmp-dotnet'
    ),
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      return child;
    },
  });

  const startPromise = service.textObservationManager.start({
    audioId: 'audio-5',
    pastedText: 'hello',
    focusInfo: null,
  });

  await waitForHelperWrite(child);
  emitObserveStarted(child, 'audio-5');
  const result = await startPromise;

  assert.equal(result.success, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][2].env.DOTNET_ROOT, 'D:\\CodeWorkSpace\\typeless\\.tmp-dotnet');
  assert.equal(spawnCalls[0][2].env['DOTNET_ROOT(x64)'], 'D:\\CodeWorkSpace\\typeless\\.tmp-dotnet');
  assert.match(spawnCalls[0][2].env.PATH, /^D:\\CodeWorkSpace\\typeless\\.tmp-dotnet;/);
  await service.textObservationManager.stop('test');
});

test('createTextObserverService 在 macOS 轮询观察到修正后写入候选', async () => {
  const reads = ['client to api', 'Client2API'];
  const learned = [];
  const dictionaryChanges = [];
  const service = createTextObserverService({
    processPlatform: 'darwin',
    macosPollIntervalMs: 1,
    macosPlatformCapabilities: {
      getFocusedTextForObservation: async () => ({
        success: true,
        text: reads.shift() || 'Client2API',
        source: 'macos_ax',
        confidence: 'confirmed',
        reason: 'macos_observed_text_read',
      }),
    },
    learnCorrection: async (candidate) => {
      learned.push(candidate);
      return { candidates: [{ id: 'candidate-mac' }], promotedEntry: null };
    },
    emitDictionaryChanged: (payload) => dictionaryChanges.push(payload),
  });

  const result = await service.textObservationManager.start({
    audioId: 'audio-mac-1',
    pastedText: 'client to api',
    focusInfo: {
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
  await waitUntil(() => learned.length > 0);

  assert.deepEqual(learned, [{ wrong: 'client to api', correct: 'Client2API' }]);
  assert.deepEqual(dictionaryChanges, [{ reason: 'auto-learning-candidate' }]);
  assert.equal(service.getMacosObservation(), null);
});

test('createTextObserverService 在 macOS 观察目标不可读时静默降级', async () => {
  const service = createTextObserverService({
    processPlatform: 'darwin',
    macosPlatformCapabilities: {
      getFocusedTextForObservation: async () => ({
        success: false,
        reason: 'macos_observed_text_unavailable',
      }),
    },
  });

  const result = await service.textObservationManager.start({
    audioId: 'audio-mac-2',
    pastedText: 'hello',
    focusInfo: null,
  });

  assert.deepEqual(result, {
    success: false,
    code: 'macos_observed_text_unavailable',
  });
  assert.equal(service.getMacosObservation(), null);
});

test('createTextObserverService 在 macOS 轮询中目标失效时清理活动会话', async () => {
  const reads = [
    { success: true, text: 'hello', source: 'macos_ax', confidence: 'confirmed' },
    { success: false, reason: 'macos_observation_target_changed' },
  ];
  const service = createTextObserverService({
    processPlatform: 'darwin',
    macosPollIntervalMs: 1,
    macosPlatformCapabilities: {
      getFocusedTextForObservation: async () => reads.shift() || {
        success: false,
        reason: 'macos_observation_target_changed',
      },
    },
  });

  const result = await service.textObservationManager.start({
    audioId: 'audio-mac-target-lost',
    pastedText: 'hello',
    focusInfo: null,
  });

  assert.equal(result.success, true);
  await waitUntil(() => service.getMacosObservation() === null);
  assert.equal(service.textObservationManager.getActiveSession(), null);
});
