"""Pluggable playlist exporters. Each one turns a Playlist into the bytes of one file.

M3U8 ships in 1a; Rekordbox XML (1b) plugs in here under the ownership rules.
"""

from .base import Entry, Exporter, Playlist
from .m3u8 import M3U8Exporter

EXPORTERS: dict[str, Exporter] = {"m3u8": M3U8Exporter()}

__all__ = ["EXPORTERS", "Entry", "Exporter", "Playlist"]
