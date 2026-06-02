import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Chip, LinearProgress, Typography } from '@mui/material'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import SettingsIcon from '@mui/icons-material/Settings'
import RefreshIcon from '@mui/icons-material/Refresh'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import { pageSx, pageTitleSx } from '../uiTokens'
import { useI18n, type TranslationKey } from '../i18n'
import {
  chooseModelCacheDirectory,
  getVoiceModelStatus,
  startVoiceModelDownload,
  type VoiceModelStatus,
} from '../services/modelSetupStore'
import { loadSettings, saveSettings, type LocalSettings } from '../services/settingsStore'

type SetupProps = {
  onOpenSettings: () => void
}

const sectionSx = {
  borderTop: '1px solid rgba(119,119,119,0.12)',
  py: 2,
}

const rowSx = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 2,
  py: 0.75,
}

function isModelBusy(status: VoiceModelStatus | null) {
  return status?.status === 'downloading' || status?.status === 'loading'
}

function formatBytes(bytes = 0) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function getStatusKey(status: VoiceModelStatus | null): TranslationKey {
  if (status?.status === 'downloading') return 'setup.modelStatus.downloading'
  if (status?.status === 'loading') return 'setup.modelStatus.loading'
  if (status?.status === 'ready') return 'setup.modelStatus.ready'
  if (status?.status === 'failed') return 'setup.modelStatus.failed'
  if (status?.status === 'unavailable') return 'setup.modelStatus.unavailable'
  if (status?.cached) return 'setup.modelStatus.cached'
  return 'setup.modelStatus.idle'
}

export default function Setup({ onOpenSettings }: SetupProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<VoiceModelStatus | null>(null)
  const [settings, setSettings] = useState<LocalSettings | null>(null)
  const [isStartingDownload, setIsStartingDownload] = useState(false)

  const currentProvider = useMemo(() => (
    settings?.llm.providers.find((provider) => provider.id === settings.llm.providerId)
      ?? settings?.llm.providers[0]
  ), [settings])
  const currentApiKey = currentProvider ? settings?.llm.apiKeys[currentProvider.id]?.trim() : ''
  const apiConfigured = Boolean(currentApiKey)
  const selectedModelCacheDir = settings?.modelCacheDir?.trim() || ''
  const effectiveModelCacheDir = selectedModelCacheDir || modelStatus?.cache_dir || ''

  const refresh = async () => {
    const nextSettings = await loadSettings()
    const nextStatus = await getVoiceModelStatus(nextSettings.modelCacheDir)
    setModelStatus(nextStatus)
    setSettings(nextSettings)
  }

  useEffect(() => {
    let cancelled = false

    const refreshIfMounted = async () => {
      const nextSettings = await loadSettings()
      const nextStatus = await getVoiceModelStatus(nextSettings.modelCacheDir)
      if (cancelled) return
      setModelStatus(nextStatus)
      setSettings(nextSettings)
    }

    void refreshIfMounted()
    const timer = window.setInterval(() => {
      void refreshIfMounted()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const handleStartDownload = async () => {
    setIsStartingDownload(true)
    try {
      setModelStatus(await startVoiceModelDownload(effectiveModelCacheDir))
    } finally {
      setIsStartingDownload(false)
    }
  }

  const handleChooseModelCacheDir = async () => {
    const result = await chooseModelCacheDirectory(effectiveModelCacheDir)
    if (!result.success || result.canceled || !result.path || !settings) return
    const nextSettings = await saveSettings({ ...settings, modelCacheDir: result.path })
    setSettings(nextSettings)
    setModelStatus(await getVoiceModelStatus(nextSettings.modelCacheDir))
  }

  const busy = isModelBusy(modelStatus) || isStartingDownload
  const isDownloaded = Boolean(modelStatus?.cached)
  const isReady = Boolean(modelStatus?.ready || modelStatus?.status === 'ready')
  const canChooseCacheDir = !isDownloaded && !isReady && !busy
  const downloadProgressPercent = modelStatus?.progress_percent ?? null
  const fileProgressPercent = modelStatus?.file_progress_percent ?? null
  const hasDownloadProgress = modelStatus?.status === 'downloading'
    && typeof downloadProgressPercent === 'number'
    && (modelStatus?.total_bytes ?? 0) > 0
  const hasFileProgress = modelStatus?.status === 'downloading'
    && typeof fileProgressPercent === 'number'
    && (modelStatus?.total_files ?? 0) > 0
  const statusText = t(getStatusKey(modelStatus))
  const modelActionText = isReady
    ? t('setup.modelReady')
    : isDownloaded
      ? t('setup.loadModel')
      : t('setup.startDownload')

  return (
    <Box sx={{ ...pageSx, maxWidth: 760 }}>
      <Typography sx={{ ...pageTitleSx, mb: 1 }}>{t('setup.title')}</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        {t('setup.subtitle')}
      </Typography>

      <Box sx={sectionSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>{t('setup.model')}</Typography>
          <Chip
            size="small"
            label={statusText}
            color={modelStatus?.status === 'ready' ? 'success' : modelStatus?.status === 'failed' ? 'error' : 'default'}
          />
        </Box>

        <Box sx={rowSx}>
          <Typography sx={{ color: 'text.secondary' }}>{t('setup.modelName')}</Typography>
          <Typography sx={{ textAlign: 'right' }}>{modelStatus?.repo_id || 'FunAudioLLM/SenseVoiceSmall'}</Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ color: 'text.secondary' }}>{t('setup.cacheDir')}</Typography>
          <Typography sx={{ textAlign: 'right', wordBreak: 'break-all' }}>{effectiveModelCacheDir || '-'}</Typography>
        </Box>
        {modelStatus?.detail ? (
          <Typography sx={{ fontSize: 13, color: modelStatus.status === 'failed' ? 'error.main' : 'text.secondary', mt: 1 }}>
            {modelStatus.detail}
          </Typography>
        ) : null}
        {busy ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant={hasDownloadProgress ? 'determinate' : 'indeterminate'}
              value={hasDownloadProgress ? downloadProgressPercent : undefined}
            />
            {hasDownloadProgress ? (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                {`${downloadProgressPercent}% · ${formatBytes(modelStatus?.downloaded_bytes)} / ${formatBytes(modelStatus?.total_bytes)}`}
              </Typography>
            ) : hasFileProgress ? (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                {`${t('setup.modelFilesProgress')} ${modelStatus?.downloaded_files} / ${modelStatus?.total_files}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {canChooseCacheDir ? (
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              onClick={() => void handleChooseModelCacheDir()}
            >
              {t('setup.chooseCacheDir')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CloudDownloadIcon />}
            onClick={() => void handleStartDownload()}
            disabled={busy || modelStatus?.status === 'ready'}
          >
            {modelActionText}
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={busy}
          >
            {t('setup.refresh')}
          </Button>
        </Box>
      </Box>

      <Box sx={sectionSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 500 }}>{t('setup.api')}</Typography>
          <Chip
            size="small"
            label={apiConfigured ? t('setup.apiReady') : t('setup.apiMissing')}
            color={apiConfigured ? 'success' : 'warning'}
          />
        </Box>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          {apiConfigured
            ? `${currentProvider?.label || 'DeepSeek'} ${t('setup.apiConfigured')}`
            : t('setup.apiRequired')}
        </Typography>
        <Button variant="outlined" startIcon={<SettingsIcon />} onClick={onOpenSettings}>
          {t('setup.openSettings')}
        </Button>
      </Box>
    </Box>
  )
}
