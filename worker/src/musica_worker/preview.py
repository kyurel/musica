"""Previews: a ~128 kbps MP3 for streaming in the app, plus loudness for level-matched A/B."""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

PREVIEW_BITRATE = "128k"


def integrated_lufs(y: np.ndarray, sr: int) -> float | None:
    """Integrated loudness (ITU-R BS.1770). y is (samples,) or (samples, channels)."""
    import pyloudnorm

    if y.size == 0 or len(y) < sr // 2:
        return None
    meter = pyloudnorm.Meter(sr)
    lufs = meter.integrated_loudness(y)
    return round(float(lufs), 2) if np.isfinite(lufs) else None


def make_preview(source: Path, target: Path, ffmpeg: str = "ffmpeg") -> Path:
    """Encode a stereo 44.1 kHz MP3 preview. Tags and artwork are dropped."""
    target.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(source),
        "-map", "0:a:0", "-map_metadata", "-1",
        "-ac", "2", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", PREVIEW_BITRATE,
        str(target),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.strip()[-500:]}")
    return target
