/**
 * 语言设置区块
 *
 * 需要调整界面语言或翻译目标语言时看这里。
 */
import { Box, MenuItem, Select, Typography } from '@mui/material'
import { TRANSLATION_TARGET_LANGUAGES, type LocalSettings } from '../../services/settingsStore'

type LanguageSettingsSectionProps = {
  settings: LocalSettings
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

export default function LanguageSettingsSection({ settings, updateSettings }: LanguageSettingsSectionProps) {
  return (
    <>
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
            translationTargetLanguage: String(event.target.value),
          })}
          sx={{ minWidth: 240 }}
        >
          {TRANSLATION_TARGET_LANGUAGES.map((language) => (
            <MenuItem key={language.id} value={language.id}>
              {language.displayName}
            </MenuItem>
          ))}
        </Select>
      </Box>
    </>
  )
}
