# recorder.ts 第一阶段重构实施计划

## 目标

参考 `20260522-191915-recorder-refactor-boundary.md`，先拆低耦合模块，保持 `recorder.ts` 对外 API、`VoiceSession` 结构、WebSocket 协议、取消语义和三种模式交付行为不变。

## 当前约束

- 当前工作区是普通 checkout，分支为 `main`；用户已明确要求开始修改代码，本轮在当前工作区小步实施。
- 本轮不拆 `recordingStartup.ts`、`voiceSocket.ts`、`voiceResultDelivery.ts`，因为它们牵涉启动并行、迟到消息过滤、最终结果和错误路径。
- 每个生产模块先补最小测试，让新增导入在模块不存在时失败，再实现模块。

## 文件边界

- 新增 `electron-app/renderer/src/services/voiceSessionUtils.ts`
  - 负责 `getRecordingDurationMs()`、`countTextLength()`、`normalizeVoiceError()`。
- 新增 `electron-app/renderer/src/services/backgroundAudio.ts`
  - 负责后台音频静音和恢复，内部保存“本轮是否需要恢复”的状态。
- 新增 `electron-app/renderer/src/services/audioCapture.ts`
  - 负责麦克风获取、PCM16 编码、降采样、PCM 发送器、MediaStream 轨道释放。
- 新增 `electron-app/renderer/src/services/audioLevelMonitor.ts`
  - 负责悬浮胶囊输入音量监控，通过回调交给 `recorder.ts` 更新状态。
- 修改 `electron-app/renderer/src/services/recorder.ts`
  - 继续作为 facade 和状态机组合根，只删除已抽出的实现细节。
- 新增对应单元测试：
  - `voiceSessionUtils.test.ts`
  - `backgroundAudio.test.ts`
  - `audioCapture.test.ts`
  - `audioLevelMonitor.test.ts`

## 执行步骤

### 1. 纯工具模块

- 先新增 `voiceSessionUtils.test.ts`，验证：
  - 开始时间为 `0` 时 duration 为 `0`。
  - 开始时间早于当前时间时 duration 不小于 `0`。
  - 文本长度按 `trim()` 后长度统计。
  - 已是 `VoiceError` 的对象原样返回，普通异常按 fallback code 包装。
- 运行：`cd electron-app/renderer; npm test -- src/services/voiceSessionUtils.test.ts`
- 预期：因模块不存在失败。
- 新增 `voiceSessionUtils.ts` 并让测试通过。
- 修改 `recorder.ts` 只导入并使用这些函数。

### 2. 后台音频模块

- 先新增 `backgroundAudio.test.ts`，验证：
  - 静音成功后恢复只调用一次 `audio:restore-background-sessions`。
  - 静音失败或抛错时不会恢复。
- 运行：`cd electron-app/renderer; npm test -- src/services/backgroundAudio.test.ts`
- 预期：因模块不存在失败。
- 新增 `backgroundAudio.ts`，迁移 `backgroundAudioRestorePending`、`muteBackgroundAudio()`、`restoreBackgroundAudio()`。
- 修改 `recorder.ts` 删除对应状态和函数。

### 3. 音频采集模块

- 先新增 `audioCapture.test.ts`，验证：
  - `encodePcm16()` 会裁剪到 PCM16 范围。
  - `downsampleToSampleRate()` 会从高采样率降到目标采样率，低采样率输入原样返回。
  - `sendPcm16Chunk()` 只在 WebSocket OPEN 时发送 ArrayBuffer。
- 运行：`cd electron-app/renderer; npm test -- src/services/audioCapture.test.ts`
- 预期：因模块不存在失败。
- 新增 `audioCapture.ts`，迁移 `getAudioStream()`、`createPcm16AudioSender()`、`sendPcm16Chunk()`、`downsampleToSampleRate()`、`encodePcm16()`、`stopStreamTracks()`。
- 修改 `recorder.ts` 保留 `mediaRecorder`、`pcmAudioSender`、`activeStream` 的会话持有逻辑，但实现调用新模块。

### 4. 音量监控模块

- 先新增 `audioLevelMonitor.test.ts`，验证：
  - 启动后 tick 会通过回调输出归一化音量。
  - cleanup 会清理 interval 和关闭 `AudioContext`。
- 运行：`cd electron-app/renderer; npm test -- src/services/audioLevelMonitor.test.ts`
- 预期：因模块不存在失败。
- 新增 `audioLevelMonitor.ts`，迁移音量监控内部状态。
- 修改 `recorder.ts` 在清理音量监控后显式把 `session.inputLevel` 归零。

### 5. 行为回归与构建

- 运行：`cd electron-app/renderer; npm test -- src/services/recorder.behavior.test.ts`
- 运行：`cd electron-app/renderer; npm test`
- 运行：`npm run renderer:build`

## 取舍

- 不为了“文件变小”拆状态机；`session`、订阅广播、当前会话 ID 和 active task 继续留在 `recorder.ts`。
- 不把 WebSocket 和交付路径一起拆，避免取消、迟到消息、粘贴兜底同时变化。
- 新模块如果需要状态，只保存该职责内部的最小状态，不反向依赖 React 页面或 recorder 会话对象。
