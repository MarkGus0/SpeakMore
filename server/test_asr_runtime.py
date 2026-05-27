import asyncio
import unittest
from unittest.mock import patch

import asr


class AsrRuntimeTest(unittest.TestCase):
    def setUp(self):
        asr._model = None

    def test_preload_asr_model_uses_paraformer_loader_when_paraformer_is_active(self):
        fake_model = object()
        old_model = object()

        with patch("model_manager.ACTIVE_ASR_MODEL_ID", asr.PARAFORMER_STREAMING_MODEL_ID), patch(
            "asr._load_asr_model",
            return_value=old_model,
            create=True,
        ), patch(
            "asr._load_paraformer_streaming_model",
            return_value=fake_model,
        ) as load_paraformer:
            first = asr.preload_asr_model()
            second = asr.preload_asr_model()

        self.assertIs(first, fake_model)
        self.assertIs(second, fake_model)
        load_paraformer.assert_called_once()

    def test_preload_asr_model_uses_active_sensevoice_model_id_by_default(self):
        fake_model = object()

        with patch("asr._load_streaming_asr_model", return_value=fake_model) as load_streaming:
            result = asr.preload_asr_model()

        self.assertIs(result, fake_model)
        load_streaming.assert_called_once_with(asr.SENSEVOICE_SMALL_MODEL_ID)

    def test_sensevoice_runtime_generates_from_accumulated_audio(self):
        calls = []

        class FakeModel:
            def generate(self, **kwargs):
                calls.append(kwargs)
                return [{"text": f"<|zh|><|NEUTRAL|><|Speech|><|withitn|>累计{len(kwargs['input'])}"}]

        runtime = asr.StreamingAsrRuntime(
            model=FakeModel(),
            model_id=asr.SENSEVOICE_SMALL_MODEL_ID,
            chunk_ms=2,
            accumulate_audio=True,
            generate_options={"language": "auto", "use_itn": True, "ban_emo_unk": False},
            postprocess="rich_transcription",
        )
        session = asr.StreamingAsrSession(runtime, sample_rate=1000, chunk_ms=2)

        first = session.append_pcm16(b"\x01\x00\x02\x00")
        second = session.append_pcm16(b"\x03\x00\x04\x00")
        final = session.finalize()

        self.assertEqual(first[-1].text, "累计2")
        self.assertEqual(second[-1].text, "累计4")
        self.assertEqual(final.text, "累计4")
        self.assertEqual([len(call["input"]) for call in calls], [2, 4, 4])

    def test_transcribe_audio_uses_pcm16_streaming_session(self):
        fake_runtime = asr.ParaformerStreamingRuntime(
            model=object(),
            chunk_size=[0, 10, 5],
            encoder_chunk_look_back=4,
            decoder_chunk_look_back=1,
        )

        class FakeSession:
            chunk_bytes = 2

            def __init__(self):
                self.chunks = []

            def append_pcm16(self, chunk):
                self.chunks.append(chunk)
                return []

            def finalize(self):
                return asr.StreamingAsrResult(text="你好")

        fake_session = FakeSession()

        with patch("asr._get_model", return_value=fake_runtime), patch(
            "asr.create_streaming_asr_session",
            return_value=fake_session,
        ), patch(
            "asr.subprocess.run",
            return_value=type("CompletedProcess", (), {"stdout": b"\x01\x00\x02\x00"})(),
        ):
            result = asyncio.run(asr.transcribe_audio("audio.wav"))

        self.assertEqual(result, "你好")
        self.assertEqual(b"".join(fake_session.chunks), b"\x01\x00\x02\x00")


if __name__ == "__main__":
    unittest.main()
