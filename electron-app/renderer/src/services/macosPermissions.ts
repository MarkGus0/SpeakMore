import { ipcClient } from './ipc'

export type MacOSAccessibilityStatus = {
  success: boolean
  trusted: boolean
  reason: string
  detail?: string
}

export function isMacOSRuntime(platform = ipcClient.platform()) {
  return platform === 'darwin'
}

export function normalizeMacOSAccessibilityStatus(value: unknown): MacOSAccessibilityStatus {
  if (!value || typeof value !== 'object') {
    return {
      success: false,
      trusted: false,
      reason: 'invalid_result',
    }
  }

  const payload = value as { success?: unknown; trusted?: unknown; reason?: unknown; detail?: unknown }
  return {
    success: Boolean(payload.success),
    trusted: Boolean(payload.trusted),
    reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
    ...(typeof payload.detail === 'string' ? { detail: payload.detail } : {}),
  }
}

export async function getMacOSAccessibilityStatus() {
  if (!isMacOSRuntime()) {
    return {
      success: false,
      trusted: false,
      reason: 'not_macos',
    }
  }

  try {
    return normalizeMacOSAccessibilityStatus(
      await ipcClient.invoke('permission:macos-accessibility-status'),
    )
  } catch (error) {
    return {
      success: false,
      trusted: false,
      reason: 'macos_accessibility_status_failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function openMacOSAccessibilitySettings() {
  if (!isMacOSRuntime()) {
    return { success: false, reason: 'not_macos' }
  }

  try {
    const result = await ipcClient.invoke<{ success?: unknown; reason?: unknown }>('permission:open-macos-accessibility-settings')
    return {
      success: Boolean(result?.success),
      reason: typeof result?.reason === 'string' ? result.reason : 'unknown',
    }
  } catch (error) {
    return {
      success: false,
      reason: 'macos_open_accessibility_settings_failed',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
