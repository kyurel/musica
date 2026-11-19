"""Pick tracks from the library and write a playlist file on this Mac.

Exports go to one stable folder (MUSICA_EXPORT_DIR), one file per playlist name, so
DJ software that watches or re-imports a playlist always finds it in the same place.
Filters match the web app's library page.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .exporters import EXPORTERS, Entry, Playlist
from .keys import ATONAL

PAGE = 1000
TRACK_COLUMNS = ("id, title, artist, bpm, musical_key, created_at, "
                 "versions(path_hint, duration_s, created_at, deleted_at)")


@dataclass
class Selection:
    crate: str | None = None
    search: str | None = None
    genre: str | None = None
    bpm_min: float | None = None
    bpm_max: float | None = None
    key: str | None = None
    mixable: bool = False
    source: str | None = None
    labels: list[str] = field(default_factory=list)
    review: bool = False

    def default_name(self) -> str:
        if self.crate:
            return self.crate
        parts = [self.genre, self.source, *self.labels,
                 self.key and (f"{self.key} mix" if self.mixable else self.key),
                 (self.bpm_min or self.bpm_max) and f"{_num(self.bpm_min)}-{_num(self.bpm_max)} bpm",
                 self.search and f"'{self.search}'", self.review and "review"]
        return " ".join(p for p in parts if p) or "All tracks"


def _num(x: float | None) -> str:
    return "" if x is None else f"{x:g}"


def compatible_keys(code: str) -> list[str]:
    """Same key, one step either way, and the relative key (mirrors keys.ts)."""
    m = re.fullmatch(r"(1[0-2]|[1-9])([AB])", code.strip().upper())
    if not m:
        return [ATONAL] if code == ATONAL else []
    num, letter = int(m[1]), m[2]
    other = "B" if letter == "A" else "A"
    step = lambda d: (num - 1 + d) % 12 + 1  # noqa: E731
    return [f"{num}{letter}", f"{step(1)}{letter}", f"{step(-1)}{letter}", f"{num}{other}"]


def newest_file(versions: list[dict]) -> dict | None:
    live = [v for v in versions or [] if v.get("path_hint") and not v.get("deleted_at")]
    return max(live, key=lambda v: v["created_at"]) if live else None


def _filtered(db, sel: Selection):
    q = db.table("tracks").select(TRACK_COLUMNS).is_("deleted_at", "null")
    if sel.search:
        q = q.text_search("search", sel.search, options={"type": "web_search", "config": "simple"})
    if sel.genre:
        g = db.table("genres").select("id").eq("slug", sel.genre).execute().data
        if not g:
            raise ValueError(f"unknown genre {sel.genre!r}")
        q = q.eq("genre_id", g[0]["id"])
    if sel.bpm_min:
        q = q.gte("bpm", sel.bpm_min)
    if sel.bpm_max:
        q = q.lte("bpm", sel.bpm_max)
    if sel.key:
        q = q.in_("musical_key", compatible_keys(sel.key)) if sel.mixable else q.eq("musical_key", sel.key)
    if sel.source:
        q = q.eq("source", sel.source)
    if sel.labels:
        q = q.contains("labels", sel.labels)
    if sel.review:
        q = q.eq("needs_review", True)
    return q.order("created_at", desc=True)


def fetch_tracks(db, sel: Selection) -> list[dict]:
    """Tracks in playlist order: crate order for a crate, newest first otherwise."""
    if sel.crate:
        crates = (db.table("crates").select("id").eq("name", sel.crate).is_("deleted_at", "null")
                  .execute().data)
        if not crates:
            raise ValueError(f"no crate named {sel.crate!r}")
        rows = _all(lambda a, b: db.table("crate_tracks").select(f"position, track:tracks({TRACK_COLUMNS}, deleted_at)")
                    .eq("crate_id", crates[0]["id"]).order("position").order("added_at").range(a, b))
        return [r["track"] for r in rows if r.get("track") and not r["track"].get("deleted_at")]
    return _all(lambda a, b: _filtered(db, sel).range(a, b))


def _all(page) -> list[dict]:
    out: list[dict] = []
    while True:
        rows = page(len(out), len(out) + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out


@dataclass
class Built:
    playlist: Playlist
    no_file: list[str]       # tracks with no file at all: left out
    not_on_this_mac: list[str]  # file not synced here yet: listed anyway


def build_playlist(name: str, tracks: list[dict], library_root: Path) -> Built:
    """Playlist with absolute paths on this Mac."""
    pl, no_file, absent = Playlist(name), [], []
    for t in tracks:
        v = newest_file(t.get("versions") or [])
        if v is None:
            no_file.append(t["title"])
            continue
        path = library_root / v["path_hint"]
        if not path.exists():
            absent.append(t["title"])
        pl.entries.append(Entry(
            path=str(path), title=t["title"], artist=t.get("artist"),
            duration_s=float(v["duration_s"]) if v.get("duration_s") is not None else None,
            bpm=float(t["bpm"]) if t.get("bpm") is not None else None,
            key=t.get("musical_key"), track_id=t["id"]))
    return Built(pl, no_file, absent)


def safe_filename(name: str) -> str:
    s = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]+', " ", name)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return (s or "playlist")[:120]


def write_playlist(playlist: Playlist, out_dir: Path, fmt: str = "m3u8") -> Path:
    exporter = EXPORTERS[fmt]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / (safe_filename(playlist.name) + exporter.suffix)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(exporter.render(playlist))
    os.replace(tmp, target)   # never leave a half-written playlist behind
    return target
