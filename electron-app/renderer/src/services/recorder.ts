/**
 * 语音会话对外 facade
 *
 * 需要理解录音启动、停止、取消、状态订阅和 UI 对接时看这里。
 */
import { ipcClient } from './ipc'
import { muteBackgroundAudio, resetBackgroundAudioRestoreState, restoreBackgroundAudio } from './voice/backgroundAudio'
import { createPcm16AudioSender, stopStreamTracks, type AudioSender } from './voice/audioCapture'
import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from './voice/audioLevelMonitor'
import { cleanupPreparedStart, prepareRecordingStart } from './voice/recordingStartup'
import { deliverVoiceResult, hideFloatingPanel } from './voice/voiceResultDelivery'
import type { ShortcutIntent } from './shortcutGuard'
import { countTextLength, getRecordingDurationMs, normalizeVoiceError } from './voice/voiceSessionUtils'
import { createVoiceSocketManager } from './voice/voiceSocket'
import { resolveVoiceTask, type VoiceTask } from './voice/voiceTaskResolver'
import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
  toVoiceFlowMode,
  type VoiceError,
  type VoiceMode,
  type VoiceSession,
  type VoiceStatus,
} from './voice/voiceTypes'

const TRANSCRIBE_TIMEOUT_MS = 60000
// 只有这些状态代表本轮语音还没有产出最终结果，Escape 才允许取消。
const CANCELABLE_STATUSES = new Set<VoiceStatus>(['connecting', 'recording', 'stopping', 'transcribing'])

type VoiceSessionListener = (session: VoiceSession) => void

// recorder 是渲染进程里的语音状态机，模块级变量用于保存当前唯一一轮录音会话。
// 这里不放进 React state，是因为快捷键、悬浮窗、WebSocket 和页面组件都要共享同一份录音事实。
let session: VoiceSession = initialVoiceSession
// 音频资源按“当前会话”持有，避免多个页面组件各自创建连接。
let mediaRecorder: MediaRecorder | null = null
let pcmAudioSender: AudioSender | null = null
let activeStream: MediaStream | null = null
let transcribeTimer: number | null = null
let recordingStartedAt = 0
let activeSessionId: string | null = null
let activeTask: VoiceTask | null = null
// 取消会话后，后端可能仍然返回旧 audioId 的消息，必须集中记录并过滤。
const ignoredAudioIds = new Set<string>()
const listeners = new Set<VoiceSessionListener>()
const voiceSocket = createVoiceSocketManager({
  getCurrentAudioId: () => session.audioId || '',
  getCurrentRawText: () => session.rawText,
  isIgnoredAudioId: (audioId: string) => ignoredAudioIds.has(audioId),
  isCancelledSession: () => session.status === 'cancelled',
  isTerminalSession: () => session.status === 'completed' || session.status === 'error',
  shouldFailOnClose: () => session.status === 'recording' || session.status === 'transcribing',
  onRawText: handleRawText,
  onFinalText: (text) => void completeSession(text),
  onError: failSession,
  onInterrupt: (detail) => failSession(createVoiceError('backend_unavailable', detail || '会话已被中断')),
})

// 外部页面读取当前语音状态时只拿快照，真正状态修改必须走 recorder 内部函数。
export function getVoiceSession() {
  return session
}

// AppShell、页面和悬浮 UI 都通过订阅拿状态；返回清理函数避免组件卸载后继续收通知。
export function subscribeVoiceSession(listener: VoiceSessionListener) {
  listeners.add(listener)
  // 新订阅者需要立刻拿到当前状态，避免页面切换后 UI 等下一次状态变更。
  listener(session)
  return () => {
    listeners.delete(listener)
  }
}

// 页面按钮入口按显式模式启动；如果当前正在录音，同一个入口就变成停止。
export async function toggleRecording(mode: VoiceMode) {
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecording(mode)
}

// 快捷键入口先保留“意图”，后续再结合选区快照解析成最终任务。
export async function toggleRecordingByShortcut(intent: ShortcutIntent) {
  if (session.status === 'recording') {
    stopRecording()
    return
  }

  if (session.status === 'connecting' || session.status === 'stopping' || session.status === 'transcribing') {
    return
  }

  await startRecordingFromIntent(intent)
}

function toShortcutIntent(mode: VoiceMode): ShortcutIntent {
  if (mode === 'Ask') return 'AskShortcut'
  if (mode === 'Translate') return 'TranslateShortcut'
  return 'DictateShortcut'
}

// 兼容旧调用方：外部如果只知道 VoiceMode，这里转换成统一的快捷键意图入口。
export async function startRecording(mode: VoiceMode) {
  await startRecordingFromIntent(toShortcutIntent(mode))
}

function getInitialModeForIntent(intent: ShortcutIntent): VoiceMode {
  if (intent === 'AskShortcut') return 'Ask'
  if (intent === 'TranslateShortcut') return 'Translate'
  return 'Dictate'
}

async function startRecordingFromIntent(intent: ShortcutIntent) {
  // audioId 是本轮录音的唯一边界，后续 WebSocket 消息必须匹配它才会被接受。
  // 新录音开始前先隐藏旧结果，避免用户看到上一轮悬浮面板误以为是当前结果。
  hideFloatingPanel()
  resetBackgroundAudioRestoreState()
  recordingStartedAt = 0
  const audioId = crypto.randomUUID()
  activeSessionId = audioId
  setSession({
    ...initialVoiceSession,
    status: 'connecting',
    mode: getInitialModeForIntent(intent),
    audioId,
  })

  try {
    // 快捷键只表达意图，真正的语音模式、选区上下文和结果交付方式在这里解析。
    const task = await resolveVoiceTask(intent)
    if (!isSessionActive(audioId)) return
    activeTask = task
    if (session.mode !== task.mode) {
      setSession({ ...session, mode: task.mode })
    }

    const prepared = await prepareRecordingStart(task, voiceSocket)
    if (!isSessionActive(audioId)) {
      cleanupPreparedStart(prepared, voiceSocket)
      return
    }

    const { parameters, socket, stream, transport } = prepared
    activeStream = stream
    startAudioLevelMonitoring(stream, updateSessionInputLevel)

    // PCM 模式绕过 MediaRecorder，避免把 paraformer 流式模型需要的原始音频包成 webm。
    if (transport === 'pcm16') {
      pcmAudioSender = createPcm16AudioSender(stream, socket)
      mediaRecorder = null
    } else {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          event.data.arrayBuffer().then((buffer) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(buffer)
          })
        }
      }

      mediaRecorder.onerror = () => {
        if (!isSessionActive(audioId)) return
        failSession(createVoiceError('recording_start_failed'))
      }
    }

    // start_audio 必须在后端 ready、WebSocket、麦克风和参数都准备好之后再发送。
    socket.send(JSON.stringify({
      type: 'start_audio',
      audio_id: audioId,
      mode: toVoiceFlowMode(task.mode),
      audio_context: {},
      parameters,
    }))

    if (mediaRecorder) {
      mediaRecorder.start(500)
    }
    recordingStartedAt = Date.now()
    setSessionStatus('recording')
    void muteBackgroundAudio()
  } catch (error) {
    if (!isSessionActive(audioId) || ignoredAudioIds.has(audioId)) return
    cleanupRecording()
    activeTask = null
    failSession(normalizeVoiceError(error, 'recording_start_failed'))
  }
}

export function stopRecording() {
  if (session.status !== 'recording') return

  try {
    // 正常停止需要发送 end_audio，让后端 flush 音频并进入转写/润色阶段。
    setSessionStatus('stopping')
    stopActiveAudioSender()
    cleanupSessionAudioLevelMonitoring()
    cleanupStream()

    const socket = voiceSocket.getSocket()
    if (socket?.readyState === WebSocket.OPEN && session.audioId) {
      socket.send(JSON.stringify({ type: 'end_audio', audio_id: session.audioId }))
      setSessionStatus('transcribing')
      startTranscribeTimeout()
      return
    }

    failSession(createVoiceError('websocket_closed'))
  } catch (error) {
    failSession(normalizeVoiceError(error, 'recording_stop_failed'))
  }
}

export function cancelRecording() {
  if (!CANCELABLE_STATUSES.has(session.status)) return

  // 取消不是正常结束，不能发 end_audio，否则后端可能继续返回结果并触发粘贴。
  const durationMs = getRecordingDurationMs(recordingStartedAt)
  activeSessionId = null
  activeTask = null
  if (session.audioId) {
    // 取消后可能还有迟到的后端消息，按 audioId 忽略能避免旧结果污染新会话。
    ignoredAudioIds.add(session.audioId)
  }

  clearTranscribeTimeout()
  cleanupRecording()
  voiceSocket.closeWebSocketSilently()
  void restoreBackgroundAudio()
  recordingStartedAt = 0

  setSession({
    ...session,
    status: 'cancelled',
    refinedText: '',
    durationMs,
    error: null,
    inputLevel: 0,
  })
}

export function disposeRecorder() {
  // 应用退出或热重载时做完整释放，避免后台静音、麦克风和监听器残留。
  activeSessionId = null
  activeTask = null
  ignoredAudioIds.clear()
  clearTranscribeTimeout()
  cleanupRecording()
  void restoreBackgroundAudio()
  voiceSocket.closeWebSocketSilently()
  recordingStartedAt = 0
  listeners.clear()
}

function setSession(next: VoiceSession) {
  // 所有状态变更都集中从这里广播，避免 React 页面和悬浮窗看到不同步状态。
  session = next
  listeners.forEach((listener) => listener(session))
  // 悬浮胶囊只消费 voice-state，录音状态源必须集中在 recorder。
  ipcClient.send('voice-state', toFloatingBarState(session))
}

function setSessionStatus(status: VoiceStatus) {
  // 状态切换时清掉旧错误，避免 UI 在新状态下还显示上一轮错误。
  setSession({ ...session, status, error: null })
}

function updateSessionInputLevel(inputLevel: number) {
  const normalizedInputLevel = Math.max(0, Math.min(1, inputLevel))
  // 音量变化太小时不广播，避免悬浮胶囊被高频微小波动拖慢。
  if (Math.abs(session.inputLevel - normalizedInputLevel) < 0.005) return
  setSession({ ...session, inputLevel: normalizedInputLevel })
}

function failSession(error: VoiceError) {
  // 失败路径统一回收资源，避免麦克风、WebSocket 或后台静音状态泄漏。
  activeSessionId = null
  activeTask = null
  clearTranscribeTimeout()
  const durationMs = getRecordingDurationMs(recordingStartedAt)
  cleanupRecording()
  void restoreBackgroundAudio()
  setSession({ ...session, status: 'error', durationMs, error })
  recordingStartedAt = 0
}

async function completeSession(refinedText: string) {
  // 完成路径必须先冻结本轮结果，再恢复后台音频和决定展示/粘贴方式。
  activeSessionId = null
  clearTranscribeTimeout()
  const durationMs = getRecordingDurationMs(recordingStartedAt)
  const resultText = refinedText || session.rawText
  const textLength = countTextLength(resultText)
  const completedSession = {
    ...session,
    status: 'completed' as const,
    refinedText: resultText,
    durationMs,
    textLength,
    error: null,
  }

  setSession(completedSession)
  recordingStartedAt = 0
  await restoreBackgroundAudio()
  const task = activeTask
  activeTask = null
  if (!resultText) return

  await deliverVoiceResult(resultText, task, completedSession.mode)
}

function handleRawText(text: string) {
  // 流式转写会多次更新 rawText，最终结果仍以后端完成消息为准。
  setSession({ ...session, rawText: text, textLength: countTextLength(text) })
}

function isSessionActive(audioId: string) {
  // 同时检查 activeSessionId 和 session.audioId，避免旧异步任务误操作新会话。
  return activeSessionId === audioId && session.audioId === audioId
}

function startTranscribeTimeout() {
  // end_audio 后必须有最终消息或错误消息，否则按 WebSocket 超时处理。
  clearTranscribeTimeout()
  transcribeTimer = window.setTimeout(() => {
    failSession(createVoiceError('websocket_timeout'))
  }, TRANSCRIBE_TIMEOUT_MS)
}

function clearTranscribeTimeout() {
  // 多条完成/失败路径都会调用这里，重复清理要保持无副作用。
  if (transcribeTimer) window.clearTimeout(transcribeTimer)
  transcribeTimer = null
}

function cleanupStream() {
  // 麦克风 MediaStream 是最容易残留的资源，停止后必须释放所有 track。
  stopStreamTracks(activeStream)
  activeStream = null
}

function cleanupSessionAudioLevelMonitoring() {
  cleanupAudioLevelMonitoring()
  // 停止后必须归零，避免悬浮胶囊残留最后一帧音量。
  if (session.inputLevel !== 0) {
    setSession({ ...session, inputLevel: 0 })
  }
}

function stopActiveAudioSender() {
  // 两种传输模式只会有一种处于活动状态，但清理时同时处理更稳。
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    } catch {
      // 避免在已有原始错误时被 stop 的二次异常覆盖。
    }
  }
  mediaRecorder = null

  if (pcmAudioSender) {
    pcmAudioSender.stop()
    pcmAudioSender = null
  }
}

function cleanupRecording() {
  // 录音清理只处理音频相关资源，WebSocket 是否关闭由调用路径决定。
  stopActiveAudioSender()
  cleanupSessionAudioLevelMonitoring()
  cleanupStream()
}
