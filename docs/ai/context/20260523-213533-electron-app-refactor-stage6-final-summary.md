# 阶段 6 最终验收总结

## 已完成阶段

- 阶段 1：`shared/llm-providers.json` 成为 LLM provider 元数据唯一来源。
- 阶段 2：`electron-app/renderer/src/services/recorder.ts` 收口为语音 facade，状态、运行时和生命周期拆分到独立模块。
- 阶段 3：`electron-app/main.js` 收口为主进程入口和组合根。
- 阶段 4：`electron-app/voice-backend-client.js` 拆出模型接口、配置重载和 voice flow 协议模块。
- 阶段 5：`AppShell`、`Settings`、`Models` 拆出页面级 hook 和展示层。
- 阶段 6：完成最终验收、结构确认、AGENTS 收口和文档收口。

## 最终文件结构

- `electron-app/main.js`：启动编排、生命周期和服务接线入口。
- `electron-app/main-ipc-registry.js`：按上下文注册 IPC。
- `electron-app/voice-backend-client.js`：主进程语音后端统一 HTTP facade。
- `electron-app/model-backend-client.js`、`voice-config-client.js`、`voice-flow-form-data.js`、`voice-backend-urls.js`：语音后端协议辅助模块。
- `electron-app/renderer/src/services/recorder.ts`：语音状态机唯一对外入口。
- `electron-app/renderer/src/services/voice/`：会话状态、运行时、生命周期、WebSocket、结果交付、音频采集和背景音频控制。
- `electron-app/renderer/src/components/AppShell.tsx`：全局壳层与持久化订阅。
- `electron-app/renderer/src/pages/Settings.tsx`、`Models.tsx`：页面展示层。
- `electron-app/renderer/src/pages/settings/useSettingsPageState.ts`、`models/useModelsPageState.ts`：页面状态和副作用。
- `shared/llm-providers.json`：唯一的 provider 元数据来源。

## 验证结果

- `node --check electron-app/main.js`：通过。
- `node --test electron-app/main-ipc-registry.test.js electron-app/window-manager.test.js electron-app/right-alt-listener-service.test.js electron-app/voice-backend-client.test.js electron-app/settings-store.test.js`：通过。
- `npm run verify:voice`：通过。
- `cd electron-app/renderer; npm test`：通过。
- `npm run renderer:build`：通过。

## 剩余风险

- 语音链路仍依赖本地后端、Windows UIA、音频会话和模型缓存，属于环境相关风险，不是代码回归。
- `verify:voice` 主要覆盖协议契约，不覆盖真实设备、外部模型下载和系统权限边界。

## 不建议继续的重构

- 不要把 `main-ipc-registry.js` 再折回 `main.js`。
- 不要把 provider 元数据重新内联到 main 或 renderer。
- 不要把 `recorder.ts` 再拆回多个页面状态。
- 不要把 `AppShell` 扩成页面业务容器。

## 补充

- 已同步更新项目根 `AGENTS.md`，只保留长期有效的架构事实。
