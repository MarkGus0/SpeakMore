import asyncio
from pathlib import Path

import pytest

import local_translation_model
import main


def test_translation_model_status_detects_cached_gguf(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    snapshot = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(local_translation_model.TRANSLATION_MODEL_GGUF_REPO_ID)
        / "snapshots"
        / "snapshot-a"
    )
    snapshot.mkdir(parents=True)
    (snapshot / local_translation_model.TRANSLATION_MODEL_GGUF_FILE).write_bytes(b"gguf")

    status = local_translation_model.get_translation_model_status()

    assert status["cached"] is True
    assert status["model_path"].endswith(local_translation_model.TRANSLATION_MODEL_GGUF_FILE)
    assert status["repo_id"] == local_translation_model.TRANSLATION_MODEL_DISPLAY_REPO_ID


def test_translation_model_load_reports_runtime_missing_for_cached_model(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: False)
    snapshot = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(local_translation_model.TRANSLATION_MODEL_GGUF_REPO_ID)
        / "snapshots"
        / "snapshot-a"
    )
    snapshot.mkdir(parents=True)
    (snapshot / local_translation_model.TRANSLATION_MODEL_GGUF_FILE).write_bytes(b"gguf")

    status = local_translation_model.load_translation_model()

    assert status["status"] == "runtime_missing"
    assert status["runtime_missing"] is True
    assert "llama-server" in status["detail"]
    assert "llama-cpp-python" in status["detail"]


def test_translation_model_load_can_use_llama_cpp_python_server(tmp_path, monkeypatch):
    monkeypatch.setenv(local_translation_model.TRANSLATION_MODEL_CACHE_DIR_ENV, str(tmp_path))
    monkeypatch.delenv("SPEAKMORE_LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("LLAMA_SERVER_PATH", raising=False)
    monkeypatch.delenv("SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL", raising=False)
    monkeypatch.setattr(local_translation_model.shutil, "which", lambda _name: None)
    monkeypatch.setattr(local_translation_model, "has_llama_cpp_python_server", lambda: True)
    monkeypatch.setattr(local_translation_model, "wait_for_local_server", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        local_translation_model.socket,
        "create_connection",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError()),
    )
    snapshot = (
        tmp_path
        / local_translation_model.repo_cache_dir_name(local_translation_model.TRANSLATION_MODEL_GGUF_REPO_ID)
        / "snapshots"
        / "snapshot-a"
    )
    snapshot.mkdir(parents=True)
    model_file = snapshot / local_translation_model.TRANSLATION_MODEL_GGUF_FILE
    model_file.write_bytes(b"gguf")
    popen_calls = []

    class FakeProcess:
        pid = 12345

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout=None):
            del timeout
            return 0

    def fake_popen(args, **kwargs):
        popen_calls.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(local_translation_model.subprocess, "Popen", fake_popen)

    status = local_translation_model.load_translation_model()
    local_translation_model.unload_translation_model()

    assert status["status"] == "ready"
    assert status["runtime_kind"] == "llama-cpp-python"
    assert popen_calls
    args = popen_calls[0][0]
    assert args[:3] == [local_translation_model.sys.executable, "-m", "llama_cpp.server"]
    assert "--model" in args
    assert str(model_file) in args


def test_translate_text_with_engine_uses_local_model_when_ready(monkeypatch):
    async def fake_local(**kwargs):
        assert kwargs["target_language_id"] == "en"
        return "Hello"

    monkeypatch.setattr(main, "get_translation_model_status", lambda: {"ready": True, "status": "ready"})
    monkeypatch.setattr(main, "translate_with_local_model", fake_local)

    result = asyncio.run(main.translate_text_with_engine(
        raw_text="你好",
        target_language="en",
        context={},
        parameters={"translation_engine_preference": "auto"},
    ))

    assert result["text"] == "Hello"
    assert result["translation_engine"] == "local_hy_mt"
    assert result["local_model_status"] == "ready"


def test_translate_text_with_engine_falls_back_to_llm_in_auto(monkeypatch):
    async def fake_local(**_kwargs):
        raise RuntimeError("runtime failed")

    async def fake_refine_text(**kwargs):
        assert kwargs["mode"] == "translation"
        return "Hello from LLM"

    monkeypatch.setattr(main, "get_translation_model_status", lambda: {"ready": True, "status": "ready"})
    monkeypatch.setattr(main, "translate_with_local_model", fake_local)
    monkeypatch.setattr(main, "refine_text", fake_refine_text)

    result = asyncio.run(main.translate_text_with_engine(
        raw_text="你好",
        target_language="en",
        context={},
        parameters={"translation_engine_preference": "auto"},
    ))

    assert result["text"] == "Hello from LLM"
    assert result["translation_engine"] == "llm"
    assert result["local_model_status"] == "failed"


def test_translate_text_with_engine_raises_when_local_is_forced_but_unready(monkeypatch):
    monkeypatch.setattr(main, "get_translation_model_status", lambda: {
        "ready": False,
        "status": "runtime_missing",
        "detail": local_translation_model.RUNTIME_MISSING_DETAIL,
    })

    with pytest.raises(RuntimeError, match="llama-server"):
        asyncio.run(main.translate_text_with_engine(
            raw_text="你好",
            target_language="en",
            context={},
            parameters={"translation_engine_preference": "local"},
        ))
