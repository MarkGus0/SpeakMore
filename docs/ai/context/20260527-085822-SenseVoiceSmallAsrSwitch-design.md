# SenseVoiceSmall ASR 切换设计

## 背景

当前后端只加载 `paraformer-zh-streaming`，前端通过现有 WebSocket 语音流发送 16kHz 单声道 PCM16 chunk，并消费后端持续返回的 `transcription` 消息。用户希望新增 `SenseVoice-Small`，前端不展示切换入口，后端通过直接修改代码切换两个模型。

官方资料确认：

- FunASR README 明确把 `paraformer-zh-streaming` 标为 Streaming ASR，并给出 `cache`、`chunk_size` 的实时示例。
- FunASR 与 SenseVoice 文档把 `SenseVoiceSmall` 标为 ASR + emotion + events，常规示例是 `AutoModel.generate(input=..., cache={}, language=..., use_itn=...)`。
- SenseVoice 源码内部存在 chunk 相关实现，但官方主路径没有把 `SenseVoiceSmall` 标成与 `paraformer-zh-streaming` 同级的在线 streaming 模型。

因此本次实现不把 SenseVoiceSmall 宣称为原生在线 ASR。后端会复用 WebSocket 流式输出协议，对 SenseVoiceSmall 采用累计音频伪流式：按 chunk 节奏对已累计音频重新生成累计文本，最终 `end_audio` 再生成一次最终文本。这样前端协议不变，也不会在模型不支持同构在线参数时静默错误。

参考来源：

- https://github.com/modelscope/FunASR
- https://github.com/FunAudioLLM/SenseVoice
- https://huggingface.co/FunAudioLLM/SenseVoiceSmall

## 目标

- 后端支持两个 ASR model id：`paraformer-zh-streaming` 和 `sensevoice-small`。
- 默认仍使用 `paraformer-zh-streaming`。
- 切换只改后端代码中的单个常量，不增加前端设置、IPC 或 UI。
- WebSocket 协议保持不变，前端继续发送 PCM16 chunk 并接收 `transcription`。
- `/ai/voice_flow` 兼容入口继续先转 PCM16，再走同一套 ASR session。

## 设计

### 模型元数据

`server/model_manager.py` 维护两套模型元数据：

- `PARAFORMER_STREAMING_MODEL_ID = "paraformer-zh-streaming"`
- `SENSEVOICE_SMALL_MODEL_ID = "sensevoice-small"`
- `ACTIVE_ASR_MODEL_ID = DEFAULT_MODEL_ID`

切换模型时只修改 `ACTIVE_ASR_MODEL_ID`。缓存根仍使用 `%LOCALAPPDATA%\Typeless\models\funasr`，但 Hugging Face repo id、必需文件、显式目录环境变量按模型区分。

### ASR runtime

`server/asr.py` 将当前 `ParaformerStreamingRuntime` 泛化为 streaming ASR runtime：

- Paraformer profile：原生 chunk streaming，继续传 `cache`、`is_final`、`chunk_size`、look back 参数。
- SenseVoiceSmall profile：使用 `FunAudioLLM/SenseVoiceSmall`，传 `cache`、`language="auto"`、`use_itn=True`、`ban_emo_unk=False`，并启用累计音频模式。
- SenseVoiceSmall 输出通过 `rich_transcription_postprocess` 清理富文本 token；如果当前 FunASR 包没有该 helper，则使用本地轻量 token 清理兜底。

### 错误边界

- `ACTIVE_ASR_MODEL_ID` 不在支持列表中时，后端启动阶段直接报错。
- 显式模型目录不完整时，抛出带对应环境变量名的错误。
- 如果 SenseVoiceSmall 当前安装的 FunASR 版本无法按所需参数加载或生成，错误会走现有 `transcription_error`，不回退到 Paraformer。

## 验证

- `python -m pytest server/test_asr_config.py server/test_asr_runtime.py -q`
- `python -m pytest server/test_runtime_config.py server/test_service_readiness.py server/test_asr_runtime.py server/test_asr_config.py server/test_voice_flow_contract.py server/test_ws_protocol_contract.py -q`
- 如修改主进程或前端，才运行 Electron/renderer 验证；本次预期不触碰前端运行产物。
