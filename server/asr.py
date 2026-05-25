"""ASR 模块 - 只保留 paraformer 中文实时流式模型。"""

import asyncio
import os
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from model_manager import (
    PARAFORMER_STREAMING_MODEL_ID,
    PARAFORMER_STREAMING_REPO_ID,
    PARAFORMER_STREAMING_REQUIRED_MODEL_FILES,
    find_cached_model_snapshot,
    get_hf_cache_root as get_model_hf_cache_root,
    get_managed_model_cache_root,
)
from runtime_config import load_server_env

load_server_env()

DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"
DEFAULT_FUNASR_REPO_DIR = Path("D:/CodeWorkSpace/FunASR")


@dataclass(frozen=True)
class ParaformerStreamingModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = PARAFORMER_STREAMING_MODEL_ID


@dataclass
class ParaformerStreamingRuntime:
    model: Any
    chunk_size: list[int]
    encoder_chunk_look_back: int
    decoder_chunk_look_back: int
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)


@dataclass(frozen=True)
class StreamingAsrResult:
    text: str


_model: ParaformerStreamingRuntime | None = None
_model_lock = threading.Lock()


def get_hf_cache_root() -> Path:
    return get_model_hf_cache_root()


def is_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def resolve_funasr_device() -> str:
    configured_device = os.environ.get("FUNASR_DEVICE", "").strip()
    if configured_device:
        if configured_device.startswith("cuda") and not is_cuda_available():
            return "cpu"
        return configured_device
    return "cuda:0" if is_cuda_available() else "cpu"


def is_valid_model_dir(path: Path, required_files: tuple[str, ...]) -> bool:
    return path.is_dir() and all((path / name).is_file() for name in required_files)


def is_valid_paraformer_model_dir(path: Path) -> bool:
    return is_valid_model_dir(path, PARAFORMER_STREAMING_REQUIRED_MODEL_FILES)


def get_candidate_paraformer_streaming_model_sources(
    model_id: str | None = None,
) -> list[ParaformerStreamingModelSource]:
    selected_model_id = PARAFORMER_STREAMING_MODEL_ID if model_id is None else model_id
    if selected_model_id != PARAFORMER_STREAMING_MODEL_ID:
        raise ValueError(f"未知 Paraformer streaming 模型: {selected_model_id}")

    configured_dir = os.getenv("PARAFORMER_STREAMING_MODEL_DIR", "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_paraformer_model_dir(explicit_dir):
            raise ValueError("PARAFORMER_STREAMING_MODEL_DIR 指向的模型权重不完整")
        return [
            ParaformerStreamingModelSource(
                kind=DIR_SOURCE,
                model_ref=str(explicit_dir),
                model_id=selected_model_id,
            )
        ]

    sources: list[ParaformerStreamingModelSource] = []
    managed_root = get_managed_model_cache_root(selected_model_id)
    managed_snapshot = find_cached_model_snapshot(selected_model_id)
    if managed_snapshot:
        sources.append(
            ParaformerStreamingModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                model_id=selected_model_id,
            )
        )

    hf_snapshot = find_cached_model_snapshot(selected_model_id, cache_root=get_hf_cache_root())
    if hf_snapshot:
        sources.append(
            ParaformerStreamingModelSource(
                kind=HF_CACHE_SOURCE,
                model_ref=str(hf_snapshot),
                model_id=selected_model_id,
            )
        )

    sources.append(
        ParaformerStreamingModelSource(
            kind=DOWNLOAD_SOURCE,
            model_ref=PARAFORMER_STREAMING_REPO_ID,
            download_root=str(managed_root),
            model_id=selected_model_id,
        )
    )
    return sources


def resolve_paraformer_streaming_model_source() -> ParaformerStreamingModelSource:
    return get_candidate_paraformer_streaming_model_sources()[0]


def resolve_funasr_repo_dir() -> Path | None:
    configured_repo = os.environ.get("FUNASR_REPO_DIR", "").strip()
    candidates = [Path(configured_repo)] if configured_repo else []
    candidates.append(DEFAULT_FUNASR_REPO_DIR)

    for candidate in candidates:
        if (candidate / "funasr").is_dir():
            return candidate
    return None


def ensure_funasr_repo_import_path() -> None:
    repo_dir = resolve_funasr_repo_dir()
    if repo_dir and str(repo_dir) not in sys.path:
        sys.path.insert(0, str(repo_dir))


def build_paraformer_streaming_model(source: ParaformerStreamingModelSource) -> ParaformerStreamingRuntime:
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if source.kind != DOWNLOAD_SOURCE:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    ensure_funasr_repo_import_path()
    from funasr import AutoModel

    device = resolve_funasr_device()
    print(f"[ASR] 从 {source.kind} 加载 Paraformer streaming {source.model_id}: {source.model_ref}，设备: {device}")
    model = AutoModel(model=source.model_ref, hub="hf", device=device, disable_update=True)
    return ParaformerStreamingRuntime(
        model=model,
        chunk_size=[0, 10, 5],
        encoder_chunk_look_back=4,
        decoder_chunk_look_back=1,
    )


def _load_paraformer_streaming_model(model_id: str | None = None):
    errors: list[str] = []
    for source in get_candidate_paraformer_streaming_model_sources(model_id):
        try:
            model = build_paraformer_streaming_model(source)
            print(f"[ASR] Paraformer streaming 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            if source.kind == DOWNLOAD_SOURCE:
                errors.append(
                    f"{source.kind}: {source.model_ref} -> 下载或加载失败，目标目录: {source.download_root}: {error}"
                )
            else:
                errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError("Paraformer streaming 模型加载失败: " + " | ".join(errors))


def preload_asr_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        _model = _load_paraformer_streaming_model()
        return _model


def _get_model():
    return preload_asr_model()


def convert_audio_file_to_pcm16_bytes(source_path: str) -> bytes:
    completed = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "pipe:1",
        ],
        capture_output=True,
        timeout=30,
        check=True,
    )
    return completed.stdout


def pcm16_bytes_to_float32(pcm_bytes: bytes):
    import numpy as np

    if len(pcm_bytes) % 2 == 1:
        pcm_bytes = pcm_bytes[:-1]
    if not pcm_bytes:
        return np.asarray([], dtype="float32")
    return np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0


def extract_funasr_text(result: Any) -> str:
    item = result
    if isinstance(item, tuple) and item:
        item = item[0]
    while isinstance(item, list) and item:
        item = item[0]
    if isinstance(item, dict):
        return str(item.get("text", "")).strip()
    return str(item or "").strip()


def generate_paraformer_streaming_chunk(
    runtime: ParaformerStreamingRuntime,
    pcm_bytes: bytes,
    cache: dict[str, Any],
    is_final: bool,
) -> str:
    audio = pcm16_bytes_to_float32(pcm_bytes)
    with runtime.lock:
        result = runtime.model.generate(
            input=audio,
            cache=cache,
            is_final=is_final,
            chunk_size=runtime.chunk_size,
            encoder_chunk_look_back=runtime.encoder_chunk_look_back,
            decoder_chunk_look_back=runtime.decoder_chunk_look_back,
        )
    return extract_funasr_text(result)


class StreamingAsrSession:
    def __init__(
        self,
        runtime: ParaformerStreamingRuntime,
        sample_rate: int = 16000,
        chunk_ms: int = 600,
    ) -> None:
        self.runtime = runtime
        self.sample_rate = sample_rate
        self.chunk_ms = chunk_ms
        self.cache: dict[str, Any] = {}
        self.pcm_buffer = bytearray()
        self.chunk_bytes = max(1, int(self.sample_rate * self.chunk_ms / 1000) * 2)
        self.text_parts: list[str] = []
        self.has_audio = False

    def append_pcm16(self, chunk: bytes) -> list[StreamingAsrResult]:
        if not chunk:
            return []

        self.has_audio = True
        self.pcm_buffer.extend(chunk)
        results: list[StreamingAsrResult] = []

        while len(self.pcm_buffer) >= self.chunk_bytes:
            pcm_chunk = bytes(self.pcm_buffer[: self.chunk_bytes])
            del self.pcm_buffer[: self.chunk_bytes]
            results.append(self._generate(pcm_chunk, False))

        return results

    def finalize(self) -> StreamingAsrResult:
        if not self.has_audio and not self.pcm_buffer:
            return StreamingAsrResult(text="".join(self.text_parts))

        final_chunk = bytes(self.pcm_buffer)
        self.pcm_buffer.clear()
        return self._generate(final_chunk, True)

    def _generate(self, pcm_chunk: bytes, is_final: bool) -> StreamingAsrResult:
        text = generate_paraformer_streaming_chunk(self.runtime, pcm_chunk, self.cache, is_final)
        if text:
            self.text_parts.append(text)
        return StreamingAsrResult(text="".join(self.text_parts))


def is_streaming_asr_model_loaded() -> bool:
    return isinstance(_model, ParaformerStreamingRuntime)


def create_streaming_asr_session(sample_rate: int = 16000) -> StreamingAsrSession:
    model = _get_model()
    if not isinstance(model, ParaformerStreamingRuntime):
        raise RuntimeError("当前 ASR 模型不支持 streaming 会话")
    return StreamingAsrSession(model, sample_rate=sample_rate)


def transcribe_pcm16_bytes(pcm_bytes: bytes) -> str:
    if not pcm_bytes:
        return ""

    session = create_streaming_asr_session()
    chunk_size = getattr(session, "chunk_bytes", len(pcm_bytes) or 1)
    for offset in range(0, len(pcm_bytes), chunk_size):
        session.append_pcm16(pcm_bytes[offset : offset + chunk_size])
    return session.finalize().text


async def transcribe_audio(audio_path: str, language: str | None = None) -> str:
    """转写音频文件为文本。"""
    loop = asyncio.get_event_loop()
    del language
    return await loop.run_in_executor(None, _transcribe_sync, audio_path)


def _transcribe_sync(audio_path: str) -> str:
    pcm_bytes = convert_audio_file_to_pcm16_bytes(audio_path)
    return transcribe_pcm16_bytes(pcm_bytes)
