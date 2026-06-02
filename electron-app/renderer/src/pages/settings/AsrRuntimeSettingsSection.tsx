import { useEffect, useState } from 'react'
import { Box, Button, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useI18n } from '../../i18n'
import { isMacOSRuntime } from '../../services/macosPermissions'
import { getVoiceModelStatus, type VoiceModelStatus } from '../../services/modelSetupStore'
import { type AsrDeviceMode, type LocalSettings } from '../../services/settingsStore'

type AsrRuntimeSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 }

function normalizeMode(value: string | null): AsrDeviceMode | null {
  if (value === 'default' || value === 'mps' || value === 'cpu') return value
  return null
}

function formatDeviceStatus(status: VoiceModelStatus | null) {
  if (!status?.device) return ''
  const requested = status.requested_device && status.requested_device !== status.device
    ? ` / ${status.requested_device}`
    : ''
  return `${status.device}${requested}`
}

export default function AsrRuntimeSettingsSection({
  settings,
  updateSettings,
}: AsrRuntimeSettingsSectionProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshStatus = async () => {
    setIsRefreshing(true)
    try {
      setModelStatus(await getVoiceModelStatus(settings.modelCacheDir))
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (!isMacOSRuntime()) return
    void refreshStatus()
  }, [settings.modelCacheDir])

  if (!isMacOSRuntime()) return null

  const deviceStatus = formatDeviceStatus(modelStatus)
  const fallbackReason = modelStatus?.fallback_reason || ''

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.asrRuntime.title')}</Typography>
      <Box sx={rowSx}>
        <Box>
          <Typography>{t('settings.asrRuntime.mode')}</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
            {t('settings.asrRuntime.restartRequired')}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
            {t('settings.asrRuntime.devModeHint')}
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={settings.asrDeviceMode}
          onChange={(_, value) => {
            const mode = normalizeMode(value)
            if (!mode || mode === settings.asrDeviceMode) return
            void updateSettings({ ...settings, asrDeviceMode: mode })
          }}
        >
          <ToggleButton value="default">{t('settings.asrRuntime.default')}</ToggleButton>
          <ToggleButton value="mps">{t('settings.asrRuntime.mps')}</ToggleButton>
          <ToggleButton value="cpu">{t('settings.asrRuntime.cpu')}</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ ...rowSx, borderBottom: 'none' }}>
        <Box>
          <Typography>{t('settings.asrRuntime.currentDevice')}</Typography>
          {fallbackReason ? (
            <Typography sx={{ fontSize: 13, color: 'warning.main', mt: 0.5 }}>
              {t('settings.asrRuntime.fallbackReason')}：{fallbackReason}
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            size="small"
            label={deviceStatus || t('settings.asrRuntime.unavailable')}
            color={fallbackReason ? 'warning' : 'default'}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => void refreshStatus()}
            disabled={isRefreshing}
          >
            {t('settings.asrRuntime.refresh')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
