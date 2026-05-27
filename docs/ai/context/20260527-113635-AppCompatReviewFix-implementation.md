# AppCompatReviewFix 实现记录

## 背景

合并前 review 发现两个低成本风险：

- 通用 Chromium 应用 blocked title 包含 `Extension/Extensions`，可能误伤 VS Code、Cursor、Notion 等正常编辑窗口标题。
- Claude Code 的进程名可能使用 `claude-code`，原 allowlist 只覆盖 `claude code` 和 `claude`。

## 调整

- 从通用 blocked title 中移除 `Extension/Extensions`，保留登录、设置、更新、安装等明显非输入场景。
- 将 `claude-code` 加入 Claude Code 应用族的进程名匹配。
- 补充 focused-context 测试，覆盖 `Extension.ts` 正常放行和 `claude-code` 匹配。

## 验证

- 运行 focused-context 相关测试。
