import { ipcClient } from './ipc'

export type ShortcutLabelSet = {
  dictation: string[]
  ask: string[]
  translate: string[]
}

export function getShortcutLabelSet(platform = ipcClient.platform()): ShortcutLabelSet {
  if (platform === 'darwin') {
    return {
      dictation: ['Right Option'],
      ask: ['Right Option', 'Right Command'],
      translate: ['Right Option', 'Shift'],
    }
  }

  return {
    dictation: ['Right Alt'],
    ask: ['Right Alt', 'Space'],
    translate: ['Right Alt', 'Right Shift'],
  }
}

export function formatShortcut(keys: string[]) {
  return keys.join(' + ')
}
