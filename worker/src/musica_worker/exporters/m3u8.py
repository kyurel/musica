"""Extended M3U, UTF-8 (.m3u8). Read by Rekordbox, Traktor, Serato, VLC, Music.

Titles and artists are untrusted text: line breaks and other control characters are
replaced, so a title can never add a line (and so a path) to the playlist.
Mirrors apps/web/src/lib/m3u8.ts; both are checked against testdata/golden/.
"""

from __future__ import annotations

import math
import re

from .base import Entry, Playlist

_CONTROL = re.compile(r"[\x00-\x1f\x7f\u2028\u2029]+")


def clean(text: str | None) -> str:
    return _CONTROL.sub(" ", text or "").strip()


def _seconds(duration_s: float | None) -> int:
    if duration_s is None or not math.isfinite(duration_s) or duration_s < 0:
        return -1
    return int(math.floor(duration_s + 0.5))   # half up, same as Math.round in the web app


def _path_line(path: str) -> str | None:
    if not path or _CONTROL.search(path):
        return None   # a path with a line break cannot be written safely
    return "./" + path if path.startswith("#") else path


def render_m3u8(playlist: Playlist) -> str:
    lines = ["#EXTM3U", f"#PLAYLIST:{clean(playlist.name)}"]
    for e in playlist.entries:
        path = _path_line(e.path)
        if path is None:
            continue
        artist, title = clean(e.artist), clean(e.title)
        lines.append(f"#EXTINF:{_seconds(e.duration_s)},{f'{artist} - {title}' if artist else title}")
        lines.append(path)
    return "\n".join(lines) + "\n"


class M3U8Exporter:
    suffix = ".m3u8"

    def render(self, playlist: Playlist) -> bytes:
        return render_m3u8(playlist).encode("utf-8")


def skipped(entries: list[Entry]) -> list[Entry]:
    """Entries render_m3u8 leaves out because their path is unsafe."""
    return [e for e in entries if _path_line(e.path) is None]
