"""BPM: detection, file-tag reading and genre-range folding."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class BpmRange:
    low: float
    high: float


def fold_into_range(bpm: float, rng: BpmRange | None) -> tuple[float, str | None]:
    """Halve or double a BPM until it lands in the genre's typical range.

    Returns (bpm, hint) where hint is 'doubled', 'halved' or None.
    Detectors often report half or double time; the UI offers the same one-click fix.
    """
    if rng is None or bpm <= 0:
        return bpm, None
    if rng.low <= bpm <= rng.high:
        return bpm, None
    for factor, hint in ((2.0, "doubled"), (0.5, "halved")):
        candidate = bpm * factor
        if rng.low <= candidate <= rng.high:
            return candidate, hint
    return bpm, None


def parse_bpm_tag(text: str | float | None) -> float | None:
    """BPM from a file tag ('140', '140.00', 140.0). None if missing or silly."""
    if text is None:
        return None
    try:
        bpm = float(str(text).strip().replace(",", "."))
    except ValueError:
        return None
    return round(bpm, 2) if 40 <= bpm <= 300 else None


def agrees(a: float, b: float, tolerance: float = 0.03) -> bool:
    """True when two BPMs match, allowing half/double time."""
    for factor in (1.0, 2.0, 0.5):
        if abs(a * factor - b) <= b * tolerance:
            return True
    return False


def detect_bpm(y: np.ndarray, sr: int) -> tuple[float, float]:
    """Tempo of a mono signal. Returns (bpm, confidence 0..1)."""
    import librosa

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    if bpm <= 0 or len(beats) < 8:
        return bpm, 0.1

    # Steady beat intervals mean a confident estimate.
    intervals = np.diff(beats)
    cv = float(np.std(intervals) / np.mean(intervals))
    confidence = max(0.1, min(0.9, 1.0 - cv * 4))

    # Refine with the median interval, which is less quantised than the tempo grid.
    refined = 60.0 / float(np.median(intervals))
    if abs(refined - bpm) / bpm < 0.04:
        bpm = refined
    return round(bpm, 2), round(confidence, 3)
