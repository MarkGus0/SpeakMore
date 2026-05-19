import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from model_manager import (
    AVAILABLE_MODEL_IDS,
    DEFAULT_MODEL_ID,
    cancel_download_task,
    clear_download_status_for_tests,
    create_models_state,
    delete_model_files,
    download_model,
    find_cached_model_snapshot,
    get_download_status,
    get_managed_models_root,
    get_managed_whisper_cache_root,
    get_model_definition,
    get_model_catalog,
    is_valid_model_snapshot,
    mark_download_failed,
    mark_download_finished,
    mark_download_started,
    normalize_model_id,
    read_selected_model_id,
    repo_cache_dir_name,
    start_download_task,
    update_download_progress,
    write_selected_model_id,
)


class ModelManagerCatalogTest(unittest.TestCase):
    def test_catalog_contains_supported_faster_whisper_models(self):
        catalog = get_model_catalog()
        required_fields = {
            "id",
            "name",
            "repoId",
            "engine",
            "description",
            "sizeMb",
            "accuracyScore",
            "speedScore",
            "supportedLanguages",
        }

        self.assertEqual(AVAILABLE_MODEL_IDS, ("tiny", "base", "small", "medium", "large-v3"))
        self.assertEqual([model["id"] for model in catalog], list(AVAILABLE_MODEL_IDS))
        self.assertTrue(all(model["repoId"].startswith("Systran/faster-whisper-") for model in catalog))
        self.assertTrue(all(model["engine"] == "faster-whisper" for model in catalog))
        for model in catalog:
            self.assertEqual(set(model.keys()), required_fields)
            self.assertGreaterEqual(model["accuracyScore"], 0)
            self.assertLessEqual(model["accuracyScore"], 1)
            self.assertGreaterEqual(model["speedScore"], 0)
            self.assertLessEqual(model["speedScore"], 1)
            self.assertIsInstance(model["supportedLanguages"], list)
            self.assertIn("multi", model["supportedLanguages"])
            self.assertIn("zh", model["supportedLanguages"])
            self.assertIn("en", model["supportedLanguages"])

    def test_catalog_language_lists_cannot_pollute_internal_catalog(self):
        catalog = get_model_catalog()
        catalog[0]["supportedLanguages"].append("polluted")

        next_catalog = get_model_catalog()

        self.assertNotIn("polluted", next_catalog[0]["supportedLanguages"])

    def test_normalize_model_id_only_accepts_supported_string_ids(self):
        self.assertEqual(normalize_model_id("tiny"), "tiny")
        self.assertEqual(normalize_model_id("large-v3"), "large-v3")
        self.assertEqual(normalize_model_id("invalid"), DEFAULT_MODEL_ID)
        self.assertEqual(normalize_model_id(None), DEFAULT_MODEL_ID)
        self.assertEqual(normalize_model_id(["base"]), DEFAULT_MODEL_ID)

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

    def test_non_object_selection_json_falls_back_to_base(self):
        invalid_json_values = ("[]", "null", '"base"')

        for raw_json in invalid_json_values:
            with self.subTest(raw_json=raw_json):
                with tempfile.TemporaryDirectory() as temp_dir:
                    local_app_data = Path(temp_dir) / "LocalAppData"
                    with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                        root = get_managed_models_root()
                        root.mkdir(parents=True, exist_ok=True)
                        (root / "model-selection.json").write_text(raw_json, encoding="utf-8")

                        self.assertEqual(read_selected_model_id(), DEFAULT_MODEL_ID)


class ModelManagerStateTest(unittest.TestCase):
    def setUp(self):
        clear_download_status_for_tests()

    def create_snapshot(self, model_id="small", snapshot_name="abc"):
        repo_id = f"Systran/faster-whisper-{model_id}"
        snapshot = get_managed_whisper_cache_root() / repo_cache_dir_name(repo_id) / "snapshots" / snapshot_name
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(b"model")
        (snapshot / "config.json").write_text("{}", encoding="utf-8")
        return snapshot

    def create_invalid_snapshot(self, model_id="small", snapshot_name="invalid"):
        repo_id = f"Systran/faster-whisper-{model_id}"
        snapshot = get_managed_whisper_cache_root() / repo_cache_dir_name(repo_id) / "snapshots" / snapshot_name
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(b"model")
        return snapshot

    def test_repo_cache_dir_name_uses_huggingface_cache_format(self):
        self.assertEqual(
            repo_cache_dir_name("Systran/faster-whisper-small"),
            "models--Systran--faster-whisper-small",
        )

    def test_models_state_marks_current_and_downloaded_models(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data), "WHISPER_MODEL_DIR": ""}, clear=False):
                snapshot = self.create_snapshot("small")
                write_selected_model_id("small")

                state = create_models_state()

        small = next(model for model in state["models"] if model["id"] == "small")
        base = next(model for model in state["models"] if model["id"] == "base")
        self.assertEqual(state["currentModelId"], "small")
        self.assertTrue(small["isCurrent"])
        self.assertTrue(small["isDownloaded"])
        self.assertEqual(small["snapshotPath"], str(snapshot))
        self.assertFalse(base["isCurrent"])

    def test_download_progress_is_reflected_in_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                mark_download_started("medium")
                update_download_progress("medium", downloaded=40, total=100)

                state = create_models_state()

        medium = next(model for model in state["models"] if model["id"] == "medium")
        self.assertTrue(medium["isDownloading"])
        self.assertEqual(medium["downloadProgress"], 40)

    def test_download_progress_is_clamped(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                update_download_progress("tiny", downloaded=-10, total=100)
                negative_status = get_download_status("tiny")
                update_download_progress("small", downloaded=150, total=100)
                oversized_status = get_download_status("small")
                update_download_progress("medium", downloaded=50, total=0)
                zero_total_status = get_download_status("medium")

        self.assertEqual(negative_status["downloadProgress"], 0)
        self.assertEqual(oversized_status["downloadProgress"], 100)
        self.assertEqual(zero_total_status["downloadProgress"], 0)

    def test_download_status_returns_default_and_failed_status(self):
        self.assertEqual(
            get_download_status("base"),
            {"isDownloading": False, "downloadProgress": 0, "downloadError": ""},
        )

        mark_download_failed("base", "网络错误")

        self.assertEqual(
            get_download_status("base"),
            {"isDownloading": False, "downloadProgress": 0, "downloadError": "网络错误"},
        )

    def test_download_status_rejects_unknown_model_without_falling_back_to_base(self):
        with self.assertRaisesRegex(ValueError, "未知模型: typo"):
            mark_download_started("typo")

        self.assertEqual(
            get_download_status("base"),
            {"isDownloading": False, "downloadProgress": 0, "downloadError": ""},
        )

    def test_mark_download_finished_rejects_unknown_model_without_clearing_base(self):
        mark_download_failed("base", "网络错误")

        with self.assertRaisesRegex(ValueError, "未知模型: typo"):
            mark_download_finished("typo")

        self.assertEqual(
            get_download_status("base"),
            {"isDownloading": False, "downloadProgress": 0, "downloadError": "网络错误"},
        )

    def test_download_failure_is_reflected_in_state_and_finish_clears_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": ""}, clear=False):
                mark_download_failed("tiny", "网络错误")
                failed_state = create_models_state()
                mark_download_finished("tiny")
                cleared_state = create_models_state()

        failed = next(model for model in failed_state["models"] if model["id"] == "tiny")
        cleared = next(model for model in cleared_state["models"] if model["id"] == "tiny")
        self.assertFalse(failed["isDownloading"])
        self.assertEqual(failed["downloadError"], "网络错误")
        self.assertEqual(cleared["downloadError"], "")

    def test_delete_model_files_removes_cached_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                self.create_snapshot("small")

                self.assertIsNotNone(find_cached_model_snapshot("small"))
                self.assertTrue(delete_model_files("small"))
                self.assertIsNone(find_cached_model_snapshot("small"))

    def test_delete_model_files_returns_false_when_cache_dir_is_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                self.assertFalse(delete_model_files("small"))

    def test_delete_model_files_clears_download_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                self.create_snapshot("small")
                mark_download_failed("small", "网络错误")

                delete_model_files("small")

        self.assertEqual(
            get_download_status("small"),
            {"isDownloading": False, "downloadProgress": 0, "downloadError": ""},
        )

    def test_delete_model_files_does_not_touch_explicit_model_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            explicit_dir = Path(temp_dir) / "explicit"
            explicit_dir.mkdir()
            explicit_file = explicit_dir / "model.bin"
            explicit_file.write_bytes(b"explicit")
            with patch.dict(
                os.environ,
                {"LOCALAPPDATA": str(local_app_data), "WHISPER_MODEL_DIR": str(explicit_dir)},
                clear=False,
            ):
                self.assertFalse(delete_model_files("small"))
                self.assertTrue(explicit_file.exists())

    def test_explicit_model_dir_locks_selection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = Path(temp_dir) / "explicit"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"), "WHISPER_MODEL_DIR": str(explicit_dir)}, clear=False):
                state = create_models_state()

        self.assertTrue(state["selectionLocked"])
        self.assertEqual(state["explicitModelDir"], str(explicit_dir))

    def test_models_state_locks_selection_when_whisper_model_env_is_set(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            with patch.dict(
                os.environ,
                {
                    "LOCALAPPDATA": str(local_app_data),
                    "WHISPER_MODEL": "base",
                    "WHISPER_MODEL_DIR": "",
                },
                clear=False,
            ):
                write_selected_model_id("small")

                state = create_models_state()

        self.assertEqual(state["currentModelId"], "base")
        self.assertEqual(state["explicitModelId"], "base")
        self.assertTrue(state["selectionLocked"])
        base = next(model for model in state["models"] if model["id"] == "base")
        small = next(model for model in state["models"] if model["id"] == "small")
        self.assertTrue(base["isCurrent"])
        self.assertFalse(small["isCurrent"])

    def test_model_definition_rejects_unknown_model(self):
        with self.assertRaisesRegex(ValueError, "未知模型: unknown"):
            get_model_definition("unknown")

    def test_invalid_snapshots_are_ignored(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                repo_id = "Systran/faster-whisper-small"
                invalid_snapshot = get_managed_whisper_cache_root() / repo_cache_dir_name(repo_id) / "snapshots" / "missing-config"
                invalid_snapshot.mkdir(parents=True)
                (invalid_snapshot / "model.bin").write_bytes(b"model")

                self.assertFalse(is_valid_model_snapshot(invalid_snapshot))
                self.assertIsNone(find_cached_model_snapshot("small"))

    def test_find_cached_model_snapshot_uses_newest_valid_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                older_valid = self.create_snapshot("small", "older-valid")
                newer_valid = self.create_snapshot("small", "newer-valid")
                newest_invalid = self.create_invalid_snapshot("small", "newest-invalid")
                os.utime(older_valid, (100, 100))
                os.utime(newer_valid, (200, 200))
                os.utime(newest_invalid, (300, 300))

                snapshot = find_cached_model_snapshot("small")

        self.assertEqual(snapshot, newer_valid)

    def test_find_cached_model_snapshot_skips_snapshot_when_stat_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                broken_stat = self.create_snapshot("small", "broken-stat")
                fallback_valid = self.create_snapshot("small", "fallback-valid")
                original_stat = Path.stat
                stat_calls = {}

                def stat_or_fail(path, *args, **kwargs):
                    stat_calls[path] = stat_calls.get(path, 0) + 1
                    if path == broken_stat:
                        if stat_calls[path] == 1:
                            return original_stat(path, *args, **kwargs)
                        raise OSError("stat 失败")
                    return original_stat(path, *args, **kwargs)

                with patch.object(Path, "stat", stat_or_fail):
                    snapshot = find_cached_model_snapshot("small")

        self.assertEqual(snapshot, fallback_valid)

    def test_find_cached_model_snapshot_can_scan_custom_cache_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_root = Path(temp_dir) / "custom-hf-cache"
            repo_id = "Systran/faster-whisper-small"
            snapshot = cache_root / repo_cache_dir_name(repo_id) / "snapshots" / "custom-valid"
            snapshot.mkdir(parents=True)
            (snapshot / "model.bin").write_bytes(b"model")
            (snapshot / "config.json").write_text("{}", encoding="utf-8")

            self.assertEqual(find_cached_model_snapshot("small", cache_root=cache_root), snapshot)

    def test_start_download_task_marks_status_before_background_task_runs(self):
        class PendingTask:
            def done(self):
                return False

            def add_done_callback(self, _callback):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData")}, clear=False):
                def fake_create_task(coroutine):
                    coroutine.close()
                    return PendingTask()

                with patch("model_manager.asyncio.create_task", side_effect=fake_create_task):
                    self.assertTrue(start_download_task("small"))

                status = get_download_status("small")

        self.assertTrue(status["isDownloading"])
        self.assertEqual(status["downloadProgress"], 0)
        self.assertEqual(status["downloadError"], "")

    def test_download_model_updates_progress_from_huggingface_tqdm(self):
        async def run_case():
            with tempfile.TemporaryDirectory() as temp_dir:
                local_app_data = Path(temp_dir) / "LocalAppData"

                def fake_snapshot_download(repo_id, cache_dir, local_files_only, **kwargs):
                    del repo_id, cache_dir, local_files_only
                    progress = kwargs.get("tqdm_class")
                    if progress is not None:
                        bar = progress(total=100)
                        bar.update(25)
                        bar.update(15)
                        bar.close()
                    status = get_download_status("medium")
                    self.assertTrue(status["isDownloading"])
                    self.assertEqual(status["downloadProgress"], 40)

                with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                    with patch("huggingface_hub.snapshot_download", side_effect=fake_snapshot_download):
                        await download_model("medium")

        asyncio.run(run_case())

    def test_cancel_download_cleans_cache_when_background_download_finishes(self):
        async def run_case():
            with tempfile.TemporaryDirectory() as temp_dir:
                local_app_data = Path(temp_dir) / "LocalAppData"
                entered = threading.Event()

                def fake_snapshot_download(repo_id, cache_dir, local_files_only, **kwargs):
                    del repo_id, local_files_only, kwargs
                    entered.set()
                    time.sleep(0.1)
                    model = get_model_definition("tiny")
                    snapshot = Path(cache_dir) / repo_cache_dir_name(model["repoId"]) / "snapshots" / "abc"
                    snapshot.mkdir(parents=True)
                    (snapshot / "model.bin").write_bytes(b"model")
                    (snapshot / "config.json").write_text("{}", encoding="utf-8")

                with patch.dict(os.environ, {"LOCALAPPDATA": str(local_app_data)}, clear=False):
                    with patch("huggingface_hub.snapshot_download", side_effect=fake_snapshot_download):
                        self.assertTrue(start_download_task("tiny"))
                        while not entered.is_set():
                            await asyncio.sleep(0.01)
                        self.assertTrue(cancel_download_task("tiny"))
                        await asyncio.sleep(0.2)

                    self.assertIsNone(find_cached_model_snapshot("tiny"))
                    self.assertEqual(
                        get_download_status("tiny"),
                        {"isDownloading": False, "downloadProgress": 0, "downloadError": ""},
                    )

        asyncio.run(run_case())
