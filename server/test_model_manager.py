import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from model_manager import (
    AVAILABLE_MODEL_IDS,
    DEFAULT_MODEL_ID,
    create_models_state,
    delete_model_files,
    find_cached_model_snapshot,
    get_managed_models_root,
    get_model_catalog,
    mark_download_started,
    read_selected_model_id,
    repo_cache_dir_name,
    update_download_progress,
    write_selected_model_id,
)


def create_model_snapshot(root: Path, repo_id: str, snapshot_name: str = "abc") -> Path:
    snapshot = root / "faster-whisper" / repo_cache_dir_name(repo_id) / "snapshots" / snapshot_name
    snapshot.mkdir(parents=True)
    (snapshot / "model.bin").write_bytes(b"model")
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    return snapshot


class ModelManagerCatalogTest(unittest.TestCase):
    def test_catalog_contains_supported_faster_whisper_models(self):
        catalog = get_model_catalog()

        self.assertEqual(AVAILABLE_MODEL_IDS, ("tiny", "base", "small", "medium", "large-v3"))
        self.assertEqual([model["id"] for model in catalog], list(AVAILABLE_MODEL_IDS))
        self.assertTrue(all(model["repoId"].startswith("Systran/faster-whisper-") for model in catalog))
        self.assertTrue(all(model["engine"] == "faster-whisper" for model in catalog))

    def test_selected_model_defaults_to_base(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                self.assertEqual(read_selected_model_id(), DEFAULT_MODEL_ID)

    def test_selected_model_is_persisted_in_managed_model_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                write_selected_model_id("small")

                self.assertEqual(read_selected_model_id(), "small")
                selection_file = get_managed_models_root() / "model-selection.json"
                self.assertEqual(json.loads(selection_file.read_text(encoding="utf-8"))["currentModelId"], "small")

    def test_invalid_selected_model_falls_back_to_base(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                root = get_managed_models_root()
                root.mkdir(parents=True, exist_ok=True)
                (root / "model-selection.json").write_text('{"currentModelId":"invalid"}', encoding="utf-8")

                self.assertEqual(read_selected_model_id(), DEFAULT_MODEL_ID)


class ModelManagerStateTest(unittest.TestCase):
    def test_models_state_marks_current_and_downloaded_models(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                create_model_snapshot(get_managed_models_root(), "Systran/faster-whisper-small")
                write_selected_model_id("small")

                state = create_models_state()

        small = next(model for model in state["models"] if model["id"] == "small")
        base = next(model for model in state["models"] if model["id"] == "base")
        self.assertEqual(state["currentModelId"], "small")
        self.assertTrue(small["isCurrent"])
        self.assertTrue(small["isDownloaded"])
        self.assertFalse(base["isCurrent"])

    def test_download_progress_is_reflected_in_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                mark_download_started("medium")
                update_download_progress("medium", downloaded=40, total=100)

                state = create_models_state()

        medium = next(model for model in state["models"] if model["id"] == "medium")
        self.assertTrue(medium["isDownloading"])
        self.assertEqual(medium["downloadProgress"], 40)

    def test_delete_model_files_removes_cached_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                create_model_snapshot(get_managed_models_root(), "Systran/faster-whisper-small")

                self.assertIsNotNone(find_cached_model_snapshot("small"))
                self.assertTrue(delete_model_files("small"))
                self.assertIsNone(find_cached_model_snapshot("small"))


if __name__ == "__main__":
    unittest.main()
