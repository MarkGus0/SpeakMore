# SenseVoiceSmall ASR Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端新增 `sensevoice-small` ASR profile，并允许通过修改后端常量在 `paraformer-zh-streaming` 与 `sensevoice-small` 之间切换。

**Architecture:** 模型元数据集中在 `server/model_manager.py`，ASR 加载与 session 逻辑集中在 `server/asr.py`。前端协议不变，SenseVoiceSmall 使用累计音频伪流式输出。

**Tech Stack:** Python、FastAPI、FunASR AutoModel、pytest/unittest、Electron WebSocket 语音流协议。

---

### Task 1: 模型元数据

**Files:**
- Modify: `server/model_manager.py`
- Test: `server/test_asr_config.py`

- [ ] **Step 1: Write failing tests**

在 `server/test_asr_config.py` 添加：

```python
def create_sensevoice_snapshot(cache_root: Path, snapshot_name: str = "sensevoice") -> Path:
    snapshot_dir = cache_root / repo_cache_dir_name("FunAudioLLM/SenseVoiceSmall") / "snapshots" / snapshot_name
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.pt").write_bytes(b"model")
    (snapshot_dir / "config.yaml").write_text("model: SenseVoiceSmall", encoding="utf-8")
    (snapshot_dir / "am.mvn").write_bytes(b"mvn")
    (snapshot_dir / "chn_jpn_yue_eng_ko_spectok.bpe.model").write_bytes(b"bpe")
    return snapshot_dir
```

并添加测试：

```python
def test_model_manager_supports_sensevoice_small_snapshot(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        snapshot = create_sensevoice_snapshot(Path(temp_dir))
        self.assertEqual(
            find_cached_model_snapshot(SENSEVOICE_SMALL_MODEL_ID, cache_root=Path(temp_dir)),
            snapshot,
        )
```

- [ ] **Step 2: Run red test**

Run: `cd server; python -m pytest test_asr_config.py::AsrConfigTest::test_model_manager_supports_sensevoice_small_snapshot -q`

Expected: import `SENSEVOICE_SMALL_MODEL_ID` 失败或未知模型失败。

- [ ] **Step 3: Implement metadata**

在 `server/model_manager.py` 添加 SenseVoiceSmall 常量、repo id、required files、支持模型集合、`ACTIVE_ASR_MODEL_ID`、`get_active_asr_model_id()`、`get_model_repo_id()`、`get_model_required_files()`、`get_model_explicit_dir_env()`。

- [ ] **Step 4: Run green test**

Run: `cd server; python -m pytest test_asr_config.py::AsrConfigTest::test_model_manager_supports_sensevoice_small_snapshot -q`

Expected: PASS。

### Task 2: ASR source 与 runtime profile

**Files:**
- Modify: `server/asr.py`
- Test: `server/test_asr_config.py`

- [ ] **Step 1: Write failing tests**

添加测试：

```python
def test_resolve_sensevoice_model_source_prefers_explicit_dir(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        explicit_dir = create_sensevoice_snapshot(Path(temp_dir), "explicit-sensevoice")
        with patch.dict(
            os.environ,
            {
                "SENSEVOICE_SMALL_MODEL_DIR": str(explicit_dir),
                "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
            },
            clear=False,
        ):
            source = asr.resolve_streaming_model_source(SENSEVOICE_SMALL_MODEL_ID)
    self.assertEqual(source.model_id, SENSEVOICE_SMALL_MODEL_ID)
    self.assertEqual(source.kind, asr.DIR_SOURCE)
    self.assertEqual(source.model_ref, str(explicit_dir))
```

- [ ] **Step 2: Run red test**

Run: `cd server; python -m pytest test_asr_config.py::AsrConfigTest::test_resolve_sensevoice_model_source_prefers_explicit_dir -q`

Expected: `resolve_streaming_model_source` 或 `SENSEVOICE_SMALL_MODEL_ID` 未定义。

- [ ] **Step 3: Implement source resolution**

在 `server/asr.py` 添加通用 `StreamingAsrModelSource`、`get_candidate_streaming_model_sources(model_id=None)`、`resolve_streaming_model_source(model_id=None)`，保留 `resolve_paraformer_streaming_model_source()` 兼容现有调用。

- [ ] **Step 4: Run green test**

Run: `cd server; python -m pytest test_asr_config.py::AsrConfigTest::test_resolve_sensevoice_model_source_prefers_explicit_dir -q`

Expected: PASS。

### Task 3: 流式 session 行为

**Files:**
- Modify: `server/asr.py`
- Test: `server/test_asr_runtime.py`

- [ ] **Step 1: Write failing tests**

添加测试：

```python
def test_sensevoice_runtime_generates_from_accumulated_audio(self):
    calls = []

    class FakeModel:
        def generate(self, **kwargs):
            calls.append(kwargs)
            return [{"text": f"<|zh|><|NEUTRAL|><|Speech|><|withitn|>累计{len(kwargs['input'])}"}]

    runtime = asr.StreamingAsrRuntime(
        model=FakeModel(),
        model_id=asr.SENSEVOICE_SMALL_MODEL_ID,
        chunk_ms=1,
        accumulate_audio=True,
        generate_options={"language": "auto", "use_itn": True, "ban_emo_unk": False},
        postprocess="rich_transcription",
    )
    session = asr.StreamingAsrSession(runtime, sample_rate=1000, chunk_ms=1)
    first = session.append_pcm16(b"\x01\x00\x02\x00")
    second = session.append_pcm16(b"\x03\x00\x04\x00")
    final = session.finalize()
    self.assertEqual(first[-1].text, "累计2")
    self.assertEqual(second[-1].text, "累计4")
    self.assertEqual(final.text, "累计4")
    self.assertEqual([len(call["input"]) for call in calls], [2, 4, 4])
```

- [ ] **Step 2: Run red test**

Run: `cd server; python -m pytest test_asr_runtime.py::AsrRuntimeTest::test_sensevoice_runtime_generates_from_accumulated_audio -q`

Expected: `StreamingAsrRuntime` 或累计模式不存在。

- [ ] **Step 3: Implement runtime**

将 `ParaformerStreamingRuntime` 泛化为 `StreamingAsrRuntime`，添加 profile 构建、SenseVoiceSmall `AutoModel` 参数、`normalize_rich_transcription_text()`、累计音频 session 分支。

- [ ] **Step 4: Run green test**

Run: `cd server; python -m pytest test_asr_runtime.py::AsrRuntimeTest::test_sensevoice_runtime_generates_from_accumulated_audio -q`

Expected: PASS。

### Task 4: 文档与架构约束

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update project memory**

把“当前唯一 ASR 模型”改为“默认模型 + 后端隐藏切换常量”，并记录 SenseVoiceSmall 是累计音频伪流式，不是 Paraformer 同级原生 streaming。

- [ ] **Step 2: Verify no frontend scope leaked**

Run: `git diff -- electron-app`

Expected: 无前端变更。

### Task 5: Full verification

**Files:**
- Test: `server/test_asr_config.py`
- Test: `server/test_asr_runtime.py`
- Test: `server/test_runtime_config.py`
- Test: `server/test_service_readiness.py`
- Test: `server/test_voice_flow_contract.py`
- Test: `server/test_ws_protocol_contract.py`

- [ ] **Step 1: Run focused tests**

Run: `cd server; python -m pytest test_asr_config.py test_asr_runtime.py -q`

Expected: PASS。

- [ ] **Step 2: Run voice verification set**

Run: `python -m pytest server/test_runtime_config.py server/test_service_readiness.py server/test_asr_runtime.py server/test_asr_config.py server/test_voice_flow_contract.py server/test_ws_protocol_contract.py -q`

Expected: PASS。
