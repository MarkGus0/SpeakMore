import json
import os
import shutil
import threading
from pathlib import Path

DEFAULT_MODEL_ID = "base"
AVAILABLE_MODEL_IDS = ("tiny", "base", "small", "medium", "large-v3")
SELECTION_FILE_NAME = "model-selection.json"
REQUIRED_MODEL_FILES = ("model.bin", "config.json")

MODEL_CATALOG = [
    {
        "id": "tiny",
        "name": "Faster Whisper Tiny",
        "repoId": "Systran/faster-whisper-tiny",
        "engine": "faster-whisper",
        "description": "速度最快，适合临时测试和低配置设备。",
        "sizeMb": 75,
        "accuracyScore": 0.35,
        "speedScore": 0.95,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "base",
        "name": "Faster Whisper Base",
        "repoId": "Systran/faster-whisper-base",
        "engine": "faster-whisper",
        "description": "默认模型，速度和资源占用较均衡。",
        "sizeMb": 145,
        "accuracyScore": 0.50,
        "speedScore": 0.85,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "small",
        "name": "Faster Whisper Small",
        "repoId": "Systran/faster-whisper-small",
        "engine": "faster-whisper",
        "description": "准确度更高，仍适合日常听写。",
        "sizeMb": 470,
        "accuracyScore": 0.65,
        "speedScore": 0.68,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "medium",
        "name": "Faster Whisper Medium",
        "repoId": "Systran/faster-whisper-medium",
        "engine": "faster-whisper",
        "description": "准确度高，加载和转写更慢。",
        "sizeMb": 1500,
        "accuracyScore": 0.80,
        "speedScore": 0.42,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "large-v3",
        "name": "Faster Whisper Large v3",
        "repoId": "Systran/faster-whisper-large-v3",
        "engine": "faster-whisper",
        "description": "准确度最高，资源占用最大。",
        "sizeMb": 3100,
        "accuracyScore": 0.92,
        "speedScore": 0.22,
        "supportedLanguages": ["multi", "zh", "en"],
    },
]

_download_status_by_model_id: dict[str, dict] = {}
_download_lock = threading.Lock()
_download_threads_by_model_id: dict[str, threading.Thread] = {}


def get_managed_models_root() -> Path:
    local_app_data = Path(os.getenv("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return local_app_data / "Typeless" / "models"


def get_managed_whisper_cache_root() -> Path:
    return get_managed_models_root() / "faster-whisper"


def get_model_catalog() -> list[dict]:
    return [dict(model) for model in MODEL_CATALOG]


def get_model_definition(model_id: str) -> dict:
    for model in MODEL_CATALOG:
        if model["id"] == model_id:
            return dict(model)
    raise ValueError(f"未知模型: {model_id}")


def selection_file_path() -> Path:
    return get_managed_models_root() / SELECTION_FILE_NAME


def normalize_model_id(model_id: str | None) -> str:
    return model_id if model_id in AVAILABLE_MODEL_IDS else DEFAULT_MODEL_ID


def read_selected_model_id() -> str:
    try:
        payload = json.loads(selection_file_path().read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return DEFAULT_MODEL_ID
    return normalize_model_id(payload.get("currentModelId"))


def write_selected_model_id(model_id: str) -> str:
    normalized = normalize_model_id(model_id)
    root = get_managed_models_root()
    root.mkdir(parents=True, exist_ok=True)
    selection_file_path().write_text(
        json.dumps({"currentModelId": normalized}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return normalized


def repo_cache_dir_name(repo_id: str) -> str:
    return f"models--{repo_id.replace('/', '--')}"


def is_valid_model_snapshot(path: Path) -> bool:
    return path.is_dir() and all((path / name).exists() for name in REQUIRED_MODEL_FILES)


def find_cached_model_snapshot(model_id: str) -> Path | None:
    model = get_model_definition(model_id)
    snapshots_root = get_managed_whisper_cache_root() / repo_cache_dir_name(model["repoId"]) / "snapshots"
    if not snapshots_root.exists():
        return None

    candidates = sorted(
        (candidate for candidate in snapshots_root.iterdir() if candidate.is_dir()),
        key=lambda candidate: candidate.stat().st_mtime,
        reverse=True,
    )
    for candidate in candidates:
        if is_valid_model_snapshot(candidate):
            return candidate
    return None


def get_download_status(model_id: str) -> dict:
    with _download_lock:
        return dict(_download_status_by_model_id.get(model_id, {}))


def mark_download_started(model_id: str) -> None:
    get_model_definition(model_id)
    with _download_lock:
        _download_status_by_model_id[model_id] = {
            "isDownloading": True,
            "downloadProgress": 0,
            "downloadError": "",
            "cancelRequested": False,
        }


def update_download_progress(model_id: str, downloaded: int, total: int) -> None:
    percentage = 0 if total <= 0 else max(0, min(100, round(downloaded / total * 100)))
    with _download_lock:
        current = _download_status_by_model_id.setdefault(model_id, {})
        current.update({
            "isDownloading": True,
            "downloadProgress": percentage,
            "downloadError": "",
        })


def mark_download_finished(model_id: str) -> None:
    with _download_lock:
        _download_status_by_model_id.pop(model_id, None)


def mark_download_failed(model_id: str, error: str) -> None:
    with _download_lock:
        _download_status_by_model_id[model_id] = {
            "isDownloading": False,
            "downloadProgress": 0,
            "downloadError": error,
            "cancelRequested": False,
        }


def request_download_cancel(model_id: str) -> None:
    with _download_lock:
        current = _download_status_by_model_id.setdefault(model_id, {})
        current["cancelRequested"] = True


def is_download_cancel_requested(model_id: str) -> bool:
    return bool(get_download_status(model_id).get("cancelRequested"))


def download_model_files(model_id: str) -> None:
    model = get_model_definition(model_id)
    mark_download_started(model_id)
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=model["repoId"],
            cache_dir=str(get_managed_whisper_cache_root()),
            local_files_only=False,
        )
        if is_download_cancel_requested(model_id):
            mark_download_failed(model_id, "下载已取消")
            return
        mark_download_finished(model_id)
    except Exception as error:
        mark_download_failed(model_id, str(error))


def start_model_download(model_id: str) -> None:
    model = get_model_definition(model_id)
    normalized = model["id"]
    if get_download_status(normalized).get("isDownloading"):
        return

    thread = threading.Thread(target=download_model_files, args=(normalized,), daemon=True)
    with _download_lock:
        _download_threads_by_model_id[normalized] = thread
    thread.start()


def cancel_model_download(model_id: str) -> None:
    model = get_model_definition(model_id)
    normalized = model["id"]
    request_download_cancel(normalized)
    mark_download_failed(normalized, "下载已取消")


def create_models_state() -> dict:
    current_model_id = read_selected_model_id()
    explicit_model_dir = os.getenv("WHISPER_MODEL_DIR", "").strip()
    models = []
    for model in get_model_catalog():
        status = get_download_status(model["id"])
        snapshot = find_cached_model_snapshot(model["id"])
        models.append({
            **model,
            "isCurrent": model["id"] == current_model_id,
            "isDownloaded": snapshot is not None,
            "isDownloading": bool(status.get("isDownloading")),
            "downloadProgress": int(status.get("downloadProgress") or 0),
            "downloadError": str(status.get("downloadError") or ""),
            "snapshotPath": str(snapshot) if snapshot else "",
        })
    return {
        "currentModelId": current_model_id,
        "models": models,
        "explicitModelDir": explicit_model_dir,
        "selectionLocked": bool(explicit_model_dir),
    }


def delete_model_files(model_id: str) -> bool:
    model = get_model_definition(model_id)
    cache_root = get_managed_whisper_cache_root() / repo_cache_dir_name(model["repoId"])
    if not cache_root.exists():
        return False
    shutil.rmtree(cache_root)
    mark_download_finished(model_id)
    return True
