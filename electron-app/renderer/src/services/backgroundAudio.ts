import { ipcClient } from './ipc'

let backgroundAudioRestorePending = false

export function resetBackgroundAudioRestoreState() {
  backgroundAudioRestorePending = false
}

export async function muteBackgroundAudio() {
  try {
    const result = await ipcClient.invoke('audio:mute-background-sessions') as { success?: boolean }
    // 只在本轮确实静音成功时恢复，避免误改用户原本的音频会话状态。
    backgroundAudioRestorePending = Boolean(result?.success)
  } catch {
    backgroundAudioRestorePending = false
  }
}

export async function restoreBackgroundAudio() {
  if (!backgroundAudioRestorePending) return

  try {
    await ipcClient.invoke('audio:restore-background-sessions')
  } finally {
    backgroundAudioRestorePending = false
  }
}
