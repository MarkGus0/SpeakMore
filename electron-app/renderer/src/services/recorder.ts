import { ipcClient } from './ipc'
import { loadPromptDictionaryTerms } from './dictionaryStore'
import { hideFloatingPanel, showFreeAskResult } from './floatingPanel'
import { loadModelsState } from './modelStore'
import { getCurrentLlmConfig, getSelectedAudioDeviceId, getTranslationTargetLanguage } from './settingsStore'
import type { ShortcutIntent } from './shortcutGuard'
import { VOICE_SERVER_WS_URL } from './voiceServer'
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

type AudioSender = {
  stop: () => void
}

// recorder 是渲染进程里的语音状态机，模块级变量用于保存当前唯一一轮录音会话。
let session: VoiceSession = initialVoiceSession
let ws: WebSocket | null = null
let mediaRecorder: MediaRecorder | null = null
let pcmAudioSender: AudioSender | null = null
let activeStream: MediaStream | null = null
let transcribeTimer: number | null = null
let recordingStartedAt = 0
let backgroundAudioRestorePending = false
let activeSessionId: string | null = null
let activeTask: VoiceTask | null = null
let levelAudioContext: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSource: MediaStreamAudioSourceNode | null = null
let levelTimerId: number | null = null
let levelData: Float32Array<ArrayBuffer> | null = null
let smoothedInputLevel = 0
const ignoredAudioIds = new Set<string>()
const listeners = new Set<VoiceSessionListener>()

export function getVoiceSession() {
  return session
}

export function subscribeVoiceSession(listener: VoiceSessionListener) {
  listeners.add(listener)
  // 新订阅者需要立刻拿到当前状态，避免页面切换后 UI 等下一次状态变更。
  listener(session)
  return () => {
    listeners.delete(listener)
  }
}

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

export async function startRecording(mode: VoiceMode) {
  await startRecordingFromIntent(toShortcutIntent(mode))
}

function getInitialModeForIntent(intent: ShortcutIntent): VoiceMode {
  if (intent === 'AskShortcut') return 'Ask'
  if (intent === 'TranslateShortcut') return 'Translate'
  return 'Dictate'
}

async function startRecordingFromIntent(intent: ShortcutIntent) {
  // 新录音开始前先隐藏旧结果，避免用户看到上一轮悬浮面板误以为是当前结果。
  hideFloatingPanel()
  backgroundAudioRestorePending = false
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
    startAudioLevelMonitoring(stream)

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
  let pendingStream: MediaStream | null = null
  let shouldStopPendingStream = false

  try {
    // 启动前资源可以并行准备，但失败时必须把已经打开的麦克风和连接收掉。
    const readyPromise = ensureVoiceServerReady()
    const transportPromise = resolveRecordingTransport()
    const socketPromise = ensureOpenWebSocket()
    const streamPromise = getAudioStream().then((stream) => {
      pendingStream = stream
      if (shouldStopPendingStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      return stream
    })

    const [transport, socket, stream] = await Promise.all([
      transportPromise,
      socketPromise,
      streamPromise,
      readyPromise,
    ]).then(([transport, socket, stream]) => [transport, socket, stream] as const)
    const parameters = await getStartAudioParameters(task.mode, task.selectedText, transport)

    return { parameters, socket, stream, transport }
  } catch (error) {
    shouldStopPendingStream = true
    stopStreamTracks(pendingStream as MediaStream | null)
    closeWebSocketSilently()
    throw error
  }
}

function cleanupPreparedStart(prepared: PreparedRecordingStart) {
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

async function getStartAudioParameters(
  mode: VoiceMode,
  selectedText = '',
  transport: RecordingTransport = 'webm',
): Promise<Record<string, unknown>> {
  const [dictionaryTerms, llm] = await Promise.all([
    loadPromptDictionaryTerms(),
    getCurrentLlmConfig(),
  ])
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
    output_language: await getTranslationTargetLanguage(),
  }
}

export function stopRecording() {
  if (session.status !== 'recording') return

  try {
    // 正常停止需要发送 end_audio，让后端 flush 音频并进入转写/润色阶段。
    setSessionStatus('stopping')
    stopActiveAudioSender()
    cleanupAudioLevelMonitoring()
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

  const durationMs = getRecordingDurationMs()
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
  session = next
  listeners.forEach((listener) => listener(session))
  // 悬浮胶囊只消费 voice-state，录音状态源必须集中在 recorder。
  ipcClient.send('voice-state', toFloatingBarState(session))
}

function setSessionStatus(status: VoiceStatus) {
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
  const durationMs = getRecordingDurationMs()
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
  activeSessionId = null
  clearTranscribeTimeout()
  const durationMs = getRecordingDurationMs()
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
  setSession({ ...session, rawText: text, textLength: countTextLength(text) })
}

function isVoiceFinalMessageType(messageType: string) {
  return ['audio_processing_completed', 'refine_completed', 'refine_selected_text'].includes(messageType)
}

function isVoiceErrorMessageType(messageType: string) {
  return ['error', 'transcription_error', 'audio_processing_error', 'refine_error', 'refine_selected_text_error'].includes(messageType)
}

function normalizeSocketError(messageType: string, payload: Record<string, unknown> = {}) {
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

async function getAudioStream() {
  try {
    const selectedAudioDeviceId = await getSelectedAudioDeviceId()
    const deviceConstraint = selectedAudioDeviceId === 'default' ? {} : { deviceId: { exact: selectedAudioDeviceId } }
    // 这里关闭浏览器音频增强，避免 ASR 输入被浏览器自动处理成不可控结果。
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...deviceConstraint,
        sampleRate: 32000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw createVoiceError('microphone_permission_denied', String(error))
    }
    throw createVoiceError('microphone_unavailable', String(error))
  }
}

function downsampleToSampleRate(input: Float32Array, inputSampleRate: number, targetSampleRate: number) {
  if (inputSampleRate <= targetSampleRate) return input

  // 流式模型固定吃 16k 单声道 PCM，浏览器实际采样率需要降到目标采样率。
  const ratio = inputSampleRate / targetSampleRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    output[index] = input[Math.floor(index * ratio)] ?? 0
  }
  return output
}

function encodePcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    // PCM16 只能表达 [-1, 1] 范围内的采样，编码前必须裁剪避免溢出。
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    pcm[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
  }
  return pcm
}

function sendPcm16Chunk(socket: WebSocket, samples: Float32Array, inputSampleRate: number) {
  if (socket.readyState !== WebSocket.OPEN) return

  const downsampled = downsampleToSampleRate(samples, inputSampleRate, 16000)
  if (!downsampled.length) return

  const pcm = encodePcm16(downsampled)
  const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
  socket.send(buffer)
}

function createPcm16AudioSender(stream: MediaStream, socket: WebSocket): AudioSender {
  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  // ScriptProcessor 虽旧但这里足够小范围使用，用来直接拿到浏览器音频采样。
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const inputSampleRate = audioContext.sampleRate || 16000

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    sendPcm16Chunk(socket, input, inputSampleRate)

    for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) {
      event.outputBuffer.getChannelData(channel).fill(0)
    }
  }

  source.connect(processor)
  processor.connect(audioContext.destination)
  void audioContext.resume().catch(() => undefined)

  return {
    stop: () => {
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      void audioContext.close().catch(() => undefined)
    },
  }
}

function startAudioLevelMonitoring(stream: MediaStream) {
  cleanupAudioLevelMonitoring()

  try {
    // 悬浮胶囊的波形只需要输入音量，不参与真实音频上传。
    levelAudioContext = new AudioContext()
    levelAnalyser = levelAudioContext.createAnalyser()
    levelAnalyser.fftSize = 2048
    levelAnalyser.smoothingTimeConstant = 0.18
    levelSource = levelAudioContext.createMediaStreamSource(stream)
    levelSource.connect(levelAnalyser)
    levelData = new Float32Array(new ArrayBuffer(levelAnalyser.fftSize * Float32Array.BYTES_PER_ELEMENT))
    smoothedInputLevel = 0
    void levelAudioContext.resume().catch(() => undefined)

    const tick = () => {
      if (!levelAnalyser || !levelData) return

      levelAnalyser.getFloatTimeDomainData(levelData)
      let sum = 0
      for (const sample of levelData) {
        sum += sample * sample
      }

      const rms = Math.sqrt(sum / levelData.length)
      const normalizedLevel = Math.min(1, rms * 3.2)
      // 上升快、下降慢能让波形反馈更贴近用户感知，不至于频繁闪烁。
      const smoothing = normalizedLevel > smoothedInputLevel ? 0.42 : 0.18
      smoothedInputLevel += (normalizedLevel - smoothedInputLevel) * smoothing
      updateSessionInputLevel(Number(smoothedInputLevel.toFixed(4)))
    }

    levelTimerId = window.setInterval(tick, 50)
  } catch {
    cleanupAudioLevelMonitoring()
  }
}

function getRecordingDurationMs() {
  return recordingStartedAt > 0 ? Math.max(0, Date.now() - recordingStartedAt) : 0
}

function countTextLength(text: string) {
  return text.trim().length
}

function startTranscribeTimeout() {
  clearTranscribeTimeout()
  transcribeTimer = window.setTimeout(() => {
    failSession(createVoiceError('websocket_timeout'))
  }, TRANSCRIBE_TIMEOUT_MS)
}

function clearTranscribeTimeout() {
  if (transcribeTimer) window.clearTimeout(transcribeTimer)
  transcribeTimer = null
}

async function muteBackgroundAudio() {
  try {
    const result = await ipcClient.invoke('audio:mute-background-sessions') as { success?: boolean }
    // 只在本轮确实静音成功时恢复，避免误改用户原本的音频会话状态。
    backgroundAudioRestorePending = Boolean(result?.success)
  } catch {
    backgroundAudioRestorePending = false
  }
}

async function restoreBackgroundAudio() {
  if (!backgroundAudioRestorePending) return

  try {
    await ipcClient.invoke('audio:restore-background-sessions')
  } finally {
    backgroundAudioRestorePending = false
  }
}

function cleanupStream() {
  stopStreamTracks(activeStream)
  activeStream = null
}

function stopStreamTracks(stream: MediaStream | null) {
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

function cleanupAudioLevelMonitoring() {
  if (levelTimerId !== null) window.clearInterval(levelTimerId)
  levelTimerId = null

  // 音量监控独立于录音上传，停止后必须归零，避免悬浮胶囊残留最后一帧音量。
  levelSource?.disconnect()
  levelSource = null
  levelAnalyser = null
  levelData = null
  smoothedInputLevel = 0

  const audioContext = levelAudioContext
  levelAudioContext = null
  if (audioContext) void audioContext.close().catch(() => undefined)

  if (session.inputLevel !== 0) {
    setSession({ ...session, inputLevel: 0 })
  }
}

function stopActiveAudioSender() {
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
  stopActiveAudioSender()
  cleanupAudioLevelMonitoring()
  cleanupStream()
}

function normalizeVoiceError(error: unknown, fallbackCode: Parameters<typeof createVoiceError>[0]) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as VoiceError
  }
  return createVoiceError(fallbackCode, error instanceof Error ? error.message : String(error))
}
