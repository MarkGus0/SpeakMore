import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from model_manager import (
    DEFAULT_MODEL_ID,
    get_managed_models_root,
    read_selected_model_id,
    repo_cache_dir_name,
    write_selected_model_id,
)


def create_snapshot(model_id: str, repo_id: str) -> Path:
    snapshot = get_managed_models_root() / "faster-whisper" / repo_cache_dir_name(repo_id) / "snapshots" / f"{model_id}-snapshot"
    snapshot.mkdir(parents=True)
    (snapshot / "model.bin").write_bytes(b"model")
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    return snapshot


class ModelApiTest(unittest.TestCase):
    def create_client(self):
        app = main.create_app(preload_model=lambda: object(), exit_scheduler=lambda _code: None)
        return TestClient(app)

    def test_models_endpoint_returns_catalog_and_current_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                with self.create_client() as client:
                    response = client.get("/models")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["currentModelId"], DEFAULT_MODEL_ID)
        self.assertEqual([model["id"] for model in payload["models"]], ["tiny", "base", "small", "medium", "large-v3"])

    def test_select_model_rejects_model_that_is_not_downloaded(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                with self.create_client() as client:
                    response = client.post("/models/small/select")

        self.assertEqual(response.status_code, 409)
        self.assertIn("模型尚未下载", response.json()["detail"])

    def test_unknown_model_id_returns_404(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                with self.create_client() as client:
                    response = client.post("/models/unknown/download")

        self.assertEqual(response.status_code, 404)

    def test_select_model_loads_downloaded_model_and_persists_choice(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                create_snapshot("small", "Systran/faster-whisper-small")
                with patch("main.reload_whisper_model", return_value=object()) as reload_model:
                    with self.create_client() as client:
                        response = client.post("/models/small/select")

                self.assertEqual(read_selected_model_id(), "small")

        self.assertEqual(response.status_code, 200)
        reload_model.assert_called_once_with("small")
        self.assertEqual(response.json()["currentModelId"], "small")

    def test_delete_current_model_falls_back_to_base_selection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                create_snapshot("base", "Systran/faster-whisper-base")
                create_snapshot("small", "Systran/faster-whisper-small")
                write_selected_model_id("small")
                with patch("main.reload_whisper_model", return_value=object()):
                    with self.create_client() as client:
                        response = client.delete("/models/small")

                self.assertEqual(read_selected_model_id(), "base")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["currentModelId"], "base")


if __name__ == "__main__":
    unittest.main()
