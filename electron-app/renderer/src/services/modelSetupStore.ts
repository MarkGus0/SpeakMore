/**
 * 首次运行模型初始化数据源
 *
 * 需要查询或触发 SenseVoiceSmall 下载时看这里。
 */
import { ipcClient } from './ipc'

export type VoiceModelSetupStatus =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'unavailable'

export type VoiceModelStatus = {
  success?: boolean
  status: VoiceModelSetupStatus
  detail: string
  model_id?: string
  repo_id?: string
  cache_dir?: string
  cached?: boolean
  ready?: boolean
  device?: string
  requested_device?: string
  device_source?: string
  fallback_reason?: string | null
  elapsed_ms?: number
  downloaded_bytes?: number
  total_bytes?: number
  progress_percent?: number | null
}

export type DirectorySelectionResult = {
  success: boolean
  canceled: boolean
  path: string
}

const unavailableStatus: VoiceModelStatus = {
  success: false,
  status: 'unavailable',
  detail: '无法连接语音后端',
  ready: false,
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizePercent(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeModelStatus(value: unknown): VoiceModelStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus
  const status = value as Record<string, unknown>
  const rawStatus = typeof status.status === 'string' ? status.status : 'unavailable'
  const normalizedStatus = ['idle', 'downloading', 'loading', 'ready', 'failed'].includes(rawStatus)
    ? rawStatus as VoiceModelSetupStatus
    : 'unavailable'

  return {
    success: Boolean(status.success ?? normalizedStatus !== 'unavailable'),
    status: normalizedStatus,
    detail: typeof status.detail === 'string' ? status.detail : '',
    model_id: typeof status.model_id === 'string' ? status.model_id : '',
    repo_id: typeof status.repo_id === 'string' ? status.repo_id : '',
    cache_dir: typeof status.cache_dir === 'string' ? status.cache_dir : '',
    cached: Boolean(status.cached),
    ready: Boolean(status.ready || normalizedStatus === 'ready'),
    device: typeof status.device === 'string' ? status.device : '',
    requested_device: typeof status.requested_device === 'string' ? status.requested_device : '',
    device_source: typeof status.device_source === 'string' ? status.device_source : '',
    fallback_reason: typeof status.fallback_reason === 'string' ? status.fallback_reason : null,
    elapsed_ms: typeof status.elapsed_ms === 'number' ? status.elapsed_ms : 0,
    downloaded_bytes: normalizeNumber(status.downloaded_bytes),
    total_bytes: normalizeNumber(status.total_bytes),
    progress_percent: normalizePercent(status.progress_percent),
  }
}
export async function getVoiceModelStatus(cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:get-status', { cacheDir }))
  } catch {
    return unavailableStatus
  }
}

export async function startVoiceModelDownload(cacheDir = ''): Promise<VoiceModelStatus> {
  try {
    return normalizeModelStatus(await ipcClient.invoke('voice-model:start-download', { cacheDir }))
  } catch {
    return unavailableStatus
  }
}

export async function chooseModelCacheDirectory(defaultPath = ''): Promise<DirectorySelectionResult> {
  try {
    const result = await ipcClient.invoke<Partial<DirectorySelectionResult>>('file:choose-directory', { defaultPath })
    return {
      success: Boolean(result?.success),
      canceled: Boolean(result?.canceled),
      path: typeof result?.path === 'string' ? result.path : '',
    }
  } catch {
    return { success: false, canceled: true, path: '' }
  }
}
