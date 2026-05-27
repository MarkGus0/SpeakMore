# BrowserSelectionUiaScan 设计

## 背景

Ask Anything 在 Chrome 中测试时没有拿到浏览器页面文字。日志显示：

- `focused-context:get-selection-snapshot` 已触发。
- 前台窗口为 `chrome.exe`，标题为 `新标签页 - Google Chrome`。
- UIA 选区读取失败，原因是 `text_pattern_unavailable`。
- 剪贴板 fallback 失败，原因是 `copy_timeout`。
- 后端收到 `selected_text` 为空：`has_text: False`。

因此问题发生在主进程选区快照阶段，不是后端 prompt、WebSocket 参数或 renderer 参数构造的问题。

## 必须解决的问题

- 浏览器页面选区不一定暴露在 `AutomationElement.FocusedElement` 上。
- 当前 UIA 脚本只读 `FocusedElement.TextPattern.GetSelection()`，对 Chrome / Chromium 页面内容覆盖不足。
- 剪贴板复制仍然可能受焦点、快捷键状态或浏览器策略影响，只能作为兜底，不应成为浏览器选区读取的唯一能力。

## 方案

扩展 `UIA_SELECTION_SCRIPT`：

1. 先保留当前 `FocusedElement` 读取，命中即返回，避免影响原有编辑器和原生控件。
2. 当 `FocusedElement` 没有可用 TextPattern 或没有选区时，读取前台窗口根元素。
3. 在前台窗口子树中查找支持 `TextPattern` 的元素，尝试 `GetSelection()`。
4. 任一元素返回非空选区时，仍标记为 `source: "uia"`、`confidence: "confirmed"`。
5. 找不到时返回更具体的失败原因，例如 `foreground_text_selection_unavailable`，便于继续排查。

## 取舍

- 不把浏览器特殊逻辑放到 renderer。选区来源属于主进程本地兼容能力。
- 不依赖 Chrome DevTools Protocol。普通用户浏览器不会默认开启远程调试端口。
- 不取消剪贴板 fallback。它对不暴露 UIA 选区的应用仍然有价值。
- 限制扫描数量，避免对复杂浏览器页面造成明显启动延迟。

## 验证

- 扩展 focused-context 单测，覆盖 `UIA_SELECTION_SCRIPT` 包含前台窗口扫描逻辑。
- 跑主进程相关测试和语法检查。
- 重启 Electron 后让用户再次用 `Right Alt + Space` 测试浏览器选区。
