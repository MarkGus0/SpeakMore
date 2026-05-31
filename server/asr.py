"""ASR 模块 - 负责加载当前后端启用的 FunASR 语音模型。"""

import asyncio
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from download_progress import DownloadProgress, create_hf_tqdm_class
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    find_cached_model_snapshot,
    get_active_asr_model_id,
    get_hf_cache_root as get_model_hf_cache_root,
    get_managed_model_cache_root,
    get_model_explicit_dir_env,
    get_model_repo_id,
    get_model_required_files,
)
from runtime_config import load_server_env

load_server_env()

DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"


@dataclass(frozen=True)
class StreamingAsrModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = SENSEVOICE_SMALL_MODEL_ID
    repo_id: str = "FunAudioLLM/SenseVoiceSmall"


@dataclass
class StreamingAsrRuntime:
    model: Any
    model_id: str = SENSEVOICE_SMALL_MODEL_ID
    chunk_size: list[int] | None = None
    encoder_chunk_look_back: int | None = None
    decoder_chunk_look_back: int | None = None
    chunk_ms: int = 600
    accumulate_audio: bool = False
    pass_cache: bool = True
    pass_is_final: bool = True
    generate_options: dict[str, Any] = field(default_factory=dict)
    postprocess: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)


@dataclass(frozen=True)
class StreamingAsrResult:
    text: str


_model: StreamingAsrRuntime | None = None
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


def is_valid_streaming_model_dir(path: Path, model_id: str) -> bool:
    return is_valid_model_dir(path, get_model_required_files(model_id))


def get_candidate_streaming_model_sources(
    model_id: str | None = None,
) -> list[StreamingAsrModelSource]:
    selected_model_id = get_active_asr_model_id() if model_id is None else model_id
    repo_id = get_model_repo_id(selected_model_id)
    explicit_dir_env = get_model_explicit_dir_env(selected_model_id)

    configured_dir = os.getenv(explicit_dir_env, "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_streaming_model_dir(explicit_dir, selected_model_id):
            raise ValueError(f"{explicit_dir_env} 指向的模型权重不完整")
        return [
            StreamingAsrModelSource(
                kind=DIR_SOURCE,
                model_ref=str(explicit_dir),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        ]

    sources: list[StreamingAsrModelSource] = []
    managed_root = get_managed_model_cache_root(selected_model_id)
    managed_snapshot = find_cached_model_snapshot(selected_model_id)
    if managed_snapshot:
        sources.append(
            StreamingAsrModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        )

    hf_snapshot = find_cached_model_snapshot(selected_model_id, cache_root=get_hf_cache_root())
    if hf_snapshot:
        sources.append(
            StreamingAsrModelSource(
                kind=HF_CACHE_SOURCE,
                model_ref=str(hf_snapshot),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        )

    sources.append(
        StreamingAsrModelSource(
            kind=DOWNLOAD_SOURCE,
            model_ref=repo_id,
            download_root=str(managed_root),
            model_id=selected_model_id,
            repo_id=repo_id,
        )
    )
    return sources


def resolve_streaming_model_source(model_id: str | None = None) -> StreamingAsrModelSource:
    return get_candidate_streaming_model_sources(model_id)[0]


def resolve_funasr_repo_dir() -> Path | None:
    configured_repo = os.environ.get("FUNASR_REPO_DIR", "").strip()
    candidates = [Path(configured_repo)] if configured_repo else []

    for candidate in candidates:
        if (candidate / "funasr").is_dir():
            return candidate
    return None


def ensure_funasr_repo_import_path() -> None:
    repo_dir = resolve_funasr_repo_dir()
    if repo_dir and str(repo_dir) not in sys.path:
        sys.path.insert(0, str(repo_dir))


def get_auto_model_kwargs(model_id: str) -> dict[str, Any]:
    if model_id == SENSEVOICE_SMALL_MODEL_ID:
        return {"disable_pbar": True}
    return {}


def resolve_model_ref_for_build(
    source: StreamingAsrModelSource,
    download_progress_callback: Callable[[DownloadProgress], None] | None = None,
) -> str:
    if source.kind != DOWNLOAD_SOURCE or not source.download_root:
        return source.model_ref

    from huggingface_hub import snapshot_download

    if not download_progress_callback:
        return snapshot_download(source.model_ref, cache_dir=source.download_root)

    tqdm_class = create_hf_tqdm_class(download_progress_callback)
    return snapshot_download(source.model_ref, cache_dir=source.download_root, tqdm_class=tqdm_class)


def create_streaming_runtime(model: Any, model_id: str) -> StreamingAsrRuntime:
    if model_id != SENSEVOICE_SMALL_MODEL_ID:
        raise ValueError(f"未知 streaming ASR 模型: {model_id}")

    return StreamingAsrRuntime(
        model=model,
        model_id=model_id,
        chunk_ms=1200,
        accumulate_audio=True,
        pass_cache=True,
        pass_is_final=False,
        generate_options={
            "language": "auto",
            "use_itn": True,
            "ban_emo_unk": False,
            "batch_size_s": 60,
        },
        postprocess="rich_transcription",
    )


def build_streaming_asr_model(
    source: StreamingAsrModelSource,
    download_progress_callback: Callable[[DownloadProgress], None] | None = None,
) -> StreamingAsrRuntime:
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if source.kind != DOWNLOAD_SOURCE:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    ensure_funasr_repo_import_path()
    from funasr import AutoModel

    device = resolve_funasr_device()
    model_ref = resolve_model_ref_for_build(source, download_progress_callback)
    print(f"[ASR] 从 {source.kind} 加载 {source.model_id}: {model_ref}，设备: {device}")
    model = AutoModel(
        model=model_ref,
        hub="hf",
        device=device,
        disable_update=True,
        **get_auto_model_kwargs(source.model_id),
    )
    return create_streaming_runtime(model, source.model_id)


def _load_streaming_asr_model(download_progress_callback: Callable[[DownloadProgress], None] | None = None):
    selected_model_id = get_active_asr_model_id()
    errors: list[str] = []
    for source in get_candidate_streaming_model_sources(selected_model_id):
        try:
            model = build_streaming_asr_model(source, download_progress_callback)
            print(f"[ASR] {selected_model_id} 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            if source.kind == DOWNLOAD_SOURCE:
                errors.append(
                    f"{source.kind}: {source.model_ref} -> 下载或加载失败，目标目录: {source.download_root}: {error}"
                )
            else:
                errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError(f"{selected_model_id} 模型加载失败: " + " | ".join(errors))


def preload_asr_model(download_progress_callback: Callable[[DownloadProgress], None] | None = None):
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        if download_progress_callback:
            _model = _load_streaming_asr_model(download_progress_callback)
        else:
            _model = _load_streaming_asr_model()
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


def normalize_rich_transcription_text(text: str) -> str:
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        return str(rich_transcription_postprocess(text)).strip()
    except Exception:
        return re.sub(r"<\|[^|]+?\|>", "", text).strip()


def postprocess_asr_text(text: str, postprocess: str | None) -> str:
    if postprocess == "rich_transcription":
        return normalize_rich_transcription_text(text)
    return text


def generate_streaming_asr_chunk(
    runtime: StreamingAsrRuntime,
    pcm_bytes: bytes,
    cache: dict[str, Any],
    is_final: bool,
) -> str:
    audio = pcm16_bytes_to_float32(pcm_bytes)
    kwargs: dict[str, Any] = {"input": audio}
    if runtime.pass_cache:
        kwargs["cache"] = cache
    if runtime.pass_is_final:
        kwargs["is_final"] = is_final
    if runtime.chunk_size is not None:
        kwargs["chunk_size"] = runtime.chunk_size
    if runtime.encoder_chunk_look_back is not None:
        kwargs["encoder_chunk_look_back"] = runtime.encoder_chunk_look_back
    if runtime.decoder_chunk_look_back is not None:
        kwargs["decoder_chunk_look_back"] = runtime.decoder_chunk_look_back
    kwargs.update(runtime.generate_options)

    with runtime.lock:
        result = runtime.model.generate(**kwargs)
    return postprocess_asr_text(extract_funasr_text(result), runtime.postprocess)


class StreamingAsrSession:
    def __init__(
        self,
        runtime: StreamingAsrRuntime,
        sample_rate: int = 16000,
        chunk_ms: int | None = None,
    ) -> None:
        self.runtime = runtime
        self.sample_rate = sample_rate
        self.chunk_ms = runtime.chunk_ms if chunk_ms is None else chunk_ms
        self.cache: dict[str, Any] = {}
        self.pcm_buffer = bytearray()
        self.full_pcm = bytearray()
        self.chunk_bytes = max(1, int(self.sample_rate * self.chunk_ms / 1000) * 2)
        self.text_parts: list[str] = []
        self.has_audio = False

    def append_pcm16(self, chunk: bytes) -> list[StreamingAsrResult]:
        if not chunk:
            return []

        self.has_audio = True
        self.pcm_buffer.extend(chunk)
        if self.runtime.accumulate_audio:
            self.full_pcm.extend(chunk)
        results: list[StreamingAsrResult] = []

        while len(self.pcm_buffer) >= self.chunk_bytes:
            pcm_chunk = bytes(self.pcm_buffer[: self.chunk_bytes])
            del self.pcm_buffer[: self.chunk_bytes]
            results.append(self._generate(pcm_chunk, False))

        return results

    def finalize(self) -> StreamingAsrResult:
        if not self.has_audio and not self.pcm_buffer:
            return StreamingAsrResult(text="".join(self.text_parts))

        final_chunk = bytes(self.full_pcm if self.runtime.accumulate_audio else self.pcm_buffer)
        self.pcm_buffer.clear()
        return self._generate(final_chunk, True)

    def _generate(self, pcm_chunk: bytes, is_final: bool) -> StreamingAsrResult:
        source_pcm = bytes(self.full_pcm) if self.runtime.accumulate_audio else pcm_chunk
        text = generate_streaming_asr_chunk(self.runtime, source_pcm, self.cache, is_final)
        if self.runtime.accumulate_audio:
            if text:
                self.text_parts = [text]
            return StreamingAsrResult(text="".join(self.text_parts))

        if text:
            self.text_parts.append(text)
        return StreamingAsrResult(text="".join(self.text_parts))


def is_streaming_asr_model_loaded() -> bool:
    return isinstance(_model, StreamingAsrRuntime)


def create_streaming_asr_session(sample_rate: int = 16000) -> StreamingAsrSession:
    model = _get_model()
    if not isinstance(model, StreamingAsrRuntime):
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
