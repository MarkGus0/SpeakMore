import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

import asr


class AsrRuntimeTest(unittest.TestCase):
    def setUp(self):
        asr._model = None

    def create_explicit_model_dir(self, root: Path) -> Path:
        root.mkdir(parents=True, exist_ok=True)
        (root / "model.bin").write_bytes(b"model")
        (root / "config.json").write_text("{}", encoding="utf-8")
        return root

    def test_preload_whisper_model_reuses_singleton(self):
        self.assertTrue(hasattr(asr, "preload_whisper_model"), "preload_whisper_model 尚未实现")
        self.assertTrue(
            hasattr(asr, "get_candidate_whisper_model_sources"),
            "get_candidate_whisper_model_sources 尚未实现",
        )
        if not hasattr(asr, "preload_whisper_model") or not hasattr(asr, "get_candidate_whisper_model_sources"):
            return

        source = asr.WhisperModelSource(kind=asr.DOWNLOAD_SOURCE, model_ref="base", download_root="C:/models")
        fake_model = object()

        with patch("asr.get_candidate_whisper_model_sources", return_value=[source]), patch(
            "asr.build_whisper_model",
            return_value=fake_model,
        ) as build:
            first = asr.preload_whisper_model()
            second = asr.preload_whisper_model()

        self.assertIs(first, fake_model)
        self.assertIs(second, fake_model)
        build.assert_called_once_with(source)

    def test_preload_whisper_model_falls_through_broken_cached_source(self):
        self.assertTrue(hasattr(asr, "preload_whisper_model"), "preload_whisper_model 尚未实现")
        self.assertTrue(
            hasattr(asr, "get_candidate_whisper_model_sources"),
            "get_candidate_whisper_model_sources 尚未实现",
        )
        if not hasattr(asr, "preload_whisper_model") or not hasattr(asr, "get_candidate_whisper_model_sources"):
            return

        bad_source = asr.WhisperModelSource(kind=asr.MANAGED_CACHE_SOURCE, model_ref="C:/managed")
        good_source = asr.WhisperModelSource(kind=asr.HF_CACHE_SOURCE, model_ref="C:/hf")
        fake_model = object()

        with patch("asr.get_candidate_whisper_model_sources", return_value=[bad_source, good_source]), patch(
            "asr.build_whisper_model",
            side_effect=[RuntimeError("broken managed cache"), fake_model],
        ) as build:
            model = asr.preload_whisper_model()

        self.assertIs(model, fake_model)
        self.assertEqual(build.call_args_list, [call(bad_source), call(good_source)])

    def test_reload_whisper_model_replaces_singleton_and_persists_selection_after_success(self):
        self.assertTrue(hasattr(asr, "reload_whisper_model"), "reload_whisper_model 尚未实现")
        if not hasattr(asr, "reload_whisper_model"):
            return

        old_model = object()
        new_model = object()
        asr._model = old_model
        source = asr.WhisperModelSource(kind=asr.DOWNLOAD_SOURCE, model_ref="small", download_root="C:/models")

        events = []

        def build_model(_source):
            events.append("build")
            return new_model

        def write_model_id(model_id):
            events.append(f"write:{model_id}")
            return model_id

        with patch(
            "asr.write_selected_model_id",
            side_effect=write_model_id,
        ) as write_selection, patch(
            "asr.get_candidate_whisper_model_sources",
            return_value=[source],
        ), patch(
            "asr.build_whisper_model",
            side_effect=build_model,
        ) as build:
            model = asr.reload_whisper_model("small")

        self.assertIs(model, new_model)
        self.assertIs(asr._model, new_model)
        write_selection.assert_called_once_with("small")
        build.assert_called_once_with(source)
        self.assertEqual(events, ["build", "write:small"])

    def test_reload_whisper_model_keeps_previous_model_and_selection_after_failure(self):
        self.assertTrue(hasattr(asr, "reload_whisper_model"), "reload_whisper_model 尚未实现")
        if not hasattr(asr, "reload_whisper_model"):
            return

        old_model = object()
        asr._model = old_model
        source = asr.WhisperModelSource(kind=asr.DOWNLOAD_SOURCE, model_ref="small", download_root="C:/models")

        with patch(
            "asr.write_selected_model_id",
        ) as write_selection, patch(
            "asr.get_candidate_whisper_model_sources",
            return_value=[source],
        ), patch(
            "asr.build_whisper_model",
            side_effect=RuntimeError("load failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "load failed"):
                asr.reload_whisper_model("small")

        self.assertIs(asr._model, old_model)
        write_selection.assert_not_called()

    def test_reload_whisper_model_rejects_selection_change_when_explicit_dir_is_set(self):
        old_model = object()
        asr._model = old_model

        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = self.create_explicit_model_dir(Path(temp_dir) / "explicit")
            with patch.dict(os.environ, {"WHISPER_MODEL_DIR": str(explicit_dir)}, clear=False), patch(
                "asr.write_selected_model_id",
            ) as write_selection, patch(
                "asr.build_whisper_model",
                return_value=object(),
            ) as build:
                with self.assertRaisesRegex(RuntimeError, "WHISPER_MODEL_DIR"):
                    asr.reload_whisper_model("small")

        self.assertIs(asr._model, old_model)
        write_selection.assert_not_called()
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
