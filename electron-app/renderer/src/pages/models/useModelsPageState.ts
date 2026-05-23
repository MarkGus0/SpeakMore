/**
 * 模型页状态
 *
 * 需要轮询模型状态、过滤和错误回显时看这里。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { emptyModelsState, loadModelsState, type ModelsState } from '../../services/modelStore'

export type LanguageFilter = 'all' | 'zh' | 'en'

function modelMatchesLanguage(model: ModelsState['models'][number], language: LanguageFilter) {
  if (language === 'all') return true
  return model.supportedLanguages.includes(language) || model.supportedLanguages.includes('multi')
}

export function useModelsPageState() {
  const [state, setState] = useState<ModelsState>(emptyModelsState)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>('all')

  const refresh = useCallback(async () => {
    try {
      setState(await loadModelsState())
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!state.models.some((model) => model.isDownloading)) return undefined
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh, state.models])

  const filteredModels = useMemo(
    () => state.models.filter((model) => modelMatchesLanguage(model, languageFilter)),
    [languageFilter, state.models],
  )

  const downloaded = useMemo(
    () => filteredModels.filter((model) => model.isDownloaded || model.isDownloading),
    [filteredModels],
  )

  const available = useMemo(
    () => filteredModels.filter((model) => !model.isDownloaded && !model.isDownloading),
    [filteredModels],
  )

  return {
    state,
    error,
    loading,
    languageFilter,
    setLanguageFilter,
    downloaded,
    available,
    setState,
    setError,
  }
}
