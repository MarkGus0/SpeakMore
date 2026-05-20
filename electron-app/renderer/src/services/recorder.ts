import { ipcClient } from './ipc'
import { loadPromptDictionaryTerms } from './dictionaryStore'
import { hideFloatingPanel, showFreeAskResult } from './floatingPanel'
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

type PreparedRecordingStart = {
  parameters: Record<string, unknown>
  socket: WebSocket
  stream: MediaStream
}

let session: VoiceSession = initialVoiceSession
let ws: WebSocket | null = null
let mediaRecorder: MediaRecorder | null = null
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

    const { parameters, socket, stream } = prepared
    activeStream = stream
    startAudioLevelMonitoring(stream)
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

    socket.send(JSON.stringify({
      type: 'start_audio',
      audio_id: audioId,
      mode: toVoiceFlowMode(task.mode),
      audio_context: {},
      parameters,
    }))

    mediaRecorder.start(500)
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
    const readyPromise = ensureVoiceServerReady()
    const parametersPromise = getStartAudioParameters(task.mode, task.selectedText)
    const socketPromise = ensureOpenWebSocket()
    const streamPromise = getAudioStream().then((stream) => {
      pendingStream = stream
      if (shouldStopPendingStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      return stream
    })

    const [parameters, socket, stream] = await Promise.all([
      parametersPromise,
      socketPromise,
      streamPromise,
      readyPromise,
    ]).then(([parameters, socket, stream]) => [parameters, socket, stream] as const)

    return { parameters, socket, stream }
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

async function getStartAudioParameters(mode: VoiceMode, selectedText = ''): Promise<Record<string, unknown>> {
  const [dictionaryTerms, llm] = await Promise.all([
    loadPromptDictionaryTerms(),
    getCurrentLlmConfig(),
  ])
  const dictionaryParameters = dictionaryTerms.length ? { dictionary_terms: dictionaryTerms } : {}
  const baseParameters = { llm, ...dictionaryParameters }

  if (mode === 'Ask') {
    return selectedText ? { ...baseParameters, selected_text: selectedText } : baseParameters
  }

  if (mode !== 'Translate') return baseParameters

  return {
    ...baseParameters,
    output_language: await getTranslationTargetLanguage(),
  }
}

export function stopRecording() {
  if (!mediaRecorder || session.status !== 'recording') return

  try {
    setSessionStatus('stopping')
    mediaRecorder.stop()
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
  } finally {
    mediaRecorder = null
  }
}

export function cancelRecording() {
  if (!CANCELABLE_STATUSES.has(session.status)) return

  const durationMs = getRecordingDurationMs()
  activeSessionId = null
  activeTask = null
  if (session.audioId) {
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
  ipcClient.send('voice-state', toFloatingBarState(session))
}

function setSessionStatus(status: VoiceStatus) {
  setSession({ ...session, status, error: null })
}

function updateSessionInputLevel(inputLevel: number) {
  const normalizedInputLevel = Math.max(0, Math.min(1, inputLevel))
  if (Math.abs(session.inputLevel - normalizedInputLevel) < 0.005) return
  setSession({ ...session, inputLevel: normalizedInputLevel })
}

function failSession(error: VoiceError) {
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

function startAudioLevelMonitoring(stream: MediaStream) {
  cleanupAudioLevelMonitoring()

  try {
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

function cleanupRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop()
    } catch {
      // 避免在已有原始错误时被 stop 的二次异常覆盖。
    }
  }
  mediaRecorder = null
  cleanupAudioLevelMonitoring()
  cleanupStream()
}

function normalizeVoiceError(error: unknown, fallbackCode: Parameters<typeof createVoiceError>[0]) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as VoiceError
  }
  return createVoiceError(fallbackCode, error instanceof Error ? error.message : String(error))
}
