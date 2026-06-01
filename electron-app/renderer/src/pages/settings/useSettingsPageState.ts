/**
 * 设置页状态
 *
 * 需要加载本地设置、枚举麦克风或保存大模型配置时看这里。
 */
import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  defaultSettings,
  loadSettings,
  reloadLlmBackendConfig,
  saveSettings,
  type LlmProvider,
  type LocalSettings,
} from '../../services/settingsStore'

export type AudioDevice = { deviceId: string; label?: string }

function toAudioInputDevices(devices: MediaDeviceInfo[]): AudioDevice[] {
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

export function useSettingsPageState() {
  const [settings, setSettings] = useState<LocalSettings>(defaultSettings)
  const [llmDraft, setLlmDraft] = useState<LocalSettings['llm']>(defaultSettings.llm)
  const [isLlmEditing, setIsLlmEditing] = useState(false)
  const [isSavingLlm, setIsSavingLlm] = useState(false)
  const [llmSaveMessage, setLlmSaveMessage] = useState('')
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const settingsUpdateSeq = useRef(0)
  const settingsRef = useRef(defaultSettings)

  useEffect(() => {
    let cancelled = false

    loadSettings()
      .then((loadedSettings) => {
        if (cancelled) return
        settingsRef.current = loadedSettings
        setSettings(loadedSettings)
        setLlmDraft(loadedSettings.llm)
      })
      .catch(() => undefined)

    navigator.mediaDevices.enumerateDevices()
      .then((items) => {
        if (cancelled) return
        setDevices(toAudioInputDevices(items))
      })
      .catch(() => {
        if (cancelled) return
        setDevices([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateSettings = useCallback(async (next: LocalSettings) => {
    const seq = settingsUpdateSeq.current + 1
    settingsUpdateSeq.current = seq
    settingsRef.current = next
    setSettings(next)

    // 自动启动链路暂时停用，避免设置页写入系统开机项。

    const saved = await saveSettings(next)
    if (settingsUpdateSeq.current === seq) {
      settingsRef.current = saved
      setSettings(saved)
    }
  }, [])

  const llmView = useMemo(() => (
    isLlmEditing ? llmDraft : settings.llm
  ), [isLlmEditing, llmDraft, settings.llm])

  const currentProvider = useMemo(() => (
    llmView.providers.find((provider) => provider.id === llmView.providerId)
      ?? llmView.providers[0]
  ), [llmView])

  const updateProvider = useCallback((providerId: string) => {
    setLlmDraft((currentDraft) => {
      if (!currentDraft.providers.some((provider) => provider.id === providerId)) return currentDraft
      return { ...currentDraft, providerId }
    })
  }, [])

  const updateCurrentProvider = useCallback((updater: (provider: LlmProvider) => LlmProvider) => {
    setLlmDraft((currentDraft) => {
      const providerId = currentDraft.providerId
      if (!currentDraft.providers.some((provider) => provider.id === providerId)) return currentDraft
      return {
        ...currentDraft,
        providers: currentDraft.providers.map((provider) => (
          provider.id === providerId ? updater(provider) : provider
        )),
      }
    })
  }, [])

  const updateCurrentApiKey = useCallback((apiKey: string) => {
    setLlmDraft((currentDraft) => ({
      ...currentDraft,
      apiKeys: currentDraft.providers.some((provider) => provider.id === currentDraft.providerId)
        ? { ...currentDraft.apiKeys, [currentDraft.providerId]: apiKey }
        : currentDraft.apiKeys,
    }))
  }, [])

  const updateCurrentModel = useCallback((model: string) => {
    setLlmDraft((currentDraft) => ({
      ...currentDraft,
      models: currentDraft.providers.some((provider) => provider.id === currentDraft.providerId)
        ? { ...currentDraft.models, [currentDraft.providerId]: model }
        : currentDraft.models,
    }))
  }, [])

  const beginLlmEdit = useCallback(() => {
    setLlmDraft(settingsRef.current.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(true)
  }, [])

  const cancelLlmEdit = useCallback(() => {
    setLlmDraft(settingsRef.current.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(false)
  }, [])

  const saveLlmSettings = useCallback(async () => {
    setIsSavingLlm(true)
    setLlmSaveMessage('')

    try {
      const saved = await saveSettings({ ...settingsRef.current, llm: llmDraft })
      settingsRef.current = saved
      setSettings(saved)
      setLlmDraft(saved.llm)

      const reloadResult = await reloadLlmBackendConfig()
      if (reloadResult.success) {
        setIsLlmEditing(false)
        setLlmSaveMessage('已保存')
        return
      }

      setLlmSaveMessage(`后端重载失败：${reloadResult.detail || reloadResult.code || '未知错误'}`)
    } finally {
      setIsSavingLlm(false)
    }
  }, [llmDraft])

  return {
    settings,
    llmDraft,
    llmView,
    currentProvider,
    isLlmEditing,
    isSavingLlm,
    llmSaveMessage,
    devices,
    updateSettings,
    updateProvider,
    updateCurrentProvider,
    updateCurrentApiKey,
    updateCurrentModel,
    beginLlmEdit,
    cancelLlmEdit,
    saveLlmSettings,
  }
}
