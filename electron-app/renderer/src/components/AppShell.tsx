import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Dictionary from '../pages/Dictionary'
import Shortcuts from '../pages/Shortcuts'
import MeetingNotes from '../pages/MeetingNotes'
import Settings from '../pages/Settings'
import Setup from '../pages/Setup'
import { type Page } from '../navigation'
import { I18nProvider } from '../i18n'
import { defaultSettings, loadSettings, type InterfaceLanguage } from '../services/settingsStore'
import { disposeRecorder } from '../services/recorder'
import { useGlobalShortcutBridge } from './useGlobalShortcutBridge'
import { useVoiceHistoryPersistence } from './useVoiceHistoryPersistence'

export default function AppShell() {
  const [page, setPage] = useState<Page>('setup')
  const [language, setLanguage] = useState<InterfaceLanguage>(defaultSettings.preferredLanguage)
  useGlobalShortcutBridge()
  useVoiceHistoryPersistence()

  useEffect(() => {
    let cancelled = false

    loadSettings()
      .then((settings) => {
        if (!cancelled) setLanguage(settings.preferredLanguage)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      disposeRecorder()
    }
  }, [])

  const content = useMemo(() => ({
    setup: <Setup onOpenSettings={() => setPage('settings')} />,
    home: <Dashboard />,
    history: <History />,
    dictionary: <Dictionary />,
    shortcuts: <Shortcuts />,
    meetingNotes: <MeetingNotes />,
    settings: <Settings />,
  }), [])

  return (
    <I18nProvider language={language} setLanguage={setLanguage}>
      <Box sx={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: 2,
            WebkitAppRegion: 'drag',
          }}
        />

        <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <Sidebar activePage={page} onNavigate={setPage} />
          <Box
            sx={{
              flex: 1,
              bgcolor: 'background.paper',
              borderRadius: '8px',
              border: '1px solid rgba(119,119,119,0.15)',
              overflow: 'auto',
            }}
          >
            {content[page]}
          </Box>
        </Box>
      </Box>
    </I18nProvider>
  )
}
