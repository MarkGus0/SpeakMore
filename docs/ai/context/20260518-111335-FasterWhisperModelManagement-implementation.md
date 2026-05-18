# Faster Whisper 模型管理页实现记录

## 改动范围

- 后端新增模型管理模块和 `/models` 接口，统一负责模型清单、下载、取消、删除和选择。
- ASR 支持按当前选择加载 `faster-whisper` 模型，并在切换失败时保留旧单例。
- Electron 新增 `model:*` IPC，只转发到后端 `/models`。
- Renderer 新增模型服务、侧边栏“模型”入口和模型管理页。

## 关键取舍

- 模型事实来源保留在 FastAPI 后端，避免 Electron 与后端各自维护下载和选择状态。
- 第一版只支持 `tiny`、`base`、`small`、`medium`、`large-v3`，不恢复 Handy 的多引擎模型兼容。
- 下载非当前模型只更新模型状态，不影响 `/ready` 和当前语音链路。
- `WHISPER_MODEL_DIR` 设置后作为显式覆盖，前端禁用切换和删除，避免误导用户。

## 验证

- `cd server; python -m pytest -q`
- `node --check electron-app/main.js`
- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
