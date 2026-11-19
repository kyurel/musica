import numpy as np
import pytest

from musica_worker.ingest import add_to_library, place_in_library, prepare

from .conftest import SR


@pytest.fixture
def setup(tmp_path, write_wav):
    root = tmp_path / "library"
    root.mkdir()
    y = np.random.default_rng(5).standard_normal(SR).astype(np.float32) * 0.1
    outside = write_wav("Some Track.wav", y)
    return root, outside


def test_file_outside_root_is_copied_into_inbox(setup):
    root, outside = setup
    placed = place_in_library(outside, root)
    assert placed == (root / "Inbox" / "Some Track.wav").resolve()
    assert outside.exists()
    # same file again: reused, not copied twice
    assert place_in_library(outside, root) == placed


def test_file_inside_root_stays_put(setup):
    root, outside = setup
    inside = root / "techno" / "a.wav"
    inside.parent.mkdir()
    inside.write_bytes(outside.read_bytes())
    assert place_in_library(inside, root) == inside.resolve()


def test_name_clash_with_different_content_gets_new_name(setup):
    root, outside = setup
    place_in_library(outside, root)
    different = outside.parent / "sub" / "Some Track.wav"
    different.parent.mkdir()
    different.write_bytes(b"RIFF" + b"\0" * 100)
    assert place_in_library(different, root).name == "Some Track (1).wav"


def test_prepare_uses_filename_as_title(setup):
    root, outside = setup
    p = prepare(outside, root)
    assert p.title == "Some Track"
    assert p.path_hint == "Inbox/Some Track.wav"
    assert len(p.content_hash) == 64


def test_prepare_rejects_non_audio(tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("hi")
    with pytest.raises(ValueError):
        prepare(f, tmp_path)


class FakeDb:
    """Records calls made through the supabase-py builder interface."""

    def __init__(self, existing=None):
        self.existing = existing or []
        self.inserted, self.rpcs = [], []

    def table(self, name):
        db = self

        class T:
            def select(self, *_): return self
            def eq(self, *_): return self
            def insert(self, row):
                db.inserted.append((name, row))
                self.row = {"id": f"{name}-1", **row}
                return self
            def execute(self):
                class R: pass
                r = R()
                r.data = [self.row] if hasattr(self, "row") else db.existing
                return r
        return T()

    def rpc(self, fn, params):
        self.rpcs.append((fn, params))

        class E:
            def execute(self): return None
        return E()


def test_add_creates_track_version_and_jobs(setup):
    root, outside = setup
    db = FakeDb()
    vid, created = add_to_library(db, prepare(outside, root), "ours")
    assert created and vid == "versions-1"
    assert [n for n, _ in db.inserted] == ["tracks", "versions"]
    assert db.inserted[0][1]["source"] == "ours"
    assert [p["p_kind"] for _, p in db.rpcs] == ["analyse", "preview"]
    assert db.rpcs[0][1]["p_dedupe_key"] == "analyse:versions-1"


def test_identical_file_is_not_added_twice(setup):
    root, outside = setup
    db = FakeDb(existing=[{"id": "v-old"}])
    assert add_to_library(db, prepare(outside, root)) == ("v-old", False)
    assert db.inserted == []
