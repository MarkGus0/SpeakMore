/**
 * 音频设置区块
 *
 * 需要选择麦克风和开机启动时看这里。
 */
import { Box, MenuItem, Select, Switch, Typography } from '@mui/material'
import { type LocalSettings } from '../../services/settingsStore'
import { useI18n } from '../../i18n'

type AudioDevice = { deviceId: string; label?: string }

type AudioSettingsSectionProps = {
  settings: LocalSettings
  devices: AudioDevice[]
  updateSettings: (next: LocalSettings) => Promise<void>
}

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 0',
  borderBottom: '1px solid rgba(119,119,119,0.08)',
}

const sectionTitle = { fontSize: 16, fontWeight: 500, mt: 3, mb: 1 }

export default function AudioSettingsSection({ settings, devices, updateSettings }: AudioSettingsSectionProps) {
  const { t } = useI18n()

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.microphone')}</Typography>
      <Box sx={rowSx}>
        <Select
          size="small"
          value={settings.selectedAudioDeviceId}
          onChange={(event) => void updateSettings({ ...settings, selectedAudioDeviceId: String(event.target.value) })}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="default">{t('settings.systemDefault')}</MenuItem>
          {devices.map((device) => (
            <MenuItem key={device.deviceId} value={device.deviceId}>
              {device.label || `${t('settings.inputDevice')} ${device.deviceId}`}
            </MenuItem>
          ))}
        </Select>
      </Box>

      <Typography sx={sectionTitle}>{t('settings.other')}</Typography>
      <Box sx={rowSx}>
        <Typography>{t('settings.autoLaunch')}</Typography>
        <Switch
          checked={settings.launchAtSystemStartup}
          onChange={(_event, checked) => {
            void updateSettings({ ...settings, launchAtSystemStartup: checked })
          }}
        />
      </Box>
    </>
  )
}
