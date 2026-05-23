/**
 * 转录模型数据源
 *
 * 需要通过 renderer 查询、下载、取消、删除或选择 ASR 模型时看这里。
 */
import { ipcClient } from './ipc'

export type ModelInfo = {
  id: string
  name: string
  repoId: string
  engine: 'faster-whisper' | 'funasr' | 'funasr-streaming'
  description: string
  sizeMb: number
  accuracyScore: number
  speedScore: number
  supportedLanguages: string[]
  isCurrent: boolean
  isDownloaded: boolean
  isDownloading: boolean
  downloadProgress: number
  downloadError: string
  snapshotPath: string
  cacheSource: 'managed-cache' | 'hf-cache' | ''
  canDelete: boolean
}

export type ModelsState = {
  currentModelId: string
  models: ModelInfo[]
  explicitModelDir: string
  selectionLocked: boolean
}

type IpcResponse<T> = {
  success?: boolean
  data?: T
  detail?: string
  code?: string
}

export const emptyModelsState: ModelsState = {
  currentModelId: 'fun-asr-nano-2512',
  models: [],
  explicitModelDir: '',
  selectionLocked: false,
}

function normalizeModelsState(value: unknown): ModelsState {
  const candidate = value && typeof value === 'object' ? value as Partial<ModelsState> : null
  return {
    currentModelId: typeof candidate?.currentModelId === 'string' ? candidate.currentModelId : 'fun-asr-nano-2512',
    models: Array.isArray(candidate?.models) ? candidate.models as ModelInfo[] : [],
    explicitModelDir: typeof candidate?.explicitModelDir === 'string' ? candidate.explicitModelDir : '',
    selectionLocked: Boolean(candidate?.selectionLocked),
  }
}

async function invokeModelCommand(channel: string, modelId?: string): Promise<ModelsState> {
  const response = await ipcClient.invoke<IpcResponse<ModelsState>>(channel, modelId)
  if (response?.success === false) {
    throw new Error(response.detail || response.code || '模型请求失败')
  }
  return normalizeModelsState(response?.data ?? response)
}

export function loadModelsState(): Promise<ModelsState> {
  return invokeModelCommand('model:list')
}

export function downloadModel(modelId: string): Promise<ModelsState> {
  return invokeModelCommand('model:download', modelId)
}

export function cancelModelDownload(modelId: string): Promise<ModelsState> {
  return invokeModelCommand('model:cancel-download', modelId)
}

export function deleteModel(modelId: string): Promise<ModelsState> {
  return invokeModelCommand('model:delete', modelId)
}

export function selectModel(modelId: string): Promise<ModelsState> {
  return invokeModelCommand('model:select', modelId)
}
