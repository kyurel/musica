import hashlib

import numpy as np
from scipy.signal import butter, sosfilt

from musica_worker.fileinfo import content_hash, read_info, spectral_cutoff_hz, suspected_fake_lossless

from .conftest import SR


def test_content_hash_is_sha256_of_bytes(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"musica")
    assert content_hash(p) == hashlib.sha256(b"musica").hexdigest()


def test_reads_flac_facts_and_tags(write_wav):
    import mutagen

    y = np.random.default_rng(2).standard_normal(SR * 2).astype(np.float32) * 0.1
    path = write_wav("t.flac", np.stack([y, y], axis=1), subtype="PCM_24")
    f = mutagen.File(path)
    f["title"], f["artist"], f["bpm"], f["initialkey"] = "Acid Line", "Andre", "145", "8A"
    f.save()
    info = read_info(path)
    assert (info.codec, info.sample_rate, info.channels, info.bit_depth) == ("flac", SR, 2, 24)
    assert abs(info.duration_s - 2.0) < 0.01
    assert info.tags == {"title": "Acid Line", "artist": "Andre", "bpm": "145", "key": "8A"}


def test_lowpassed_flac_is_suspected_fake():
    noise = np.random.default_rng(3).standard_normal(SR * 4)
    sos = butter(16, 16000, fs=SR, output="sos")
    fake = sosfilt(sos, noise)
    assert spectral_cutoff_hz(fake, SR) < 19000
    assert suspected_fake_lossless("flac", fake, SR) is True
    assert suspected_fake_lossless("flac", noise, SR) is False
    assert suspected_fake_lossless("mp3", fake, SR) is None
