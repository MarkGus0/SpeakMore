from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import importlib.util
from pathlib import Path
from threading import Lock
from typing import Callable

import httpx

from download_progress import DownloadProgress, create_hf_tqdm_class
from model_manager import get_managed_models_root, repo_cache_dir_name


TRANSLATION_MODEL_ID = "hy-mt-1.5-1.8b-2bit"
TRANSLATION_MODEL_DISPLAY_REPO_ID = "AngelSlim/Hy-MT1.5-1.8B-2bit"
TRANSLATION_MODEL_GGUF_REPO_ID = "AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF"
TRANSLATION_MODEL_GGUF_FILE = "Hy-MT1.5-1.8B-2bit.gguf"
TRANSLATION_MODEL_CACHE_DIR_ENV = "SPEAKMORE_TRANSLATION_MODEL_CACHE_DIR"
LLAMA_SERVER_PATH_ENVS = ("SPEAKMORE_LLAMA_SERVER_PATH", "LLAMA_SERVER_PATH")
LLAMA_SERVER_URL_ENV = "SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL"
LLAMA_SERVER_PORT_ENV = "SPEAKMORE_LLAMA_SERVER_PORT"
DEFAULT_LLAMA_SERVER_PORT = 8105
RUNTIME_MISSING_DETAIL = (
    "未找到本地翻译运行时。请安装 llama.cpp 的 llama-server，"
    "或在当前后端 Python 环境安装 llama-cpp-python。"
)
LOCAL_TRANSLATION_TIMEOUT_SECONDS = 8.0
LOCAL_TRANSLATION_SUPPORTED_TARGETS = {
    "zh",
    "zh-CN",
    "zh-TW",
    "en",
    "ja",
    "ko",
    "es",
    "pt",
    "pt-BR",
    "fr",
    "de",
    "it",
    "ru",
    "uk",
    "ar",
    "he",
    "fa",
    "hi",
    "bn",
    "ur",
    "th",
    "vi",
    "id",
    "ms",
    "fil",
    "my",
    "km",
    "lo",
    "nl",
    "pl",
    "tr",
    "el",
    "cs",
    "ro",
    "hu",
    "sv",
    "da",
    "no",
    "fi",
    "sw",
}


_state_lock = Lock()
_runtime_process: subprocess.Popen | None = None
_runtime_url = ""
_runtime_kind = ""
_translation_model_state: dict = {
    "status": "idle",
    "detail": "",
    "started_at": None,
}


def normalize_optional_path(value: str | None) -> str:
    return str(Path(value).expanduser()) if isinstance(value, str) and value.strip() else ""


def configure_translation_model_cache_dir(cache_dir: str | None) -> Path:
    normalized = normalize_optional_path(cache_dir)
    if normalized:
        os.environ[TRANSLATION_MODEL_CACHE_DIR_ENV] = normalized
    else:
        os.environ.pop(TRANSLATION_MODEL_CACHE_DIR_ENV, None)
    return get_translation_model_cache_root()


def get_translation_model_cache_root() -> Path:
    configured = normalize_optional_path(os.environ.get(TRANSLATION_MODEL_CACHE_DIR_ENV))
    if configured:
        return Path(configured)
    return get_managed_models_root() / "translation"


def get_translation_model_snapshot_root(cache_root: Path | None = None) -> Path:
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    return root / repo_cache_dir_name(TRANSLATION_MODEL_GGUF_REPO_ID) / "snapshots"


def is_valid_translation_model_snapshot(path: Path) -> bool:
    return path.is_dir() and (path / TRANSLATION_MODEL_GGUF_FILE).is_file()


def find_cached_translation_model_snapshot(cache_root: Path | None = None) -> Path | None:
    snapshots_root = get_translation_model_snapshot_root(cache_root)
    try:
        candidates = list(snapshots_root.iterdir())
    except (FileNotFoundError, OSError):
        return None

    sortable_snapshots = []
    for snapshot in candidates:
        try:
            if snapshot.is_dir():
                sortable_snapshots.append((snapshot.stat().st_mtime, snapshot))
        except OSError:
            continue

    sortable_snapshots.sort(key=lambda item: item[0], reverse=True)
    for _mtime, snapshot in sortable_snapshots:
        if is_valid_translation_model_snapshot(snapshot):
            return snapshot
    return None


def find_cached_translation_model_file(cache_root: Path | None = None) -> Path | None:
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    direct_file = root / TRANSLATION_MODEL_GGUF_FILE
    if direct_file.is_file():
        return direct_file
    snapshot = find_cached_translation_model_snapshot(root)
    if snapshot:
        return snapshot / TRANSLATION_MODEL_GGUF_FILE
    return None


def normalize_download_progress(progress: dict | None = None) -> dict[str, int | None]:
    downloaded = progress.get("downloaded_bytes") if isinstance(progress, dict) else None
    total = progress.get("total_bytes") if isinstance(progress, dict) else None
    percent = progress.get("progress_percent") if isinstance(progress, dict) else None
    downloaded_files = progress.get("downloaded_files") if isinstance(progress, dict) else None
    total_files = progress.get("total_files") if isinstance(progress, dict) else None
    file_percent = progress.get("file_progress_percent") if isinstance(progress, dict) else None
    progress_percent = int(percent) if isinstance(percent, (int, float)) else None
    file_progress_percent = int(file_percent) if isinstance(file_percent, (int, float)) else None
    if progress_percent is not None:
        progress_percent = max(0, min(100, progress_percent))
    if file_progress_percent is not None:
        file_progress_percent = max(0, min(100, file_progress_percent))
    return {
        "downloaded_bytes": max(0, int(downloaded)) if isinstance(downloaded, (int, float)) else 0,
        "total_bytes": max(0, int(total)) if isinstance(total, (int, float)) else 0,
        "progress_percent": progress_percent,
        "downloaded_files": max(0, int(downloaded_files)) if isinstance(downloaded_files, (int, float)) else 0,
        "total_files": max(0, int(total_files)) if isinstance(total_files, (int, float)) else 0,
        "file_progress_percent": file_progress_percent,
    }


def set_translation_model_state(status: str, detail: str = "", started_at: float | None = None, progress: dict | None = None) -> None:
    with _state_lock:
        current = dict(_translation_model_state)
        if started_at is None and status in {"downloading", "loading"}:
            started_at = current.get("started_at") if isinstance(current.get("started_at"), float) else time.time()
        _translation_model_state.clear()
        _translation_model_state.update({
            "status": status,
            "detail": detail,
            "started_at": started_at,
            **normalize_download_progress(progress),
        })


def update_translation_model_progress(progress: DownloadProgress) -> None:
    with _state_lock:
        current = dict(_translation_model_state)
        _translation_model_state.clear()
        _translation_model_state.update({
            **current,
            **normalize_download_progress(progress),
            "updated_at": time.time(),
        })


def get_runtime_url() -> str:
    external_url = str(os.environ.get(LLAMA_SERVER_URL_ENV, "") or "").strip().rstrip("/")
    if external_url:
        return external_url
    return _runtime_url


def is_runtime_process_alive() -> bool:
    return bool(_runtime_process and _runtime_process.poll() is None)


def is_translation_model_ready() -> bool:
    return get_translation_model_status()["ready"] is True


def get_translation_model_status() -> dict:
    now = time.time()
    with _state_lock:
        current = dict(_translation_model_state)

    cached_file = find_cached_translation_model_file()
    status = str(current.get("status") or "idle")
    runtime_url = get_runtime_url()
    runtime_ready = bool(runtime_url and (str(os.environ.get(LLAMA_SERVER_URL_ENV, "")).strip() or is_runtime_process_alive()))
    if status == "ready" and not runtime_ready:
        status = "runtime_missing"

    started_at = current.get("started_at")
    return {
        "status": status,
        "detail": str(current.get("detail") or ""),
        "model_id": TRANSLATION_MODEL_ID,
        "repo_id": TRANSLATION_MODEL_DISPLAY_REPO_ID,
        "gguf_repo_id": TRANSLATION_MODEL_GGUF_REPO_ID,
        "model_file": TRANSLATION_MODEL_GGUF_FILE,
        "cache_dir": str(get_translation_model_cache_root()),
        "cached": cached_file is not None,
        "model_path": str(cached_file) if cached_file else "",
        "ready": status == "ready",
        "runtime_url": runtime_url,
        "runtime_kind": _runtime_kind if runtime_url else "",
        "runtime_pid": _runtime_process.pid if is_runtime_process_alive() else None,
        "runtime_missing": status == "runtime_missing",
        "started_at": started_at,
        "updated_at": now,
        "elapsed_ms": int((now - started_at) * 1000) if isinstance(started_at, (float, int)) else 0,
        **normalize_download_progress(current),
    }


def download_translation_model(progress_callback: Callable[[DownloadProgress], None] | None = None) -> Path:
    from huggingface_hub import snapshot_download

    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    cache_root = get_translation_model_cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    tqdm_class = create_hf_tqdm_class(progress_callback) if progress_callback else None
    kwargs = {
        "repo_id": TRANSLATION_MODEL_GGUF_REPO_ID,
        "cache_dir": cache_root,
        "allow_patterns": [TRANSLATION_MODEL_GGUF_FILE, "README.md", "License.txt"],
    }
    if tqdm_class:
        kwargs["tqdm_class"] = tqdm_class
    snapshot_path = Path(snapshot_download(**kwargs))
    model_file = snapshot_path / TRANSLATION_MODEL_GGUF_FILE
    if not model_file.is_file():
        raise RuntimeError(f"Downloaded snapshot does not contain {TRANSLATION_MODEL_GGUF_FILE}")
    return model_file


def resolve_llama_server_path() -> str:
    for env_name in LLAMA_SERVER_PATH_ENVS:
        candidate = str(os.environ.get(env_name, "") or "").strip()
        if candidate and Path(candidate).is_file():
            return candidate
    return shutil.which("llama-server") or ""


def has_llama_cpp_python_server() -> bool:
    try:
        return importlib.util.find_spec("llama_cpp.server") is not None
    except ModuleNotFoundError:
        return False


def resolve_llama_server_port() -> int:
    try:
        port = int(str(os.environ.get(LLAMA_SERVER_PORT_ENV, "") or "").strip())
    except ValueError:
        port = DEFAULT_LLAMA_SERVER_PORT
    return max(1024, min(65535, port or DEFAULT_LLAMA_SERVER_PORT))


def wait_for_local_server(url: str, timeout_seconds: float = 20.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            response = httpx.get(f"{url}/v1/models", timeout=1.2)
            if response.status_code < 500:
                return
        except Exception as error:
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"Local translation runtime did not become ready: {last_error or 'timeout'}")


def unload_translation_model() -> dict:
    global _runtime_process, _runtime_url, _runtime_kind
    process = _runtime_process
    _runtime_process = None
    _runtime_url = ""
    _runtime_kind = ""
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    set_translation_model_state("idle", "Local translation model unloaded")
    return get_translation_model_status()


def load_translation_model() -> dict:
    global _runtime_process, _runtime_url, _runtime_kind
    external_url = str(os.environ.get(LLAMA_SERVER_URL_ENV, "") or "").strip().rstrip("/")
    if external_url:
        _runtime_url = external_url
        _runtime_kind = "external"
        wait_for_local_server(external_url, timeout_seconds=5.0)
        set_translation_model_state("ready", "Using external local translation runtime")
        return get_translation_model_status()

    model_file = find_cached_translation_model_file()
    if not model_file:
        set_translation_model_state("failed", "Local translation model is not downloaded")
        return get_translation_model_status()

    if is_runtime_process_alive() and _runtime_url:
        set_translation_model_state("ready", "Local translation model is already loaded")
        return get_translation_model_status()

    llama_server_path = resolve_llama_server_path()
    port = resolve_llama_server_port()
    url = f"http://127.0.0.1:{port}"
    thread_count = str(max(2, min(8, os.cpu_count() or 4)))
    runtime_kind = ""
    if llama_server_path:
        runtime_kind = "llama-server"
        args = [
            llama_server_path,
            "--model",
            str(model_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--ctx-size",
            "4096",
            "--threads",
            thread_count,
            "--no-webui",
        ]
    elif has_llama_cpp_python_server():
        runtime_kind = "llama-cpp-python"
        args = [
            sys.executable,
            "-m",
            "llama_cpp.server",
            "--model",
            str(model_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--n_ctx",
            "4096",
            "--n_threads",
            thread_count,
        ]
    else:
        set_translation_model_state("runtime_missing", RUNTIME_MISSING_DETAIL)
        return get_translation_model_status()

    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            raise RuntimeError(f"Port {port} is already in use")
    except OSError:
        pass

    _runtime_process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=os.environ.copy(),
    )
    _runtime_url = url
    _runtime_kind = runtime_kind
    try:
        wait_for_local_server(url)
    except Exception:
        unload_translation_model()
        set_translation_model_state("failed", "Local translation runtime failed to start")
        raise
    set_translation_model_state("ready", f"Local translation model loaded with {runtime_kind}")
    return get_translation_model_status()


def build_local_translation_messages(
    raw_text: str,
    target_language_name: str,
    target_language_id: str,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
) -> list[dict]:
    previous_sentences = previous_sentences or []
    previous_context_pairs = previous_context_pairs or []
    pair_lines = "\n".join(
        f"- Source: {str(item.get('source') or '').strip()} | Translation: {str(item.get('translation') or '').strip()}"
        for item in previous_context_pairs[-2:]
        if isinstance(item, dict)
    )
    context_lines = "\n".join(str(item or "").strip() for item in previous_sentences[-2:] if str(item or "").strip())
    system_prompt = (
        "You are a low-latency machine translation engine. Translate only the current input into the target language. "
        "Use previous context only for terminology and pronouns. Never output source text, labels, explanations, markdown, timestamps, or emoji."
    )
    user_prompt = (
        f"Target language: {target_language_name} ({target_language_id})\n"
        f"Previous sentences for context only:\n{context_lines or '(none)'}\n\n"
        f"Previous source/translation pairs for context only:\n{pair_lines or '(none)'}\n\n"
        f"Current input:\n{raw_text}"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def normalize_local_translation_output(value: object) -> str:
    text = str(value or "").strip()
    text = text.strip("` \n\t")
    return text


async def translate_with_local_model(
    raw_text: str,
    target_language_id: str,
    target_language_name: str,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
) -> str:
    if target_language_id not in LOCAL_TRANSLATION_SUPPORTED_TARGETS:
        raise RuntimeError(f"Unsupported local translation target: {target_language_id}")
    status = get_translation_model_status()
    if not status.get("ready"):
        raise RuntimeError(str(status.get("detail") or status.get("status") or "local translation model is not ready"))
    runtime_url = str(status.get("runtime_url") or "").rstrip("/")
    if not runtime_url:
        raise RuntimeError("Local translation runtime URL is empty")

    payload = {
        "model": TRANSLATION_MODEL_ID,
        "messages": build_local_translation_messages(
            raw_text=raw_text,
            target_language_name=target_language_name,
            target_language_id=target_language_id,
            previous_sentences=previous_sentences,
            previous_context_pairs=previous_context_pairs,
        ),
        "temperature": 0.0,
        "max_tokens": 256,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=LOCAL_TRANSLATION_TIMEOUT_SECONDS) as client:
        response = await client.post(f"{runtime_url}/v1/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices", [])
    if not choices or not isinstance(choices, list):
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else {}
    return normalize_local_translation_output(message.get("content") if isinstance(message, dict) else "")
