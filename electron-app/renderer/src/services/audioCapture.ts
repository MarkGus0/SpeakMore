import { getSelectedAudioDeviceId } from './settingsStore'
import { createVoiceError } from './voiceTypes'

export type AudioSender = {
  stop: () => void
}

export async function getAudioStream() {
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

export function stopStreamTracks(stream: MediaStream | null) {
  // stop track 才会真正释放浏览器侧麦克风占用。
  if (!stream) return
  stream.getTracks().forEach((track) => track.stop())
}

export function downsampleToSampleRate(input: Float32Array, inputSampleRate: number, targetSampleRate: number) {
  // 浏览器采样率可能高于后端要求，发送前需要降采样；低于目标时不做插值放大。
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

export function encodePcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    // PCM16 只能表达 [-1, 1] 范围内的采样，编码前必须裁剪避免溢出。
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    pcm[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
  }
  return pcm
}

export function sendPcm16Chunk(socket: WebSocket, samples: Float32Array, inputSampleRate: number) {
  // PCM 发送路径只负责实时推 chunk，不缓存整段音频。
  if (socket.readyState !== WebSocket.OPEN) return

  const downsampled = downsampleToSampleRate(samples, inputSampleRate, 16000)
  if (!downsampled.length) return

  const pcm = encodePcm16(downsampled)
  const buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
  socket.send(buffer)
}

export function createPcm16AudioSender(stream: MediaStream, socket: WebSocket): AudioSender {
  // 这个 sender 是 MediaRecorder 的替代实现，专门服务 paraformer 流式模型。
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
