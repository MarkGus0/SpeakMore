import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from model_manager import (
    clear_download_status_for_tests,
    find_cached_model_snapshot,
    FUNASR_NANO_MODEL_ID,
    get_hf_cache_root,
    get_managed_models_root,
    repo_cache_dir_name,
    write_selected_model_id,
)

PARAFORMER_STREAMING_MODEL_ID = "paraformer-zh-streaming"
PARAFORMER_STREAMING_REPO_ID = "funasr/paraformer-zh-streaming"


def create_snapshot(model_id: str, repo_id: str):
    snapshot = get_managed_models_root() / "faster-whisper" / repo_cache_dir_name(repo_id) / "snapshots" / "abc"
    snapshot.mkdir(parents=True, exist_ok=True)
    (snapshot / "model.bin").write_bytes(b"model")
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    return snapshot


def create_funasr_hf_snapshot():
    snapshot = get_hf_cache_root() / repo_cache_dir_name("FunAudioLLM/Fun-ASR-Nano-2512") / "snapshots" / "funasr"
    snapshot.mkdir(parents=True, exist_ok=True)
    (snapshot / "model.pt").write_bytes(b"model")
    (snapshot / "config.yaml").write_text("model: FunASRNano", encoding="utf-8")
    (snapshot / "configuration.json").write_text("{}", encoding="utf-8")
    (snapshot / "multilingual.tiktoken").write_text("token", encoding="utf-8")
    qwen_dir = snapshot / "Qwen3-0.6B"
    qwen_dir.mkdir(exist_ok=True)
    (qwen_dir / "config.json").write_text("{}", encoding="utf-8")
    return snapshot


def create_paraformer_streaming_hf_snapshot():
    snapshot = get_hf_cache_root() / repo_cache_dir_name(PARAFORMER_STREAMING_REPO_ID) / "snapshots" / "paraformer"
    snapshot.mkdir(parents=True, exist_ok=True)
    (snapshot / "model.pt").write_bytes(b"model")
    (snapshot / "config.yaml").write_text("model: paraformer", encoding="utf-8")
    (snapshot / "tokens.json").write_text("[]", encoding="utf-8")
    (snapshot / "am.mvn").write_bytes(b"mvn")
    return snapshot


class ModelApiTest(unittest.TestCase):
    def setUp(self):
        clear_download_status_for_tests()

    def test_models_endpoint_returns_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with TestClient(app) as client:
                    response = client.get("/models")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["currentModelId"], FUNASR_NANO_MODEL_ID)
        self.assertEqual(
            [model["id"] for model in payload["models"]],
            [FUNASR_NANO_MODEL_ID, PARAFORMER_STREAMING_MODEL_ID, "tiny", "base", "small", "medium", "large-v3"],
        )

    def test_select_rejects_model_that_is_not_downloaded(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with TestClient(app) as client:
                    response = client.post("/models/small/select")

        self.assertEqual(response.status_code, 409)

    def test_select_downloaded_model_calls_reload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                create_snapshot("small", "Systran/faster-whisper-small")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.reload_asr_model", return_value=object()) as reload_model:
                    with TestClient(app) as client:
                        response = client.post("/models/small/select")

        self.assertEqual(response.status_code, 200)
        reload_model.assert_called_once_with("small")

    def test_select_funasr_from_hf_cache_calls_reload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                os.environ,
                {
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                    "WHISPER_MODEL_DIR": "",
                    "WHISPER_MODEL": "",
                },
                clear=False,
            ):
                create_funasr_hf_snapshot()
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.reload_asr_model", return_value=object()) as reload_model:
                    with TestClient(app) as client:
                        response = client.post(f"/models/{FUNASR_NANO_MODEL_ID}/select")

        self.assertEqual(response.status_code, 200)
        reload_model.assert_called_once_with(FUNASR_NANO_MODEL_ID)

    def test_select_paraformer_streaming_from_hf_cache_calls_reload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                os.environ,
                {
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                    "WHISPER_MODEL_DIR": "",
                    "WHISPER_MODEL": "",
                },
                clear=False,
            ):
                create_paraformer_streaming_hf_snapshot()
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.reload_asr_model", return_value=object()) as reload_model:
                    with TestClient(app) as client:
                        response = client.post(f"/models/{PARAFORMER_STREAMING_MODEL_ID}/select")

        self.assertEqual(response.status_code, 200)
        reload_model.assert_called_once_with(PARAFORMER_STREAMING_MODEL_ID)

    def test_delete_current_model_falls_back_to_base(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                create_snapshot("small", "Systran/faster-whisper-small")
                create_snapshot("base", "Systran/faster-whisper-base")
                write_selected_model_id("small")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.reload_asr_model", side_effect=lambda model_id: write_selected_model_id(model_id)):
                    with TestClient(app) as client:
                        response = client.delete("/models/small")
                        state = client.get("/models").json()

                self.assertEqual(response.status_code, 200)
                self.assertEqual(state["currentModelId"], "base")
                self.assertIsNone(find_cached_model_snapshot("small"))

    def test_delete_current_model_keeps_selection_and_cache_when_fallback_reload_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                create_snapshot("small", "Systran/faster-whisper-small")
                create_snapshot("base", "Systran/faster-whisper-base")
                write_selected_model_id("small")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.reload_asr_model", side_effect=RuntimeError("load failed")):
                    with TestClient(app) as client:
                        response = client.delete("/models/small")
                        state = client.get("/models").json()

                self.assertEqual(response.status_code, 500)
                self.assertEqual(state["currentModelId"], "small")
                self.assertIsNotNone(find_cached_model_snapshot("small"))

    def test_delete_current_base_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                create_snapshot("base", "Systran/faster-whisper-base")
                write_selected_model_id("base")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with TestClient(app) as client:
                    response = client.delete("/models/base")
                    state = client.get("/models").json()

                self.assertEqual(response.status_code, 409)
                self.assertEqual(state["currentModelId"], "base")
                self.assertIsNotNone(find_cached_model_snapshot("base"))

    def test_download_and_cancel_delegate_to_model_manager(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with patch("main.start_download_task") as start_download, patch("main.cancel_download_task", return_value=True) as cancel_download:
                    with TestClient(app) as client:
                        download_response = client.post("/models/small/download")
                        cancel_response = client.post("/models/small/cancel")

        self.assertEqual(download_response.status_code, 200)
        self.assertEqual(cancel_response.status_code, 200)
        start_download.assert_called_once_with("small")
        cancel_download.assert_called_once_with("small")

    def test_explicit_model_dir_rejects_select(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = Path(temp_dir) / "explicit"
            explicit_dir.mkdir()
            (explicit_dir / "model.bin").write_bytes(b"model")
            (explicit_dir / "config.json").write_text("{}", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": str(explicit_dir)},
                clear=False,
            ):
                create_snapshot("small", "Systran/faster-whisper-small")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with TestClient(app) as client:
                    response = client.post("/models/small/select")

        self.assertEqual(response.status_code, 409)

    def test_explicit_model_dir_rejects_delete(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = Path(temp_dir) / "explicit"
            explicit_dir.mkdir()
            (explicit_dir / "model.bin").write_bytes(b"model")
            (explicit_dir / "config.json").write_text("{}", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": str(explicit_dir)},
                clear=False,
            ):
                create_snapshot("small", "Systran/faster-whisper-small")
                app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
                with TestClient(app) as client:
                    response = client.delete("/models/small")

                self.assertIsNotNone(find_cached_model_snapshot("small"))

        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
