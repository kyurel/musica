import numpy as np
import pytest
import soundfile as sf

SR = 44100


def kick_loop(bpm: float, seconds: float = 20, sr: int = SR) -> np.ndarray:
    """Four-on-the-floor sine kicks with an offbeat hat."""
    y = np.zeros(int(seconds * sr), dtype=np.float32)
    beat = 60.0 / bpm
    t = np.arange(int(0.15 * sr)) / sr
    kick = (np.sin(2 * np.pi * 55 * t * (1 + 2 * np.exp(-t * 40))) * np.exp(-t * 18)).astype(np.float32)
    rng = np.random.default_rng(0)
    hat = (rng.standard_normal(int(0.03 * sr)) * np.exp(-np.arange(int(0.03 * sr)) / sr * 150) * 0.2).astype(np.float32)
    n = 0
    while (start := int(n * beat * sr)) < len(y):
        end = min(len(y), start + len(kick))
        y[start:end] += kick[: end - start]
        h = int((n + 0.5) * beat * sr)
        if h < len(y):
            e = min(len(y), h + len(hat))
            y[h:e] += hat[: e - h]
        n += 1
    return y * 0.8


def chord_pad(notes_hz: list[float], seconds: float = 12, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    y = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) for f in notes_hz)
    return (y / (len(notes_hz) * 1.6)).astype(np.float32)


def hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


@pytest.fixture
def write_wav(tmp_path):
    def _write(name: str, y: np.ndarray, sr: int = SR, subtype: str = "PCM_16"):
        path = tmp_path / name
        sf.write(path, y, sr, subtype=subtype)
        return path
    return _write
