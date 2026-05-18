import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { subscribeVoiceSession } from '../services/recorder'
import { ipcClient } from '../services/ipc'
import {
  emptyVoiceStats,
  formatAverageSpeed,
  formatDurationMinutes,
  formatSavedMinutes,
  listVoiceHistory,
  loadVoiceStats,
  type VoiceStats,
  VOICE_HISTORY_UPDATED_EVENT,
} from '../services/historyStore'
import {
  prependRecentDashboardResult,
  selectRecentDashboardResults,
  type RecentDashboardResult,
} from '../services/recentDashboardResults'
import { cardSx, subtlePanelSx } from '../uiTokens'

export default function Dashboard() {
  const [recentResults, setRecentResults] = useState<RecentDashboardResult[]>([])
  const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats)

  const handleCopyRecentResult = (text: string) => {
    if (!text) return
    ipcClient.invoke('clipboard:write-text', text).catch(() => navigator.clipboard.writeText(text))
  }

  useEffect(() => {
    return subscribeVoiceSession((voiceSession) => {
      if (voiceSession.status === 'completed' && voiceSession.mode !== 'Ask') {
        const { refinedText, rawText } = voiceSession
        const result = refinedText || rawText
        const id = voiceSession.audioId || `live-${Date.now()}`
        if (result) {
          setRecentResults((current) => prependRecentDashboardResult(current, { id, text: result }))
        }
      }
    })
  }, [])

  useEffect(() => {
    const refreshRecentResults = () => {
      listVoiceHistory()
        .then((items) => setRecentResults(selectRecentDashboardResults(items)))
        .catch(() => undefined)
    }

    refreshRecentResults()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshRecentResults)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshRecentResults)
  }, [])

  useEffect(() => {
    const refreshStats = () => {
      loadVoiceStats().then(setStats).catch(() => setStats(emptyVoiceStats))
    }

    refreshStats()
    window.addEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
    return () => window.removeEventListener(VOICE_HISTORY_UPDATED_EVENT, refreshStats)
  }, [])

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography sx={{ fontSize: 24, fontWeight: 500 }}>首页</Typography>
        <Typography sx={{ fontSize: 14, color: '#5d5d5d', mt: 0.5 }}>
          请短按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt + Right Shift
          </Box>{' '}
          或按{' '}
          <Box component="kbd" sx={{ bgcolor: 'rgba(119,119,119,0.08)', borderRadius: '5px', px: '5px', py: '2px', fontWeight: 500 }}>
            Right Alt + Space
          </Box>{' '}
          开始听写
        </Typography>
      </Box>

      <Box sx={{ ...subtlePanelSx, p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 24, fontWeight: 600 }}>暂未启用</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>整体个性化</Typography>
          </Box>
          <Box sx={{ width: 56, height: 56, borderRadius: '50%', background: 'conic-gradient(#d0d0d0 0% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: '#fff' }} />
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {[
            { label: '总听写时长', value: formatDurationMinutes(stats.totalDurationMs) },
            { label: '累计听写字数', value: String(stats.totalTextLength) },
            { label: '节省时间', value: formatSavedMinutes(stats.savedMs) },
            { label: '平均速度', value: formatAverageSpeed(stats.averageCharsPerMinute) },
          ].map((item) => (
            <Box key={item.label} sx={{ ...cardSx, p: '12px' }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{item.value}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box>
        <Box sx={{ ...cardSx, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 500 }}>最近结果</Typography>
          </Box>
          <Box sx={{ bgcolor: 'rgba(119,119,119,0.03)', borderRadius: '12px', minHeight: 64, overflow: 'hidden' }}>
            {recentResults.length > 0 ? recentResults.map((item, index) => (
              <Box
                key={item.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  alignItems: 'start',
                  gap: 1,
                  p: 1.5,
                  borderBottom: index === recentResults.length - 1 ? 'none' : '1px solid rgba(119,119,119,0.08)',
                }}
              >
                <Typography sx={{ fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.text}</Typography>
                <IconButton
                  size="small"
                  aria-label={`复制最近结果 ${index + 1}`}
                  onClick={() => handleCopyRecentResult(item.text)}
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            )) : (
              <Box sx={{ p: 1.5 }}>
                <Typography sx={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>-</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
