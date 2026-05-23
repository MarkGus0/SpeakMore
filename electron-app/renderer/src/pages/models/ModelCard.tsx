/**
 * 模型卡片
 *
 * 需要渲染单个模型的展示和下载、选择、删除操作时看这里。
 */
import { Box, Button, Chip, LinearProgress, Typography, Alert } from '@mui/material'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  selectModel,
  type ModelInfo,
  type ModelsState,
} from '../../services/modelStore'

const rowSx = {
  bgcolor: '#fff',
  borderRadius: '8px',
  border: '1px solid rgba(119,119,119,0.10)',
  p: 1.75,
}

const scoreBarSx = {
  width: 72,
  height: 6,
  borderRadius: 999,
  bgcolor: 'rgba(119,119,119,0.16)',
  overflow: 'hidden',
}

function formatSize(sizeMb: number) {
  return sizeMb >= 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${sizeMb} MB`
}

function formatLanguages(languages: string[]) {
  if (languages.includes('multi')) return '多语言'
  const labels = languages.map((language) => {
    if (language === 'zh') return '中文'
    if (language === 'en') return '英文'
    return language
  })
  return labels.length ? labels.join('、') : '未知语言'
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ width: 44, fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={scoreBarSx}>
        <Box sx={{ width: `${Math.round(value * 100)}%`, height: '100%', bgcolor: '#3f3f3f' }} />
      </Box>
    </Box>
  )
}

type ModelCardProps = {
  model: ModelInfo
  selectionLocked: boolean
  onRefresh: (state: ModelsState) => void
  onError: (message: string) => void
}

export default function ModelCard({
  model,
  selectionLocked,
  onRefresh,
  onError,
}: ModelCardProps) {
  const run = async (action: () => Promise<ModelsState>) => {
    try {
      onRefresh(await action())
      onError('')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Box sx={rowSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{model.name}</Typography>
            {model.isCurrent ? <Chip size="small" label="当前使用" sx={{ bgcolor: '#1f1f1f', color: '#fff' }} /> : null}
            {model.isDownloaded && !model.isCurrent ? <Chip size="small" label="已下载" /> : null}
            {model.cacheSource === 'hf-cache' ? <Chip size="small" label="本机缓存" /> : null}
          </Box>
          <Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 14 }}>
            {model.description}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flexShrink: 0 }}>
          <ScoreBar label="准确度" value={model.accuracyScore} />
          <ScoreBar label="速度" value={model.speedScore} />
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          mt: 1.5,
          pt: 1.5,
          borderTop: '1px solid rgba(119,119,119,0.08)',
        }}
      >
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{formatLanguages(model.supportedLanguages)}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{formatSize(model.sizeMb)}</Typography>
        <Box sx={{ flex: 1, minWidth: 12 }} />
        {model.isDownloading ? (
          <Button
            size="small"
            startIcon={<CancelIcon />}
            onClick={() => void run(() => cancelModelDownload(model.id))}
          >
            取消下载
          </Button>
        ) : null}
        {!model.isDownloaded && !model.isDownloading ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => void run(() => downloadModel(model.id))}
          >
            下载
          </Button>
        ) : null}
        {model.isDownloaded && !model.isCurrent ? (
          <Button
            size="small"
            variant="contained"
            disabled={selectionLocked}
            startIcon={<CheckIcon />}
            onClick={() => void run(() => selectModel(model.id))}
          >
            设为当前
          </Button>
        ) : null}
        {model.isDownloaded && model.canDelete ? (
          <Button
            size="small"
            color="error"
            disabled={selectionLocked}
            startIcon={<DeleteIcon />}
            onClick={() => {
              if (window.confirm(`确定要删除 ${model.name} 吗？`)) {
                void run(() => deleteModel(model.id))
              }
            }}
          >
            删除
          </Button>
        ) : null}
      </Box>
      {model.isDownloading ? (
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>下载中</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{model.downloadProgress}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={model.downloadProgress} />
        </Box>
      ) : null}
      {model.downloadError ? <Alert severity="warning" sx={{ mt: 1.5 }}>{model.downloadError}</Alert> : null}
    </Box>
  )
}
