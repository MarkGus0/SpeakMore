/**
 * 大模型设置区块
 *
 * 需要编辑 provider、API Key 或模型时看这里。
 */
import { Box, Button, MenuItem, Select, TextField, Typography } from '@mui/material'
import { type LlmProvider, type LlmSettings } from '../../services/settingsStore'

type LlmSettingsSectionProps = {
  llmView: LlmSettings
  currentProvider: LlmProvider | undefined
  isLlmEditing: boolean
  isSavingLlm: boolean
  llmSaveMessage: string
  updateProvider: (providerId: string) => void
  updateCurrentProvider: (updater: (provider: LlmProvider) => LlmProvider) => void
  updateCurrentApiKey: (apiKey: string) => void
  updateCurrentModel: (model: string) => void
  beginLlmEdit: () => void
  cancelLlmEdit: () => void
  saveLlmSettings: () => Promise<void>
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500 }

export default function LlmSettingsSection({
  llmView,
  currentProvider,
  isLlmEditing,
  isSavingLlm,
  llmSaveMessage,
  updateProvider,
  updateCurrentProvider,
  updateCurrentApiKey,
  updateCurrentModel,
  beginLlmEdit,
  cancelLlmEdit,
  saveLlmSettings,
}: LlmSettingsSectionProps) {
  const saveMessageColor = llmSaveMessage.startsWith('后端') ? 'error.main' : 'success.main'

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1 }}>
        <Typography sx={sectionTitle}>大模型</Typography>
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
        <Typography sx={{ fontSize: 12, color: saveMessageColor, mb: 1 }}>
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
      {currentProvider?.allowBaseUrlEdit ? (
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
      ) : null}
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
    </>
  )
}
