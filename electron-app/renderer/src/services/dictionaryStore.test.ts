import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

type Listener = (event: unknown, payload: unknown) => void
type WindowWithIpc = typeof globalThis & {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: Listener) => void
    off: (channel: string, listener: Listener) => void
  }
}

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

async function loadDictionaryStore(seed: string) {
  return import(new URL(`./dictionaryStore.ts?case=${seed}-${Date.now()}`, import.meta.url).href)
}

test('subscribeDictionaryChanges 订阅主进程词典变更事件并返回取消订阅函数', async () => {
  const listeners = new Map<string, Listener>()
  const removed: string[] = []
  const windowLike = globalThis as WindowWithIpc
  windowLike.ipcRenderer = {
    invoke: async () => [] as never,
    send: () => undefined,
    on: (channel, listener) => {
      listeners.set(channel, listener)
    },
    off: (channel, listener) => {
      if (listeners.get(channel) === listener) {
        removed.push(channel)
        listeners.delete(channel)
      }
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowLike,
  })

  const dictionaryStore = await loadDictionaryStore('subscribe')
  const payloads: unknown[] = []
  const unsubscribe = dictionaryStore.subscribeDictionaryChanges((payload: unknown) => {
    payloads.push(payload)
  })

  listeners.get('dictionary:changed')?.({}, { reason: 'auto-learning-candidate' })
  unsubscribe()

  assert.deepEqual(payloads, [{ reason: 'auto-learning-candidate' }])
  assert.deepEqual(removed, ['dictionary:changed'])
})
