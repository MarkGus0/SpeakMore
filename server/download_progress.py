from __future__ import annotations

from threading import Lock
from typing import Callable

from tqdm.auto import tqdm


DownloadProgress = dict[str, int | None]


def create_hf_tqdm_class(on_progress: Callable[[DownloadProgress], None]):
    lock = Lock()
    tasks: dict[int, dict[str, int]] = {}

    def emit_progress() -> None:
        downloaded = sum(task["downloaded"] for task in tasks.values())
        total = sum(task["total"] for task in tasks.values())
        percent = round(downloaded * 100 / total) if total > 0 else None
        if percent is not None:
            percent = max(0, min(100, percent))
        on_progress({
            "downloaded_bytes": downloaded,
            "total_bytes": total,
            "progress_percent": percent,
        })

    class DownloadProgressTqdm(tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            with lock:
                tasks[id(self)] = {
                    "downloaded": int(self.n or 0),
                    "total": int(self.total or 0),
                }
                emit_progress()

        def update(self, n=1):
            result = super().update(n)
            with lock:
                task = tasks.setdefault(id(self), {"downloaded": 0, "total": int(self.total or 0)})
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
