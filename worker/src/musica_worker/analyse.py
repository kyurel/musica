"""The 'analyse' job: everything the Library needs to know about one audio file.

Produces a list of results; each becomes one record_analysis() call, so every value
keeps its own source and confidence in the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from . import __version__
from .fileinfo import read_info, suspected_fake_lossless
from .keys import detect_key, parse_key_tag
from .preview import integrated_lufs
from .tempo import BpmRange, agrees, detect_bpm, fold_into_range, parse_bpm_tag

ANALYSIS_SR = 22050


@dataclass
class AnalysisResult:
    analyser: str
    analyser_version: str
    source: str  # matches the *_source columns: 'tag', 'librosa', ...
    values: dict[str, Any]


def analyse_file(path: Path, genre_range: BpmRange | None = None) -> list[AnalysisResult]:
    import librosa

    info = read_info(path)
    results: list[AnalysisResult] = []

    # file facts
    full, native_sr = _load_full(path)
    mono_native = full.mean(axis=1) if full.ndim == 2 else full
    file_values: dict[str, Any] = {
        k: v for k, v in {
            "codec": info.codec, "bitrate_kbps": info.bitrate_kbps, "sample_rate": info.sample_rate or native_sr,
            "bit_depth": info.bit_depth, "channels": info.channels,
            "duration_s": info.duration_s or round(len(full) / native_sr, 3),
            "suspected_fake_lossless": suspected_fake_lossless(info.codec, mono_native, native_sr),
            "preview_lufs": integrated_lufs(full, native_sr),
        }.items() if v is not None
    }
    results.append(AnalysisResult("fileinfo", __version__, "librosa", file_values))

    # analysis signal
    y = librosa.resample(mono_native.astype(np.float32), orig_sr=native_sr, target_sr=ANALYSIS_SR) \
        if native_sr != ANALYSIS_SR else mono_native.astype(np.float32)

    detected_bpm, bpm_conf = detect_bpm(y, ANALYSIS_SR)
    folded, hint = fold_into_range(detected_bpm, genre_range)
    key, key_conf = detect_key(y, ANALYSIS_SR)
    detected = {"bpm": round(folded, 2), "bpm_confidence": bpm_conf, "key": key, "key_confidence": key_conf}
    if hint:
        detected["bpm_fold"] = hint
        detected["bpm_raw"] = detected_bpm

    # Tags win when they agree with what we hear (BPM tag first, per scope).
    tag_values: dict[str, Any] = {}
    tag_bpm = parse_bpm_tag(info.tags.get("bpm"))
    if tag_bpm is not None:
        trusted = agrees(tag_bpm, detected_bpm)
        tag_values.update(bpm=tag_bpm, bpm_confidence=0.95 if trusted else 0.4)
        if not trusted:
            tag_values["bpm_disagrees_with_audio"] = detected_bpm
    tag_key = parse_key_tag(info.tags.get("key"))
    if tag_key is not None:
        trusted = tag_key == key
        tag_values.update(key=tag_key, key_confidence=0.9 if trusted else 0.6)
    if tag_values:
        results.append(AnalysisResult("file-tags", __version__, "tag", tag_values))

    results.append(AnalysisResult("librosa-bpm-key", f"{__version__}+librosa{librosa.__version__}",
                                  "librosa", detected))
    return results


def _load_full(path: Path) -> tuple[np.ndarray, int]:
    """Decode the whole file at its native rate. soundfile first, librosa (audioread/ffmpeg) for MP3/AAC."""
    import soundfile as sf

    try:
        data, sr = sf.read(str(path), always_2d=False, dtype="float32")
        return data, sr
    except Exception:
        import librosa

        y, sr = librosa.load(str(path), sr=None, mono=False)
        return (y.T if y.ndim == 2 else y), sr
