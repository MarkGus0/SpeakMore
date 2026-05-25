/**
 * 录音传输运行时
 *
 * 需要管理 PCM16 sender、麦克风流和输入音量监控时看这里。
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
  let pcmAudioSender: AudioSender | null = null
  let activeStream: MediaStream | null = null
  let resetInputLevel: (() => void) | null = null

  const stopSenders = () => {
    if (pcmAudioSender) {
      pcmAudioSender.stop()
      pcmAudioSender = null
    }
  }

  return {
    attach: (prepared, onInputLevel, _onRecorderError) => {
      const { socket, stream } = prepared
      activeStream = stream
      resetInputLevel = () => onInputLevel(0)
      startAudioLevelMonitoring(stream, onInputLevel)

      pcmAudioSender = createPcm16AudioSender(stream, socket)
    },
    start: () => undefined,
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
