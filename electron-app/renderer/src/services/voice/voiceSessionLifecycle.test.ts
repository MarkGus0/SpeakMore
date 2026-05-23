import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createVoiceSessionLifecycle } from './voiceSessionLifecycle'

test('isSessionActive 只接受当前 audioId', () => {
  const lifecycle = createVoiceSessionLifecycle({
    timeoutMs: 1000,
    setTimer: () => 1,
    clearTimer: () => undefined,
    onTimeout: () => undefined,
  })

  lifecycle.startSession('audio-1')

  assert.equal(lifecycle.isSessionActive('audio-1', 'audio-1'), true)
  assert.equal(lifecycle.isSessionActive('audio-1', 'audio-2'), false)
  assert.equal(lifecycle.isSessionActive('audio-2', 'audio-2'), false)
})

test('ignoreAudioId 后 isIgnoredAudioId 为 true', () => {
  const lifecycle = createVoiceSessionLifecycle({
    timeoutMs: 1000,
    setTimer: () => 1,
    clearTimer: () => undefined,
    onTimeout: () => undefined,
  })

  lifecycle.ignoreAudioId('audio-1')

  assert.equal(lifecycle.isIgnoredAudioId('audio-1'), true)
  assert.equal(lifecycle.isIgnoredAudioId('audio-2'), false)
})

test('dispose 会清空 ignored audio ids', () => {
  const clearedTimers: number[] = []
  const lifecycle = createVoiceSessionLifecycle({
    timeoutMs: 1000,
    setTimer: () => 1,
    clearTimer: (timerId) => {
      clearedTimers.push(timerId)
    },
    onTimeout: () => undefined,
  })

  lifecycle.ignoreAudioId('audio-1')
  lifecycle.startSession('audio-2')
  lifecycle.startTranscribeTimeout()
  lifecycle.dispose()

  assert.equal(lifecycle.isIgnoredAudioId('audio-1'), false)
  assert.equal(clearedTimers.length > 0, true)
})
