from pathlib import Path

import mutagen
import numpy as np
import pytest

from musica_worker.analyse import analyse_file
from musica_worker.jobs import Job, PermanentError, VersionRef, Worker, resolve_audio
from musica_worker.preview import integrated_lufs, make_preview
from musica_worker.tempo import BpmRange

from .conftest import SR, chord_pad, hz, kick_loop


class FakeQueue:
    def __init__(self, jobs, versions):
        self.jobs = list(jobs)
        self.versions = versions
        self.done, self.failed, self.analyses, self.previews = {}, {}, [], {}

    def register(self, runner, capabilities): pass
    def claim(self, runner): return self.jobs.pop(0) if self.jobs else None
    def heartbeat(self, job_id, runner): return True
    def complete(self, job_id, runner, result): self.done[job_id] = result; return True
    def fail(self, job_id, runner, error, retry=True): self.failed[job_id] = (error, retry); return True
    def version(self, version_id): return self.versions[version_id]
    def record_analysis(self, version_id, result, job_id): self.analyses.append((version_id, result))
    def set_preview(self, version_id, key): self.previews[version_id] = key


class FakeUploader:
    def __init__(self): self.files = {}
    def upload_preview(self, version_id, file: Path):
        self.files[version_id] = file.read_bytes()
        return f"previews/{version_id}.mp3"


@pytest.fixture
def library(tmp_path):
    root = tmp_path / "library"
    (root / "psy").mkdir(parents=True)
    pad = chord_pad([hz(57), hz(60), hz(64)], 20)
    y = kick_loop(145, 20) + pad * 0.5
    import soundfile as sf
    path = root / "psy" / "track.flac"
    sf.write(path, np.stack([y, y], axis=1) * 0.7, SR, subtype="PCM_24")
    return root


def test_resolve_audio_refuses_escapes(library):
    assert resolve_audio(library, "psy/track.flac").name == "track.flac"
    with pytest.raises(PermanentError, match="escapes"):
        resolve_audio(library, "../../etc/passwd")
    with pytest.raises(PermanentError, match="not found"):
        resolve_audio(library, "psy/missing.flac")


def test_analyse_file_values(library):
    f = mutagen.File(library / "psy" / "track.flac")
    f["bpm"] = "145"
    f.save()
    results = {r.analyser: r for r in analyse_file(library / "psy" / "track.flac", BpmRange(138, 150))}
    facts = results["fileinfo"].values
    assert facts["codec"] == "flac" and facts["sample_rate"] == SR and facts["channels"] == 2
    assert -30 < facts["preview_lufs"] < 0
    assert facts["suspected_fake_lossless"] is False

    heard = results["librosa-bpm-key"].values
    assert abs(heard["bpm"] - 145) < 2
    assert heard["key"] == "8A"

    tag = results["file-tags"]
    assert tag.source == "tag"
    assert tag.values["bpm"] == 145.0 and tag.values["bpm_confidence"] == 0.95


def test_worker_runs_analyse_job(library):
    q = FakeQueue([Job("j1", "analyse", "v1")], {"v1": VersionRef("psy/track.flac", BpmRange(138, 150))})
    w = Worker(q, "andre-mac", ["analyse"], library)
    assert w.run_one() is True
    assert "j1" in q.done
    assert {r.analyser for _, r in q.analyses} >= {"fileinfo", "librosa-bpm-key"}
    assert w.run_one() is False


def test_missing_file_fails_without_retry(library):
    q = FakeQueue([Job("j1", "analyse", "v1")], {"v1": VersionRef("nope.flac", None)})
    Worker(q, "andre-mac", ["analyse"], library).run_one()
    assert q.failed["j1"][1] is False


def test_unknown_kind_fails_without_retry(library):
    q = FakeQueue([Job("j1", "rebuild", "v1")], {})
    Worker(q, "andre-mac", ["analyse"], library).run_one()
    assert q.failed["j1"] == ("this worker cannot do 'rebuild' jobs", False)


def test_unexpected_errors_are_retried(library, monkeypatch):
    q = FakeQueue([Job("j1", "analyse", "v1")], {"v1": VersionRef("psy/track.flac", None)})
    monkeypatch.setattr("musica_worker.jobs.analyse_file", lambda *a: (_ for _ in ()).throw(OSError("disk")))
    Worker(q, "andre-mac", ["analyse"], library).run_one()
    assert q.failed["j1"] == ("OSError: disk", True)


def test_preview_job_encodes_and_uploads(library):
    q = FakeQueue([Job("j1", "preview", "v1")], {"v1": VersionRef("psy/track.flac", None)})
    up = FakeUploader()
    Worker(q, "andre-mac", ["preview"], library, uploader=up).run_one()
    assert q.done["j1"] == {"preview_key": "previews/v1.mp3"}
    assert q.previews["v1"] == "previews/v1.mp3"
    assert len(up.files["v1"]) > 10_000


def test_preview_is_128k_stereo_mp3(library, tmp_path):
    out = make_preview(library / "psy" / "track.flac", tmp_path / "p.mp3")
    info = mutagen.File(out).info
    assert info.channels == 2 and info.sample_rate == 44100
    assert 120_000 <= info.bitrate <= 136_000


def test_lufs_of_silence_and_tone():
    assert integrated_lufs(np.zeros(10), SR) is None
    t = np.arange(SR * 3) / SR
    loud = integrated_lufs(0.5 * np.sin(2 * np.pi * 1000 * t), SR)
    quiet = integrated_lufs(0.05 * np.sin(2 * np.pi * 1000 * t), SR)
    assert abs((loud - quiet) - 20) < 0.5
