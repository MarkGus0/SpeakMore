import os
from pathlib import Path


PARAFORMER_STREAMING_MODEL_ID = "paraformer-zh-streaming"
PARAFORMER_STREAMING_REPO_ID = "funasr/paraformer-zh-streaming"
PARAFORMER_STREAMING_REQUIRED_MODEL_FILES = (
    "model.pt",
    "config.yaml",
    "tokens.json",
    "am.mvn",
)
DEFAULT_MODEL_ID = PARAFORMER_STREAMING_MODEL_ID


def get_managed_models_root():
    local_app_data = os.environ.get("LOCALAPPDATA")
    base_dir = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base_dir / "Typeless" / "models"


def get_managed_model_cache_root(model_id: str = PARAFORMER_STREAMING_MODEL_ID):
    if model_id != PARAFORMER_STREAMING_MODEL_ID:
        raise ValueError(f"未知模型: {model_id}")
    return get_managed_models_root() / "funasr"


def get_hf_cache_root() -> Path:
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home) / "hub"
    user_profile = Path(os.getenv("USERPROFILE") or Path.home())
    return user_profile / ".cache" / "huggingface" / "hub"


def repo_cache_dir_name(repo_id: str):
    return f"models--{repo_id.replace('/', '--')}"


def is_valid_model_snapshot(path: Path, model_id: str = PARAFORMER_STREAMING_MODEL_ID):
    if model_id != PARAFORMER_STREAMING_MODEL_ID:
        raise ValueError(f"未知模型: {model_id}")
    return path.is_dir() and all((path / relative_path).is_file() for relative_path in PARAFORMER_STREAMING_REQUIRED_MODEL_FILES)


def find_cached_model_snapshot(model_id: str = PARAFORMER_STREAMING_MODEL_ID, cache_root=None):
    if model_id != PARAFORMER_STREAMING_MODEL_ID:
        raise ValueError(f"未知模型: {model_id}")

    root = Path(cache_root) if cache_root is not None else get_managed_model_cache_root(model_id)
    snapshots_root = root / repo_cache_dir_name(PARAFORMER_STREAMING_REPO_ID) / "snapshots"
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
        if is_valid_model_snapshot(snapshot, model_id):
            return snapshot
    return None
