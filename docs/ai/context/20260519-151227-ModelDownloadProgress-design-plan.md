# 模型下载进度显示

## 背景

模型页已经展示下载态进度条，并通过 `downloadProgress` 字段每秒刷新模型状态。但后端下载 `faster-whisper` 模型时直接调用 `huggingface_hub.snapshot_download`，没有把 Hugging Face 下载进度写回现有状态，所以 UI 只能看到 0% 或完成后的状态变化。

## 必须解决的问题

- 下载过程中后端要持续更新 `downloadProgress`。
- 前端模型卡片要让用户看到具体百分比，避免只有一条没有数字的进度条。
- 继续复用现有 `GET /models`、`isDownloading` 和 `downloadProgress` 数据流，不新增协议。

## 方案

采用 Hugging Face Hub 暴露的进度条工厂钩子，在 `snapshot_download` 调用期间临时替换为自定义进度条类。该类按每个下载任务累计本次文件下载增量，并调用现有 `update_download_progress(model_id, downloaded, total)`。

取舍：

- 不改前端轮询协议，改动范围小。
- 不把进度持久化到磁盘，下载状态仍是进程内短时状态。
- 如果 Hugging Face 某些阶段拿不到总大小，保持现有 0% 并等待后续可计算进度。

## 前端显示

模型正在下载时，在进度条上方显示 `下载中 X%`。进度条继续使用 determinate 模式，数值来源仍是后端 `downloadProgress`。

## 测试与验证

- 新增后端单元测试：模拟 Hugging Face 进度回调，验证 `download_model` 会把进度更新到状态中。
- 运行 `cd server; python -m pytest -q test_model_manager.py`。
- 运行 `npm run renderer:build`，因为修改了前端运行产物相关页面。
