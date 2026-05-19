import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Chip, IconButton, Switch, TextField, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  createDictionaryEntry,
  deleteDictionaryEntry,
  ignoreDictionaryCandidate,
  listDictionaryCandidates,
  listDictionaryEntries,
  promoteDictionaryCandidate,
  updateDictionaryEntry,
  type DictionaryCandidate,
  type DictionaryEntry,
} from '../services/dictionaryStore'
import { pageSx, pageTitleSx } from '../uiTokens'

const filters = [
  { label: '全部', value: 'all' },
  { label: '自动添加', value: 'auto' },
  { label: '手动添加', value: 'manual' },
  { label: '候选', value: 'candidate' },
] as const

type FilterValue = (typeof filters)[number]['value']

const itemSx = {
  bgcolor: '#fff',
  borderRadius: '8px',
  border: '1px solid rgba(119,119,119,0.10)',
  p: 1.5,
}

function formatDate(value: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function matchesQuery(entry: DictionaryEntry, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return entry.phrase.toLowerCase().includes(keyword)
    || entry.aliases.some((alias) => alias.toLowerCase().includes(keyword))
}

function candidateMatchesQuery(candidate: DictionaryCandidate, query: string) {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return candidate.wrong.toLowerCase().includes(keyword) || candidate.correct.toLowerCase().includes(keyword)
}

export default function Dictionary() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [candidates, setCandidates] = useState<DictionaryCandidate[]>([])
  const [filter, setFilter] = useState<FilterValue>('all')
  const [query, setQuery] = useState('')
  const [phrase, setPhrase] = useState('')
  const [aliases, setAliases] = useState('')

  const refreshDictionary = async () => {
    const [nextEntries, nextCandidates] = await Promise.all([
      listDictionaryEntries(),
      listDictionaryCandidates(),
    ])
    setEntries(nextEntries)
    setCandidates(nextCandidates)
  }

  useEffect(() => {
    void refreshDictionary()
  }, [])

  const visibleEntries = useMemo(() => entries
    .filter((entry) => filter === 'all' || filter === 'candidate' || entry.source === filter)
    .filter((entry) => matchesQuery(entry, query)), [entries, filter, query])

  const visibleCandidates = useMemo(() => candidates
    .filter((candidate) => candidate.status === 'candidate')
    .filter(() => filter === 'all' || filter === 'candidate')
    .filter((candidate) => candidateMatchesQuery(candidate, query)), [candidates, filter, query])

  const handleCreateEntry = async () => {
    const nextPhrase = phrase.trim()
    if (!nextPhrase) return

    await createDictionaryEntry({
      phrase: nextPhrase,
      aliases: aliases.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      source: 'manual',
      status: 'active',
    })
    setPhrase('')
    setAliases('')
    await refreshDictionary()
  }

  const handleToggleEntry = async (entry: DictionaryEntry) => {
    await updateDictionaryEntry({
      id: entry.id,
      status: entry.status === 'active' ? 'disabled' : 'active',
    })
    await refreshDictionary()
  }

  const handleDeleteEntry = async (id: string) => {
    await deleteDictionaryEntry(id)
    await refreshDictionary()
  }

  const handlePromoteCandidate = async (id: string) => {
    await promoteDictionaryCandidate(id)
    await refreshDictionary()
  }

  const handleIgnoreCandidate = async (id: string) => {
    await ignoreDictionaryCandidate(id)
    await refreshDictionary()
  }

  return (
    <Box sx={{ ...pageSx, maxWidth: 920, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Typography sx={pageTitleSx}>词典</Typography>
        <Button variant="contained" onClick={handleCreateEntry} disabled={!phrase.trim()}>新增词条</Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mb: 2 }}>
        <TextField
          size="small"
          label="正确写法"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />
        <TextField
          size="small"
          label="错误写法或别名"
          placeholder="多个写法可用逗号或换行分隔"
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {filters.map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            color={filter === item.value ? 'primary' : 'default'}
            variant={filter === item.value ? 'filled' : 'outlined'}
            onClick={() => setFilter(item.value)}
          />
        ))}
        <TextField
          size="small"
          placeholder="搜索词条..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ ml: { xs: 0, md: 'auto' }, width: { xs: '100%', md: 260 } }}
        />
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibleCandidates.map((candidate) => (
          <Box key={candidate.id} sx={itemSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500 }}>
                  {candidate.wrong} → {candidate.correct}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                  候选 · 出现 {candidate.count} 次 · 最近学习 {formatDate(candidate.lastSeenAt)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <IconButton size="small" aria-label="确认候选词" onClick={() => void handlePromoteCandidate(candidate.id)}>
                  <CheckIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <IconButton size="small" aria-label="忽略候选词" onClick={() => void handleIgnoreCandidate(candidate.id)}>
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          </Box>
        ))}

        {visibleEntries.map((entry) => (
          <Box key={entry.id} sx={itemSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{entry.phrase}</Typography>
                  <Chip size="small" label={entry.source === 'auto' ? '自动添加' : '手动添加'} variant="outlined" />
                  {entry.status === 'disabled' ? <Chip size="small" label="已停用" /> : null}
                </Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
                  {entry.aliases.length ? `别名：${entry.aliases.join('、')}` : '暂无别名'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  命中 {entry.hitCount} 次 · 更新 {formatDate(entry.updatedAt)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>启用</Typography>
                <Switch
                  size="small"
                  checked={entry.status === 'active'}
                  onChange={() => void handleToggleEntry(entry)}
                />
                <IconButton size="small" aria-label="删除词条" onClick={() => void handleDeleteEntry(entry.id)}>
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
          </Box>
        ))}

        {visibleEntries.length === 0 && visibleCandidates.length === 0 ? (
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
            <Typography sx={{ color: 'text.secondary' }}>暂无词条</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
