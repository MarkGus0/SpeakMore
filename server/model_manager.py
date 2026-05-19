import asyncio
import json
import os
import shutil
import threading
from pathlib import Path


DEFAULT_MODEL_ID = "base"
AVAILABLE_MODEL_IDS = ("tiny", "base", "small", "medium", "large-v3")

_SELECTION_FILE_NAME = "model-selection.json"
_DOWNLOAD_STATUS = {}
_DOWNLOAD_TASKS = {}
_DOWNLOAD_CANCELLED = set()
_DOWNLOAD_STATUS_LOCK = threading.Lock()

_MODEL_CATALOG = (
    {
        "id": "tiny",
        "name": "Faster Whisper Tiny",
        "repoId": "Systran/faster-whisper-tiny",
        "engine": "faster-whisper",
        "description": "最快的入门模型，适合低资源设备和快速验证。",
        "sizeMb": 75,
        "accuracyScore": 0.2,
        "speedScore": 1.0,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "base",
        "name": "Faster Whisper Base",
        "repoId": "Systran/faster-whisper-base",
        "engine": "faster-whisper",
        "description": "默认模型，在速度、体积和识别质量之间保持平衡。",
        "sizeMb": 145,
        "accuracyScore": 0.4,
        "speedScore": 0.8,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "small",
        "name": "Faster Whisper Small",
        "repoId": "Systran/faster-whisper-small",
        "engine": "faster-whisper",
        "description": "更好的识别质量，适合多数日常听写场景。",
        "sizeMb": 466,
        "accuracyScore": 0.6,
        "speedScore": 0.6,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "medium",
        "name": "Faster Whisper Medium",
        "repoId": "Systran/faster-whisper-medium",
        "engine": "faster-whisper",
        "description": "更高准确率，适合质量优先且设备性能充足的场景。",
        "sizeMb": 1500,
        "accuracyScore": 0.8,
        "speedScore": 0.4,
        "supportedLanguages": ["multi", "zh", "en"],
    },
    {
        "id": "large-v3",
        "name": "Faster Whisper Large v3",
        "repoId": "Systran/faster-whisper-large-v3",
        "engine": "faster-whisper",
        "description": "最高识别质量，适合准确率优先的场景。",
        "sizeMb": 3100,
        "accuracyScore": 1.0,
        "speedScore": 0.2,
        "supportedLanguages": ["multi", "zh", "en"],
    },
)


def get_managed_models_root():
    local_app_data = os.environ.get("LOCALAPPDATA")
    base_dir = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base_dir / "Typeless" / "models"


def get_managed_whisper_cache_root():
    return get_managed_models_root() / "faster-whisper"


def repo_cache_dir_name(repo_id: str):
    return f"models--{repo_id.replace('/', '--')}"


def get_model_catalog():
    return [{**model, "supportedLanguages": list(model["supportedLanguages"])} for model in _MODEL_CATALOG]


def get_model_definition(model_id: str):
    for model in get_model_catalog():
        if model["id"] == model_id:
            return model
    raise ValueError(f"未知模型: {model_id}")


def normalize_model_id(model_id):
    return model_id if isinstance(model_id, str) and model_id in AVAILABLE_MODEL_IDS else DEFAULT_MODEL_ID


def read_selected_model_id():
    selection_file = get_managed_models_root() / _SELECTION_FILE_NAME
    try:
        selection = json.loads(selection_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return DEFAULT_MODEL_ID

    if not isinstance(selection, dict):
        return DEFAULT_MODEL_ID

    return normalize_model_id(selection.get("currentModelId"))


def write_selected_model_id(model_id):
    normalized_model_id = normalize_model_id(model_id)
    root = get_managed_models_root()
    root.mkdir(parents=True, exist_ok=True)
    selection_file = root / _SELECTION_FILE_NAME
    selection_file.write_text(
        json.dumps({"currentModelId": normalized_model_id}, ensure_ascii=False),
        encoding="utf-8",
    )
    return normalized_model_id


def read_explicit_model_id():
    configured_model = os.environ.get("WHISPER_MODEL", "").strip()
    return normalize_model_id(configured_model) if configured_model else ""


def get_runtime_model_id():
    explicit_model_id = read_explicit_model_id()
    return explicit_model_id or read_selected_model_id()


def is_model_selection_locked():
    return bool(os.environ.get("WHISPER_MODEL_DIR", "").strip() or read_explicit_model_id())


def is_valid_model_snapshot(path: Path):
    return path.is_dir() and (path / "model.bin").is_file() and (path / "config.json").is_file()


def find_cached_model_snapshot(model_id: str, cache_root=None):
    model = get_model_definition(model_id)
    root = Path(cache_root) if cache_root is not None else get_managed_whisper_cache_root()
    snapshots_root = root / repo_cache_dir_name(model["repoId"]) / "snapshots"
    try:
        candidates = list(snapshots_root.iterdir())
    except (FileNotFoundError, OSError):
        return None

    sortable_snapshots = []
    for snapshot in candidates:
        try:
            if not snapshot.is_dir():
                continue
            sortable_snapshots.append((snapshot.stat().st_mtime, snapshot))
        except OSError:
            continue

    sortable_snapshots.sort(key=lambda item: item[0], reverse=True)
    for _, snapshot in sortable_snapshots:
        if is_valid_model_snapshot(snapshot):
            return snapshot
    return None


def _default_download_status():
    return {
        "isDownloading": False,
        "downloadProgress": 0,
        "downloadError": "",
    }


def _set_download_status(model_id, status):
    normalized_model_id = get_model_definition(model_id)["id"]
    with _DOWNLOAD_STATUS_LOCK:
        _DOWNLOAD_STATUS[normalized_model_id] = status
    return normalized_model_id


def mark_download_started(model_id):
    return _set_download_status(
        model_id,
        {
            "isDownloading": True,
            "downloadProgress": 0,
            "downloadError": "",
        },
    )


def update_download_progress(model_id, downloaded, total):
    normalized_model_id = get_model_definition(model_id)["id"]
    progress = 0 if total <= 0 else round(downloaded / total * 100)
    progress = max(0, min(100, progress))

    with _DOWNLOAD_STATUS_LOCK:
        current = {**_default_download_status(), **_DOWNLOAD_STATUS.get(normalized_model_id, {})}
        _DOWNLOAD_STATUS[normalized_model_id] = {
            **current,
            "isDownloading": True,
            "downloadProgress": progress,
            "downloadError": "",
        }
    return normalized_model_id


def mark_download_finished(model_id):
    normalized_model_id = get_model_definition(model_id)["id"]
    with _DOWNLOAD_STATUS_LOCK:
        _DOWNLOAD_STATUS.pop(normalized_model_id, None)
    return normalized_model_id


def mark_download_failed(model_id, error):
    return _set_download_status(
        model_id,
        {
            "isDownloading": False,
            "downloadProgress": 0,
            "downloadError": str(error),
        },
    )


def get_download_status(model_id):
    normalized_model_id = get_model_definition(model_id)["id"]
    with _DOWNLOAD_STATUS_LOCK:
        return {**_default_download_status(), **_DOWNLOAD_STATUS.get(normalized_model_id, {})}


def clear_download_status_for_tests():
    # 模块级下载状态会跨测试保留，测试需要显式隔离。
    with _DOWNLOAD_STATUS_LOCK:
        _DOWNLOAD_STATUS.clear()
        _DOWNLOAD_TASKS.clear()
        _DOWNLOAD_CANCELLED.clear()


def create_models_state():
    explicit_model_dir = os.environ.get("WHISPER_MODEL_DIR") or ""
    explicit_model_id = read_explicit_model_id()
    current_model_id = explicit_model_id or read_selected_model_id()
    models = []

    for model in get_model_catalog():
        snapshot = find_cached_model_snapshot(model["id"])
        download_status = get_download_status(model["id"])
        models.append(
            {
                **model,
                "isCurrent": model["id"] == current_model_id,
                "isDownloaded": snapshot is not None,
                "isDownloading": download_status["isDownloading"],
                "downloadProgress": download_status["downloadProgress"],
                "downloadError": download_status["downloadError"],
                "snapshotPath": str(snapshot) if snapshot else "",
            }
        )

    return {
        "currentModelId": current_model_id,
        "models": models,
        "explicitModelDir": explicit_model_dir,
        "explicitModelId": explicit_model_id,
        "selectionLocked": is_model_selection_locked(),
    }


def delete_model_files(model_id):
    model = get_model_definition(model_id)
    cache_dir = get_managed_whisper_cache_root() / repo_cache_dir_name(model["repoId"])
    mark_download_finished(model["id"])

    if not cache_dir.exists():
        return False

    shutil.rmtree(cache_dir)
    return True


async def download_model(model_id):
    model = get_model_definition(model_id)
    if find_cached_model_snapshot(model["id"]):
        mark_download_finished(model["id"])
        return

    mark_download_started(model["id"])
    try:
        from huggingface_hub import snapshot_download

        await asyncio.to_thread(
            snapshot_download,
            repo_id=model["repoId"],
            cache_dir=str(get_managed_whisper_cache_root()),
            local_files_only=False,
        )
        with _DOWNLOAD_STATUS_LOCK:
            was_cancelled = model["id"] in _DOWNLOAD_CANCELLED
            _DOWNLOAD_CANCELLED.discard(model["id"])
        if was_cancelled:
            delete_model_files(model["id"])
            return
        mark_download_finished(model["id"])
    except asyncio.CancelledError:
        mark_download_finished(model["id"])
        raise
    except Exception as error:
        mark_download_failed(model["id"], str(error))
        raise


def _consume_download_task_result(task):
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception:
        return


def start_download_task(model_id):
    model = get_model_definition(model_id)
    if find_cached_model_snapshot(model["id"]):
        mark_download_finished(model["id"])
        return False

    existing_task = _DOWNLOAD_TASKS.get(model["id"])
    if existing_task and not existing_task.done():
        return False

    with _DOWNLOAD_STATUS_LOCK:
        _DOWNLOAD_CANCELLED.discard(model["id"])
    mark_download_started(model["id"])
    task = asyncio.create_task(download_model(model["id"]))
    task.add_done_callback(_consume_download_task_result)
    _DOWNLOAD_TASKS[model["id"]] = task
    return True


def cancel_download_task(model_id):
    model = get_model_definition(model_id)
    task = _DOWNLOAD_TASKS.get(model["id"])
    if not task or task.done():
        return False

    with _DOWNLOAD_STATUS_LOCK:
        _DOWNLOAD_CANCELLED.add(model["id"])
    mark_download_finished(model["id"])
    return True
