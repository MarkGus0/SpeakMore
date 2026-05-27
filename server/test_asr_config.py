import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import asr
from model_manager import (
    PARAFORMER_STREAMING_MODEL_ID,
    SENSEVOICE_SMALL_MODEL_ID,
    find_cached_model_snapshot,
    get_hf_cache_root,
    repo_cache_dir_name,
)


def create_paraformer_snapshot(cache_root: Path, snapshot_name: str = "paraformer") -> Path:
    snapshot_dir = cache_root / repo_cache_dir_name("funasr/paraformer-zh-streaming") / "snapshots" / snapshot_name
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.pt").write_bytes(b"model")
    (snapshot_dir / "config.yaml").write_text("model: paraformer", encoding="utf-8")
    (snapshot_dir / "tokens.json").write_text("[]", encoding="utf-8")
    (snapshot_dir / "am.mvn").write_bytes(b"mvn")
    return snapshot_dir


def create_sensevoice_snapshot(cache_root: Path, snapshot_name: str = "sensevoice") -> Path:
    snapshot_dir = cache_root / repo_cache_dir_name("FunAudioLLM/SenseVoiceSmall") / "snapshots" / snapshot_name
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.pt").write_bytes(b"model")
    (snapshot_dir / "config.yaml").write_text("model: SenseVoiceSmall", encoding="utf-8")
    (snapshot_dir / "am.mvn").write_bytes(b"mvn")
    (snapshot_dir / "chn_jpn_yue_eng_ko_spectok.bpe.model").write_bytes(b"bpe")
    return snapshot_dir


class AsrConfigTest(unittest.TestCase):
    def test_model_manager_supports_sensevoice_small_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot = create_sensevoice_snapshot(Path(temp_dir))

            result = find_cached_model_snapshot(SENSEVOICE_SMALL_MODEL_ID, cache_root=Path(temp_dir))

        self.assertEqual(result, snapshot)

    def test_resolve_paraformer_streaming_model_source_uses_hf_cache_by_default(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            hf_root = user_profile / ".cache" / "huggingface" / "hub"
            snapshot = create_paraformer_snapshot(hf_root)

            with patch.dict(
                os.environ,
                {
                    "PARAFORMER_STREAMING_MODEL_DIR": "",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = asr.resolve_paraformer_streaming_model_source()

        self.assertEqual(
            source,
            asr.ParaformerStreamingModelSource(
                kind=asr.HF_CACHE_SOURCE,
                model_ref=str(snapshot),
                download_root=None,
                model_id=PARAFORMER_STREAMING_MODEL_ID,
            ),
        )

    def test_resolve_paraformer_streaming_model_source_prefers_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = Path(temp_dir) / "explicit-paraformer"
            explicit_dir.mkdir(parents=True, exist_ok=True)
            (explicit_dir / "model.pt").write_bytes(b"model")
            (explicit_dir / "config.yaml").write_text("model: paraformer", encoding="utf-8")
            (explicit_dir / "tokens.json").write_text("[]", encoding="utf-8")
            (explicit_dir / "am.mvn").write_bytes(b"mvn")

            with patch.dict(
                os.environ,
                {
                    "PARAFORMER_STREAMING_MODEL_DIR": str(explicit_dir),
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                source = asr.resolve_paraformer_streaming_model_source()

        self.assertEqual(
            source,
            asr.ParaformerStreamingModelSource(
                kind=asr.DIR_SOURCE,
                model_ref=str(explicit_dir),
                download_root=None,
                model_id=PARAFORMER_STREAMING_MODEL_ID,
            ),
        )

    def test_resolve_paraformer_streaming_model_source_rejects_invalid_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            invalid_dir = Path(temp_dir) / "invalid-paraformer"
            invalid_dir.mkdir(parents=True, exist_ok=True)

            with patch.dict(
                os.environ,
                {
                    "PARAFORMER_STREAMING_MODEL_DIR": str(invalid_dir),
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                with self.assertRaisesRegex(ValueError, "PARAFORMER_STREAMING_MODEL_DIR"):
                    asr.resolve_paraformer_streaming_model_source()

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

    def test_asr_module_no_longer_exposes_whisper_helpers(self):
        self.assertFalse(hasattr(asr, "WhisperModelSource"))
        self.assertFalse(hasattr(asr, "FunAsrModelSource"))
        self.assertFalse(hasattr(asr, "resolve_whisper_model_source"))
        self.assertFalse(hasattr(asr, "preload_whisper_model"))
        self.assertFalse(hasattr(asr, "reload_whisper_model"))


if __name__ == "__main__":
    unittest.main()
