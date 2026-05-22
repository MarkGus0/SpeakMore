import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  countTextLength,
  getRecordingDurationMs,
  normalizeVoiceError,
} from './voiceSessionUtils'
import { createVoiceError } from './voiceTypes'

test('getRecordingDurationMs 在未开始录音时返回 0', () => {
  assert.equal(getRecordingDurationMs(0, 1000), 0)
})

test('getRecordingDurationMs 只返回非负录音时长', () => {
  assert.equal(getRecordingDurationMs(700, 1000), 300)
  assert.equal(getRecordingDurationMs(1200, 1000), 0)
})

test('countTextLength 按 trim 后文本长度统计', () => {
  assert.equal(countTextLength('  hello  '), 5)
  assert.equal(countTextLength('\n  你好  \t'), 2)
})

test('normalizeVoiceError 会透传已有 VoiceError', () => {
  const voiceError = createVoiceError('backend_unavailable', 'ready failed')

  assert.equal(normalizeVoiceError(voiceError, 'unknown'), voiceError)
})

test('normalizeVoiceError 会用 fallback code 包装普通异常', () => {
  const normalized = normalizeVoiceError(new Error('boom'), 'recording_start_failed')

  assert.equal(normalized.code, 'recording_start_failed')
  assert.equal(normalized.detail, 'boom')
})
