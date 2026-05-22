import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from './audioLevelMonitor'

type WindowWithTimers = typeof globalThis & {
  setInterval: (callback: () => void, timeout: number) => number
  clearInterval: (id: number) => void
}

function installAudioLevelEnvironment(sample = 1) {
  const originalWindow = globalThis.window
  const originalAudioContext = globalThis.AudioContext
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const intervalCallbacks = new Map<number, () => void>()
  const clearedIntervals: number[] = []
  let nextIntervalId = 1
  let closeCalls = 0

  class FakeAnalyserNode {
    fftSize = 2048
    smoothingTimeConstant = 0

    getFloatTimeDomainData(target: Float32Array) {
      target.fill(sample)
    }
  }

  class FakeMediaStreamAudioSourceNode {
    connect(_node: unknown) {}

    disconnect() {}
  }

  class FakeAudioContext {
    destination = {}

    createAnalyser() {
      return new FakeAnalyserNode()
    }

    createMediaStreamSource(_stream: MediaStream) {
      return new FakeMediaStreamAudioSourceNode()
    }

    resume() {
      return Promise.resolve()
    }

    close() {
      closeCalls += 1
      return Promise.resolve()
    }
  }

  const windowLike = globalThis as WindowWithTimers
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  })
  Object.defineProperty(globalThis, 'setInterval', {
    configurable: true,
    value: (callback: () => void) => {
      const id = nextIntervalId
      nextIntervalId += 1
      intervalCallbacks.set(id, callback)
      return id
    },
  })
  Object.defineProperty(globalThis, 'clearInterval', {
    configurable: true,
    value: (id: number) => {
      clearedIntervals.push(id)
      intervalCallbacks.delete(id)
    },
  })

  return {
    stream: {} as MediaStream,
    clearedIntervals,
    getCloseCalls: () => closeCalls,
    runLevelTick() {
      Array.from(intervalCallbacks.values()).forEach((callback) => callback())
    },
    restore() {
      cleanupAudioLevelMonitoring()
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
      Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: originalAudioContext,
      })
      Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        value: originalSetInterval,
      })
      Object.defineProperty(globalThis, 'clearInterval', {
        configurable: true,
        value: originalClearInterval,
      })
    },
  }
}

test('startAudioLevelMonitoring 会通过回调输出平滑后的归一化音量', () => {
  const env = installAudioLevelEnvironment(1)
  const levels: number[] = []

  try {
    startAudioLevelMonitoring(env.stream, (level) => levels.push(level))
    env.runLevelTick()

    assert.deepEqual(levels, [0.42])
  } finally {
    env.restore()
  }
})

test('cleanupAudioLevelMonitoring 会清理 interval 并关闭 AudioContext', () => {
  const env = installAudioLevelEnvironment(1)

  try {
    startAudioLevelMonitoring(env.stream, () => undefined)
    cleanupAudioLevelMonitoring()

    assert.deepEqual(env.clearedIntervals, [1])
    assert.equal(env.getCloseCalls(), 1)
  } finally {
    env.restore()
  }
})
