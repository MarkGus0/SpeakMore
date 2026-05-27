# Ask Anything 选区诊断设计

## 背景

用户在 Codex 中选中文字后使用 `Right Alt + Space` 自由提问，悬浮结果提示“请提供需要翻译成英文的单词”。这说明后端最终回答像是没有拿到选区上下文，或者选区上下文没有进入 `ask_anything` 的 user message。

当前链路为：

1. renderer `AskShortcut` 调用 `focused-context:get-selection-snapshot`。
2. 主进程优先读取 UIA confirmed 选区；失败后用剪贴板 fallback。
3. renderer 将有效选区写入 `start_audio.parameters.selected_text`。
4. 后端 `refiner.py` 在 `ask_anything` 且有 `selected_text` 时拼入 user message。

## 目标

只增加诊断日志，不改变选区判断、复制 fallback、自由提问投递方式或后端 prompt。

下一次用户测试时需要能确认：

- `focused-context:get-selection-snapshot` 是否被调用。
- UIA 选区结果是什么来源、置信度、失败原因和文本长度。
- 剪贴板 fallback 是否执行，结果是什么来源、失败原因和文本长度。
- renderer 解析后的 `VoiceTask` 是否带 `selectedText`。
- `start_audio.parameters` 是否包含 `selected_text`。
- 后端 `ask_anything` 是否收到 `selected_text`。

## 日志边界

- 日志允许输出短预览，最多 80 个字符。
- 不输出完整选区文本，避免长文本或敏感内容刷进日志。
- 日志前缀统一用：
  - `[focused-context][selection]`
  - `[voice][task]`
  - `[voice][startup]`
  - `[Refiner][ask_anything]`

