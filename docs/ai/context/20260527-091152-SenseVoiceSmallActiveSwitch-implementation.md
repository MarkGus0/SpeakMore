# SenseVoiceSmall Active Switch 实施记录

## 背景

用户要求将后端当前启用的 ASR 切换到 `SenseVoiceSmall`，并重启刚修改的后端内容。前一轮已经新增了 `paraformer-zh-streaming` 与 `sensevoice-small` 的隐藏后端切换能力，本次只改变实际启用模型，不新增前端入口。

## 改动

- `server/model_manager.py` 的 `ACTIVE_ASR_MODEL_ID` 从 `DEFAULT_MODEL_ID` 改为 `SENSEVOICE_SMALL_MODEL_ID`。
- `server/test_asr_runtime.py` 将 Paraformer 加载测试改成显式 patch Paraformer active；默认 active 加载测试改为验证 SenseVoiceSmall。

## 取舍

- 继续保留 `DEFAULT_MODEL_ID = PARAFORMER_STREAMING_MODEL_ID`，因为它表示项目原始默认值；实际运行使用 `ACTIVE_ASR_MODEL_ID`。
- SenseVoiceSmall 仍按累计音频伪流式策略运行，不修改前端 WebSocket 协议。

## 验证

- 计划运行 `python -m pytest server/test_runtime_config.py server/test_service_readiness.py server/test_asr_runtime.py server/test_asr_config.py server/test_voice_flow_contract.py server/test_ws_protocol_contract.py -q`。
- 验证通过后停止端口 `8000` 上的旧 Python 后端进程，并用 `npm run server` 重新启动。
