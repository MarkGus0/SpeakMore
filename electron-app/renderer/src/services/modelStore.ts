import { ipcClient } from './ipc'

export type ModelInfo = {
  id: string
  name: string
  repoId: string
  engine: 'faster-whisper'
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
  currentModelId: 'base',
  models: [],
  explicitModelDir: '',
  selectionLocked: false,
}

function normalizeModelInfo(value: unknown): ModelInfo | null {
  const model = value as Partial<ModelInfo> | null
  if (!model || typeof model.id !== 'string' || typeof model.name !== 'string') return null
  return {
    id: model.id,
    name: model.name,
    repoId: typeof model.repoId === 'string' ? model.repoId : '',
    engine: 'faster-whisper',
    description: typeof model.description === 'string' ? model.description : '',
    sizeMb: Number(model.sizeMb) || 0,
    accuracyScore: Number(model.accuracyScore) || 0,
    speedScore: Number(model.speedScore) || 0,
    supportedLanguages: Array.isArray(model.supportedLanguages) ? model.supportedLanguages.map(String) : [],
    isCurrent: Boolean(model.isCurrent),
    isDownloaded: Boolean(model.isDownloaded),
    isDownloading: Boolean(model.isDownloading),
    downloadProgress: Math.max(0, Math.min(100, Number(model.downloadProgress) || 0)),
    downloadError: typeof model.downloadError === 'string' ? model.downloadError : '',
    snapshotPath: typeof model.snapshotPath === 'string' ? model.snapshotPath : '',
  }
}

function normalizeModelsState(value: unknown): ModelsState {
  const candidate = value as Partial<ModelsState> | null
  return {
    currentModelId: typeof candidate?.currentModelId === 'string' ? candidate.currentModelId : 'base',
    models: Array.isArray(candidate?.models)
      ? candidate.models.map(normalizeModelInfo).filter((model): model is ModelInfo => Boolean(model))
      : [],
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
