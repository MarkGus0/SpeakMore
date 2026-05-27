# 输入目标白名单扩展设计

## 背景

当前 `electron-app/focused-context/app-compat.js` 只允许微信、QQ、Discord 进入 `app_compat` 弱可信兜底。结果是一些常见桌面文本应用在 UIA 和 Win32 caret 都读不到时，会被误判为不可粘贴，最终退回悬浮卡片。

用户这次明确希望把常见文本工作台也放进白名单，至少包括：

- Codex
- Claude Code
- ChatGPT
- VS Code
- Cursor
- Slack
- Notion
- Spotify

## 目标

在不放宽 `UIA confirmed` 和 `Win32 caret confirmed` 的前提下，扩展 `app_compat` 第三层 allowlist，让上述常见应用在满足同窗口、类名和标题约束时可以继续走自动粘贴。

## 设计

- 继续保留按应用族显式匹配，不做“所有 Electron / Chromium 一刀切放开”。
- 新增的每个应用族都继续要求：
  - 进程名命中 allowlist。
  - 窗口类名命中 Chromium / Electron 常见类名。
  - 标题未命中登录、设置、安装、更新等明显非输入场景。
  - 如果传入了录音开始时的窗口句柄，仍要求前台句柄一致。
- 规则层面只扩 allowlist，不改 `readFocusedTextTarget()` 的优先级和返回语义。

## 验证

- 补 `app-compat` 单元测试，覆盖新应用族命中和明显非输入场景拒绝。
- 运行 `node --test electron-app/focused-context.test.mjs`
- 运行 `node --test electron-app/focused-context-modules.test.js`

