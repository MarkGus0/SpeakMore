/**
 * 音频设置区块
 *
 * 需要选择麦克风和开机启动时看这里。
 */
import { Box, MenuItem, Select, Switch, Typography } from '@mui/material'
import { type LocalSettings } from '../../services/settingsStore'

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
  return (
    <>
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

      <Typography sx={sectionTitle}>其他设置</Typography>
      <Box sx={rowSx}>
        <Typography>开机启动</Typography>
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
