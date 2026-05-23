/**
 * 全局快捷键桥接
 *
 * 需要把 Windows 低级键盘事件转成语音意图时看这里。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ipcClient } from '../services/ipc'
import { cancelRecording, getVoiceSession, toggleRecordingByShortcut } from '../services/recorder'
import { hideFloatingPanel, showShortcutHintPanel } from '../services/floatingPanel'
import {
  blockByLongPress,
  createInitialShortcutGuardState,
  disposeShortcutGuard,
  reduceShortcutGuard,
  type ShortcutGuardState,
} from '../services/shortcutGuard'

const CANCELABLE_STATUSES = new Set(['connecting', 'recording', 'stopping', 'transcribing'])

export function useGlobalShortcutBridge() {
  const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState)
  const shortcutGuardRef = useRef(shortcutGuard)
  const shortcutHintMountedRef = useRef(false)

  const applyShortcutGuard = useCallback((nextGuard: ShortcutGuardState) => {
    shortcutGuardRef.current = nextGuard
    setShortcutGuard(nextGuard)
  }, [])

  const handleLongPress = useCallback(() => {
    applyShortcutGuard(blockByLongPress(shortcutGuardRef.current))
  }, [applyShortcutGuard])

  useEffect(() => {
    shortcutGuardRef.current = shortcutGuard
  }, [shortcutGuard])

  useEffect(() => {
    if (!shortcutHintMountedRef.current) {
      shortcutHintMountedRef.current = true
      return
    }

    if (shortcutGuard.modalVisible) {
      showShortcutHintPanel()
      return
    }

    hideFloatingPanel()
  }, [shortcutGuard.modalVisible])

  useEffect(() => {
    return ipcClient.on('global-keyboard', (_event, keys) => {
      const next = reduceShortcutGuard(
        shortcutGuardRef.current,
        keys,
        {
          voiceStatus: getVoiceSession().status,
          debugLog: (event, payload) => {
            if (import.meta.env.DEV) {
              console.debug(`[shortcut-debug] ${event}`, payload)
            }
          },
        },
        handleLongPress,
      )

      applyShortcutGuard(next.state)

      if (next.action.type === 'toggle-recording') {
        void toggleRecordingByShortcut(next.action.intent)
      }
    })
  }, [applyShortcutGuard, handleLongPress])

  useEffect(() => {
    return ipcClient.on('voice-cancel-requested', () => {
      if (!CANCELABLE_STATUSES.has(getVoiceSession().status)) return
      cancelRecording()
    })
  }, [])

  useEffect(() => {
    return () => {
      disposeShortcutGuard(shortcutGuardRef.current)
    }
  }, [])

  return shortcutGuard
}
