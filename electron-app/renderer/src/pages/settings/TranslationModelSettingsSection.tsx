import { useEffect, useState } from 'react'
import { Box, Button, Chip, LinearProgress, MenuItem, Select, Switch, Typography } from '@mui/material'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useI18n, type TranslationKey } from '../../i18n'
import { chooseModelCacheDirectory } from '../../services/modelSetupStore'
import {
  getTranslationModelStatus,
  loadTranslationModel,
  startTranslationModelDownload,
  unloadTranslationModel,
  type TranslationModelStatus,
} from '../../services/translationModelStore'
import { type LocalSettings, type TranslationEnginePreference } from '../../services/settingsStore'
import { bodyTextSx, captionTextSx, helperTextSx, sectionTitleSx } from '../../uiTokens'

type TranslationModelSettingsSectionProps = {
  settings: LocalSettings
  updateSettings: (next: LocalSettings) => Promise<void>
}

const sectionTitle = { ...sectionTitleSx, mt: 3, mb: 1 }

const panelSx = {
  bgcolor: 'rgba(59,130,246,0.06)',
  borderRadius: '8px',
  p: 2,
}

const rowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(180px, auto)' },
  gap: 1.5,
  py: 0.75,
}

function isBusy(status: TranslationModelStatus | null) {
  return status?.status === 'downloading' || status?.status === 'loading'
}

function formatBytes(bytes = 0) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function getStatusKey(status: TranslationModelStatus | null): TranslationKey {
  if (status?.status === 'downloading') return 'settings.translationModel.modelStatus.downloading'
  if (status?.status === 'loading') return 'settings.translationModel.modelStatus.loading'
  if (status?.status === 'ready') return 'settings.translationModel.modelStatus.ready'
  if (status?.status === 'failed') return 'settings.translationModel.modelStatus.failed'
  if (status?.status === 'runtime_missing') return 'settings.translationModel.modelStatus.runtimeMissing'
  if (status?.status === 'unavailable') return 'settings.translationModel.modelStatus.unavailable'
  if (status?.cached) return 'settings.translationModel.modelStatus.cached'
  return 'settings.translationModel.modelStatus.idle'
}

export default function TranslationModelSettingsSection({
  settings,
  updateSettings,
}: TranslationModelSettingsSectionProps) {
  const { t } = useI18n()
  const [modelStatus, setModelStatus] = useState<TranslationModelStatus | null>(null)
  const [isStartingAction, setIsStartingAction] = useState(false)

  const selectedCacheDir = settings.translationModelCacheDir.trim()
  const effectiveCacheDir = selectedCacheDir || modelStatus?.cache_dir || ''

  const refresh = async () => {
    setModelStatus(await getTranslationModelStatus(settings.translationModelCacheDir))
  }

  useEffect(() => {
    let cancelled = false

    const refreshIfMounted = async () => {
      const nextStatus = await getTranslationModelStatus(settings.translationModelCacheDir)
      if (!cancelled) setModelStatus(nextStatus)
    }

    void refreshIfMounted()
    const timer = window.setInterval(() => {
      void refreshIfMounted()
    }, 1200)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [settings.translationModelCacheDir])

  const handleChooseCacheDir = async () => {
    const result = await chooseModelCacheDirectory(effectiveCacheDir)
    if (!result.success || result.canceled || !result.path) return
    await updateSettings({ ...settings, translationModelCacheDir: result.path })
    setModelStatus(await getTranslationModelStatus(result.path))
  }

  const runAction = async (action: (cacheDir: string) => Promise<TranslationModelStatus>) => {
    setIsStartingAction(true)
    try {
      setModelStatus(await action(effectiveCacheDir))
    } finally {
      setIsStartingAction(false)
    }
  }

  const busy = isBusy(modelStatus) || isStartingAction
  const isReady = Boolean(modelStatus?.ready || modelStatus?.status === 'ready')
  const isCached = Boolean(modelStatus?.cached)
  const canChooseCacheDir = !busy && !isReady
  const hasDownloadProgress = modelStatus?.status === 'downloading'
    && typeof modelStatus.progress_percent === 'number'
    && (modelStatus.total_bytes ?? 0) > 0
  const hasFileProgress = modelStatus?.status === 'downloading'
    && typeof modelStatus.file_progress_percent === 'number'
    && (modelStatus.total_files ?? 0) > 0
  const statusText = t(getStatusKey(modelStatus))

  return (
    <>
      <Typography sx={sectionTitle}>{t('settings.translationModel.title')}</Typography>
      <Box sx={panelSx}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 1.25 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ ...helperTextSx, color: 'text.secondary' }}>
              {t('settings.translationModel.description')}
            </Typography>
            <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.5 }}>
              {t('settings.translationModel.fallbackHint')}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={statusText}
            color={isReady ? 'success' : modelStatus?.status === 'failed' ? 'error' : 'default'}
          />
        </Box>

        <Box sx={rowSx}>
          <Box>
            <Typography sx={bodyTextSx}>{t('settings.translationModel.enableLocal')}</Typography>
            <Typography sx={{ ...captionTextSx, color: 'text.secondary' }}>{t('settings.translationModel.enableLocalHint')}</Typography>
          </Box>
          <Switch
            checked={settings.localTranslationModelEnabled}
            onChange={(event) => void updateSettings({ ...settings, localTranslationModelEnabled: event.target.checked })}
          />
        </Box>

        <Box sx={rowSx}>
          <Typography sx={bodyTextSx}>{t('settings.translationModel.enginePreference')}</Typography>
          <Select
            size="small"
            value={settings.translationEnginePreference}
            onChange={(event) => void updateSettings({
              ...settings,
              translationEnginePreference: String(event.target.value) as TranslationEnginePreference,
            })}
            sx={{ minWidth: { xs: '100%', sm: 220 }, width: { xs: '100%', sm: 'auto' } }}
          >
            <MenuItem value="auto">{t('settings.translationModel.engine.auto')}</MenuItem>
            <MenuItem value="local">{t('settings.translationModel.engine.local')}</MenuItem>
            <MenuItem value="llm">{t('settings.translationModel.engine.llm')}</MenuItem>
          </Select>
        </Box>

        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.modelName')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' } }}>
            {modelStatus?.repo_id || 'AngelSlim/Hy-MT1.5-1.8B-2bit'}
          </Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.ggufModel')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' } }}>
            {modelStatus?.gguf_repo_id || 'AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF'}
          </Typography>
        </Box>
        <Box sx={rowSx}>
          <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.cacheDir')}</Typography>
          <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' }, wordBreak: 'break-all' }}>
            {effectiveCacheDir || '-'}
          </Typography>
        </Box>
        {modelStatus?.runtime_url ? (
          <Box sx={rowSx}>
            <Typography sx={{ ...bodyTextSx, color: 'text.secondary' }}>{t('settings.translationModel.runtime')}</Typography>
            <Typography sx={{ ...bodyTextSx, textAlign: { xs: 'left', sm: 'right' }, wordBreak: 'break-all' }}>
              {modelStatus.runtime_url}
            </Typography>
          </Box>
        ) : null}
        {modelStatus?.detail ? (
          <Typography sx={{ ...helperTextSx, color: modelStatus.status === 'failed' || modelStatus.status === 'runtime_missing' ? 'error.main' : 'text.secondary', mt: 1 }}>
            {modelStatus.detail}
          </Typography>
        ) : null}
        {busy ? (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant={hasDownloadProgress ? 'determinate' : 'indeterminate'}
              value={hasDownloadProgress ? modelStatus?.progress_percent ?? undefined : undefined}
            />
            {hasDownloadProgress ? (
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${modelStatus?.progress_percent}% - ${formatBytes(modelStatus?.downloaded_bytes)} / ${formatBytes(modelStatus?.total_bytes)}`}
              </Typography>
            ) : hasFileProgress ? (
              <Typography sx={{ ...captionTextSx, color: 'text.secondary', mt: 0.75 }}>
                {`${t('settings.translationModel.modelFilesProgress')} ${modelStatus?.downloaded_files} / ${modelStatus?.total_files}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          {canChooseCacheDir ? (
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              onClick={() => void handleChooseCacheDir()}
              sx={{ borderRadius: '8px' }}
            >
              {t('settings.translationModel.chooseCacheDir')}
            </Button>
          ) : null}
          <Button
            variant="contained"
            startIcon={<CloudDownloadIcon />}
            onClick={() => void runAction(startTranslationModelDownload)}
            disabled={busy || isReady}
            sx={{ borderRadius: '8px' }}
          >
            {isCached ? t('settings.translationModel.redownload') : t('settings.translationModel.startDownload')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<PlayArrowIcon />}
            onClick={() => void runAction(loadTranslationModel)}
            disabled={busy || !isCached || isReady}
            sx={{ borderRadius: '8px' }}
          >
            {t('settings.translationModel.loadModel')}
          </Button>
          {isReady ? (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<PowerSettingsNewIcon />}
              onClick={() => void runAction(unloadTranslationModel)}
              disabled={busy}
              sx={{ borderRadius: '8px' }}
            >
              {t('settings.translationModel.unloadModel')}
            </Button>
          ) : null}
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={busy}
            sx={{ borderRadius: '8px' }}
          >
            {t('settings.translationModel.refresh')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
