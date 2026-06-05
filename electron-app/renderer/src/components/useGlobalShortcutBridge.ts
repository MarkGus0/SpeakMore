/**
 * 全局快捷键桥接
 *
 * 需要把 Windows 低级键盘事件转成语音意图时看这里。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ipcClient } from '../services/ipc'
import {
  cancelRecording,
  getVoiceSession,
  toggleRecordingByShortcut,
  toggleRecordingByShortcutCommand,
} from '../services/recorder'
import { hideFloatingPanel, showShortcutHintPanel } from '../services/floatingPanel'
import {
  listShortcutCommands,
  subscribeShortcutCommandChanges,
  subscribeShortcutCommandTriggers,
  type ShortcutCommand,
} from '../services/shortcutCommandStore'
import {
  blockByLongPress,
  createInitialShortcutGuardState,
  disposeShortcutGuard,
  reduceShortcutGuard,
  type ShortcutGuardState,
} from '../services/shortcutGuard'

const CANCELABLE_STATUSES = new Set(['connecting', 'recording', 'stopping', 'transcribing'])
const RIGHT_ALT_DOUBLE_TAP_MS = 280

export function useGlobalShortcutBridge() {
  const [shortcutGuard, setShortcutGuard] = useState(createInitialShortcutGuardState)
  const shortcutGuardRef = useRef(shortcutGuard)
  const shortcutHintMountedRef = useRef(false)
  const shortcutCommandsRef = useRef<Map<string, ShortcutCommand>>(new Map())
  const pendingDictateTimerRef = useRef<number | null>(null)
  const pendingDictateTapAtRef = useRef(0)

  const applyShortcutGuard = useCallback((nextGuard: ShortcutGuardState) => {
    shortcutGuardRef.current = nextGuard
    setShortcutGuard(nextGuard)
  }, [])

  const handleLongPress = useCallback(() => {
    applyShortcutGuard(blockByLongPress(shortcutGuardRef.current))
  }, [applyShortcutGuard])

  const clearPendingDictate = useCallback(() => {
    if (pendingDictateTimerRef.current !== null) {
      window.clearTimeout(pendingDictateTimerRef.current)
      pendingDictateTimerRef.current = null
    }
  }, [])

  const isCommandEnabled = useCallback((id: string) => {
    const command = shortcutCommandsRef.current.get(id)
    return command ? command.enabled : true
  }, [])

  const triggerShortcutIntent = useCallback((intent: 'DictateShortcut' | 'AskShortcut' | 'TranslateShortcut') => {
    if (intent !== 'DictateShortcut') {
      clearPendingDictate()
      void toggleRecordingByShortcut(intent)
      return
    }

    const pressedAt = Date.now()
    if (pendingDictateTimerRef.current !== null && pressedAt - pendingDictateTapAtRef.current <= RIGHT_ALT_DOUBLE_TAP_MS) {
      clearPendingDictate()
      if (isCommandEnabled('smart_assistant')) {
        void toggleRecordingByShortcut('AskShortcut')
      }
      return
    }

    pendingDictateTapAtRef.current = pressedAt
    pendingDictateTimerRef.current = window.setTimeout(() => {
      pendingDictateTimerRef.current = null
      if (isCommandEnabled('voice_input')) {
        void toggleRecordingByShortcut('DictateShortcut')
      }
    }, RIGHT_ALT_DOUBLE_TAP_MS)
  }, [clearPendingDictate, isCommandEnabled])

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
    const refreshCommands = () => {
      listShortcutCommands()
        .then((commands) => {
          shortcutCommandsRef.current = new Map(commands.map((command) => [command.id, command]))
        })
        .catch(() => undefined)
    }

    refreshCommands()
    return subscribeShortcutCommandChanges(() => {
      refreshCommands()
    })
  }, [])

  useEffect(() => {
    return subscribeShortcutCommandTriggers((command) => {
      clearPendingDictate()
      void toggleRecordingByShortcutCommand(command)
    })
  }, [clearPendingDictate])

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
        triggerShortcutIntent(next.action.intent)
      }
    })
  }, [applyShortcutGuard, handleLongPress, triggerShortcutIntent])

  useEffect(() => {
    return ipcClient.on('voice-cancel-requested', () => {
      if (!CANCELABLE_STATUSES.has(getVoiceSession().status)) return
      cancelRecording()
    })
  }, [])

  useEffect(() => {
    return () => {
      clearPendingDictate()
      disposeShortcutGuard(shortcutGuardRef.current)
    }
  }, [clearPendingDictate])

  return shortcutGuard
}
