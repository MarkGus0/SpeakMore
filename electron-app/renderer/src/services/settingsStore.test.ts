import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { LlmProvider } from './settingsStore'

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
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

async function loadSettingsStore(seed: string) {
  return import(new URL(`./settingsStore.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

function installSettingsResponse(settings: unknown) {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      if (channel === 'settings:get') return settings as never
      if (channel === 'settings:update') return settings as never
      return {} as never
    },
    send: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })
}

test('loadSettings 会补齐默认大模型 provider 配置', async () => {
  installSettingsResponse({})
  const settingsStore = await loadSettingsStore('defaults')

  const settings = await settingsStore.loadSettings()

  assert.equal(settings.llm.providerId, 'deepseek')
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'deepseek'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'openai'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'anthropic'), true)
  assert.equal(settings.llm.providers.some((provider: LlmProvider) => provider.id === 'custom'), true)
  assert.equal(settings.llm.models.deepseek, 'deepseek-chat')
})

test('getCurrentLlmConfig 返回当前 provider 可直接传给后端的配置', async () => {
  installSettingsResponse({
    llm: {
      providerId: 'openai',
      apiKeys: { openai: 'sk-openai' },
      models: { openai: 'gpt-5.4' },
    },
  })
  const settingsStore = await loadSettingsStore('current-config')

  const config = await settingsStore.getCurrentLlmConfig()

  assert.deepEqual(config, {
    provider_id: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-openai',
    model: 'gpt-5.4',
    auth_type: 'bearer',
  })
})

test('getCurrentLlmConfig 支持 Custom provider 的 Base URL 和空 API Key', async () => {
  installSettingsResponse({
    llm: {
      providerId: 'custom',
      providers: [
        {
          id: 'custom',
          label: 'Custom',
          baseUrl: 'http://127.0.0.1:11434/v1',
          defaultModel: 'qwen3',
          allowBaseUrlEdit: true,
          authType: 'bearer',
        },
      ],
      apiKeys: { custom: '' },
      models: { custom: 'qwen3' },
    },
  })
  const settingsStore = await loadSettingsStore('custom-config')

  const config = await settingsStore.getCurrentLlmConfig()

  assert.deepEqual(config, {
    provider_id: 'custom',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    model: 'qwen3',
    auth_type: 'bearer',
  })
})
