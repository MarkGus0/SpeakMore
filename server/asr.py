"""ASR 模块 - 按模型定义分发到 faster-whisper 或 FunASR。"""

import asyncio
import importlib.util
import os
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from runtime_config import load_server_env
from model_manager import (
    FALLBACK_MODEL_ID,
    FUNASR_NANO_MODEL_ID,
    FUNASR_REQUIRED_MODEL_FILES,
    PARAFORMER_STREAMING_MODEL_ID,
    PARAFORMER_STREAMING_REQUIRED_MODEL_FILES,
    WHISPER_REQUIRED_MODEL_FILES,
    find_cached_model_snapshot,
    get_hf_cache_root as get_model_hf_cache_root,
    get_managed_model_cache_root,
    get_managed_whisper_cache_root,
    get_model_definition,
    get_runtime_model_id,
    normalize_model_id,
    normalize_whisper_model_id,
    write_selected_model_id,
)

load_server_env()

DEFAULT_WHISPER_MODEL = FALLBACK_MODEL_ID
DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"
DEFAULT_FUNASR_REPO_DIR = Path("D:/CodeWorkSpace/FunASR")


@dataclass(frozen=True)
class WhisperModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = DEFAULT_WHISPER_MODEL


@dataclass(frozen=True)
class FunAsrModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = FUNASR_NANO_MODEL_ID


@dataclass(frozen=True)
class ParaformerStreamingModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = PARAFORMER_STREAMING_MODEL_ID


@dataclass
class FunAsrRuntime:
    model: Any
    kwargs: dict[str, Any]
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)


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


_model = None
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


def get_whisper_model_name() -> str:
    configured_model = os.environ.get("WHISPER_MODEL", "").strip()
    if configured_model:
        return normalize_whisper_model_id(configured_model)

    try:
        model = get_model_definition(get_runtime_model_id())
    except ValueError:
        return DEFAULT_WHISPER_MODEL

    if model["engine"] == "faster-whisper":
        return normalize_whisper_model_id(model["id"])
    return DEFAULT_WHISPER_MODEL


def is_valid_model_dir(path: Path, required_files: tuple[str, ...]) -> bool:
    return path.is_dir() and all((path / name).exists() for name in required_files)


def is_valid_whisper_model_dir(path: Path) -> bool:
    return is_valid_model_dir(path, WHISPER_REQUIRED_MODEL_FILES)


def is_valid_funasr_model_dir(path: Path) -> bool:
    return is_valid_model_dir(path, FUNASR_REQUIRED_MODEL_FILES)


def is_valid_paraformer_streaming_model_dir(path: Path) -> bool:
    return is_valid_model_dir(path, PARAFORMER_STREAMING_REQUIRED_MODEL_FILES)


def get_candidate_whisper_model_sources(model_id: str | None = None) -> list[WhisperModelSource]:
    selected_model_id = normalize_whisper_model_id(model_id) if model_id is not None else get_whisper_model_name()

    configured_dir = os.getenv("WHISPER_MODEL_DIR", "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_whisper_model_dir(explicit_dir):
            raise ValueError(
                "WHISPER_MODEL_DIR 必须指向包含 model.bin 和 config.json 的 faster-whisper 模型目录"
            )
        return [
            WhisperModelSource(
                kind=DIR_SOURCE,
                model_ref=str(explicit_dir),
                model_id=selected_model_id,
            )
        ]

    sources: list[WhisperModelSource] = []
    managed_root = get_managed_whisper_cache_root()
    managed_snapshot = find_cached_model_snapshot(selected_model_id)
    if managed_snapshot:
        sources.append(
            WhisperModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                model_id=selected_model_id,
            )
        )

    hf_snapshot = find_cached_model_snapshot(selected_model_id, cache_root=get_hf_cache_root())
    if hf_snapshot:
        sources.append(
            WhisperModelSource(
                kind=HF_CACHE_SOURCE,
                model_ref=str(hf_snapshot),
                model_id=selected_model_id,
            )
        )

    sources.append(
        WhisperModelSource(
            kind=DOWNLOAD_SOURCE,
            model_ref=selected_model_id,
            download_root=str(managed_root),
            model_id=selected_model_id,
        )
    )
    return sources


def get_candidate_funasr_model_sources(model_id: str | None = None) -> list[FunAsrModelSource]:
    selected_model_id = normalize_model_id(model_id or FUNASR_NANO_MODEL_ID)
    if selected_model_id != FUNASR_NANO_MODEL_ID:
        raise ValueError(f"未知 FunASR 模型: {selected_model_id}")

    configured_dir = os.getenv("FUNASR_NANO_MODEL_DIR", "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_funasr_model_dir(explicit_dir):
            raise ValueError("FUNASR_NANO_MODEL_DIR 指向的 FunASR 模型权重不完整")
        return [
            FunAsrModelSource(
                kind=DIR_SOURCE,
                model_ref=str(explicit_dir),
                model_id=selected_model_id,
            )
        ]

    sources: list[FunAsrModelSource] = []
    managed_root = get_managed_model_cache_root(selected_model_id)
    managed_snapshot = find_cached_model_snapshot(selected_model_id)
    if managed_snapshot:
        sources.append(
            FunAsrModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                model_id=selected_model_id,
            )
        )

    hf_snapshot = find_cached_model_snapshot(selected_model_id, cache_root=get_hf_cache_root())
    if hf_snapshot:
        sources.append(
            FunAsrModelSource(
                kind=HF_CACHE_SOURCE,
                model_ref=str(hf_snapshot),
                model_id=selected_model_id,
            )
        )

    sources.append(
        FunAsrModelSource(
            kind=DOWNLOAD_SOURCE,
            model_ref=get_model_definition(selected_model_id)["repoId"],
            download_root=str(managed_root),
            model_id=selected_model_id,
        )
    )
    return sources


def get_candidate_paraformer_streaming_model_sources(
    model_id: str | None = None,
) -> list[ParaformerStreamingModelSource]:
    selected_model_id = normalize_model_id(model_id or PARAFORMER_STREAMING_MODEL_ID)
    if selected_model_id != PARAFORMER_STREAMING_MODEL_ID:
        raise ValueError(f"未知 Paraformer streaming 模型: {selected_model_id}")

    configured_dir = os.getenv("PARAFORMER_STREAMING_MODEL_DIR", "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_paraformer_streaming_model_dir(explicit_dir):
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
            model_ref=get_model_definition(selected_model_id)["repoId"],
            download_root=str(managed_root),
            model_id=selected_model_id,
        )
    )
    return sources


def resolve_whisper_model_source() -> WhisperModelSource:
    return get_candidate_whisper_model_sources()[0]


def resolve_funasr_model_source() -> FunAsrModelSource:
    return get_candidate_funasr_model_sources()[0]


def resolve_paraformer_streaming_model_source() -> ParaformerStreamingModelSource:
    return get_candidate_paraformer_streaming_model_sources()[0]


def build_whisper_model(source: WhisperModelSource):
    from faster_whisper import WhisperModel

    load_kwargs = {"device": "cpu", "compute_type": "int8"}

    if source.kind == DOWNLOAD_SOURCE:
        print(f"[ASR] 未命中本地 faster-whisper {source.model_id}，首次下载到: {source.download_root}")
        return WhisperModel(
            source.model_ref,
            download_root=source.download_root,
            **load_kwargs,
        )

    print(f"[ASR] 从 {source.kind} 加载 faster-whisper {source.model_id}: {source.model_ref}")
    return WhisperModel(source.model_ref, **load_kwargs)


def resolve_funasr_repo_dir() -> Path | None:
    configured_repo = os.environ.get("FUNASR_REPO_DIR", "").strip()
    candidates = [Path(configured_repo)] if configured_repo else []
    candidates.append(DEFAULT_FUNASR_REPO_DIR)

    for candidate in candidates:
        if (candidate / "funasr").is_dir():
            return candidate
    return None


def resolve_funasr_code_dir() -> Path:
    configured_code_dir = os.environ.get("FUNASR_NANO_CODE_DIR", "").strip()
    if configured_code_dir:
        code_dir = Path(configured_code_dir).expanduser()
        if (code_dir / "model.py").is_file():
            return code_dir
        raise RuntimeError(f"FUNASR_NANO_CODE_DIR 缺少 model.py: {code_dir}")

    repo_dir = resolve_funasr_repo_dir()
    if repo_dir:
        code_dir = repo_dir / "examples" / "industrial_data_pretraining" / "fun_asr_nano"
        if (code_dir / "model.py").is_file():
            return code_dir

    raise RuntimeError("找不到 FunASR Nano 本地代码，请设置 FUNASR_REPO_DIR 或 FUNASR_NANO_CODE_DIR")


def ensure_funasr_import_paths(code_dir: Path) -> None:
    repo_dir = resolve_funasr_repo_dir()
    for path in [repo_dir, code_dir]:
        if path and str(path) not in sys.path:
            sys.path.insert(0, str(path))


def ensure_funasr_repo_import_path() -> None:
    repo_dir = resolve_funasr_repo_dir()
    if repo_dir and str(repo_dir) not in sys.path:
        sys.path.insert(0, str(repo_dir))


def load_funasr_nano_class():
    code_dir = resolve_funasr_code_dir()
    ensure_funasr_import_paths(code_dir)
    module_name = "typeless_funasr_nano_model"
    module_path = code_dir / "model.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 FunASR Nano 模型代码: {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module.FunASRNano


def build_funasr_model(source: FunAsrModelSource) -> FunAsrRuntime:
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if source.kind != DOWNLOAD_SOURCE:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    FunASRNano = load_funasr_nano_class()
    device = resolve_funasr_device()
    print(f"[ASR] 从 {source.kind} 加载 FunASR {source.model_id}: {source.model_ref}，设备: {device}")
    model, kwargs = FunASRNano.from_pretrained(model=source.model_ref, device=device)
    model.eval()
    return FunAsrRuntime(model=model, kwargs=dict(kwargs))


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


def _load_whisper_model(model_id: str | None = None):
    errors: list[str] = []
    for source in get_candidate_whisper_model_sources(model_id):
        try:
            model = build_whisper_model(source)
            print(f"[ASR] faster-whisper 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            if source.kind == DOWNLOAD_SOURCE:
                errors.append(
                    f"{source.kind}: {source.model_ref} -> 下载或加载失败，目标目录: {source.download_root}: {error}"
                )
            else:
                errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError("faster-whisper 模型加载失败: " + " | ".join(errors))


def _load_funasr_model(model_id: str | None = None):
    errors: list[str] = []
    for source in get_candidate_funasr_model_sources(model_id):
        try:
            model = build_funasr_model(source)
            print(f"[ASR] FunASR 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError("FunASR 模型加载失败: " + " | ".join(errors))


def _load_paraformer_streaming_model(model_id: str | None = None):
    errors: list[str] = []
    for source in get_candidate_paraformer_streaming_model_sources(model_id):
        try:
            model = build_paraformer_streaming_model(source)
            print(f"[ASR] Paraformer streaming 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError("Paraformer streaming 模型加载失败: " + " | ".join(errors))


def _resolve_runtime_model_id(model_id: str | None = None) -> str:
    if os.getenv("WHISPER_MODEL_DIR", "").strip() and model_id is None:
        return get_whisper_model_name()
    return normalize_model_id(model_id) if model_id is not None else normalize_model_id(get_runtime_model_id())


def _load_asr_model(model_id: str | None = None):
    normalized_model_id = _resolve_runtime_model_id(model_id)
    model_definition = get_model_definition(normalized_model_id)
    if model_definition["engine"] == "funasr":
        return _load_funasr_model(normalized_model_id)
    if model_definition["engine"] == "funasr-streaming":
        return _load_paraformer_streaming_model(normalized_model_id)
    return _load_whisper_model(normalized_model_id)


def preload_asr_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        _model = _load_asr_model()
        return _model


def preload_whisper_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        _model = _load_whisper_model()
        return _model


def reload_asr_model(model_id: str):
    global _model
    if os.getenv("WHISPER_MODEL_DIR", "").strip():
        raise RuntimeError("WHISPER_MODEL_DIR 已设置，不能通过 reload_asr_model 切换模型")

    normalized_model_id = normalize_model_id(model_id)

    with _model_lock:
        previous_model = _model

        try:
            loaded_model = _load_asr_model(normalized_model_id)
            write_selected_model_id(normalized_model_id)
            _model = loaded_model
            return _model
        except Exception:
            _model = previous_model
            raise


def reload_whisper_model(model_id: str):
    global _model
    if os.getenv("WHISPER_MODEL_DIR", "").strip():
        raise RuntimeError("WHISPER_MODEL_DIR 已设置，不能通过 reload_whisper_model 切换模型")

    normalized_model_id = normalize_whisper_model_id(model_id)

    with _model_lock:
        previous_model = _model

        try:
            loaded_model = _load_whisper_model(normalized_model_id)
            write_selected_model_id(normalized_model_id)
            _model = loaded_model
            return _model
        except Exception:
            _model = previous_model
            raise


def _get_model():
    return preload_asr_model()


def extract_funasr_text(result: Any) -> str:
    item = result
    if isinstance(item, tuple) and item:
        item = item[0]
    while isinstance(item, list) and item:
        item = item[0]
    if isinstance(item, dict):
        return str(item.get("text", "")).strip()
    return str(item or "").strip()


def transcribe_funasr_audio(runtime: FunAsrRuntime, audio_path: str) -> str:
    kwargs = dict(runtime.kwargs)
    kwargs["language"] = os.environ.get("FUNASR_LANGUAGE", "").strip() or kwargs.get("language") or "中文"
    with runtime.lock:
        result = runtime.model.inference(data_in=[audio_path], **kwargs)
    return extract_funasr_text(result)


def pcm16_bytes_to_float32(pcm_bytes: bytes):
    import numpy as np

    if len(pcm_bytes) % 2 == 1:
        pcm_bytes = pcm_bytes[:-1]
    if not pcm_bytes:
        return np.asarray([], dtype="float32")
    return np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0


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


async def transcribe_audio(audio_path: str, language: str | None = None) -> str:
    """转写音频文件为文本。"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_path, language)


def _transcribe_sync(audio_path: str, language: str | None = None) -> str:
    model = _get_model()

    if isinstance(model, FunAsrRuntime):
        return transcribe_funasr_audio(model, audio_path)
    if isinstance(model, ParaformerStreamingRuntime):
        raise RuntimeError("当前模型仅支持 WebSocket PCM 流式转写")

    segments, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    text_parts = []
    for segment in segments:
        text_parts.append(segment.text.strip())

    return " ".join(text_parts)
