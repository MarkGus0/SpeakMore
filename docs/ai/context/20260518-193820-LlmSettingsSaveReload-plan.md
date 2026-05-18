# 大模型设置保存与后端重载计划

## 背景

设置页大模型区域当前是输入即保存，用户输入 API Key 后没有明确保存按钮，也没有显式后端重载动作。用户希望增加“修改”和“保存”按钮，并把保存按钮绑定后端重载逻辑。

## 必须解决的问题

- 大模型 provider、API Key、模型名和 Custom Base URL 需要先进入编辑态，避免输入过程中立即写入本地设置。
- 保存时一次性写入 Electron 主进程 `settings.json`，随后触发后端配置重载。
- 后端重载不应重启 ASR 模型或打断语音服务；大模型请求仍按现有 `parameters.llm` 热传递方式生效。

## 方案

- `Settings.tsx` 增加 `llmDraft`、`isLlmEditing`、`isSavingLlm` 和保存结果提示。
- 大模型区默认只展示当前配置，字段禁用；点击“修改”后字段可编辑，并显示“保存”和“取消”。
- “保存”调用 `saveSettings` 写入草稿配置，再通过新增 renderer service 调 `settings:reload-llm-backend` IPC。
- Electron 主进程新增 `settings:reload-llm-backend`，转发到后端 `POST /config/reload`，并返回成功/失败结果。
- 后端新增 `POST /config/reload`，调用 `reload_server_env()`，并让 refiner 清理旧 DeepSeek fallback client。

## 测试

- 前端结构测试覆盖“修改/保存/取消”和 reload IPC。
- 后端测试覆盖 `/config/reload` 会调用 refiner 重载逻辑。
- 运行 renderer 测试、renderer 构建、主进程语法检查、server pytest。

## 验证结果

- `cd electron-app/renderer; npm test`：109 passed。
- `npm run renderer:build`：通过。
- `node --check electron-app/main.js`：通过。
- `cd server; python -m pytest -q`：88 passed。
- 本地重启后端后，`POST http://127.0.0.1:8000/config/reload` 返回 `{"status":"ok","detail":"大模型配置已重载"}`。
- 本地重启后端后，`GET http://127.0.0.1:8000/ready` 返回 `{"status":"ready","detail":"ASR 模型已完成预热"}`。
