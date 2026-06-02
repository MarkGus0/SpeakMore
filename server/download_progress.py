from __future__ import annotations

from threading import Lock
from typing import Callable

from tqdm.auto import tqdm


DownloadProgress = dict[str, int | None]


def is_byte_progress_task(progress) -> bool:
    unit = str(getattr(progress, "unit", "") or "").strip().lower()
    return unit in {"b", "byte", "bytes"}


def create_hf_tqdm_class(on_progress: Callable[[DownloadProgress], None]):
    lock = Lock()
    tasks: dict[int, dict[str, int | bool]] = {}

    def emit_progress() -> None:
        byte_tasks = [task for task in tasks.values() if task["is_bytes"]]
        file_tasks = [task for task in tasks.values() if not task["is_bytes"]]
        downloaded = sum(int(task["downloaded"]) for task in byte_tasks)
        total = sum(int(task["total"]) for task in byte_tasks)
        downloaded_files = sum(int(task["downloaded"]) for task in file_tasks)
        total_files = sum(int(task["total"]) for task in file_tasks)
        percent = round(downloaded * 100 / total) if total > 0 else None
        file_percent = round(downloaded_files * 100 / total_files) if total_files > 0 else None
        if percent is not None:
            percent = max(0, min(100, percent))
        if file_percent is not None:
            file_percent = max(0, min(100, file_percent))
        on_progress({
            "downloaded_bytes": downloaded,
            "total_bytes": total,
            "progress_percent": percent,
            "downloaded_files": downloaded_files,
            "total_files": total_files,
            "file_progress_percent": file_percent,
        })

    class DownloadProgressTqdm(tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            with lock:
                tasks[id(self)] = {
                    "downloaded": int(self.n or 0),
                    "total": int(self.total or 0),
                    "is_bytes": is_byte_progress_task(self),
                }
                emit_progress()

        def update(self, n=1):
            result = super().update(n)
            with lock:
                task = tasks.setdefault(
                    id(self),
                    {
                        "downloaded": 0,
                        "total": int(self.total or 0),
                        "is_bytes": is_byte_progress_task(self),
                    },
                )
                task["downloaded"] = int(self.n or 0)
                task["total"] = int(self.total or task["total"] or 0)
                emit_progress()
            return result

        def close(self):
            with lock:
                task = tasks.get(id(self))
                if task is not None:
                    task["downloaded"] = int(self.n or task["downloaded"])
                    task["total"] = int(self.total or task["total"] or 0)
                    emit_progress()
            return super().close()

    return DownloadProgressTqdm
