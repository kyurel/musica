"""The real queue: Supabase RPCs, signed in as a normal member (never service_role)."""

from __future__ import annotations

from typing import Any

from .analyse import AnalysisResult
from .jobs import Job, VersionRef
from .tempo import BpmRange


class SupabaseQueue:
    def __init__(self, client) -> None:
        self.db = client

    def _rpc(self, fn: str, params: dict[str, Any]):
        return self.db.rpc(fn, params).execute().data

    def register(self, runner: str, capabilities: list[str]) -> None:
        self._rpc("register_runner", {"p_name": runner, "p_capabilities": capabilities})

    def claim(self, runner: str) -> Job | None:
        row = self._rpc("claim_job", {"p_runner": runner})
        if isinstance(row, list):
            row = row[0] if row else None
        if not row or not row.get("id"):
            return None
        return Job(id=row["id"], kind=row["kind"], version_id=row.get("version_id"),
                   payload=row.get("payload") or {}, attempts=row.get("attempts") or 1)

    def heartbeat(self, job_id: str, runner: str) -> bool:
        return bool(self._rpc("heartbeat_job", {"p_job": job_id, "p_runner": runner}))

    def complete(self, job_id: str, runner: str, result: dict[str, Any]) -> bool:
        return bool(self._rpc("complete_job", {"p_job": job_id, "p_runner": runner, "p_result": result}))

    def fail(self, job_id: str, runner: str, error: str, retry: bool = True) -> bool:
        return bool(self._rpc("fail_job", {"p_job": job_id, "p_runner": runner, "p_error": error, "p_retry": retry}))

    def version(self, version_id: str) -> VersionRef:
        rows = (self.db.table("versions")
                .select("path_hint, track:tracks(genre:genres(bpm_min, bpm_max))")
                .eq("id", version_id).limit(1).execute().data)
        if not rows:
            from .jobs import PermanentError
            raise PermanentError(f"version {version_id} not found")
        genre = ((rows[0].get("track") or {}).get("genre") or {})
        rng = None
        if genre.get("bpm_min") is not None and genre.get("bpm_max") is not None:
            rng = BpmRange(float(genre["bpm_min"]), float(genre["bpm_max"]))
        return VersionRef(path_hint=rows[0].get("path_hint"), genre_range=rng)

    def record_analysis(self, version_id: str, result: AnalysisResult, job_id: str) -> None:
        self._rpc("record_analysis", {
            "p_version_id": version_id, "p_analyser": result.analyser,
            "p_analyser_version": result.analyser_version, "p_source": result.source,
            "p_values": result.values, "p_job": job_id,
        })

    def set_preview(self, version_id: str, preview_key: str) -> None:
        self.db.table("versions").update({"preview_key": preview_key}).eq("id", version_id).execute()
        track = self.db.table("versions").select("track_id").eq("id", version_id).execute().data
        if track:
            self.db.table("tracks").update({"active": True}).eq("id", track[0]["track_id"]).execute()
