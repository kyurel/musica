"""What every exporter gets: a named, ordered list of files on this Mac."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class Entry:
    path: str                  # where the file is on this Mac (absolute, or relative to the playlist)
    title: str
    artist: str | None = None
    duration_s: float | None = None
    bpm: float | None = None
    key: str | None = None     # Camelot code or 'atonal'
    track_id: str | None = None


@dataclass
class Playlist:
    name: str
    entries: list[Entry] = field(default_factory=list)


class Exporter(Protocol):
    suffix: str                # file extension, with the dot

    def render(self, playlist: Playlist) -> bytes: ...
