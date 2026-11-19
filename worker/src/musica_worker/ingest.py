"""Adding files to the library from a Mac.

Lossless files stay on the Macs: a file already under the library root is used where it
is; anything else is copied into <root>/Inbox/ (Syncthing then shares it with the other Mac).
The database gets a track and a version, and analyse + preview jobs are queued.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from .fileinfo import content_hash, read_info

AUDIO_SUFFIXES = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".ogg", ".opus"}
SOURCES = {"ours", "reference", "commercial", "promo", "sample_pack"}


@dataclass
class Prepared:
    path_hint: str
    content_hash: str
    title: str
    artist: str | None


def place_in_library(file: Path, root: Path) -> Path:
    """Return the file's location under the library root, copying it into Inbox/ if needed."""
    root = root.expanduser().resolve()
    file = file.expanduser().resolve()
    if file.is_relative_to(root):
        return file
    inbox = root / "Inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    target = inbox / file.name
    n = 1
    while target.exists():
        if content_hash(target) == content_hash(file):
            return target
        target = inbox / f"{file.stem} ({n}){file.suffix}"
        n += 1
    shutil.copy2(file, target)
    return target


def prepare(file: Path, root: Path) -> Prepared:
    if file.suffix.lower() not in AUDIO_SUFFIXES:
        raise ValueError(f"not an audio file: {file.name}")
    placed = place_in_library(file, root)
    info = read_info(placed)
    return Prepared(
        path_hint=placed.relative_to(root.expanduser().resolve()).as_posix(),
        content_hash=content_hash(placed),
        title=info.tags.get("title") or placed.stem,
        artist=info.tags.get("artist"),
    )


def add_to_library(db, prepared: Prepared, source: str = "reference") -> tuple[str, bool]:
    """Create track + version and queue analysis. Returns (version id, created).

    An identical file (same content hash) is never added twice: the existing version is used.
    """
    if source not in SOURCES:
        raise ValueError(f"source must be one of {sorted(SOURCES)}")
    existing = db.table("versions").select("id").eq("content_hash", prepared.content_hash).execute().data
    if existing:
        return existing[0]["id"], False

    track = db.table("tracks").insert(
        {"title": prepared.title[:500], "artist": (prepared.artist or None) and prepared.artist[:500], "source": source}
    ).execute().data[0]
    version = db.table("versions").insert(
        {"track_id": track["id"], "content_hash": prepared.content_hash, "path_hint": prepared.path_hint}
    ).execute().data[0]
    for kind, priority in (("analyse", 100), ("preview", 110)):
        db.rpc("enqueue_job", {
            "p_kind": kind, "p_version_id": version["id"], "p_capabilities": [kind],
            "p_dedupe_key": f"{kind}:{version['id']}", "p_priority": priority,
        }).execute()
    return version["id"], True
