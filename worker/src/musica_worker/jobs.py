"""Job handlers and the claim loop. Talks to the queue through a small interface,
so the loop can be tested without a database."""

from __future__ import annotations

import logging
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from .analyse import AnalysisResult, analyse_file
from .preview import make_preview
from .tempo import BpmRange

log = logging.getLogger("musica.worker")

HEARTBEAT_SECONDS = 60  # lease is 5 minutes


@dataclass
class Job:
    id: str
    kind: str
    version_id: str | None
    payload: dict[str, Any] = field(default_factory=dict)
    attempts: int = 1


@dataclass
class VersionRef:
    path_hint: str | None
    genre_range: BpmRange | None


class Queue(Protocol):
    def register(self, runner: str, capabilities: list[str]) -> None: ...
    def claim(self, runner: str) -> Job | None: ...
    def heartbeat(self, job_id: str, runner: str) -> bool: ...
    def complete(self, job_id: str, runner: str, result: dict[str, Any]) -> bool: ...
    def fail(self, job_id: str, runner: str, error: str, retry: bool = True) -> bool: ...
    def version(self, version_id: str) -> VersionRef: ...
    def record_analysis(self, version_id: str, result: AnalysisResult, job_id: str) -> None: ...
    def set_preview(self, version_id: str, preview_key: str) -> None: ...


class Uploader(Protocol):
    def upload_preview(self, version_id: str, file: Path) -> str:
        """Upload a preview and return its object key."""
        ...


class PermanentError(Exception):
    """A failure that retrying will not fix (missing file, unknown job kind)."""


def resolve_audio(root: Path, path_hint: str | None) -> Path:
    """The file for a version, under this Mac's library root. Refuses paths that escape it."""
    if not path_hint:
        raise PermanentError("version has no path")
    root = root.expanduser().resolve()
    path = (root / path_hint).resolve()
    if not path.is_relative_to(root):
        raise PermanentError(f"path escapes the library root: {path_hint}")
    if not path.is_file():
        raise PermanentError(f"file not found on this Mac: {path_hint}")
    return path


@dataclass
class Worker:
    queue: Queue
    runner: str
    capabilities: list[str]
    library_root: Path
    uploader: Uploader | None = None
    heartbeat_seconds: float = HEARTBEAT_SECONDS

    def handlers(self) -> dict[str, Callable[[Job], dict[str, Any]]]:
        return {"analyse": self.analyse, "preview": self.preview}

    # ---- handlers

    def analyse(self, job: Job) -> dict[str, Any]:
        ref = self._version(job)
        path = resolve_audio(self.library_root, job.payload.get("path_hint") or ref.path_hint)
        results = analyse_file(path, ref.genre_range)
        for r in results:
            self.queue.record_analysis(job.version_id, r, job.id)
        return {"analysers": [r.analyser for r in results]}

    def preview(self, job: Job) -> dict[str, Any]:
        if self.uploader is None:
            raise PermanentError("no preview uploader configured on this Mac")
        ref = self._version(job)
        path = resolve_audio(self.library_root, ref.path_hint)
        with tempfile.TemporaryDirectory(prefix="musica-preview-") as tmp:
            mp3 = make_preview(path, Path(tmp) / f"{job.version_id}.mp3")
            key = self.uploader.upload_preview(job.version_id, mp3)
        self.queue.set_preview(job.version_id, key)
        return {"preview_key": key}

    def _version(self, job: Job) -> VersionRef:
        if not job.version_id:
            raise PermanentError("job has no version")
        return self.queue.version(job.version_id)

    # ---- loop

    def run_one(self) -> bool:
        """Claim and run one job. Returns False when the queue had nothing for us."""
        job = self.queue.claim(self.runner)
        if job is None:
            return False
        handler = self.handlers().get(job.kind)
        if handler is None:
            self.queue.fail(job.id, self.runner, f"this worker cannot do '{job.kind}' jobs", retry=False)
            return True

        stop = threading.Event()
        beat = threading.Thread(target=self._beat, args=(job.id, stop), daemon=True)
        beat.start()
        try:
            log.info("job %s (%s) started", job.id, job.kind)
            result = handler(job)
        except PermanentError as e:
            log.warning("job %s failed: %s", job.id, e)
            self.queue.fail(job.id, self.runner, str(e), retry=False)
        except Exception as e:  # noqa: BLE001 - anything else may be transient
            log.exception("job %s failed", job.id)
            self.queue.fail(job.id, self.runner, f"{type(e).__name__}: {e}", retry=True)
        else:
            if not self.queue.complete(job.id, self.runner, result):
                log.warning("job %s finished but was no longer ours (lease lost or cancelled)", job.id)
            else:
                log.info("job %s done", job.id)
        finally:
            stop.set()
            beat.join(timeout=5)
        return True

    def _beat(self, job_id: str, stop: threading.Event) -> None:
        while not stop.wait(self.heartbeat_seconds):
            try:
                if not self.queue.heartbeat(job_id, self.runner):
                    log.warning("lost the lease on job %s", job_id)
                    return
            except Exception:  # network blip: try again next beat
                log.exception("heartbeat failed")

    def run_forever(self, idle_seconds: float = 10, max_idle_seconds: float = 120) -> None:
        """Poll the queue, backing off while it is empty. Registering also keeps the
        free Supabase project awake while a Mac is on."""
        self.queue.register(self.runner, self.capabilities)
        wait = idle_seconds
        while True:
            try:
                if self.run_one():
                    wait = idle_seconds
                    continue
            except Exception:
                log.exception("queue error")
            time.sleep(wait)
            wait = min(max_idle_seconds, wait * 1.5)
            self.queue.register(self.runner, self.capabilities)
