"""ASR 模块 - 唯一使用 faster-whisper 进行语音转文字"""

import asyncio
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from runtime_config import load_server_env
from model_manager import (
    DEFAULT_MODEL_ID,
    find_cached_model_snapshot,
    get_managed_whisper_cache_root,
    get_runtime_model_id,
    normalize_model_id,
    write_selected_model_id,
)

load_server_env()

DEFAULT_WHISPER_MODEL = DEFAULT_MODEL_ID
DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"
REQUIRED_MODEL_FILES = ("model.bin", "config.json")


@dataclass(frozen=True)
class WhisperModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = DEFAULT_WHISPER_MODEL


_model = None
_model_lock = threading.Lock()


def get_whisper_model_name() -> str:
    return normalize_model_id(get_runtime_model_id())


def get_hf_cache_root() -> Path:
    user_profile = Path(os.getenv("USERPROFILE") or Path.home())
    return user_profile / ".cache" / "huggingface" / "hub"


def is_valid_whisper_model_dir(path: Path) -> bool:
    return path.is_dir() and all((path / name).exists() for name in REQUIRED_MODEL_FILES)


def get_candidate_whisper_model_sources(model_id: str | None = None) -> list[WhisperModelSource]:
    selected_model_id = normalize_model_id(model_id) if model_id is not None else get_whisper_model_name()

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


def resolve_whisper_model_source() -> WhisperModelSource:
    return get_candidate_whisper_model_sources()[0]


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


def _load_whisper_model(model_id: str | None = None):
    errors: list[str] = []
    for source in get_candidate_whisper_model_sources(model_id):
        try:
            model = build_whisper_model(source)
            print(f"[ASR] 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            if source.kind == DOWNLOAD_SOURCE:
                errors.append(
                    f"{source.kind}: {source.model_ref} -> 下载或加载失败，目标目录: {source.download_root}: {error}"
                )
            else:
                errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError("faster-whisper 模型加载失败: " + " | ".join(errors))


def preload_whisper_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        _model = _load_whisper_model()
        return _model


def reload_whisper_model(model_id: str):
    global _model
    if os.getenv("WHISPER_MODEL_DIR", "").strip():
        raise RuntimeError("WHISPER_MODEL_DIR 已设置，不能通过 reload_whisper_model 切换模型")

    normalized_model_id = normalize_model_id(model_id)

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
    """加载 Whisper 模型单例。"""
    return preload_whisper_model()


async def transcribe_audio(audio_path: str, language: str | None = None) -> str:
    """转写音频文件为文本

    Args:
        audio_path: 音频文件路径（支持 wav, ogg, mp3 等）
        language: 指定语言代码（如 "zh", "en"），None 则自动检测

    Returns:
        转写后的文本
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_path, language)


def _transcribe_sync(audio_path: str, language: str | None = None) -> str:
    """同步转写（在线程池中执行）"""
    model = _get_model()

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
