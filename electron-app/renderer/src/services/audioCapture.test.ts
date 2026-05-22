import assert from 'node:assert/strict'
import { test } from 'node:test'

import { downsampleToSampleRate, encodePcm16, sendPcm16Chunk } from './audioCapture'

test('encodePcm16 会裁剪并编码到 PCM16 范围', () => {
  const pcm = encodePcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2]))

  assert.deepEqual(Array.from(pcm), [-32768, -32768, -16384, 0, 16384, 32767, 32767])
})

test('downsampleToSampleRate 会按比例从高采样率降采样', () => {
  const input = Float32Array.from([0, 1, 2, 3, 4, 5])
  const downsampled = downsampleToSampleRate(input, 48000, 16000)

  assert.deepEqual(Array.from(downsampled), [0, 3])
})

test('downsampleToSampleRate 遇到低于目标采样率的输入会原样返回', () => {
  const input = Float32Array.from([0.1, 0.2])

  assert.equal(downsampleToSampleRate(input, 8000, 16000), input)
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
