# Ask Anything 选区诊断实现记录

## 实现内容

- `electron-app/focused-context/readers.js`
  - 在 `readSelectionSnapshot()` 内记录焦点窗口、UIA 结果、剪贴板 fallback 结果和最终返回路径。
  - 日志只记录文本长度和最多 80 字符预览。
- `electron-app/focused-context-ipc.js`
  - 记录 `focused-context:get-selection-snapshot` IPC 调用和返回摘要。
- `electron-app/main-ipc-registry.js`
  - 将主进程 logger 传给 focused-context IPC。
- `electron-app/renderer/src/services/voice/voiceTaskResolver.ts`
  - 记录快捷键意图解析、自由提问选区快照和最终 `VoiceTask`。
- `electron-app/renderer/src/services/voice/recordingStartup.ts`
  - 记录 `Ask` 参数构造结果和 `start_audio` 参数 key，确认是否包含 `selected_text`。
- `server/refiner.py`
  - 记录 `ask_anything` 是否收到 `selected_text`。

## 诊断日志前缀

- `[focused-context][selection]`
- `[voice][task]`
- `[voice][startup]`
- `[Refiner][ask_anything]`

## 验证

- `node --test electron-app/focused-context.test.mjs electron-app/focused-context-modules.test.js electron-app/ipc-handlers.test.js electron-app/main-ipc-registry.test.js`：通过，35 个测试。
- `cd electron-app/renderer; npm test -- src/services/voice/voiceTaskResolver.test.ts src/services/recorder.behavior.test.ts`：通过，实际执行 150 个测试。
- `python -m pytest server/test_refiner_prompts.py server/test_voice_flow_contract.py -q`：通过，21 个测试。
- `npm run renderer:build`：通过。
- `node --check electron-app/focused-context/readers.js; node --check electron-app/focused-context-ipc.js; node --check electron-app/main-ipc-registry.js`：通过。

