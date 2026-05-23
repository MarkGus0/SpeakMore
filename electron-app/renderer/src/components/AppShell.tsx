import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import Sidebar from './Sidebar'
import Dashboard from '../pages/Dashboard'
import History from '../pages/History'
import Dictionary from '../pages/Dictionary'
import Models from '../pages/Models'
import Settings from '../pages/Settings'
import { type Page } from '../navigation'
import { disposeRecorder } from '../services/recorder'
import { useGlobalShortcutBridge } from './useGlobalShortcutBridge'
import { useVoiceHistoryPersistence } from './useVoiceHistoryPersistence'

export default function AppShell() {
  const [page, setPage] = useState<Page>('home')
  useGlobalShortcutBridge()
  useVoiceHistoryPersistence()

  useEffect(() => {
    return () => {
      disposeRecorder()
    }
  }, [])

  const content = useMemo(() => ({
    home: <Dashboard />,
    history: <History />,
    dictionary: <Dictionary />,
    models: <Models />,
    settings: <Settings />,
  }), [])

  return (
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
  )
}
