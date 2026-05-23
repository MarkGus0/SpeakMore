/**
 * 语音会话状态存储
 *
 * 需要维护 VoiceSession 快照、订阅广播或悬浮胶囊状态同步时看这里。
 */
import {
  initialVoiceSession,
  type VoiceSession,
  type VoiceStatus,
} from './voiceTypes'

export type VoiceSessionListener = (session: VoiceSession) => void

export function createVoiceSessionStore({ sendVoiceState }: {
  sendVoiceState: (session: VoiceSession) => void
}) {
  let session = initialVoiceSession
  const listeners = new Set<VoiceSessionListener>()

  const setSession = (next: VoiceSession) => {
    // 状态广播顺序保持和旧 recorder 一致，避免页面和悬浮窗看到不同步快照。
    session = next
    listeners.forEach((listener) => listener(session))
    sendVoiceState(session)
  }

  const setSessionStatus = (status: VoiceStatus) => {
    // 进入新状态时清掉旧错误，避免 UI 在恢复流程里展示过期错误。
    setSession({ ...session, status, error: null })
  }

  const updateInputLevel = (inputLevel: number) => {
    const normalizedInputLevel = Math.max(0, Math.min(1, inputLevel))
    // 音量变化太小时不广播，避免悬浮胶囊被高频微小波动拖慢。
    if (Math.abs(session.inputLevel - normalizedInputLevel) < 0.005) return
    setSession({ ...session, inputLevel: normalizedInputLevel })
  }

  return {
    getSession: () => session,
    setSession,
    setSessionStatus,
    updateInputLevel,
    subscribe: (listener: VoiceSessionListener) => {
      listeners.add(listener)
      listener(session)
      return () => {
        listeners.delete(listener)
      }
    },
    clearListeners: () => listeners.clear(),
  }
}
