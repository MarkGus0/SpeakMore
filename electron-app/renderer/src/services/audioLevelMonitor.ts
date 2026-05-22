let levelAudioContext: AudioContext | null = null
let levelAnalyser: AnalyserNode | null = null
let levelSource: MediaStreamAudioSourceNode | null = null
let levelTimerId: number | null = null
let levelData: Float32Array | null = null
let smoothedInputLevel = 0

export function startAudioLevelMonitoring(stream: MediaStream, onLevelChange: (level: number) => void) {
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
      onLevelChange(Number(smoothedInputLevel.toFixed(4)))
    }

    levelTimerId = window.setInterval(tick, 50)
  } catch {
    cleanupAudioLevelMonitoring()
  }
}

export function cleanupAudioLevelMonitoring() {
  if (levelTimerId !== null) window.clearInterval(levelTimerId)
  levelTimerId = null

  // 音量监控独立于录音上传，停止后必须释放资源。
  levelSource?.disconnect()
  levelSource = null
  levelAnalyser = null
  levelData = null
  smoothedInputLevel = 0

  const audioContext = levelAudioContext
  levelAudioContext = null
  if (audioContext) void audioContext.close().catch(() => undefined)
}
