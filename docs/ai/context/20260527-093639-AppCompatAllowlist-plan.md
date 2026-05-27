# 输入目标白名单扩展计划

## 范围

- 修改 `electron-app/focused-context/app-compat.js`
- 修改 `electron-app/focused-context.test.mjs`
- 修改 `electron-app/focused-context-modules.test.js`
- 同步更新 `AGENTS.md`
- 追加一条实现记录到 `docs/ai/context/`

## 步骤

1. 把 Codex、Claude Code、ChatGPT、VS Code、Cursor、Slack、Notion、Spotify 补进 `APP_COMPAT_RULES`。
2. 复用现有 Chromium / Electron 常见类名约束和非输入场景标题拦截，不改上层调用链。
3. 给新增应用族补回归测试，确认命中时返回 `app_compat`，未命中时仍保持拒绝。
4. 更新 `AGENTS.md` 里的输入目标约束说明，记录当前白名单边界。
5. 跑相关测试，确认只影响第三层兜底，不影响 UIA / caret。

## 验证

- `node --test electron-app/focused-context.test.mjs`
- `node --test electron-app/focused-context-modules.test.js`
- `node --test electron-app/page-keyboard-ipc.test.js`

