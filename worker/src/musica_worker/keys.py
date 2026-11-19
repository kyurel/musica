"""Musical key: detection from audio and Camelot notation.

Keys are stored as Camelot codes ("8A" = A minor) or "atonal". The UI shows both
Camelot and musical notation, using the helpers here.
"""

from __future__ import annotations

import numpy as np

PITCHES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
ATONAL = "atonal"

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Below this correlation, no key fits well enough (drum tools, noise, FX).
ATONAL_THRESHOLD = 0.55


def to_camelot(pitch_class: int, minor: bool) -> str:
    """Pitch class (0 = C) and mode to a Camelot code. C major = 8B, A minor = 8A."""
    major_pc = (pitch_class + 3) % 12 if minor else pitch_class
    number = (7 * major_pc % 12 + 7) % 12 + 1
    return f"{number}{'A' if minor else 'B'}"


def from_camelot(code: str) -> tuple[int, bool]:
    """Camelot code to (pitch class, minor)."""
    number, letter = int(code[:-1]), code[-1].upper()
    if not 1 <= number <= 12 or letter not in "AB":
        raise ValueError(f"not a Camelot code: {code}")
    major_pc = (7 * (number - 8)) % 12
    minor = letter == "A"
    return ((major_pc - 3) % 12 if minor else major_pc), minor


def notation(code: str) -> str:
    """'8A' -> 'A minor', 'atonal' -> 'atonal'."""
    if code == ATONAL:
        return ATONAL
    pc, minor = from_camelot(code)
    return f"{PITCHES[pc]} {'minor' if minor else 'major'}"


def parse_key_tag(text: str | None) -> str | None:
    """Read a key from a file tag. Accepts Camelot ('8A'), 'Am', 'A minor', 'F#m', 'Bbmaj'."""
    if not text:
        return None
    t = text.strip()
    if t.lower() in ("atonal", "none", "o", "x"):
        return ATONAL
    upper = t.upper()
    if upper[-1:] in ("A", "B") and upper[:-1].isdigit() and 1 <= int(upper[:-1]) <= 12:
        return f"{int(upper[:-1])}{upper[-1]}"
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    if not t or t[0].upper() not in names:
        return None
    pc = names[t[0].upper()]
    rest = t[1:]
    if rest[:1] in ("#", "♯"):
        pc, rest = (pc + 1) % 12, rest[1:]
    elif rest[:1] in ("b", "♭") and not rest.lower().startswith("b "):
        pc, rest = (pc - 1) % 12, rest[1:]
    rest = rest.strip().lower()
    if rest in ("m", "min", "minor"):
        return to_camelot(pc, True)
    if rest in ("", "maj", "major"):
        return to_camelot(pc, False)
    return None


def estimate_key(chroma_mean: np.ndarray) -> tuple[str, float]:
    """Best-fitting key for a 12-bin mean chroma vector.

    Returns (camelot code or 'atonal', confidence 0..1).
    """
    chroma = np.asarray(chroma_mean, dtype=float)
    if chroma.shape != (12,) or not np.isfinite(chroma).all() or chroma.std() < 1e-6:
        return ATONAL, 0.5

    scores = []
    for minor, profile in ((False, _MAJOR), (True, _MINOR)):
        for pc in range(12):
            r = float(np.corrcoef(chroma, np.roll(profile, pc))[0, 1])
            scores.append((r, pc, minor))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]

    if best[0] < ATONAL_THRESHOLD:
        return ATONAL, round(min(1.0, 0.5 + (ATONAL_THRESHOLD - best[0])), 3)

    margin = best[0] - second[0]
    confidence = min(1.0, 0.4 + best[0] * 0.3 + margin * 3)
    return to_camelot(best[1], best[2]), round(confidence, 3)


def detect_key(y: np.ndarray, sr: int) -> tuple[str, float]:
    """Key of a mono signal."""
    import librosa

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    return estimate_key(chroma.mean(axis=1))
