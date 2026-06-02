import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

async function loadModelSetupStore(seed: string) {
  return import(new URL(`./modelSetupStore.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

function installModelStatusResponse(status: unknown) {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async () => status as never,
    send: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
}

test('getVoiceModelStatus 会保留 ASR 运行设备字段', async () => {
  installModelStatusResponse({
    success: true,
    status: 'ready',
    detail: 'ASR 模型已完成预热',
    device: 'mps',
    requested_device: 'mps',
    device_source: 'explicit',
    fallback_reason: null,
    ready: true,
  })
  const store = await loadModelSetupStore('asr-device-status')

  const status = await store.getVoiceModelStatus()

  assert.equal(status.device, 'mps')
  assert.equal(status.requested_device, 'mps')
  assert.equal(status.device_source, 'explicit')
  assert.equal(status.fallback_reason, null)
})
