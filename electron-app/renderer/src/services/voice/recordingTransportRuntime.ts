/**
 * 录音传输运行时
 *
 * 需要管理 MediaRecorder、PCM16 sender、麦克风流和输入音量监控时看这里。
 */
import { createPcm16AudioSender, stopStreamTracks, type AudioSender } from './audioCapture'
import { cleanupAudioLevelMonitoring, startAudioLevelMonitoring } from './audioLevelMonitor'
import type { PreparedRecordingStart } from './recordingStartup'

export type RecordingTransportRuntime = {
  attach: (
    prepared: PreparedRecordingStart,
    onInputLevel: (level: number) => void,
    onRecorderError: () => void,
  ) => void
  start: () => void
  stopSenders: () => void
  cleanup: () => void
}

export function createRecordingTransportRuntime(): RecordingTransportRuntime {
  let mediaRecorder: MediaRecorder | null = null
  let pcmAudioSender: AudioSender | null = null
  let activeStream: MediaStream | null = null
  let resetInputLevel: (() => void) | null = null

  const stopSenders = () => {
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

  return {
    attach: (prepared, onInputLevel, onRecorderError) => {
      const { socket, stream, transport } = prepared
      activeStream = stream
      resetInputLevel = () => onInputLevel(0)
      startAudioLevelMonitoring(stream, onInputLevel)

      // PCM 模式绕过 MediaRecorder，避免把流式模型需要的原始音频包成 webm。
      if (transport === 'pcm16') {
        pcmAudioSender = createPcm16AudioSender(stream, socket)
        mediaRecorder = null
        return
      }

      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      pcmAudioSender = null

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          event.data.arrayBuffer().then((buffer) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(buffer)
          })
        }
      }

      mediaRecorder.onerror = onRecorderError
    },
    start: () => {
      if (mediaRecorder) {
        mediaRecorder.start(500)
      }
    },
    stopSenders,
    cleanup: () => {
      // 录音清理只处理音频相关资源，WebSocket 是否关闭由调用路径决定。
      stopSenders()
      cleanupAudioLevelMonitoring()
      resetInputLevel?.()
      resetInputLevel = null
      stopStreamTracks(activeStream)
      activeStream = null
    },
  }
}
