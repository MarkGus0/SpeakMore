import { Box, Typography } from '@mui/material'
import { pageSx, pageTitleSx } from '../uiTokens'
import AsrRuntimeSettingsSection from './settings/AsrRuntimeSettingsSection'
import AudioSettingsSection from './settings/AudioSettingsSection'
import LanguageSettingsSection from './settings/LanguageSettingsSection'
import LlmSettingsSection from './settings/LlmSettingsSection'
import MacOSPermissionSection from './settings/MacOSPermissionSection'
import ShortcutSettingsSection from './settings/ShortcutSettingsSection'
import { useSettingsPageState } from './settings/useSettingsPageState'
import { useI18n } from '../i18n'

export default function Settings() {
  const { t } = useI18n()
  const {
    settings,
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
  } = useSettingsPageState()

  return (
    <Box sx={{ ...pageSx, maxWidth: 680 }}>
      <Typography sx={{ ...pageTitleSx, mb: 2 }}>{t('settings.title')}</Typography>
      <ShortcutSettingsSection />
      <MacOSPermissionSection />
      <AudioSettingsSection
        settings={settings}
        devices={devices}
        updateSettings={updateSettings}
      />
      <AsrRuntimeSettingsSection settings={settings} updateSettings={updateSettings} />
      <LanguageSettingsSection settings={settings} updateSettings={updateSettings} />
      <LlmSettingsSection
        llmView={llmView}
        currentProvider={currentProvider}
        isLlmEditing={isLlmEditing}
        isSavingLlm={isSavingLlm}
        llmSaveMessage={llmSaveMessage}
        updateProvider={updateProvider}
        updateCurrentProvider={updateCurrentProvider}
        updateCurrentApiKey={updateCurrentApiKey}
        updateCurrentModel={updateCurrentModel}
        beginLlmEdit={beginLlmEdit}
        cancelLlmEdit={cancelLlmEdit}
        saveLlmSettings={saveLlmSettings}
      />
    </Box>
  )
}
