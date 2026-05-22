import { createVoiceError, type VoiceError } from './voiceTypes'

export function getRecordingDurationMs(recordingStartedAt: number, now = Date.now()) {
  // 连接准备阶段不计入听写时长。
  return recordingStartedAt > 0 ? Math.max(0, now - recordingStartedAt) : 0
}

export function countTextLength(text: string) {
  // 统计统一用 trim 后长度，避免首尾空白影响历史统计。
  return text.trim().length
}

export function normalizeVoiceError(error: unknown, fallbackCode: Parameters<typeof createVoiceError>[0]) {
  // 已经是 VoiceError 的对象直接透传，普通异常才包成前端错误码。
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as VoiceError
  }
  return createVoiceError(fallbackCode, error instanceof Error ? error.message : String(error))
}
