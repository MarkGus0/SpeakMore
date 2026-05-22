# recorder.ts 第一阶段重构验证记录

## 本轮改动

- 保留 `recorder.ts` 对外 API 和语音状态机职责。
- 新增低耦合模块：
  - `voiceSessionUtils.ts`：录音时长、文本长度、语音错误归一化。
  - `backgroundAudio.ts`：后台音频静音和恢复状态。
  - `audioCapture.ts`：麦克风获取、PCM16 编码/降采样、PCM 发送器、MediaStream track 清理。
  - `audioLevelMonitor.ts`：输入音量监控，通过回调交给 `recorder.ts` 更新 `inputLevel`。
- 更新结构测试，使其检查 `recorder.ts` facade 与拆分后的生产模块共同组成录音链路实现面。
- 更新 `AGENTS.md`，记录新的 renderer 录音模块边界。

## 保持不变的行为

- `recorder.ts` 仍导出 `getVoiceSession()`、`subscribeVoiceSession()`、`toggleRecording()`、`toggleRecordingByShortcut()`、`startRecording()`、`stopRecording()`、`cancelRecording()`、`disposeRecorder()`。
- 取消录音不发送 `end_audio`，迟到消息仍按 `audioId` 过滤。
- 每轮新录音开始前仍会重置后台音频恢复标记，避免上一轮取消后的迟到静音结果污染下一轮。
- 普通听写和语音翻译仍优先自动粘贴，失败展示悬浮面板。
- 自由提问仍只展示悬浮面板，不自动粘贴。
- `paraformer-zh-streaming` 仍发送 `pcm_s16le`、`16kHz`、单声道二进制 chunk。

## 验证命令

- `node --import tsx --test src/services/voiceSessionUtils.test.ts`
  - 结果：5 个测试通过。
- `node --import tsx --test src/services/backgroundAudio.test.ts`
  - 结果：4 个测试通过。
- `node --import tsx --test src/services/audioCapture.test.ts`
  - 结果：4 个测试通过。
- `node --import tsx --test src/services/audioLevelMonitor.test.ts`
  - 结果：2 个测试通过。
- `node --import tsx --test src/services/recorder.behavior.test.ts`
  - 结果：28 个测试通过。
- `npm test`
  - 结果：142 个测试通过，0 个失败。
- `npm run renderer:build`
  - 结果：TypeScript 编译和 Vite 生产构建通过。

## 已知后续拆分点

- `recordingStartup.ts`、`voiceSocket.ts` 和 `voiceResultDelivery.ts` 暂未拆分。
- 下一阶段应继续保持 `recorder.ts` facade 不变，先抽启动编排，再抽 WebSocket，避免同时修改完成、错误和取消路径。
