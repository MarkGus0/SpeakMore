import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

import asr

FUNASR_MODEL_ID = "fun-asr-nano-2512"
PARAFORMER_STREAMING_MODEL_ID = "paraformer-zh-streaming"


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

    def test_reload_asr_model_loads_funasr_and_persists_selection_after_success(self):
        self.assertTrue(hasattr(asr, "reload_asr_model"), "reload_asr_model 尚未实现")
        if not hasattr(asr, "reload_asr_model"):
            return

        old_model = object()
        new_model = object()
        asr._model = old_model
        source = asr.FunAsrModelSource(kind=asr.HF_CACHE_SOURCE, model_ref="C:/hf/funasr", model_id=FUNASR_MODEL_ID)

        with patch("asr.get_candidate_funasr_model_sources", return_value=[source]), patch(
            "asr.build_funasr_model",
            return_value=new_model,
        ) as build, patch("asr.write_selected_model_id", side_effect=lambda model_id: model_id) as write_selection:
            model = asr.reload_asr_model(FUNASR_MODEL_ID)

        self.assertIs(model, new_model)
        self.assertIs(asr._model, new_model)
        build.assert_called_once_with(source)
        write_selection.assert_called_once_with(FUNASR_MODEL_ID)

    def test_reload_asr_model_loads_paraformer_streaming_and_persists_selection_after_success(self):
        old_model = object()
        new_model = object()
        asr._model = old_model
        source = asr.ParaformerStreamingModelSource(
            kind=asr.HF_CACHE_SOURCE,
            model_ref="C:/hf/paraformer",
            model_id=PARAFORMER_STREAMING_MODEL_ID,
        )

        with patch("asr.get_candidate_paraformer_streaming_model_sources", return_value=[source]), patch(
            "asr.build_paraformer_streaming_model",
            return_value=new_model,
        ) as build, patch("asr.write_selected_model_id", side_effect=lambda model_id: model_id) as write_selection:
            model = asr.reload_asr_model(PARAFORMER_STREAMING_MODEL_ID)

        self.assertIs(model, new_model)
        self.assertIs(asr._model, new_model)
        build.assert_called_once_with(source)
        write_selection.assert_called_once_with(PARAFORMER_STREAMING_MODEL_ID)

    def test_resolve_funasr_device_prefers_cuda_and_falls_back_to_cpu(self):
        self.assertTrue(hasattr(asr, "resolve_funasr_device"), "resolve_funasr_device 尚未实现")
        if not hasattr(asr, "resolve_funasr_device"):
            return

        with patch("asr.is_cuda_available", return_value=True):
            self.assertEqual(asr.resolve_funasr_device(), "cuda:0")

        with patch("asr.is_cuda_available", return_value=False):
            self.assertEqual(asr.resolve_funasr_device(), "cpu")

    def test_transcribe_sync_uses_funasr_runtime_inference_text(self):
        self.assertTrue(hasattr(asr, "FunAsrRuntime"), "FunAsrRuntime 尚未实现")
        if not hasattr(asr, "FunAsrRuntime"):
            return

        class FakeFunAsrModel:
            def inference(self, data_in, **kwargs):
                return [[{"text": " 你好 SpeakMore "}]]

        asr._model = asr.FunAsrRuntime(model=FakeFunAsrModel(), kwargs={"language": "中文"})

        self.assertEqual(asr._transcribe_sync("audio.wav"), "你好 SpeakMore")

    def test_streaming_asr_session_accumulates_partial_and_final_text(self):
        class FakeStreamingModel:
            def __init__(self):
                self.texts = iter(["你", "好", "了"])
                self.calls = []

            def generate(self, **kwargs):
                self.calls.append(kwargs)
                return [{"text": next(self.texts)}]

        fake_model = FakeStreamingModel()
        runtime = asr.ParaformerStreamingRuntime(
            model=fake_model,
            chunk_size=[0, 10, 5],
            encoder_chunk_look_back=4,
            decoder_chunk_look_back=1,
        )
        session = asr.StreamingAsrSession(runtime, sample_rate=16000, chunk_ms=600)
        chunk_600ms = b"\x00\x00" * 9600

        partials = session.append_pcm16(chunk_600ms + chunk_600ms)
        final = session.finalize()

        self.assertEqual([partial.text for partial in partials], ["你", "你好"])
        self.assertEqual(final.text, "你好了")
        self.assertEqual([call["is_final"] for call in fake_model.calls], [False, False, True])

    def test_create_streaming_asr_session_only_for_loaded_streaming_runtime(self):
        asr._model = asr.ParaformerStreamingRuntime(
            model=object(),
            chunk_size=[0, 10, 5],
            encoder_chunk_look_back=4,
            decoder_chunk_look_back=1,
        )

        self.assertTrue(asr.is_streaming_asr_model_loaded())
        self.assertIsInstance(asr.create_streaming_asr_session(sample_rate=16000), asr.StreamingAsrSession)

    def test_build_paraformer_streaming_model_uses_local_funasr_repo_for_import(self):
        repo_dir = Path("D:/CodeWorkSpace/FunASR")
        source = asr.ParaformerStreamingModelSource(
            kind=asr.HF_CACHE_SOURCE,
            model_ref="C:/hf/paraformer",
            model_id=PARAFORMER_STREAMING_MODEL_ID,
        )
        original_path = list(sys.path)

        class FakeAutoModel:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        def import_or_fail(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "funasr":
                self.assertIn(str(repo_dir), sys.path)
                return type("FakeFunAsrModule", (), {"AutoModel": FakeAutoModel})
            return original_import(name, globals, locals, fromlist, level)

        original_import = __import__
        try:
            sys.path = [path for path in sys.path if path != str(repo_dir)]
            with patch("asr.resolve_funasr_repo_dir", return_value=repo_dir), patch(
                "asr.resolve_funasr_device",
                return_value="cpu",
            ), patch("builtins.__import__", side_effect=import_or_fail):
                runtime = asr.build_paraformer_streaming_model(source)
        finally:
            sys.path = original_path

        self.assertEqual(runtime.model.kwargs["model"], source.model_ref)
        self.assertEqual(runtime.model.kwargs["hub"], "hf")
        self.assertEqual(runtime.model.kwargs["device"], "cpu")


if __name__ == "__main__":
    unittest.main()
