# macOS 路线图

本文档记录 SpeakMore macOS 版本的分阶段边界，方便后续任务接力。Windows 版本仍保持当前最终稳定形态；macOS 版本在同一个仓库中通过平台适配层逐步补齐。

当前 macOS 最低支持固定为 `macOS 15+ arm64`。

## 第一版：开发态 MVP

目标：

- 只支持开发态运行，不做打包、签名、公证、DMG 或自动更新。
- 最低支持 `macOS 15+ arm64`。
- macOS 下主窗口、初始化页、语音后端、录音链路、悬浮胶囊和悬浮面板可跑通。
- 快捷键固定为 `Option` 听写、`Option + Space` 自由提问、`Option + Shift` 翻译、`Escape` 取消或关闭悬浮面板。
- 不启动 Windows PowerShell、UIA helper、Win32 caret、Windows 音频会话控制或 `.exe` 后端路径。
- 听写、自由提问和翻译结果统一展示到悬浮面板，不自动粘贴。
- 自由提问不读取选区，`selected_text` 为空。
- ASR 优先 CPU 跑通，模型默认缓存到 macOS 用户本地目录或用户设置的模型目录。

非目标：

- 不做自动粘贴。
- 不做选区上下文。
- 不做自动学习。
- 不做后台应用音频静音。
- 不做 Apple Silicon MPS 加速。

## 第二版：权限与平台能力基座

目标：

- 增加 macOS Accessibility 权限检查和引导。
- 增加前台应用、focused element 可输入性、剪贴板快照恢复和受控 `Cmd+V` 事件注入的诊断能力。
- 设置页展示辅助功能权限状态，并提供打开系统设置入口。
- 诊断能力集中在 macOS 平台适配层，不接入真实听写交付。

约束：

- 不自动粘贴。
- 不读取选区。
- 不做自动学习。
- 不把“前台窗口存在”当成可粘贴条件。
- macOS 输入目标确认独立于 Windows UIA/Win32 实现，但输出结构要和现有 renderer 交付链路兼容。

## 第三版：自动粘贴

目标：

- 使用第二版平台能力发送 `Cmd+V`。
- 自动粘贴前实现 macOS 输入目标确认。
- 自动粘贴失败时继续展示悬浮面板。
- 自动粘贴后恢复用户剪贴板。
- 普通听写和语音翻译接入自动粘贴，自由提问继续固定悬浮面板。
- 当前阶段已进入实现：普通听写和语音翻译可在可信输入目标中自动粘贴，失败时回到悬浮面板。

约束：

- 不读取选区上下文。
- 不把“前台窗口存在”当成可粘贴条件。

## 第四版：选区上下文

目标：

- 使用 macOS Accessibility API 读取 focused element 的 selected text。
- `Option + Space` 自由提问优先携带可信选区上下文。
- Accessibility 读取失败时先按无选区处理；剪贴板 fallback 后续如启用，必须限制触发模式并恢复原剪贴板。
- 普通听写和语音翻译启动前不读取选区。
- 当前阶段已进入实现：`Option + Space` 可携带 AX confirmed 选区上下文，结果仍展示悬浮面板。

约束：

- 选区能力只服务自由提问。
- 不因为存在选区改变 `Option` 和 `Option + Shift` 的模式语义。

## 第五版：自动学习

目标：

- 使用 macOS Accessibility 或 AXObserver 观察本轮 SpeakMore 粘贴后的 focused text element。
- 只围绕本轮粘贴结果短时观察用户修正。
- 自动学习仍只接受短词或短语级纠错。
- 目标应用不暴露可读文本时自然降级。
- 当前阶段已进入实现：自动粘贴成功后复用现有自动学习会话管理器，通过 macOS AX focused text 轮询生成候选。

约束：

- 不做无差别全局文本采集。
- 不复用 Windows `.NET` helper。
- 不展示自动学习过程或目标不可读原因。

## 第六版：Apple Silicon 优化

目标：

- 验证 FunASR/SenseVoiceSmall 在 Apple Silicon 上使用 MPS 的稳定性。
- 如兼容，增加 `FUNASR_DEVICE=mps` 或自动探测策略。
- 保留 CPU fallback。

约束：

- MPS 是性能优化，不作为可用性前置条件。
- 不为了 MPS 破坏已跑通的 CPU 默认链路。

## 最终版：发布链路

目标：

- 增加 macOS electron-builder 配置。
- 增加 macOS 后端构建脚本。
- 增加 macOS ffmpeg 资源处理。
- 增加 `Info.plist` 麦克风和辅助功能相关说明。
- 完成签名、公证和可下载 artifact。
- GitHub Release 同时发布 Windows 和 macOS 产物。

约束：

- Windows 便携包继续保持当前最终版形态。
- macOS 发布链路只在开发态 MVP 稳定后推进。
