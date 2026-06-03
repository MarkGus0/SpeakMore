import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encodePcm16, getAudioStream, resampleToSampleRate, sendPcm16Chunk } from './audioCapture'

test('encodePcm16 会裁剪并编码到 PCM16 范围', () => {
  const pcm = encodePcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]))

  assert.deepEqual(Array.from(pcm), [-32768, -32768, -16384, 0, 16384, 32767, 32767])
})

test('resampleToSampleRate 会按比例从高采样率降采样', () => {
  const input = Float32Array.from([0, 1, 2, 3, 4, 5])
  const downsampled = resampleToSampleRate(input, 48000, 16000)

  assert.deepEqual(Array.from(downsampled), [0, 3])
})

test('resampleToSampleRate 会把蓝牙耳机常见低采样率升到目标采样率', () => {
  const input = Float32Array.from([0.1, 0.2])
  const resampled = resampleToSampleRate(input, 8000, 16000)

  assert.notEqual(resampled, input)
  assert.deepEqual(Array.from(resampled), [0.1, 0.15, 0.2, 0.2].map((value) => Math.fround(value)))
})

test('sendPcm16Chunk 会把 8k 耳机输入转成协议要求的 16k PCM', () => {
  const sentPayloads: unknown[] = []
  const openSocket = {
    readyState: WebSocket.OPEN,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket

  sendPcm16Chunk(openSocket, Float32Array.from([0, 0.5]), 8000)

  assert.equal(sentPayloads.length, 1)
  assert.deepEqual(Array.from(new Int16Array(sentPayloads[0] as ArrayBuffer)), [0, 8192, 16384, 16384])
})

test('sendPcm16Chunk 只在 WebSocket OPEN 时发送 ArrayBuffer', () => {
  const sentPayloads: unknown[] = []
  const openSocket = {
    readyState: WebSocket.OPEN,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket
  const closedSocket = {
    readyState: WebSocket.CLOSED,
    send: (payload: unknown) => { sentPayloads.push(payload) },
  } as unknown as WebSocket

  sendPcm16Chunk(openSocket, Float32Array.from([0, 0.5, -0.5]), 16000)
  sendPcm16Chunk(closedSocket, Float32Array.from([1]), 16000)

  assert.equal(sentPayloads.length, 1)
  assert.ok(sentPayloads[0] instanceof ArrayBuffer)
  assert.deepEqual(Array.from(new Int16Array(sentPayloads[0] as ArrayBuffer)), [0, 16384, -16384])
})

test('getAudioStream 在耳机不接受采样率约束时使用同一设备降级重试', async () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window
  const calls: MediaStreamConstraints[] = []
  const stream = {} as MediaStream
  const overconstrained = new DOMException('sample rate unsupported', 'OverconstrainedError')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ipcRenderer: {
        invoke: async (channel: string) => {
          assert.equal(channel, 'settings:get')
          return { selectedAudioDeviceId: 'headset-device' }
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          calls.push(constraints)
          if (calls.length === 1) throw overconstrained
          return stream
        },
      },
    },
  })

  try {
    assert.equal(await getAudioStream(), stream)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0], {
      audio: {
        deviceId: { exact: 'headset-device' },
        sampleRate: { ideal: 16000 },
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    })
    assert.deepEqual(calls[1], {
      audio: {
        deviceId: { exact: 'headset-device' },
      },
    })
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
