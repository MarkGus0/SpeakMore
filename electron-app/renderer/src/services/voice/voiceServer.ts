/**
 * 本地语音后端地址
 *
 * 需要调整 renderer 连接 FastAPI WebSocket 入口时看这里。
 */
export const VOICE_SERVER_HTTP_BASE_URL = 'http://127.0.0.1:8000'

const REVERSE_COMPAT_WS_VERSION = 'win_local'
const REVERSE_COMPAT_WS_TOKEN = 'local-dev-token'
const REVERSE_COMPAT_WS_MODE = '0'

function toVoiceServerWebSocketUrl() {
  const url = new URL('/ws/rt_voice_flow', VOICE_SERVER_HTTP_BASE_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('v', REVERSE_COMPAT_WS_VERSION)
  url.searchParams.set('t', REVERSE_COMPAT_WS_TOKEN)
  url.searchParams.set('m', REVERSE_COMPAT_WS_MODE)
  return url.toString()
}

export const VOICE_SERVER_WS_URL = toVoiceServerWebSocketUrl()
