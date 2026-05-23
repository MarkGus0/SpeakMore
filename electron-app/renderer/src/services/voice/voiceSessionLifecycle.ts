/**
 * 语音会话生命周期边界
 *
 * 需要判断当前 audioId、过滤取消后的迟到消息或管理转写超时时看这里。
 */
import { getRecordingDurationMs } from './voiceSessionUtils'

type TimerId = number

type VoiceSessionLifecycleOptions = {
  timeoutMs: number
  setTimer: (callback: () => void, timeoutMs: number) => TimerId
  clearTimer: (timerId: TimerId) => void
  onTimeout: () => void
}

export function createVoiceSessionLifecycle({
  timeoutMs,
  setTimer,
  clearTimer,
  onTimeout,
}: VoiceSessionLifecycleOptions) {
  let activeSessionId: string | null = null
  let recordingStartedAt = 0
  let transcribeTimer: TimerId | null = null
  const ignoredAudioIds = new Set<string>()

  const clearTranscribeTimeout = () => {
    // 多条完成/失败路径都会调用这里，重复清理要保持无副作用。
    if (transcribeTimer !== null) clearTimer(transcribeTimer)
    transcribeTimer = null
  }

  return {
    startSession: (audioId: string) => {
      activeSessionId = audioId
      recordingStartedAt = 0
    },
    markRecordingStarted: () => {
      recordingStartedAt = Date.now()
    },
    getDurationMs: () => getRecordingDurationMs(recordingStartedAt),
    resetRecordingStarted: () => {
      recordingStartedAt = 0
    },
    isSessionActive: (audioId: string, currentAudioId: string) => (
      activeSessionId === audioId && currentAudioId === audioId
    ),
    ignoreAudioId: (audioId: string) => {
      ignoredAudioIds.add(audioId)
    },
    isIgnoredAudioId: (audioId: string) => ignoredAudioIds.has(audioId),
    clearActive: () => {
      activeSessionId = null
    },
    startTranscribeTimeout: () => {
      // end_audio 后必须有最终消息或错误消息，否则按 WebSocket 超时处理。
      clearTranscribeTimeout()
      transcribeTimer = setTimer(onTimeout, timeoutMs)
    },
    clearTranscribeTimeout,
    dispose: () => {
      activeSessionId = null
      recordingStartedAt = 0
      ignoredAudioIds.clear()
      clearTranscribeTimeout()
    },
  }
}
