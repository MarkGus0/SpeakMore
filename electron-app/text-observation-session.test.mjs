import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextObservationSessionManager } from './text-observation-session.js';

test('观察到用户修改后写入候选', async () => {
  const learned = [];
  const manager = createTextObservationSessionManager({
    startNativeObservation: async () => ({ success: true }),
    stopNativeObservation: async () => {},
    learnCorrection: async (candidate) => learned.push(candidate),
    now: () => '2026-05-18T00:00:00.000Z',
    timeoutMs: 1000,
  });

  await manager.start({
    audioId: 'audio-1',
    pastedText: '我在使用 client to api',
    focusInfo: { processId: 100, windowTitle: 'Editor' },
  });

  await manager.handleObservedText({
    audioId: 'audio-1',
    text: '我在使用 Client2API',
  });

  assert.deepEqual(learned, [{ wrong: 'client to api', correct: 'Client2API' }]);
  assert.equal(manager.getActiveSession(), null);
});

test('不同 audioId 的观察结果会被忽略', async () => {
  const learned = [];
  const manager = createTextObservationSessionManager({
    startNativeObservation: async () => ({ success: true }),
    stopNativeObservation: async () => {},
    learnCorrection: async (candidate) => learned.push(candidate),
    now: () => '2026-05-18T00:00:00.000Z',
    timeoutMs: 1000,
  });

  await manager.start({ audioId: 'audio-1', pastedText: 'hello word', focusInfo: {} });
  await manager.handleObservedText({ audioId: 'audio-2', text: 'hello world' });

  assert.deepEqual(learned, []);
  assert.equal(manager.getActiveSession()?.audioId, 'audio-1');
  await manager.stop('test');
});

test('native 观察不可用时不会保留活动会话', async () => {
  const manager = createTextObservationSessionManager({
    startNativeObservation: async () => ({ success: false, code: 'native_unavailable' }),
    stopNativeObservation: async () => {},
    learnCorrection: async () => {},
    timeoutMs: 1000,
  });

  const result = await manager.start({ audioId: 'audio-1', pastedText: 'hello word', focusInfo: {} });

  assert.deepEqual(result, { success: false, code: 'native_unavailable' });
  assert.equal(manager.getActiveSession(), null);
});
