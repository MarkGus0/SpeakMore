/**
 * renderer IPC 最小封装
 *
 * 需要从前端调用主进程能力或订阅主进程事件时看这里。
 */
type IpcListener = (event: unknown, payload: unknown) => void

// 这里把 preload 注入到 window 上的 ipcRenderer 能力显式收口成一个最小接口，避免 renderer 直接依赖 Electron 类型。
type ElectronIpcRenderer = {
  invoke: <T = unknown>(channel: string, ...payload: unknown[]) => Promise<T>
  send: (channel: string, payload?: unknown) => void
  on: (channel: string, listener: IpcListener) => void
  off?: (channel: string, listener: IpcListener) => void
  removeListener?: (channel: string, listener: IpcListener) => void
}

// renderer 只能通过 preload 暴露的 window.ipcRenderer 访问主进程，直接引用 Electron API 会破坏隔离边界。
function getIpcRenderer(): ElectronIpcRenderer | null {
  return window.ipcRenderer ?? null
}

export const ipcClient = {
  // 供调用方先判断当前环境是否已经注入了 IPC 能力，避免在非 Electron 场景下直接报错。
  isAvailable() {
    return Boolean(getIpcRenderer())
  },

  // 需要返回 Promise 的请求走 invoke，适合一问一答型 IPC，例如读取设置、查询状态、获取上下文。
  invoke<T = unknown>(channel: string, ...payload: unknown[]): Promise<T> {
    const ipc = getIpcRenderer()
    if (!ipc) {
      // 没有 preload 注入时直接拒绝，让上层明确知道 IPC 不可用，而不是卡在未定义访问上。
      return Promise.reject(new Error(`IPC 不可用: ${channel}`))
    }
    return ipc.invoke<T>(channel, ...payload)
  },

  // 不需要返回结果的通知型消息走 send，例如触发一次主进程动作或广播状态变化。
  send(channel: string, payload?: unknown) {
    const ipc = getIpcRenderer()
    if (!ipc) return
    ipc.send(channel, payload)
  },

  // 订阅主进程事件，返回一个取消订阅函数，调用方不需要自己记住 off/removeListener 的兼容差异。
  on(channel: string, listener: IpcListener) {
    const ipc = getIpcRenderer()
    if (!ipc) return () => {}
    ipc.on(channel, listener)
    return () => {
      // 兼容不同注入实现：优先用 off，没有的话退回到 removeListener。
      if (ipc.off) ipc.off(channel, listener)
      else ipc.removeListener?.(channel, listener)
    }
  },
}
