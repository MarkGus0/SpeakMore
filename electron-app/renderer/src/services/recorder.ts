import { ipcClient } from './ipc'
import { muteBackgroundAudio, resetBackgroundAudioRestoreState, restoreBackgroundAudio } from './backgroundAudio'
import { createPcm16AudioSender, getAudioStream, stopStreamTracks, type AudioSender } from './audioCapture'
import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from './audioLevelMonitor'
import { loadPromptDictionaryTerms, type PromptDictionaryTerm } from './dictionaryStore'
import { hideFloatingPanel, showFreeAskResult } from './floatingPanel'
import { loadModelsState } from './modelStore'
import {
  getCurrentLlmConfig,
  getTranslationTargetLanguage,
  type LlmRequestConfig,
  type TranslationTargetLanguage,
} from './settingsStore'
import type { ShortcutIntent } from './shortcutGuard'
import { VOICE_SERVER_WS_URL } from './voiceServer'
import { countTextLength, getRecordingDurationMs, normalizeVoiceError } from './voiceSessionUtils'
import { resolveVoiceTask, type VoiceTask } from './voiceTaskResolver'
import {
  createVoiceError,
  initialVoiceSession,
  toFloatingBarState,
  toVoiceFlowMode,
  type VoiceError,
  type VoiceMode,
  type VoiceSession,
  type VoiceStatus,
} from './voiceTypes'

const CONNECT_TIMEOUT_MS = 2500
const TRANSCRIBE_TIMEOUT_MS = 60000
// 只有这些状态代表本轮语音还没有产出最终结果，Escape 才允许取消。
const CANCELABLE_STATUSES = new Set<VoiceStatus>(['connecting', 'recording', 'stopping', 'transcribing'])

type VoiceSessionListener = (session: VoiceSession) => void

// 启动录音必须同时拿到参数、连接、麦克风和传输格式，任何一项失败都要整体清理。
type PreparedRecordingStart = {
  parameters: Record<string, unknown>
  socket: WebSocket
  stream: MediaStream
  transport: RecordingTransport
}

// 流式 FunASR 需要浏览器侧发送 16k PCM，其它模型沿用 MediaRecorder 的 webm。
type RecordingTransport = 'webm' | 'pcm16'

type StartAudioParameterInputs = {
  dictionaryTerms: PromptDictionaryTerm[]
  llm: LlmRequestConfig
  translationTargetLanguage: TranslationTargetLanguage | null
}

// recorder 是渲染进程里的语音状态机，模块级变量用于保存当前唯一一轮录音会话。
// 这里不放进 React state，是因为快捷键、悬浮窗、WebSocket 和页面组件都要共享同一份录音事实。
let session: VoiceSession = initialVoiceSession
// WebSocket 和音频资源都按“当前会话”持有，避免多个页面组件各自创建连接。
let ws: WebSocket | null = null
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

    const prepared = await prepareRecordingStart(task)
    if (!isSessionActive(audioId)) {
      cleanupPreparedStart(prepared)
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
        if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
          event.data.arrayBuffer().then((buffer) => {
            if (ws?.readyState === WebSocket.OPEN) ws.send(buffer)
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

async function prepareRecordingStart(task: VoiceTask): Promise<PreparedRecordingStart> {
  // pendingStream 用来处理“麦克风已打开但其它准备失败”的中间态，防止资源泄漏。
  let pendingStream: MediaStream | null = null
  let shouldStopPendingStream = false

  try {
    // 启动前资源可以并行准备，但失败时必须把已经打开的麦克风和连接收掉。
    const readyPromise = ensureVoiceServerReady()
    const transportPromise = resolveRecordingTransport()
    const socketPromise = ensureOpenWebSocket()
    const parameterInputsPromise = prepareStartAudioParameterInputs(task.mode)
    const streamPromise = getAudioStream().then((stream) => {
      pendingStream = stream
      if (shouldStopPendingStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      return stream
    })

    const [transport, socket, stream, , parameterInputs] = await Promise.all([
      transportPromise,
      socketPromise,
      streamPromise,
      readyPromise,
      parameterInputsPromise,
    ])
    const parameters = getStartAudioParameters(task.mode, task.selectedText, transport, parameterInputs)

    return { parameters, socket, stream, transport }
  } catch (error) {
    shouldStopPendingStream = true
    stopStreamTracks(pendingStream as MediaStream | null)
    closeWebSocketSilently()
    throw error
  }
}

function cleanupPreparedStart(prepared: PreparedRecordingStart) {
  // 会话在准备完成后被取消时，还没正式进入 active 状态，也要清理刚拿到的资源。
  stopStreamTracks(prepared.stream)
  closeWebSocketSilently()
}

async function resolveRecordingTransport(): Promise<RecordingTransport> {
  try {
    const state = await loadModelsState()
    const currentModel = state.models.find((model) => model.isCurrent)
      ?? state.models.find((model) => model.id === state.currentModelId)
    // 只有真正的流式 FunASR 模型需要浏览器侧直接推 PCM chunk。
    return currentModel?.engine === 'funasr-streaming' ? 'pcm16' : 'webm'
  } catch {
    return 'webm'
  }
}

async function prepareStartAudioParameterInputs(mode: VoiceMode): Promise<StartAudioParameterInputs> {
  const translationTargetLanguagePromise = mode === 'Translate'
    ? getTranslationTargetLanguage()
    : Promise.resolve(null)
  const [dictionaryTerms, llm, translationTargetLanguage] = await Promise.all([
    loadPromptDictionaryTerms(),
    getCurrentLlmConfig(),
    translationTargetLanguagePromise,
  ])

  return { dictionaryTerms, llm, translationTargetLanguage }
}

function getStartAudioParameters(
  mode: VoiceMode,
  selectedText = '',
  transport: RecordingTransport = 'webm',
  inputs: StartAudioParameterInputs,
): Record<string, unknown> {
  // 词典和 LLM 配置是本轮请求参数，必须在 start_audio 前固定下来，避免录音中途变化。
  const { dictionaryTerms, llm, translationTargetLanguage } = inputs
  const dictionaryParameters = dictionaryTerms.length ? { dictionary_terms: dictionaryTerms } : {}
  const audioFormatParameters = transport === 'pcm16'
    ? { audio_format: { type: 'pcm_s16le', sample_rate: 16000, channels: 1 } }
    : {}
  const baseParameters = { llm, ...dictionaryParameters, ...audioFormatParameters }

  // 自由提问只在有可信选区时把选区文本作为上下文发给后端。
  if (mode === 'Ask') {
    return selectedText ? { ...baseParameters, selected_text: selectedText } : baseParameters
  }

  if (mode !== 'Translate') return baseParameters

  // 翻译目标语言是用户设置，必须随本轮 start_audio 参数一起发送。
  return {
    ...baseParameters,
    output_language: translationTargetLanguage,
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

    if (ws?.readyState === WebSocket.OPEN && session.audioId) {
      ws.send(JSON.stringify({ type: 'end_audio', audio_id: session.audioId }))
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
  closeWebSocketSilently()
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
  closeWebSocketSilently()
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

async function pasteResultOrShowPanel(resultText: string) {
  try {
    const result = await ipcClient.invoke('keyboard:type-transcript', resultText)
    if (result === false || (result && typeof result === 'object' && (result as { success?: unknown }).success === false)) {
      // 自动粘贴失败时必须保底展示结果，不能让用户丢失本轮文本。
      showFreeAskResult(resultText)
    }
  } catch {
    showFreeAskResult(resultText)
  }
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

  // 自由提问不自动粘贴；其它模式先尝试粘贴，失败再展示悬浮结果。
  if (task?.delivery === 'floating-panel' || completedSession.mode === 'Ask') {
    showFreeAskResult(resultText)
    return
  }

  await pasteResultOrShowPanel(resultText)
}

function handleRawText(text: string) {
  // 流式转写会多次更新 rawText，最终结果仍以后端完成消息为准。
  setSession({ ...session, rawText: text, textLength: countTextLength(text) })
}

function isVoiceFinalMessageType(messageType: string) {
  // 后端存在多种历史完成消息名，前端在这里统一归类成最终结果。
  return ['audio_processing_completed', 'refine_completed', 'refine_selected_text'].includes(messageType)
}

function isVoiceErrorMessageType(messageType: string) {
  // ASR、音频处理和润色错误都属于本轮语音失败，但映射成不同前端错误码。
  return ['error', 'transcription_error', 'audio_processing_error', 'refine_error', 'refine_selected_text_error'].includes(messageType)
}

function normalizeSocketError(messageType: string, payload: Record<string, unknown> = {}) {
  // WebSocket 错误结构来自后端，先提取可读 detail，再映射成前端统一错误。
  const detail = typeof payload.detail === 'string'
    ? payload.detail
    : typeof payload.message === 'string'
      ? payload.message
      : ''

  if (messageType === 'transcription_error') {
    return createVoiceError('asr_failed', detail)
  }

  if (['audio_processing_error', 'refine_error', 'refine_selected_text_error'].includes(messageType)) {
    return createVoiceError('refine_failed', detail)
  }

  if (Number(payload.code) === 503 || detail.includes('尚未就绪')) {
    return createVoiceError('backend_unavailable', detail)
  }

  return createVoiceError('unknown', detail)
}

function handleSocketMessage(event: MessageEvent) {
  try {
    // 后端 WebSocket 消息约定为 { K, V }，K 是消息类型，V 是具体载荷。
    const msg = JSON.parse(String(event.data))
    const messageType = String(msg?.K || '')
    const audioId = msg?.V?.audio_id
    // 后端可能返回迟到消息或旧会话消息，这里必须先按会话边界过滤。
    if (audioId && ignoredAudioIds.has(audioId)) return
    if (audioId && session.audioId && audioId !== session.audioId) return
    if (session.status === 'cancelled') return
    if (messageType === 'error' && Number(msg?.V?.code) === 90002 && msg?.V?.detail === 'Unknown message type') return
    if ((session.status === 'completed' || session.status === 'error') && (isVoiceFinalMessageType(messageType) || isVoiceErrorMessageType(messageType))) {
      return
    }

    if (messageType === 'transcription') {
      handleRawText(msg.V?.text || '')
      return
    }

    if (messageType === 'important_notification') {
      if (msg?.V?.behavior?.interruptSession) {
        // 后端主动中断时按不可继续的会话失败处理，避免前端继续等待最终结果。
        failSession(createVoiceError('backend_unavailable', typeof msg?.V?.detail === 'string' ? msg.V.detail : '会话已被中断'))
      }
      return
    }

    if (isVoiceFinalMessageType(messageType)) {
      const refinedText = msg.V?.refined_text || msg.V?.refine_text || ''
      if (!refinedText && !session.rawText) {
        failSession(createVoiceError('audio_empty'))
        return
      }
      void completeSession(refinedText || session.rawText)
      return
    }

    if (isVoiceErrorMessageType(messageType)) {
      failSession(normalizeSocketError(messageType, msg?.V || {}))
    }
  } catch (error) {
    failSession(createVoiceError('protocol_invalid', error instanceof Error ? error.message : String(error)))
  }
}

function ensureOpenWebSocket(): Promise<WebSocket> {
  // 已连接时直接复用，正在连接时等待同一个连接，避免并发创建多个 socket。
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve(ws)
  if (ws?.readyState === WebSocket.CONNECTING) return waitForOpenWebSocket(ws)

  // WebSocket 由 recorder 复用和关闭，避免多轮录音并发占用后端流式会话。
  ws = new WebSocket(VOICE_SERVER_WS_URL)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = handleSocketMessage
  ws.onclose = () => {
    ws = null
    if (session.status === 'recording' || session.status === 'transcribing') {
      failSession(createVoiceError('websocket_closed'))
    }
  }
  ws.onerror = () => {
    if (ws?.readyState !== WebSocket.CLOSED) ws?.close()
  }

  return waitForOpenWebSocket(ws)
}

function isSessionActive(audioId: string) {
  // 同时检查 activeSessionId 和 session.audioId，避免旧异步任务误操作新会话。
  return activeSessionId === audioId && session.audioId === audioId
}

function closeWebSocketSilently() {
  if (!ws) return

  const socket = ws
  ws = null
  // 主动关闭时先解绑回调，避免清理动作又触发失败状态。
  socket.onopen = null
  socket.onclose = null
  socket.onerror = null
  socket.onmessage = null
  socket.close()
}

function waitForOpenWebSocket(socket: WebSocket): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // 连接超时要尽快反馈给 UI，不能让用户停在 connecting 状态。
    const timer = window.setTimeout(() => reject(createVoiceError('websocket_timeout')), CONNECT_TIMEOUT_MS)
    socket.addEventListener('open', () => {
      window.clearTimeout(timer)
      resolve(socket)
    }, { once: true })
    socket.addEventListener('close', () => {
      window.clearTimeout(timer)
      reject(createVoiceError('backend_unavailable'))
    }, { once: true })
  })
}

async function ensureVoiceServerReady() {
  let result: { success?: boolean; detail?: string; status?: string } | null = null

  try {
    // /ready 才代表当前 ASR 模型可接收请求，/health 只说明后端进程存在。
    result = await ipcClient.invoke('audio:check-voice-server-ready') as { success?: boolean; detail?: string; status?: string }
  } catch {
    result = await ipcClient.invoke('audio:ensure-voice-server') as { success?: boolean; detail?: string; status?: string }
  }

  if (!result?.success) {
    throw createVoiceError('backend_unavailable', result?.detail || result?.status || '')
  }
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
