import { ipcClient } from './ipc'

export type DictionaryEntrySource = 'manual' | 'auto'
export type DictionaryEntryStatus = 'active' | 'disabled'
export type DictionaryCandidateStatus = 'candidate' | 'ignored' | 'promoted'

export type DictionaryEntry = {
  id: string
  phrase: string
  aliases: string[]
  source: DictionaryEntrySource
  status: DictionaryEntryStatus
  hitCount: number
  createdAt: string
  updatedAt: string
  lastLearnedAt: string
}

export type DictionaryCandidate = {
  id: string
  wrong: string
  correct: string
  count: number
  status: DictionaryCandidateStatus
  firstSeenAt: string
  lastSeenAt: string
}

export type PromptDictionaryTerm = {
  phrase: string
  aliases: string[]
}

export async function listDictionaryEntries(): Promise<DictionaryEntry[]> {
  try {
    const entries = await ipcClient.invoke<DictionaryEntry[]>('dictionary:list')
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

export async function createDictionaryEntry(payload: Partial<DictionaryEntry>): Promise<DictionaryEntry | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: DictionaryEntry }>('dictionary:create', payload)
    return response?.data || null
  } catch {
    return null
  }
}

export async function updateDictionaryEntry(payload: Partial<DictionaryEntry> & { id: string }): Promise<DictionaryEntry | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: DictionaryEntry }>('dictionary:update', payload)
    return response?.data || null
  } catch {
    return null
  }
}

export async function deleteDictionaryEntry(id: string): Promise<void> {
  try {
    await ipcClient.invoke('dictionary:delete', id)
  } catch {
    // 浏览器预览环境没有主进程词典数据。
  }
}

export async function listDictionaryCandidates(): Promise<DictionaryCandidate[]> {
  try {
    const candidates = await ipcClient.invoke<DictionaryCandidate[]>('dictionary:candidates-list')
    return Array.isArray(candidates) ? candidates : []
  } catch {
    return []
  }
}

export async function promoteDictionaryCandidate(id: string): Promise<DictionaryEntry | null> {
  try {
    const response = await ipcClient.invoke<{ success?: boolean; data?: DictionaryEntry }>('dictionary:candidate-promote', id)
    return response?.data || null
  } catch {
    return null
  }
}

export async function ignoreDictionaryCandidate(id: string): Promise<void> {
  try {
    await ipcClient.invoke('dictionary:candidate-ignore', id)
  } catch {
    // 浏览器预览环境没有主进程候选词数据。
  }
}

export async function loadPromptDictionaryTerms(): Promise<PromptDictionaryTerm[]> {
  try {
    const terms = await ipcClient.invoke<PromptDictionaryTerm[]>('dictionary:prompt-terms')
    return Array.isArray(terms) ? terms : []
  } catch {
    return []
  }
}
