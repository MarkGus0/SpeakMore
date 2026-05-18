import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window

type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => void
    off: (channel: string, listener: (...args: unknown[]) => void) => void
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

async function loadTextFlow(seed: string) {
  return import(new URL(`./textFlow.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

function installSettingsIpc() {
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async (channel: string) => {
      if (channel === 'settings:get') {
        return {
          llm: {
            providerId: 'openai',
            apiKeys: { openai: 'sk-openai' },
            models: { openai: 'gpt-5.4' },
          },
        } as never
      }
      return {} as never
    },
    send: () => undefined,
    on: () => undefined,
    off: () => undefined,
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowLike })
}

test('requestTextFlow 返回后端 refine_text', async () => {
  installSettingsIpc()
  const { requestTextFlow } = await loadTextFlow('success')
  const requests: Array<{ url: string; init?: RequestInit }> = []
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        json: async () => ({ status: 'OK', data: { refine_text: 'translated text' } }),
      } as Response
    },
  })

  const result = await requestTextFlow({
    mode: 'translation',
    text: '你好',
    parameters: { output_language: 'en' },
  })

  assert.equal(result, 'translated text')
  assert.match(requests[0].url, /\/ai\/text_flow$/)
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    mode: 'translation',
    text: '你好',
    parameters: {
      output_language: 'en',
      llm: {
        provider_id: 'openai',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-openai',
        model: 'gpt-5.4',
        auth_type: 'bearer',
      },
    },
  })
})

test('requestTextFlow 在后端错误时抛出 detail', async () => {
  installSettingsIpc()
  const { requestTextFlow } = await loadTextFlow('http-error')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: '语音后端尚未就绪' }),
    }) as Response,
  })

  await assert.rejects(
    () => requestTextFlow({ mode: 'translation', text: '你好', parameters: { output_language: 'en' } }),
    /语音后端尚未就绪/,
  )
})

test('requestTextFlow 在业务状态 ERROR 时抛出 detail', async () => {
  installSettingsIpc()
  const { requestTextFlow } = await loadTextFlow('business-error')
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ERROR', data: { refine_text: '错误: boom', detail: 'boom' } }),
    }) as Response,
  })

  await assert.rejects(
    () => requestTextFlow({ mode: 'translation', text: '你好', parameters: { output_language: 'en' } }),
    /boom/,
  )
})
