import { useEffect, useRef, useState } from 'react'
import { Box, Typography, Select, MenuItem, Switch, Button, TextField } from '@mui/material'
import { ipcClient } from '../services/ipc'
import {
  defaultSettings,
  loadSettings,
  reloadLlmBackendConfig,
  saveSettings,
  type LlmProvider,
  type LocalSettings,
  type TranslationTargetLanguage,
} from '../services/settingsStore'
import { pageSx, pageTitleSx } from '../uiTokens'

const keybindChip = {
  borderRadius: '6px',
  border: '1px solid rgba(119,119,119,0.12)',
  padding: '4px 8px',
  fontSize: '13px',
  display: 'inline-block',
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 }

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {keys.map((key) => (
        <Box key={key} component="span" sx={keybindChip}>{key}</Box>
      ))}
    </Box>
  )
}

type AudioDevice = { deviceId: string; label?: string }

export default function Settings() {
  const [settings, setSettings] = useState<LocalSettings>(defaultSettings)
  const [llmDraft, setLlmDraft] = useState<LocalSettings['llm']>(defaultSettings.llm)
  const [isLlmEditing, setIsLlmEditing] = useState(false)
  const [isSavingLlm, setIsSavingLlm] = useState(false)
  const [llmSaveMessage, setLlmSaveMessage] = useState('')
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const settingsUpdateSeq = useRef(0)

  useEffect(() => {
    loadSettings()
      .then((loadedSettings) => {
        setSettings(loadedSettings)
        setLlmDraft(loadedSettings.llm)
      })
      .catch(() => undefined)
    navigator.mediaDevices.enumerateDevices()
      .then((items) => setDevices(items
        .filter((device) => device.kind === 'audioinput')
        .map((device) => ({ deviceId: device.deviceId, label: device.label }))))
      .catch(() => setDevices([]))
  }, [])

  const updateSettings = async (next: LocalSettings) => {
    const seq = settingsUpdateSeq.current + 1
    settingsUpdateSeq.current = seq
    setSettings(next)
    const saved = await saveSettings(next)
    if (settingsUpdateSeq.current === seq) setSettings(saved)
  }

  const llmView = isLlmEditing ? llmDraft : settings.llm
  const currentProvider = llmView.providers.find((provider) => provider.id === llmView.providerId)
    ?? llmView.providers[0]

  const updateProvider = (providerId: string) => {
    if (!llmDraft.providers.some((provider) => provider.id === providerId)) return
    setLlmDraft({ ...llmDraft, providerId })
  }

  const updateCurrentProvider = (updater: (provider: LlmProvider) => LlmProvider) => {
    if (!currentProvider) return
    setLlmDraft({
      ...llmDraft,
      providers: llmDraft.providers.map((provider) => (
        provider.id === currentProvider.id ? updater(provider) : provider
      )),
    })
  }

  const updateCurrentApiKey = (apiKey: string) => {
    if (!currentProvider) return
    setLlmDraft({
      ...llmDraft,
      apiKeys: { ...llmDraft.apiKeys, [currentProvider.id]: apiKey },
    })
  }

  const updateCurrentModel = (model: string) => {
    if (!currentProvider) return
    setLlmDraft({
      ...llmDraft,
      models: { ...llmDraft.models, [currentProvider.id]: model },
    })
  }

  const beginLlmEdit = () => {
    setLlmDraft(settings.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(true)
  }

  const cancelLlmEdit = () => {
    setLlmDraft(settings.llm)
    setLlmSaveMessage('')
    setIsLlmEditing(false)
  }

  const saveLlmSettings = async () => {
    setIsSavingLlm(true)
    setLlmSaveMessage('')
    const saved = await saveSettings({ ...settings, llm: llmDraft })
    setSettings(saved)
    setLlmDraft(saved.llm)
    const reloadResult = await reloadLlmBackendConfig()
    if (reloadResult.success) {
      setIsLlmEditing(false)
      setLlmSaveMessage('已保存')
    } else {
      setLlmSaveMessage(`后端重载失败：${reloadResult.detail || reloadResult.code || '未知错误'}`)
    }
    setIsSavingLlm(false)
  }

  return (
    <Box sx={{ ...pageSx, maxWidth: 680 }}>
      <Typography sx={{ ...pageTitleSx, mb: 2 }}>设置</Typography>

      {/* 快捷键 */}
      <Typography sx={sectionTitle}>快捷键</Typography>
      <Box sx={rowSx}>
        <Typography>按下开始和停止语音输入。</Typography>
        <KeyChips keys={['Right Alt']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止自由提问。</Typography>
        <KeyChips keys={['Right Alt', 'Space']} />
      </Box>
      <Box sx={rowSx}>
        <Typography>按下开始和停止翻译。</Typography>
        <KeyChips keys={['Right Alt', 'Right Shift']} />
      </Box>

      {/* 麦克风 */}
      <Typography sx={sectionTitle}>麦克风</Typography>
      <Box sx={rowSx}>
        <Select
          size="small"
          value={settings.selectedAudioDeviceId}
          onChange={(event) => void updateSettings({ ...settings, selectedAudioDeviceId: String(event.target.value) })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="default">系统默认</MenuItem>
          {devices.map((device) => (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              {device.label || `输入设备 ${device.deviceId}`}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* 语言 */}
      <Typography sx={sectionTitle}>语言</Typography>
      <Box sx={rowSx}>
        <Typography>界面语言</Typography>
        <Select
          size="small"
          value={settings.preferredLanguage}
          onChange={(event) => void updateSettings({ ...settings, preferredLanguage: String(event.target.value) as 'zh-CN' })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="zh-CN">简体中文 (zh-CN)</MenuItem>
        </Select>
      </Box>
      <Box sx={rowSx}>
        <Typography>翻译目标语言</Typography>
        <Select
          size="small"
          value={settings.translationTargetLanguage}
          onChange={(event) => void updateSettings({
            ...settings,
            translationTargetLanguage: String(event.target.value) as TranslationTargetLanguage,
          })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="en">英文 (en)</MenuItem>
        </Select>
      </Box>

      {/* 大模型 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 500 }}>大模型</Typography>
        {isLlmEditing ? (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button variant="outlined" size="small" onClick={cancelLlmEdit} disabled={isSavingLlm}>取消</Button>
            <Button variant="contained" size="small" onClick={() => void saveLlmSettings()} disabled={isSavingLlm}>保存</Button>
          </Box>
        ) : (
          <Button variant="outlined" size="small" onClick={beginLlmEdit}>修改</Button>
        )}
      </Box>
      {llmSaveMessage && (
        <Typography sx={{ fontSize: 12, color: llmSaveMessage.startsWith('后端') ? 'error.main' : 'success.main', mb: 1 }}>
          {llmSaveMessage}
        </Typography>
      )}
      <Box sx={rowSx}>
        <Typography>提供商</Typography>
        <Select
          size="small"
          value={llmView.providerId}
          onChange={(event) => updateProvider(String(event.target.value))}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ minWidth: 240 }}
        >
          {llmView.providers.map((provider) => (
            <MenuItem key={provider.id} value={provider.id}>{provider.label}</MenuItem>
          ))}
        </Select>
      </Box>
      {currentProvider?.allowBaseUrlEdit && (
        <Box sx={rowSx}>
          <Typography>Base URL</Typography>
          <TextField
            fullWidth
            size="small"
            label="Base URL"
            placeholder="请输入兼容 OpenAI 的 Base URL"
            value={currentProvider.baseUrl}
            onChange={(event) => updateCurrentProvider((provider) => ({ ...provider, baseUrl: event.target.value }))}
            disabled={!isLlmEditing || isSavingLlm}
            sx={{ maxWidth: 420 }}
          />
        </Box>
      )}
      <Box sx={rowSx}>
        <Typography>API Key</Typography>
        <TextField
          fullWidth
          size="small"
          type="password"
          label="API Key"
          placeholder="请输入 API Key"
          value={currentProvider ? llmView.apiKeys[currentProvider.id] ?? '' : ''}
          onChange={(event) => updateCurrentApiKey(event.target.value)}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ maxWidth: 420 }}
        />
      </Box>
      <Box sx={rowSx}>
        <Typography>模型</Typography>
        <TextField
          fullWidth
          size="small"
          label="模型"
          placeholder="请输入模型名称"
          value={currentProvider ? llmView.models[currentProvider.id] ?? currentProvider.defaultModel : ''}
          onChange={(event) => updateCurrentModel(event.target.value)}
          disabled={!isLlmEditing || isSavingLlm}
          sx={{ maxWidth: 420 }}
        />
      </Box>

      {/* 其他设置 */}
      <Box sx={rowSx}>
        <Typography>开机启动</Typography>
        <Switch
          checked={settings.launchAtSystemStartup}
          onChange={(_event, checked) => {
            ipcClient.invoke('permission:update-auto-launch', { enable: checked }).finally(() => {
              void updateSettings({ ...settings, launchAtSystemStartup: checked })
            })
          }}
        />
      </Box>
    </Box>
  )
}
