# 输入目标白名单扩展实现记录

## 实现内容

- `electron-app/focused-context/app-compat.js`
  - 把 Codex、Claude Code、ChatGPT、VS Code、Cursor、Slack、Notion、Spotify 补进 `APP_COMPAT_RULES`。
  - 继续保留显式应用族匹配，不改 UIA / Win32 caret 的优先级。
  - 继续沿用标题黑名单，避免登录、设置、更新、安装等明显非输入场景进入自动粘贴。
- `electron-app/focused-context.test.mjs`
  - 增加新应用族命中回归测试。
  - 增加非输入标题拒绝回归测试。
- `electron-app/focused-context-modules.test.js`
  - 增加 `app_compat` 模块级回归测试。
- `AGENTS.md`
  - 同步记录当前 `app_compat` allowlist 的真实边界。

## 行为变化

- UIA 和 Win32 caret 都失败时，常见桌面文本应用更容易进入第三层弱可信粘贴，而不再直接退回悬浮卡片。
- 这次仍然不是“所有 Electron / Chromium 一刀切放开”，只有显式列出的应用族才会命中。

## 验证

- 待执行 `node --test electron-app/focused-context.test.mjs`
- 待执行 `node --test electron-app/focused-context-modules.test.js`
- 待执行 `node --test electron-app/page-keyboard-ipc.test.js`

