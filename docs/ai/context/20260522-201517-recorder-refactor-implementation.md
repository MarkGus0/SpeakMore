# recorder.ts 分阶段重构实现记录

## 背景

本轮按以下文档继续实现：

- `docs/ai/context/20260522-193531-recorder-refactor-phases-design.md`
- `docs/ai/context/20260522-193820-recorder-refactor-phases-plan.md`

基线状态：`electron-app/renderer` 下 `npm test` 和 `npm run build` 均已通过。

## 当前判断

`recorder.ts` 已经完成低风险工具、后台静音、音频采集和音量监控的部分拆分，但启动准备、WebSocket 消息处理和最终结果交付仍保留在 `recorder.ts` 内。

剩余必须解决的问题：

- 把启动准备参数读取、ready 检查、传输格式判断移入 `recordingStartup.ts`。
- 把 WebSocket 生命周期、后端消息分类、迟到消息过滤移入 `voiceSocket.ts`。
- 把自动粘贴失败兜底和自由提问悬浮面板展示移入 `voiceResultDelivery.ts`。
- `recorder.ts` 继续只负责对外 API、会话状态、资源组合清理和完成/失败状态落地。

## 取舍

- `voiceSocket.ts` 使用 factory 创建管理器，不使用模块级 WebSocket 单例，避免测试动态导入 `recorder.ts` 时复用旧 handler。
- `recordingStartup.ts` 通过参数接收 WebSocket 控制接口，避免启动模块反向持有全局 socket 状态。
- 行为验证继续依赖现有 `recorder.behavior.test.ts`，因为本轮是内部边界重构，不改变 UI 调用 API 和外部协议。

## 验证方式

实现后运行：

```powershell
cd electron-app/renderer
npm test
npm run build
```
