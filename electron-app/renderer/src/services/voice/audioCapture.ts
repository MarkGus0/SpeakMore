/**
 * 录音输入采集和发送
 *
 * 需要处理麦克风和流式 PCM16 音频 chunk 时看这里。
 */
import { getSelectedAudioDeviceId } from '../settingsStore'
import { createVoiceError } from './voiceTypes'

export type RecordingTransport = 'pcm16'

export type AudioSender = {
  stop: () => void
}

const ACTIVE_CHANNEL_RATIO = 0.15
const MIN_GAIN_RMS = 0.003
const TARGET_SPEECH_RMS = 0.08
const MAX_SPEECH_GAIN = 8
const MAX_GAIN_PEAK = 0.95

function createAudioConstraints(selectedAudioDeviceId: string, relaxed = false): MediaStreamConstraints {
  const deviceConstraint = selectedAudioDeviceId === 'default' ? {} : { deviceId: { exact: selectedAudioDeviceId } }
  if (relaxed) {
    return {
      audio: Object.keys(deviceConstraint).length ? deviceConstraint : true,
    }
  }

  return {
    audio: {
      ...deviceConstraint,
      // 耳机/蓝牙麦克风常见采样率较低；这些只能作为偏好，不能作为硬约束。
      sampleRate: { ideal: 16000 },
      channelCount: { ideal: 1 },
      // 带降噪/通透模式的耳机通常依赖浏览器或系统语音处理来稳定电平和底噪。
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    },
  }
}

function isConstraintFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError'
}

function isDeviceLookupFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotFoundError' || name === 'DevicesNotFoundError'
}

function isPermissionFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError'
}

function toMicrophoneUnavailable(error: unknown) {
  return createVoiceError('microphone_unavailable', String(error))
}

async function getAudioStreamWithConstraints(selectedAudioDeviceId: string, relaxed = false) {
  return navigator.mediaDevices.getUserMedia(createAudioConstraints(selectedAudioDeviceId, relaxed))
}

async function getDefaultAudioStreamOrThrow() {
  try {
    return await getAudioStreamWithConstraints('default', true)
  } catch (fallbackError) {
    if (isPermissionFailure(fallbackError)) {
      throw createVoiceError('microphone_permission_denied', String(fallbackError))
    }
    throw toMicrophoneUnavailable(fallbackError)
  }
}

export async function getAudioStream() {
  const selectedAudioDeviceId = await getSelectedAudioDeviceId()
  try {
    // 浏览器音频增强对蓝牙/降噪耳机更稳定；采样率和声道只作为偏好。
    return await getAudioStreamWithConstraints(selectedAudioDeviceId)
  } catch (error) {
    if (isPermissionFailure(error)) {
      throw createVoiceError('microphone_permission_denied', String(error))
    }

    if (isConstraintFailure(error)) {
      try {
        return await getAudioStreamWithConstraints(selectedAudioDeviceId, true)
      } catch (fallbackError) {
        if (isPermissionFailure(fallbackError)) {
          throw createVoiceError('microphone_permission_denied', String(fallbackError))
        }
        if (selectedAudioDeviceId !== 'default') {
          return getDefaultAudioStreamOrThrow()
        }
        throw toMicrophoneUnavailable(fallbackError)
      }
    }

    if (selectedAudioDeviceId !== 'default' && isDeviceLookupFailure(error)) {
      return getDefaultAudioStreamOrThrow()
    }

    throw toMicrophoneUnavailable(error)
  }
}

export function stopStreamTracks(stream: MediaStream | null) {
  // stop track 才会真正释放浏览器侧麦克风占用。
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

export function resampleToSampleRate(input: Float32Array, inputSampleRate: number, targetSampleRate: number) {
  const sourceRate = Number(inputSampleRate)
  const outputRate = Number(targetSampleRate)
  if (!input.length || !Number.isFinite(sourceRate) || !Number.isFinite(outputRate) || sourceRate <= 0 || outputRate <= 0) {
    return input
  }
  if (sourceRate === outputRate) return input

  // 流式模型固定吃 16k 单声道 PCM。蓝牙耳机麦克风可能只有 8k，也必须升采样到 16k。
  const ratio = sourceRate / outputRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const weight = sourceIndex - leftIndex
    const left = input[leftIndex] ?? 0
    const right = input[rightIndex] ?? left
    output[index] = left + (right - left) * weight
  }
  return output
}

export const downsampleToSampleRate = resampleToSampleRate

export function encodePcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    // PCM16 只能表达 [-1, 1] 范围内的采样，编码前必须裁剪避免溢出。
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    pcm[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
  }
  return pcm
}

function calculateRms(samples: Float32Array) {
  if (!samples.length) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length)
}

function calculatePeak(samples: Float32Array) {
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0))
  }
  return peak
}

function removeDcOffset(samples: Float32Array) {
  if (!samples.length) return samples

  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] ?? 0
  }

  const offset = sum / samples.length
  if (Math.abs(offset) < 0.000001) return samples

  const output = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = (samples[index] ?? 0) - offset
  }
  return output
}

export function mixAudioBufferToMono(inputBuffer: AudioBuffer) {
  const channelCount = Math.max(1, inputBuffer.numberOfChannels || 1)
  if (channelCount === 1) {
    return inputBuffer.getChannelData(0)
  }

  const channels: Float32Array[] = []
  const rmsValues: number[] = []
  let maxRms = 0
  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = inputBuffer.getChannelData(channel)
    const rms = calculateRms(samples)
    channels.push(samples)
    rmsValues.push(rms)
    maxRms = Math.max(maxRms, rms)
  }

  const activeChannels = maxRms > 0
    ? channels.filter((_, index) => (rmsValues[index] ?? 0) >= maxRms * ACTIVE_CHANNEL_RATIO)
    : channels
  const output = new Float32Array(inputBuffer.length)
  for (let index = 0; index < output.length; index += 1) {
    let sum = 0
    for (const channel of activeChannels) {
      sum += channel[index] ?? 0
    }
    output[index] = sum / Math.max(1, activeChannels.length)
  }
  return output
}

export function conditionAudioForAsr(samples: Float32Array) {
  const normalized = removeDcOffset(samples)
  const rms = calculateRms(normalized)
  if (rms < MIN_GAIN_RMS) return normalized

  const peak = calculatePeak(normalized)
  if (peak <= 0 || rms >= TARGET_SPEECH_RMS) return normalized

  const gain = Math.min(MAX_SPEECH_GAIN, TARGET_SPEECH_RMS / rms, MAX_GAIN_PEAK / peak)
  if (gain <= 1.01) return normalized

  const output = new Float32Array(normalized.length)
  for (let index = 0; index < normalized.length; index += 1) {
    output[index] = (normalized[index] ?? 0) * gain
  }
  return output
}

export function sendPcm16Chunk(socket: WebSocket, samples: Float32Array, inputSampleRate: number) {
  // PCM 发送路径只负责实时推 chunk，不缓存整段音频。
  if (socket.readyState !== WebSocket.OPEN) return

  const downsampled = resampleToSampleRate(samples, inputSampleRate, 16000)
  if (!downsampled.length) return

  const pcm = encodePcm16(downsampled)
  const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
  socket.send(buffer)
}

export function createPcm16AudioSender(stream: MediaStream, socket: WebSocket): AudioSender {
  // 这个 sender 直接推 PCM16 chunk，避免浏览器容器格式影响后端 ASR 输入。
  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  // ScriptProcessor 虽旧但这里足够小范围使用；保留双声道输入，避免部分耳机的人声落在非第 0 声道。
  const processor = audioContext.createScriptProcessor(4096, 2, 1)
  const inputSampleRate = audioContext.sampleRate || 16000

  processor.onaudioprocess = (event) => {
    const input = conditionAudioForAsr(mixAudioBufferToMono(event.inputBuffer))
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
