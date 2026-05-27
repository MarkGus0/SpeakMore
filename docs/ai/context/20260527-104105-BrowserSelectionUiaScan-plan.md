# BrowserSelectionUiaScan 计划

## 步骤

1. 阅读当前 UIA 选区读取和测试结构。
2. 修改 `electron-app/focused-context/scripts.js`，让 UIA 选区读取支持前台窗口 TextPattern 子树扫描。
3. 更新 focused-context 相关测试，确保脚本结构被覆盖。
4. 如有必要，更新 `AGENTS.md` 记录长期约束。
5. 运行相关 Node 测试和语法检查。
6. 重启 Electron，等待用户复测。

## 风险

- 前台窗口子树较大，扫描可能变慢；用数量上限控制。
- 某些浏览器未启用可访问文本树时，UIA 扫描仍可能失败；届时继续依赖剪贴板 fallback 日志定位。
