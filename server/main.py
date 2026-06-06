"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import asyncio
import inspect
import json
import os
import re
import tempfile
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager, suppress
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from asr import (
    DOWNLOAD_SOURCE,
    create_streaming_asr_session,
    get_asr_runtime_device_status,
    preload_asr_model,
    resolve_streaming_model_source,
    transcribe_audio,
)
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    SENSEVOICE_SMALL_REPO_ID,
    configure_model_cache_dir,
    find_cached_model_snapshot,
    get_managed_model_cache_root,
)
from refiner import refine_text, reload_refiner_runtime_config, resolve_translation_target_language_id
from runtime_config import (
    get_cors_allowed_origins,
    get_server_host,
    get_server_port,
    load_server_env,
)

load_server_env()

MAX_UPLOAD_AUDIO_BYTES = 1024 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
SUPPORTED_UPLOAD_AUDIO_SUFFIXES = {
    ".m4a",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".flac",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".opus",
}

MODEL_MISSING_DETAIL = "还没有下载语音模型，请先下载模型。"
MODEL_CACHED_IDLE_DETAIL = "语音模型已下载，尚未加载，请加载模型后使用。"


def should_enable_reload() -> bool:
    return os.getenv("UVICORN_RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}


def detect_uploaded_audio_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if not suffix:
        return ".wav"
    if suffix in SUPPORTED_UPLOAD_AUDIO_SUFFIXES:
        return suffix
    return ""


def detect_realtime_audio_suffix(audio_data: bytes) -> str:
    if audio_data[:4] == b"OggS":
        return ".ogg"
    if audio_data[:4] == b"RIFF":
        return ".wav"
    if audio_data[:4] == bytes.fromhex("1A45DFA3"):
        return ".webm"
    return ".webm"


async def transcribe_audio_with_wav_conversion(source_path: str, suffix: str) -> str:
    del suffix
    return await transcribe_audio(source_path)


async def save_upload_to_temp_file(audio_file: UploadFile, suffix: str) -> str:
    if not suffix:
        raise HTTPException(status_code=415, detail="Unsupported media file format")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    total_bytes = 0

    try:
        while True:
            chunk = await audio_file.read(UPLOAD_CHUNK_BYTES)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Uploaded media file exceeds 1 GB")
            tmp.write(chunk)
        return tmp_path
    except Exception:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
    finally:
        tmp.close()


def create_ws_message(message_type: str, payload: dict | None = None) -> dict:
    return {"K": message_type, "V": payload or {}}


async def send_ws_message(websocket: WebSocket, message_type: str, payload: dict | None = None) -> None:
    await websocket.send_json(create_ws_message(message_type, payload))


async def send_ws_error_message(
    websocket: WebSocket,
    message_type: str,
    audio_id: str,
    detail: str,
    code: str,
) -> None:
    await send_ws_message(
        websocket,
        message_type,
        {
            "audio_id": audio_id,
            "detail": detail,
            "code": code,
        },
    )


def create_process_mode_payload(audio_id: str, mode: str, parameters: dict | None = None) -> dict:
    payload = {"audio_id": audio_id, "mode": mode}
    if parameters is not None:
        payload["parameters"] = parameters
    return payload


def normalize_audio_context_update(payload: dict) -> dict:
    candidate = payload.get("audio_context", payload.get("context", {}))
    return candidate if isinstance(candidate, dict) else {}


def normalize_mode_update(payload: dict, current_mode: str) -> str:
    explicit_mode = payload.get("mode")
    if isinstance(explicit_mode, str) and explicit_mode:
        return explicit_mode

    mode_config = payload.get("mode_config")
    if isinstance(mode_config, dict):
        nested_mode = mode_config.get("mode")
        if isinstance(nested_mode, str) and nested_mode:
            return nested_mode

    return current_mode


def normalize_selected_text(payload: dict) -> str:
    for key in ("selected_text", "text", "value"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return ""


def normalize_ws_object(value) -> dict:
    return value if isinstance(value, dict) else {}


def merge_ws_end_audio_parameters(current_parameters: dict, payload: dict) -> dict:
    next_parameters = normalize_ws_object(payload.get("parameters", {}))
    if not next_parameters:
        return current_parameters
    return {**current_parameters, **next_parameters}


def get_pcm_streaming_sample_rate(parameters: dict) -> int:
    audio_format = parameters.get("audio_format")
    if not isinstance(audio_format, dict):
        return 0
    if audio_format.get("type") != "pcm_s16le":
        return 0
    try:
        sample_rate = int(audio_format.get("sample_rate") or 16000)
        channels = int(audio_format.get("channels") or 1)
    except (TypeError, ValueError):
        return 0
    if channels != 1 or sample_rate <= 0:
        return 0
    return sample_rate


def normalize_ws_text_message(raw_text: str) -> tuple[dict | None, dict | None]:
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as error:
        return None, {"code": "invalid_json", "detail": str(error)}

    if not isinstance(data, dict):
        return None, {"code": "invalid_message", "detail": "WebSocket 消息必须是 JSON 对象"}

    return data, None


def normalize_json_object_field(raw_value: str | None) -> dict:
    if not raw_value:
        return {}

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}

    return parsed if isinstance(parsed, dict) else {}


def get_ws_completion_message_type(mode: str, parameters: dict) -> str:
    if parameters.get("selected_text"):
        return "refine_selected_text"
    if mode != "transcript":
        return "refine_completed"
    return "audio_processing_completed"


def get_ws_refine_error_message_type(mode: str, parameters: dict) -> str:
    if parameters.get("selected_text"):
        return "refine_selected_text_error"
    if mode != "transcript":
        return "refine_error"
    return "audio_processing_error"


def schedule_startup_failure_exit(exit_code: int = 1) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        os._exit(exit_code)
        return

    loop.call_later(0.1, os._exit, exit_code)


def get_model_cache_dir() -> str:
    return str(get_managed_model_cache_root(SENSEVOICE_SMALL_MODEL_ID))


def apply_model_cache_dir(cache_dir: str | None) -> str:
    return str(configure_model_cache_dir(cache_dir))


async def read_model_cache_dir_from_request(request: Request) -> str:
    try:
        payload = await request.json()
    except Exception:
        return ""
    if not isinstance(payload, dict):
        return ""
    value = payload.get("cache_dir")
    return value.strip() if isinstance(value, str) else ""


def is_sensevoice_cached() -> bool:
    return find_cached_model_snapshot(SENSEVOICE_SMALL_MODEL_ID) is not None


def normalize_download_progress(progress: dict | None = None) -> dict[str, int | None]:
    downloaded = progress.get("downloaded_bytes") if isinstance(progress, dict) else None
    total = progress.get("total_bytes") if isinstance(progress, dict) else None
    percent = progress.get("progress_percent") if isinstance(progress, dict) else None
    downloaded_files = progress.get("downloaded_files") if isinstance(progress, dict) else None
    total_files = progress.get("total_files") if isinstance(progress, dict) else None
    file_percent = progress.get("file_progress_percent") if isinstance(progress, dict) else None
    downloaded_bytes = max(0, int(downloaded)) if isinstance(downloaded, (int, float)) else 0
    total_bytes = max(0, int(total)) if isinstance(total, (int, float)) else 0
    progress_percent = int(percent) if isinstance(percent, (int, float)) else None
    downloaded_file_count = max(0, int(downloaded_files)) if isinstance(downloaded_files, (int, float)) else 0
    total_file_count = max(0, int(total_files)) if isinstance(total_files, (int, float)) else 0
    file_progress_percent = int(file_percent) if isinstance(file_percent, (int, float)) else None
    if progress_percent is not None:
        progress_percent = max(0, min(100, progress_percent))
    if file_progress_percent is not None:
        file_progress_percent = max(0, min(100, file_progress_percent))
    return {
        "downloaded_bytes": downloaded_bytes,
        "total_bytes": total_bytes,
        "progress_percent": progress_percent,
        "downloaded_files": downloaded_file_count,
        "total_files": total_file_count,
        "file_progress_percent": file_progress_percent,
    }


def create_voice_service_state(
    status: str,
    detail: str = "",
    started_at: float | None = None,
    download_progress: dict | None = None,
) -> dict[str, str | int | bool | None]:
    now = time.time()
    device_status = get_asr_runtime_device_status()
    cached = is_sensevoice_cached()
    normalized_detail = detail
    if status == "idle" and (not detail or detail == MODEL_MISSING_DETAIL):
        normalized_detail = MODEL_CACHED_IDLE_DETAIL if cached else MODEL_MISSING_DETAIL
    return {
        "status": status,
        "detail": normalized_detail,
        "model_id": SENSEVOICE_SMALL_MODEL_ID,
        "repo_id": SENSEVOICE_SMALL_REPO_ID,
        "device": device_status.get("device"),
        "requested_device": device_status.get("requested_device"),
        "device_source": device_status.get("device_source"),
        "fallback_reason": device_status.get("fallback_reason"),
        "cache_dir": get_model_cache_dir(),
        "cached": cached,
        "ready": status == "ready",
        "started_at": started_at,
        "updated_at": now,
        "elapsed_ms": int((now - started_at) * 1000) if started_at else 0,
        **normalize_download_progress(download_progress),
    }


def set_voice_service_state(app: FastAPI, status: str, detail: str = "", started_at: float | None = None) -> None:
    current = getattr(app.state, "voice_service_status", None)
    if started_at is None and isinstance(current, dict) and status in {"downloading", "loading"}:
        current_started_at = current.get("started_at")
        started_at = current_started_at if isinstance(current_started_at, float) else time.time()
    app.state.voice_service_status = create_voice_service_state(status, detail, started_at)


def update_voice_service_download_progress(app: FastAPI, progress: dict) -> None:
    current = getattr(app.state, "voice_service_status", None)
    if not isinstance(current, dict):
        return
    app.state.voice_service_status = {
        **current,
        **normalize_download_progress(progress),
        "updated_at": time.time(),
    }


def preload_model_accepts_progress_callback(preload_model) -> bool:
    try:
        signature = inspect.signature(preload_model)
    except (TypeError, ValueError):
        return True
    return any(
        parameter.kind in {
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.VAR_KEYWORD,
        }
        for parameter in signature.parameters.values()
    )


def call_preload_model(preload_model, progress_callback):
    if preload_model_accepts_progress_callback(preload_model):
        return preload_model(progress_callback)
    return preload_model()


def get_voice_service_state(app: FastAPI) -> dict:
    current = getattr(app.state, "voice_service_status", None)
    if not isinstance(current, dict):
        return create_voice_service_state("idle", MODEL_MISSING_DETAIL)

    current = {
        **current,
        **get_asr_runtime_device_status(),
        "cache_dir": get_model_cache_dir(),
        "cached": is_sensevoice_cached(),
        "ready": current.get("status") == "ready",
    }
    started_at = current.get("started_at")
    if isinstance(started_at, (float, int)):
        current = {
            **current,
            "elapsed_ms": int((time.time() - float(started_at)) * 1000),
        }
    return current


def is_voice_service_ready(app: FastAPI) -> bool:
    return get_voice_service_state(app)["status"] == "ready"


def require_voice_service_ready(request: Request) -> None:
    if not is_voice_service_ready(request.app):
        raise HTTPException(status_code=503, detail="语音后端尚未就绪")


def get_voice_model_status(app: FastAPI) -> dict:
    return get_voice_service_state(app)


def is_voice_model_task_running(app: FastAPI) -> bool:
    task = getattr(app.state, "voice_preload_task", None)
    return bool(task and not task.done())


async def preload_voice_service(
    app: FastAPI,
    preload_model,
    exit_scheduler,
    exit_on_failure: bool = False,
) -> None:
    started_at = time.time()
    try:
        source = resolve_streaming_model_source()
        if source.kind == DOWNLOAD_SOURCE:
            set_voice_service_state(app, "downloading", "正在下载 SenseVoiceSmall 模型", started_at)
        else:
            set_voice_service_state(app, "loading", "正在加载 SenseVoiceSmall 模型", started_at)

        await asyncio.to_thread(
            call_preload_model,
            preload_model,
            lambda progress: update_voice_service_download_progress(app, progress),
        )
        set_voice_service_state(app, "ready", "ASR 模型已完成预热")
    except Exception as error:
        set_voice_service_state(app, "failed", str(error))
        if exit_on_failure:
            exit_scheduler(1)


def start_voice_model_task(app: FastAPI, preload_model, exit_scheduler, exit_on_failure: bool = False) -> None:
    if is_voice_service_ready(app) or is_voice_model_task_running(app):
        return

    set_voice_service_state(app, "loading", "正在准备 SenseVoiceSmall 模型", time.time())
    app.state.voice_preload_task = asyncio.create_task(
        preload_voice_service(app, preload_model, exit_scheduler, exit_on_failure=exit_on_failure),
    )


def create_flow_success_payload(refined_text: str, raw_text: str = "", extra_data: dict | None = None) -> dict:
    data = {
        "refine_text": refined_text,
        "delivery": "inline",
        "user_prompt": raw_text,
        "web_metadata": None,
        "external_action": None,
    }
    if isinstance(extra_data, dict):
        data.update(extra_data)
    return {
        "status": "OK",
        "data": data,
    }


def create_flow_error_payload(detail: str, code: str, raw_text: str = "") -> dict:
    return {
        "status": "ERROR",
        "data": {
            "refine_text": f"错误: {detail}",
            "delivery": "inline",
            "user_prompt": raw_text,
            "detail": detail,
            "code": code,
            "important_notification": None,
        },
    }


def get_meeting_translation_target(parameters: dict | None) -> str:
    if not isinstance(parameters, dict):
        return ""
    candidate = (
        parameters.get("meeting_translation_target_language")
        or parameters.get("target_language")
        or parameters.get("output_language")
        or ""
    )
    normalized = str(candidate or "").strip().lower()
    if normalized in ("", "off", "none", "null", "false", "关闭"):
        return ""
    return resolve_translation_target_language_id(candidate)


MEETING_REALTIME_TRANSLATION_MIN_CJK_CHARS = 10
MEETING_REALTIME_TRANSLATION_MIN_OTHER_CHARS = 18
MEETING_REALTIME_TRANSLATION_SHORT_CJK_CHARS = 4
MEETING_REALTIME_TRANSLATION_SHORT_OTHER_CHARS = 8
MEETING_REALTIME_TRANSLATION_IMMEDIATE_CJK_CHARS = 8
MEETING_REALTIME_TRANSLATION_IMMEDIATE_OTHER_CHARS = 14
MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS = 1.15
MEETING_REALTIME_TRANSLATION_SHORT_WAIT_SECONDS = 1.8
MEETING_REALTIME_TRANSLATION_MAX_CONCURRENCY = 2
MEETING_REALTIME_TRANSLATION_ENDINGS = tuple(".!?\n\u3002\uff01\uff1f")
MEETING_REALTIME_LEADING_SEPARATOR_RE = re.compile(r"^[\s,，、。.!?！？;；:：]+")
MEETING_REALTIME_FILLER_ONLY = {
    "\u55ef",
    "\u5443",
    "\u554a",
    "\u54e6",
    "\u989d",
    "\u5450",
    "um",
    "uh",
    "er",
    "ah",
    "oh",
    "hmm",
}


def is_meeting_realtime_emoji_char(char: str) -> bool:
    code = ord(char)
    if 0xFE00 <= code <= 0xFE0F:
        return True
    if 0x1F000 <= code <= 0x1FAFF:
        return True
    if 0x2600 <= code <= 0x27BF:
        return True
    if 0x2300 <= code <= 0x23FF:
        return True
    if 0x2B00 <= code <= 0x2BFF:
        return True
    return False


def count_cjk_chars(value: str) -> int:
    return sum(1 for char in value if "\u4e00" <= char <= "\u9fff")


def normalize_meeting_realtime_source(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    chars = []
    for char in text:
        category = unicodedata.category(char)
        if category in {"Cc", "Cf", "Cs"}:
            continue
        if category == "So" or is_meeting_realtime_emoji_char(char):
            continue
        chars.append(char)
    text = "".join(chars)
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    text = re.sub(r"([.!?\u3002\uff01\uff1f,，、]){2,}", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    return text


def normalize_meeting_realtime_compare(value: str) -> str:
    text = normalize_meeting_realtime_source(value).lower()
    return "".join(char for char in text if char.isalnum())


def meeting_realtime_similarity(left: str, right: str) -> float:
    left_key = normalize_meeting_realtime_compare(left)
    right_key = normalize_meeting_realtime_compare(right)
    if not left_key or not right_key:
        return 0.0
    if left_key == right_key:
        return 1.0
    return SequenceMatcher(None, left_key, right_key).ratio()


def build_meeting_realtime_compare_map(value: str) -> tuple[str, list[int]]:
    compare_chars = []
    positions = []
    for index, char in enumerate(normalize_meeting_realtime_source(value).lower()):
        if char.isalnum():
            compare_chars.append(char)
            positions.append(index)
    return "".join(compare_chars), positions


def strip_meeting_realtime_leading_separators(value: str) -> str:
    return MEETING_REALTIME_LEADING_SEPARATOR_RE.sub("", value or "").strip()


def split_meeting_realtime_sentences(value: str) -> tuple[list[str], str]:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return [], ""

    completed: list[str] = []
    start = 0
    for index, char in enumerate(text):
        if char not in MEETING_REALTIME_TRANSLATION_ENDINGS:
            continue
        sentence = strip_meeting_realtime_leading_separators(text[start : index + 1])
        if sentence:
            completed.append(sentence)
        start = index + 1

    tail = strip_meeting_realtime_leading_separators(text[start:])
    return completed, tail


def join_meeting_realtime_parts(parts: list[str]) -> str:
    return normalize_meeting_realtime_source("".join(parts))


def get_meeting_realtime_lengths(value: str) -> tuple[int, int]:
    text = normalize_meeting_realtime_source(value)
    return count_cjk_chars(text), len(normalize_meeting_realtime_compare(text))


def is_tiny_meeting_realtime_fragment(value: str) -> bool:
    cjk_count, compare_length = get_meeting_realtime_lengths(value)
    if cjk_count > 0:
        return cjk_count <= 1
    return compare_length <= 2


def is_natural_meeting_realtime_sentence(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text or not has_meeting_realtime_sentence_ending(text):
        return False
    if is_tiny_meeting_realtime_fragment(text):
        return False
    cjk_count, compare_length = get_meeting_realtime_lengths(text)
    return (
        cjk_count >= MEETING_REALTIME_TRANSLATION_IMMEDIATE_CJK_CHARS
        or (cjk_count == 0 and compare_length >= MEETING_REALTIME_TRANSLATION_IMMEDIATE_OTHER_CHARS)
    )


def has_meeting_realtime_pause_commit_length(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return False
    if is_tiny_meeting_realtime_fragment(text):
        return False
    cjk_count, compare_length = get_meeting_realtime_lengths(text)
    if has_meeting_realtime_sentence_ending(text):
        if cjk_count >= MEETING_REALTIME_TRANSLATION_SHORT_CJK_CHARS:
            return True
        return cjk_count == 0 and compare_length >= MEETING_REALTIME_TRANSLATION_SHORT_OTHER_CHARS
    if cjk_count >= MEETING_REALTIME_TRANSLATION_MIN_CJK_CHARS:
        return True
    return cjk_count == 0 and compare_length >= MEETING_REALTIME_TRANSLATION_MIN_OTHER_CHARS


def get_meeting_realtime_pause_wait_seconds(value: str) -> float:
    text = normalize_meeting_realtime_source(value)
    if not has_meeting_realtime_pause_commit_length(text):
        return 0.0
    if is_natural_meeting_realtime_sentence(text):
        return MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS
    if has_meeting_realtime_sentence_ending(text):
        return MEETING_REALTIME_TRANSLATION_SHORT_WAIT_SECONDS
    return MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS


def find_meeting_realtime_boundary_after_committed(text: str, committed_compare_key: str) -> int | None:
    committed_key = str(committed_compare_key or "")
    if not committed_key:
        return 0

    compare_text, positions = build_meeting_realtime_compare_map(text)
    if not compare_text or not positions:
        return None

    if compare_text.startswith(committed_key):
        compare_boundary = len(committed_key)
    else:
        matcher = SequenceMatcher(None, committed_key, compare_text)
        matching_blocks = [block for block in matcher.get_matching_blocks() if block.size]
        matched_count = sum(block.size for block in matching_blocks)
        required_count = min(len(committed_key), max(3, int(len(committed_key) * 0.6)))
        first_block_start = matching_blocks[0].b if matching_blocks else len(compare_text)
        if matched_count < required_count or first_block_start > max(2, len(compare_text) // 4):
            return None
        compare_boundary = max(block.b + block.size for block in matching_blocks)

    if compare_boundary <= 0:
        return 0
    if compare_boundary > len(positions):
        return len(text)
    return min(len(text), positions[compare_boundary - 1] + 1)


def normalize_meeting_realtime_translation_output(value: str) -> str:
    return normalize_meeting_realtime_source(value)


def is_meaningless_meeting_realtime_segment(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    compare = normalize_meeting_realtime_compare(text)
    if not compare:
        return True
    if compare in MEETING_REALTIME_FILLER_ONLY:
        return True
    if len(compare) <= 2 and all(char in MEETING_REALTIME_FILLER_ONLY for char in compare):
        return True
    return False


def is_meeting_realtime_revision(candidate: str, previous: str) -> bool:
    candidate_key = normalize_meeting_realtime_compare(candidate)
    previous_key = normalize_meeting_realtime_compare(previous)
    if not candidate_key or not previous_key:
        return False
    if candidate_key.startswith(previous_key) or previous_key.startswith(candidate_key):
        return True
    shorter = min(len(candidate_key), len(previous_key))
    if shorter <= 4:
        return meeting_realtime_similarity(candidate_key, previous_key) >= 0.78
    return meeting_realtime_similarity(candidate_key, previous_key) >= 0.86


def has_meeting_realtime_sentence_ending(value: str) -> bool:
    return normalize_meeting_realtime_source(value).endswith(MEETING_REALTIME_TRANSLATION_ENDINGS)


def should_flush_meeting_translation_segment(segment: str, last_flush_at: float, now_value: float) -> bool:
    text = str(segment or "").strip()
    if not text:
        return False
    if text.endswith(MEETING_REALTIME_TRANSLATION_ENDINGS):
        return True
    cjk_count = count_cjk_chars(text)
    if cjk_count >= MEETING_REALTIME_TRANSLATION_MIN_CJK_CHARS:
        return True
    if cjk_count == 0 and len(text) >= MEETING_REALTIME_TRANSLATION_MIN_OTHER_CHARS:
        return True
    return now_value - last_flush_at >= MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS


async def translate_realtime_sentence(
    raw_text: str,
    target_language: str,
    context: dict,
    parameters: dict,
    previous_sentences: list[str],
) -> str:
    translation_parameters = {
        **parameters,
        "output_language": target_language,
        "realtime_sentence_translation": True,
        "realtime_context_sentences": previous_sentences[-2:],
    }
    translated = await refine_text(
        raw_text=raw_text,
        mode="translation",
        context=context,
        parameters=translation_parameters,
    )
    return normalize_meeting_realtime_translation_output(translated)


class MeetingRealtimeTranslator:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.audio_id = ""
        self.mode = "transcript"
        self.context: dict = {}
        self.parameters: dict = {}
        self.committed_compare_key = ""
        self.committed_sentences: list[str] = []
        self.committed_sentence_keys: list[str] = []
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_observed_at = 0.0
        self.pending_tail_wait_seconds = 0.0
        self.next_sentence_index = 1
        self.translation_queue: list[dict] = []
        self.active_tasks: set[asyncio.Task] = set()
        self.flush_timer_task: asyncio.Task | None = None
        self.closed = False

    def reset(self, audio_id: str, mode: str, context: dict, parameters: dict) -> None:
        self.cancel()
        self.audio_id = audio_id
        self.mode = mode
        self.context = context if isinstance(context, dict) else {}
        self.parameters = parameters if isinstance(parameters, dict) else {}
        self.committed_compare_key = ""
        self.committed_sentences = []
        self.committed_sentence_keys = []
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_observed_at = 0.0
        self.pending_tail_wait_seconds = 0.0
        self.next_sentence_index = 1
        self.translation_queue = []
        self.active_tasks = set()
        self.flush_timer_task = None
        self.closed = False

    def update_config(self, mode: str, parameters: dict) -> None:
        self.mode = mode
        self.parameters = parameters if isinstance(parameters, dict) else {}
        if not get_meeting_translation_target(self.parameters):
            self._clear_pending_work(cancel_active=True)

    def cancel(self) -> None:
        self.closed = True
        self._clear_pending_work(cancel_active=True)

    def _clear_pending_work(self, cancel_active: bool) -> None:
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_wait_seconds = 0.0
        self.translation_queue = []
        if cancel_active:
            for task in list(self.active_tasks):
                if not task.done():
                    task.cancel()
            self.active_tasks.clear()
        if self.flush_timer_task and not self.flush_timer_task.done() and self.flush_timer_task is not asyncio.current_task():
            self.flush_timer_task.cancel()
        self.flush_timer_task = None

    async def drain(self, timeout_seconds: float = 1.5) -> None:
        if self.closed:
            return

        await self._commit_pending_tail(force=True)
        self._start_next_translations()

        deadline = time.monotonic() + timeout_seconds
        while self.translation_queue or any(not task.done() for task in self.active_tasks):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            active = [task for task in self.active_tasks if not task.done()]
            if not active:
                self._start_next_translations()
                active = [task for task in self.active_tasks if not task.done()]
            if not active:
                return
            with suppress(asyncio.TimeoutError, asyncio.CancelledError, Exception):
                await asyncio.wait_for(asyncio.gather(*(asyncio.shield(task) for task in active)), timeout=remaining)

    async def observe_transcription(self, text: str, chunk_index: int) -> None:
        del chunk_index
        if self.closed or self.mode != "meeting_notes":
            return
        if not get_meeting_translation_target(self.parameters):
            return

        normalized_text = normalize_meeting_realtime_source(text)
        if not normalized_text or is_meaningless_meeting_realtime_segment(normalized_text):
            return

        suffix = self._extract_uncommitted_suffix(normalized_text)
        if not suffix:
            return

        completed_sentences, tail = split_meeting_realtime_sentences(suffix)
        buffered_parts: list[str] = []
        for sentence in completed_sentences:
            buffered_parts.append(sentence)
            candidate = join_meeting_realtime_parts(buffered_parts)
            if is_natural_meeting_realtime_sentence(candidate):
                await self._commit_sentence(candidate)
                buffered_parts = []

        pending_tail = join_meeting_realtime_parts([*buffered_parts, tail])
        self._set_pending_tail(pending_tail)
        await asyncio.sleep(0)

    def _extract_uncommitted_suffix(self, normalized_text: str) -> str:
        if not self.committed_compare_key:
            return normalized_text

        boundary = find_meeting_realtime_boundary_after_committed(normalized_text, self.committed_compare_key)
        if boundary is None:
            if self._is_already_committed(normalized_text):
                return ""
            return normalized_text

        suffix = strip_meeting_realtime_leading_separators(normalized_text[boundary:])
        return normalize_meeting_realtime_source(suffix)

    def _is_already_committed(self, candidate: str) -> bool:
        candidate_key = normalize_meeting_realtime_compare(candidate)
        if not candidate_key:
            return True
        for committed_key in self.committed_sentence_keys[-12:]:
            if candidate_key == committed_key:
                return True
            if len(candidate_key) <= len(committed_key) and (
                committed_key.startswith(candidate_key)
                or SequenceMatcher(None, candidate_key, committed_key).ratio() >= 0.88
            ):
                return True
        return False

    def _trim_committed_prefix_from_sentence(self, sentence: str) -> str:
        if not self.committed_compare_key:
            return sentence
        boundary = find_meeting_realtime_boundary_after_committed(sentence, self.committed_compare_key)
        if boundary is None or boundary <= 0:
            return sentence
        return normalize_meeting_realtime_source(strip_meeting_realtime_leading_separators(sentence[boundary:]))

    def _set_pending_tail(self, tail: str) -> None:
        normalized_tail = normalize_meeting_realtime_source(tail)
        if not normalized_tail or is_meaningless_meeting_realtime_segment(normalized_tail):
            self.pending_tail_text = ""
            self.pending_tail_compare_key = ""
            self.pending_tail_wait_seconds = 0.0
            self._cancel_flush_timer()
            return

        normalized_tail = self._trim_committed_prefix_from_sentence(normalized_tail)
        tail_key = normalize_meeting_realtime_compare(normalized_tail)
        if not tail_key or self._is_already_committed(normalized_tail):
            self.pending_tail_text = ""
            self.pending_tail_compare_key = ""
            self.pending_tail_wait_seconds = 0.0
            self._cancel_flush_timer()
            return

        if tail_key == self.pending_tail_compare_key:
            return

        self.pending_tail_text = normalized_tail
        self.pending_tail_compare_key = tail_key
        self.pending_tail_observed_at = time.monotonic()
        self.pending_tail_wait_seconds = get_meeting_realtime_pause_wait_seconds(normalized_tail)
        self._cancel_flush_timer()
        if self.pending_tail_wait_seconds > 0:
            self.flush_timer_task = asyncio.create_task(self._flush_pending_after_delay())

    def _cancel_flush_timer(self) -> None:
        if self.flush_timer_task and not self.flush_timer_task.done() and self.flush_timer_task is not asyncio.current_task():
            self.flush_timer_task.cancel()
        self.flush_timer_task = None

    async def _flush_pending_after_delay(self) -> None:
        try:
            wait_seconds = self.pending_tail_wait_seconds or MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS
            await asyncio.sleep(wait_seconds)
            if self.closed:
                return
            if time.monotonic() - self.pending_tail_observed_at >= wait_seconds:
                await self._commit_pending_tail(force=False)
        except asyncio.CancelledError:
            raise
        finally:
            if self.flush_timer_task is asyncio.current_task():
                self.flush_timer_task = None

    async def _commit_pending_tail(self, force: bool) -> None:
        tail = self.pending_tail_text
        if not tail:
            return
        if not force and not has_meeting_realtime_pause_commit_length(tail):
            return
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_wait_seconds = 0.0
        self._cancel_flush_timer()
        await self._commit_sentence(tail)

    async def _commit_sentence(self, sentence: str) -> None:
        normalized = normalize_meeting_realtime_source(strip_meeting_realtime_leading_separators(sentence))
        normalized = self._trim_committed_prefix_from_sentence(normalized)
        if not normalized or is_meaningless_meeting_realtime_segment(normalized):
            return
        if is_tiny_meeting_realtime_fragment(normalized):
            return
        if self._is_already_committed(normalized):
            return

        compare_key = normalize_meeting_realtime_compare(normalized)
        if not compare_key:
            return

        target_language = get_meeting_translation_target(self.parameters)
        if not target_language:
            return

        sentence_index = self.next_sentence_index
        self.next_sentence_index += 1
        previous_sentences = self.committed_sentences[-2:]
        self.committed_sentences.append(normalized)
        self.committed_sentence_keys.append(compare_key)
        self.committed_compare_key += compare_key

        await self._notify_pending_sentence(normalized, sentence_index)
        self.translation_queue.append({
            "segment": normalized,
            "target_language": target_language,
            "parameters": {**self.parameters},
            "context": dict(self.context),
            "sentence_index": sentence_index,
            "previous_sentences": previous_sentences,
        })
        self._start_next_translations()

    async def _notify_pending_sentence(self, segment: str, sentence_index: int) -> None:
        await send_ws_message(
            self.websocket,
            "meeting_translation_pending",
            {
                "audio_id": self.audio_id,
                "source_text": segment,
                "chunk_index": sentence_index,
                "sentence_index": sentence_index,
                "stable": False,
                "committed": True,
            },
        )

    def _start_next_translations(self) -> None:
        if self.closed:
            return
        while self.translation_queue and len([task for task in self.active_tasks if not task.done()]) < MEETING_REALTIME_TRANSLATION_MAX_CONCURRENCY:
            item = self.translation_queue.pop(0)
            task = asyncio.create_task(self._translate_sentence(**item))
            self.active_tasks.add(task)

    async def _translate_sentence(
        self,
        segment: str,
        target_language: str,
        parameters: dict,
        context: dict,
        sentence_index: int,
        previous_sentences: list[str],
    ) -> None:
        try:
            translation_text = await translate_realtime_sentence(
                raw_text=segment,
                target_language=target_language,
                context=context,
                parameters=parameters,
                previous_sentences=previous_sentences,
            )
            if self.closed or not translation_text:
                return
            await send_ws_message(
                self.websocket,
                "meeting_translation",
                {
                    "audio_id": self.audio_id,
                    "text": translation_text,
                    "source_text": segment,
                    "target_language": target_language,
                    "chunk_index": sentence_index,
                    "sentence_index": sentence_index,
                    "partial": True,
                    "stable": True,
                    "committed": True,
                },
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not self.closed:
                await send_ws_error_message(
                    self.websocket,
                    "meeting_translation_error",
                    self.audio_id,
                    str(error),
                    "meeting_translation_failed",
                )
        finally:
            current_task = asyncio.current_task()
            if current_task in self.active_tasks:
                self.active_tasks.discard(current_task)
            if not self.closed:
                self._start_next_translations()


async def refine_voice_flow_text(
    raw_text: str,
    mode: str,
    context: dict | None,
    parameters: dict | None,
) -> tuple[str, dict]:
    refined = await refine_text(
        raw_text=raw_text,
        mode=mode,
        context=context,
        parameters=parameters,
    )
    if mode != "meeting_notes":
        return refined, {}

    target_language = get_meeting_translation_target(parameters)
    if not target_language:
        return refined, {"translation_text": ""}

    translation_parameters = {
        **(parameters if isinstance(parameters, dict) else {}),
        "output_language": target_language,
    }
    translation_text = await refine_text(
        raw_text=raw_text,
        mode="translation",
        context=context,
        parameters=translation_parameters,
    )
    return refined, {"translation_text": translation_text}


async def handle_voice_flow_request(
    audio_file: UploadFile,
    mode: str,
    audio_context: str,
    parameters: str,
) -> dict:
    suffix = detect_uploaded_audio_suffix(audio_file.filename)
    tmp_path = await save_upload_to_temp_file(audio_file, suffix)

    try:
        context = normalize_json_object_field(audio_context)
        params = normalize_json_object_field(parameters)
        raw_text = await transcribe_audio_with_wav_conversion(tmp_path, suffix)

        if not raw_text or not raw_text.strip():
            return create_flow_success_payload(refined_text="", raw_text="")

        refined, extra_data = await refine_voice_flow_text(
            raw_text=raw_text,
            mode=mode,
            context=context,
            parameters=params,
        )

        return create_flow_success_payload(refined_text=refined, raw_text=raw_text, extra_data=extra_data)
    except HTTPException:
        raise
    except Exception as error:
        return create_flow_error_payload(detail=str(error), code="voice_flow_failed")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def handle_text_refine_request(payload: dict) -> dict:
    text = str(payload.get("text") or payload.get("raw_text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    mode = payload.get("mode", "transcript") if isinstance(payload.get("mode"), str) else "transcript"
    context = normalize_ws_object(payload.get("audio_context") or payload.get("context") or {})
    parameters = normalize_ws_object(payload.get("parameters") or {})

    try:
        refined, extra_data = await refine_voice_flow_text(
            raw_text=text,
            mode=mode,
            context=context,
            parameters=parameters,
        )
        return create_flow_success_payload(refined_text=refined, raw_text=text, extra_data=extra_data)
    except Exception as error:
        return create_flow_error_payload(detail=str(error), code="text_refine_failed", raw_text=text)


async def ws_voice_flow(websocket: WebSocket, app_instance: FastAPI | None = None):
    await websocket.accept()

    audio_id = ""
    mode = "transcript"
    context = {}
    parameters = {}
    audio_chunks: list[bytes] = []
    streaming_session = None
    streaming_chunk_index = 0
    realtime_translator = MeetingRealtimeTranslator(websocket)

    try:
        while True:
            message = await websocket.receive()

            if message["type"] != "websocket.receive":
                continue

            if "bytes" in message and message["bytes"]:
                if streaming_session is not None:
                    try:
                        results = await asyncio.to_thread(streaming_session.append_pcm16, message["bytes"])
                    except Exception as error:
                        streaming_session = None
                        audio_chunks = []
                        await send_ws_error_message(
                            websocket,
                            "transcription_error",
                            audio_id,
                            str(error),
                            "transcription_failed",
                        )
                        continue

                    for result in results:
                        streaming_chunk_index += 1
                        if result.text:
                            await send_ws_message(
                                websocket,
                                "transcription",
                                {
                                    "text": result.text,
                                    "audio_id": audio_id,
                                    "chunk_index": streaming_chunk_index,
                                },
                            )
                            await realtime_translator.observe_transcription(result.text, streaming_chunk_index)
                else:
                    audio_chunks.append(message["bytes"])
                    await websocket.send_json({
                        "K": "received_audio_chunk_count",
                        "V": {"count": len(audio_chunks), "audio_id": audio_id},
                    })
                continue

            if "text" not in message or not message["text"]:
                continue

            data, parse_error = normalize_ws_text_message(message["text"])
            if parse_error:
                await send_ws_message(websocket, "error", parse_error)
                continue

            msg_type = data.get("type", "")

            if app_instance is not None and not is_voice_service_ready(app_instance) and msg_type != "ping":
                await send_ws_message(
                    websocket,
                    "error",
                    {"code": 503, "detail": "语音后端尚未就绪"},
                )
                continue

            if msg_type == "start_audio":
                audio_id = data.get("audio_id", str(uuid.uuid4()))
                mode = data.get("mode", "transcript") if isinstance(data.get("mode"), str) else "transcript"
                context = normalize_ws_object(data.get("audio_context", {}))
                parameters = normalize_ws_object(data.get("parameters", {}))
                audio_chunks = []
                streaming_session = None
                streaming_chunk_index = 0
                realtime_translator.reset(audio_id, mode, context, parameters)
                sample_rate = get_pcm_streaming_sample_rate(parameters)
                if sample_rate:
                    try:
                        streaming_session = create_streaming_asr_session(sample_rate=sample_rate)
                    except RuntimeError:
                        streaming_session = None

                await send_ws_message(websocket, "session_started", {"audio_id": audio_id})
                await send_ws_message(
                    websocket,
                    "process_mode",
                    create_process_mode_payload(audio_id, mode, parameters),
                )
                await send_ws_message(websocket, "audio_session_started", {"audio_id": audio_id})
                continue

            if msg_type == "end_audio":
                parameters = merge_ws_end_audio_parameters(parameters, data)
                await realtime_translator.drain()
                realtime_translator.cancel()
                await send_ws_message(websocket, "audio_session_ending", {"audio_id": audio_id})
                if streaming_session is not None:
                    current_streaming_session = streaming_session
                    streaming_session = None
                    try:
                        final_result = await asyncio.to_thread(current_streaming_session.finalize)
                        raw_text = final_result.text
                    except Exception as error:
                        await send_ws_error_message(
                            websocket,
                            "transcription_error",
                            audio_id,
                            str(error),
                            "transcription_failed",
                        )
                        continue

                    if raw_text:
                        streaming_chunk_index += 1
                        await send_ws_message(
                            websocket,
                            "transcription",
                            {"text": raw_text, "audio_id": audio_id, "chunk_index": streaming_chunk_index},
                        )
                        try:
                            refined, extra_data = await refine_voice_flow_text(
                                raw_text=raw_text,
                                mode=mode,
                                context=context,
                                parameters=parameters,
                            )
                        except Exception as error:
                            await send_ws_error_message(
                                websocket,
                                get_ws_refine_error_message_type(mode, parameters),
                                audio_id,
                                str(error),
                                "audio_processing_failed",
                            )
                            continue

                        await send_ws_message(
                            websocket,
                            get_ws_completion_message_type(mode, parameters),
                            {
                                "audio_id": audio_id,
                                "refined_text": refined,
                                "refine_text": refined,
                                "delivery": "inline",
                                "user_prompt": raw_text,
                                "web_metadata": None,
                                "external_action": None,
                                **extra_data,
                            },
                        )
                    else:
                        await send_ws_message(
                            websocket,
                            get_ws_completion_message_type(mode, parameters),
                            {
                                "audio_id": audio_id,
                                "refined_text": "",
                                "refine_text": "",
                                "delivery": "inline",
                            },
                        )
                    continue

                if not audio_chunks:
                    continue

                current_chunks = audio_chunks
                audio_chunks = []
                audio_data = b"".join(current_chunks)
                suffix = detect_realtime_audio_suffix(audio_data)
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    tmp.write(audio_data)
                    tmp_path = tmp.name

                try:
                    try:
                        raw_text = await transcribe_audio_with_wav_conversion(tmp_path, suffix)
                    except Exception as error:
                        await send_ws_error_message(
                            websocket,
                            "transcription_error",
                            audio_id,
                            str(error),
                            "transcription_failed",
                        )
                        continue

                    if raw_text:
                        await send_ws_message(
                            websocket,
                            "transcription",
                            {"text": raw_text, "audio_id": audio_id, "chunk_index": 0},
                        )
                        try:
                            refined, extra_data = await refine_voice_flow_text(
                                raw_text=raw_text,
                                mode=mode,
                                context=context,
                                parameters=parameters,
                            )
                        except Exception as error:
                            await send_ws_error_message(
                                websocket,
                                get_ws_refine_error_message_type(mode, parameters),
                                audio_id,
                                str(error),
                                "audio_processing_failed",
                            )
                            continue

                        await send_ws_message(
                            websocket,
                            get_ws_completion_message_type(mode, parameters),
                            {
                                "audio_id": audio_id,
                                "refined_text": refined,
                                "refine_text": refined,
                                "delivery": "inline",
                                "user_prompt": raw_text,
                                "web_metadata": None,
                                "external_action": None,
                                **extra_data,
                            },
                        )
                    else:
                        await send_ws_message(
                            websocket,
                            get_ws_completion_message_type(mode, parameters),
                            {
                                "audio_id": audio_id,
                                "refined_text": "",
                                "refine_text": "",
                                "delivery": "inline",
                            },
                        )
                finally:
                    os.unlink(tmp_path)
                continue

            if msg_type == "replace_audio_context":
                context = normalize_audio_context_update(data)
                continue

            if msg_type == "ping":
                await send_ws_message(websocket, "pong", {})
                continue

            if msg_type == "set_mode_config":
                mode = normalize_mode_update(data, mode)
                next_parameters = normalize_ws_object(data.get("parameters", {}))
                if next_parameters:
                    parameters = {**parameters, **next_parameters}
                realtime_translator.update_config(mode, parameters)
                await send_ws_message(
                    websocket,
                    "process_mode",
                    create_process_mode_payload(audio_id, mode, parameters),
                )
                continue

            if msg_type == "set_selected_text":
                selected_text = normalize_selected_text(data)
                if selected_text:
                    parameters = {**parameters, "selected_text": selected_text}
                continue

            if msg_type == "set_audio_chunk_info":
                continue

    except WebSocketDisconnect:
        pass
    finally:
        try:
            await realtime_translator.drain()
        finally:
            realtime_translator.cancel()


def create_app(
    preload_model=preload_asr_model,
    exit_scheduler=schedule_startup_failure_exit,
    auto_preload_model: bool = False,
    exit_on_preload_failure: bool = False,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        set_voice_service_state(app, "idle", MODEL_MISSING_DETAIL)
        if auto_preload_model:
            start_voice_model_task(
                app,
                preload_model,
                exit_scheduler,
                exit_on_failure=exit_on_preload_failure,
            )
        try:
            yield
        finally:
            preload_task = getattr(app.state, "voice_preload_task", None)
            if preload_task:
                preload_task.cancel()

    app = FastAPI(title="Typeless Local Server", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_allowed_origins(),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {
            "status": get_voice_service_state(app)["status"],
            "service": "typeless-local",
        }

    @app.get("/ready")
    async def ready():
        payload = get_voice_service_state(app)
        if is_voice_service_ready(app):
            return payload
        return JSONResponse(status_code=503, content=payload)

    @app.get("/model/status")
    async def model_status(request: Request):
        apply_model_cache_dir(request.query_params.get("cache_dir"))
        return get_voice_model_status(app)

    @app.post("/model/download")
    async def model_download(request: Request):
        apply_model_cache_dir(await read_model_cache_dir_from_request(request))
        start_voice_model_task(app, preload_model, exit_scheduler, exit_on_failure=False)
        return get_voice_model_status(app)

    @app.post("/config/reload")
    async def reload_config():
        reload_refiner_runtime_config()
        return {"status": "ok", "detail": "大模型配置已重载"}

    @app.post("/ai/voice_flow")
    async def voice_flow(
        request: Request,
        audio_file: UploadFile = File(...),
        audio_id: str = Form(""),
        mode: str = Form("transcript"),
        audio_context: str = Form("{}"),
        audio_metadata: str = Form("{}"),
        parameters: str = Form("{}"),
        is_retry: str = Form("false"),
        device_name: str = Form(""),
        user_over_time: str = Form(""),
        send_time: str = Form(""),
    ):
        del audio_id, audio_metadata, is_retry, device_name, user_over_time, send_time
        require_voice_service_ready(request)
        return await handle_voice_flow_request(
            audio_file=audio_file,
            mode=mode,
            audio_context=audio_context,
            parameters=parameters,
        )

    @app.post("/ai/text_refine")
    async def text_refine(request: Request):
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        return await handle_text_refine_request(payload)

    @app.websocket("/ws/rt_voice_flow")
    async def voice_flow_websocket(
        websocket: WebSocket,
        v: str | None = None,
        t: str | None = None,
        m: str | None = None,
    ):
        del v, t, m
        await ws_voice_flow(websocket, app)

    @app.get("/")
    async def index():
        return FileResponse(Path(__file__).parent / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    reload_enabled = should_enable_reload()
    uvicorn.run(
        "main:app" if reload_enabled else app,
        host=get_server_host(),
        port=get_server_port(),
        reload=reload_enabled,
    )
