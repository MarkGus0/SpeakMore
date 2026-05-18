# 大模型 provider 设置 review

## 背景

本次 PR 将设置页原有单一 DeepSeek API Key 扩展为可配置大模型 provider。参考 Handy 的 API 设置逻辑后，当前项目保留 DeepSeek 兼容回退，并加入 OpenAI、Z.AI、OpenRouter、Anthropic、Groq、Cerebras 和 Custom。

## Review 结论

- 运行时链路满足热重载：录音 WebSocket 和文本请求都会在发起请求时重新读取 Electron 主进程 `settings.json`，并通过 `parameters.llm` 传给后端。
- 后端对 OpenAI 兼容 provider 走 `/chat/completions`，Anthropic 单独走 Messages API；非 Custom provider API Key 为空时回退到后端 DeepSeek 环境变量，保留旧兼容路径。
- Handy 在 macOS ARM 上还有 Apple Intelligence provider；SpeakMore 当前后端是本地 FastAPI + 网络 API Key 配置，没有 Apple 原生 Swift 桥接能力，因此本次没有纳入。

## 修正点

- 设置页保存新增顺序保护，避免连续输入 API Key、Base URL 或模型名时，较旧的异步保存响应覆盖较新的本地输入状态。
- 后端归一化请求配置时 trim API Key、Base URL 和模型名，降低复制 API Key 时携带首尾空白导致鉴权失败的风险。

## 验证结果

- `cd electron-app/renderer; npm test`：97 passed。
- `cd electron-app/renderer; npm run build`：通过。
- `node --check electron-app/main.js`：通过。
- `cd server; python -m pytest -q`：45 passed。
- GitHub PR CI `Test and build` 通过后再合并。
