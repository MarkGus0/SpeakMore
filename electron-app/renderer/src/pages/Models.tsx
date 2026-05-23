import { Alert, Box, MenuItem, Select, Typography } from '@mui/material'
import { pageSx, pageTitleSx } from '../uiTokens'
import ModelCard from './models/ModelCard'
import { type LanguageFilter, useModelsPageState } from './models/useModelsPageState'

export default function Models() {
  const {
    state,
    error,
    loading,
    languageFilter,
    setLanguageFilter,
    downloaded,
    available,
    setState,
    setError,
  } = useModelsPageState()

  return (
    <Box sx={{ ...pageSx, maxWidth: 920, minHeight: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={pageTitleSx}>转录模型</Typography>
          <Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 14 }}>
            选择转录模型或下载其他模型。不同模型提供不同的准确度、速度和资源占用。
          </Typography>
        </Box>
        <Select
          size="small"
          value={languageFilter}
          onChange={(event) => setLanguageFilter(event.target.value as LanguageFilter)}
          sx={{ minWidth: 132, flexShrink: 0 }}
        >
          <MenuItem value="all">所有语言</MenuItem>
          <MenuItem value="zh">中文</MenuItem>
          <MenuItem value="en">英文</MenuItem>
        </Select>
      </Box>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {state.selectionLocked ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          当前由模型环境变量覆盖，模型切换和删除已禁用。
        </Alert>
      ) : null}
      {loading ? <Typography sx={{ color: 'text.secondary', mb: 2 }}>模型状态加载中...</Typography> : null}

      <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.secondary', mb: 1 }}>已下载的模型</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
        {downloaded.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            selectionLocked={state.selectionLocked}
            onRefresh={setState}
            onError={setError}
          />
        ))}
        {!loading && downloaded.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>暂无已下载模型。</Typography>
        ) : null}
      </Box>

      <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.secondary', mb: 1 }}>可供下载</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {available.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            selectionLocked={state.selectionLocked}
            onRefresh={setState}
            onError={setError}
          />
        ))}
        {!loading && available.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>没有可供下载的模型。</Typography>
        ) : null}
      </Box>
    </Box>
  )
}
