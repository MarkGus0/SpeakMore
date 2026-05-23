# recorder 状态机拆分进展

## 背景

本轮按 `20260522-222550-electron-app-refactor-stage2-recorder-split-design.md` 和 `...-plan.md` 执行，目标是把 `electron-app/renderer/src/services/recorder.ts` 继续保留为对外 facade，但把会话状态、音频运行时和生命周期逻辑拆到独立内部模块。

## 本轮边界

- 新增 `voiceSessionStore.ts`
- 新增 `recordingTransportRuntime.ts`
- 新增 `voiceSessionLifecycle.ts`
- 修改 `recorder.ts`
- 补充 `voiceSessionLifecycle.test.ts`
- 保持现有对外 API、`voice-state` IPC 格式和语音语义不变

## 取舍

- 先抽纯状态，再抽音频资源，再抽生命周期，减少一次性改动面。
- `recorder.ts` 继续保留编排、快捷键兼容和对外导出，避免调用方改动。
- 取消、超时和迟到消息过滤仍然以 audioId 为边界，防止旧结果污染新会话。

## 验证

- 先跑 `recorder.behavior.test.ts`
- 再跑相关音频测试和新增生命周期测试
- 最后跑 `npm run renderer:build` 和 `npm run verify:voice`
