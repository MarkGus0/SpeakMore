# Ask Anything 选区诊断计划

## 修改范围

- `electron-app/focused-context/readers.js`
- `electron-app/focused-context-ipc.js`
- `electron-app/main-ipc-registry.js`
- `electron-app/renderer/src/services/voice/voiceTaskResolver.ts`
- `electron-app/renderer/src/services/voice/recordingStartup.ts`
- `server/refiner.py`
- 相关测试

## 步骤

1. 新增文本摘要 helper，只记录 `hasText`、`length`、`preview`。
2. 在主进程 `readSelectionSnapshot()` 内记录 UIA 结果、clipboard fallback 结果和最终返回。
3. 在 IPC handler 外层记录 `focused-context:get-selection-snapshot` 调用和返回摘要。
4. 在 renderer `resolveVoiceTask()` 记录快捷键意图、快照摘要和最终任务摘要。
5. 在 `getStartAudioParameters()` 记录 `Ask` 模式是否带 `selected_text`。
6. 在后端 `build_refiner_user_message()` 记录 `ask_anything` 是否收到 `selected_text`。
7. 跑相关 Node 测试和 renderer 测试。
8. 重启 Electron，让用户复测。

## 验证命令

- `node --test electron-app/focused-context.test.mjs electron-app/focused-context-modules.test.js electron-app/ipc-handlers.test.js`
- `cd electron-app/renderer; npm test -- src/services/voice/voiceTaskResolver.test.ts src/services/recorder.behavior.test.ts`
- `python -m pytest server/test_refiner_prompts.py server/test_voice_flow_contract.py -q`

