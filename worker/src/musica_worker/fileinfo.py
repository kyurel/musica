"""File facts: content hash, codec, bitrate, tags, and a fake-lossless check."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

LOSSLESS = {"flac", "wav", "aiff", "alac"}


def content_hash(path: Path, chunk: int = 1 << 20) -> str:
    """sha256 of the file bytes. Identical hashes are the only automatic duplicate merge."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


@dataclass
class FileInfo:
    codec: str | None = None
    bitrate_kbps: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None
    channels: int | None = None
    duration_s: float | None = None
    tags: dict[str, str] = field(default_factory=dict)  # title, artist, bpm, key, genre


def _first(tag_value) -> str | None:
    if tag_value is None:
        return None
    if isinstance(tag_value, (list, tuple)):
        return str(tag_value[0]) if tag_value else None
    return str(tag_value)


def read_info(path: Path) -> FileInfo:
    """Read format facts and the few tags we use. Never raises on odd tags."""
    import mutagen

    info = FileInfo()
    audio = mutagen.File(path, easy=True)
    if audio is None:
        return info

    kind = type(audio).__name__.lower()
    codec = {
        "flac": "flac", "wave": "wav", "aiff": "aiff", "easymp3": "mp3", "mp3": "mp3",
        "easymp4": "aac", "mp4": "aac", "oggvorbis": "vorbis", "oggopus": "opus",
    }.get(kind, kind)
    stream = audio.info
    if codec == "aac" and getattr(stream, "codec", "").startswith("alac"):
        codec = "alac"
    info.codec = codec
    info.sample_rate = getattr(stream, "sample_rate", None)
    info.channels = getattr(stream, "channels", None)
    info.bit_depth = getattr(stream, "bits_per_sample", None) or None
    info.duration_s = round(float(stream.length), 3) if getattr(stream, "length", None) else None
    bitrate = getattr(stream, "bitrate", None)
    info.bitrate_kbps = round(bitrate / 1000) if bitrate else None

    tags = audio.tags or {}
    for ours, keys in {
        "title": ("title",), "artist": ("artist",), "genre": ("genre",),
        "bpm": ("bpm",), "key": ("initialkey", "key"),
    }.items():
        for k in keys:
            try:
                value = _first(tags.get(k))
            except (KeyError, ValueError):
                value = None
            if value:
                info.tags[ours] = value.strip()
                break
    _read_id3_key(path, info)
    return info


def _read_id3_key(path: Path, info: FileInfo) -> None:
    """EasyID3 has no key field; read TKEY directly for MP3/AIFF/WAV."""
    if "key" in info.tags:
        return
    try:
        from mutagen.id3 import ID3

        frame = ID3(path).get("TKEY")
        if frame and frame.text:
            info.tags["key"] = str(frame.text[0]).strip()
    except Exception:
        pass


def spectral_cutoff_hz(y: np.ndarray, sr: int, floor_db: float = -80.0) -> float:
    """Highest frequency that still carries real energy, from an averaged spectrum."""
    n_fft = 4096
    if len(y) < n_fft:
        return sr / 2
    hop = n_fft
    frames = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::hop]
    if len(frames) > 400:
        frames = frames[:: len(frames) // 400]
    spectrum = np.mean(np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=1)) ** 2, axis=0)
    db = 10 * np.log10(spectrum / (spectrum.max() + 1e-20) + 1e-20)
    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    above = np.nonzero(db > floor_db)[0]
    return float(freqs[above[-1]]) if len(above) else 0.0


def suspected_fake_lossless(codec: str | None, y: np.ndarray, sr: int) -> bool | None:
    """A lossless file whose spectrum stops early was probably made from an MP3.

    Returns None for lossy files (the check does not apply).
    """
    if codec not in LOSSLESS or sr < 44100:
        return None
    return spectral_cutoff_hz(y, sr) < 19000
