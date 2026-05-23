# 阶段 5 页面层整理进展

## 背景

本轮依据 `20260522-222550-electron-app-refactor-stage5-page-layer-design.md` 和 `...-plan.md`，拆分 renderer 页面层中可独立维护的状态副作用与展示组件。

## 本轮范围

- `AppShell.tsx` 拆出全局快捷键桥接和语音历史持久化 hook
- `Models.tsx` 拆出页面状态 hook 和模型卡片组件
- `Settings.tsx` 拆出页面状态 hook 和分区组件
- 必要时同步更新结构测试，保证现有语义和用户可见字段不变

## 关注点

- `AppShell` 卸载时仍必须调用 `disposeShortcutGuard` 和 `disposeRecorder`
- 设置页 LLM 编辑态与普通自动保存不能互相覆盖
- 模型页轮询不能因为 hook 重组而重复启动
- 页面标题、导航和用户可见字段保持不变

## 验证

- `cd electron-app/renderer; npm test`
- `npm run renderer:build`

## 当前分支

- `feature/stage5-page-layer-page-hooks`
