# BrowserSelectionUiaScan 实现记录

## 已完成

- 扩展 `electron-app/focused-context/scripts.js` 的 `UIA_SELECTION_SCRIPT`。
- 保留原有 `FocusedElement.TextPattern.GetSelection()` 优先路径。
- 新增前台窗口 UIA 子树扫描：优先 Document + TextPattern，再扫描通用 TextPattern 元素。
- 找到选区时仍返回 `source: "uia"`、`confidence: "confirmed"`，并附带 `selection_scope` 便于日志判断。
- 透传 `selection_scope`、`focused_reason`、`foreground_scanned` 到 Electron 诊断日志，避免新路径命中后无法从日志确认。
- 更新 focused-context 测试，覆盖前台窗口扫描脚本结构。
- 更新 `AGENTS.md`，记录 `get-selection-snapshot` 的新读取顺序。

## 验证

- `node --check electron-app/focused-context/scripts.js; node --check electron-app/focused-context/readers.js; node --check electron-app/focused-context-ipc.js` 通过。
- `node --test electron-app/focused-context.test.mjs electron-app/focused-context-modules.test.js` 通过，25 tests。
- 直接执行 `UIA_SELECTION_SCRIPT` 成功返回结构化 JSON，没有 PowerShell 语法错误。

## 复测关注点

用户再次在 Chrome 选中文字并触发 `Right Alt + Space` 后，看 Electron 日志：

- 如果出现 `selection_scope: 'foreground_descendant'` 且 `hasText: true`，说明浏览器 UIA 子树扫描生效。
- 如果仍是 `foreground_selection_empty`，说明 Chrome 当前页面没有通过 UIA 暴露选区，下一步需要继续增强剪贴板 fallback 或考虑浏览器可访问性开关。
- 如果是 `copy_timeout`，说明 Ctrl+C fallback 没有在等待窗口内写入剪贴板。
