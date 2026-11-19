import json
from pathlib import Path

from musica_worker.export import (Selection, build_playlist, compatible_keys, newest_file,
                                  safe_filename, write_playlist)
from musica_worker.exporters import Entry, Playlist
from musica_worker.exporters.m3u8 import render_m3u8

GOLDEN = Path(__file__).resolve().parents[2] / "testdata" / "golden"


def test_m3u8_matches_golden_file():
    data = json.loads((GOLDEN / "m3u8-input.json").read_text())
    pl = Playlist(data["name"], [Entry(**e) for e in data["entries"]])
    assert render_m3u8(pl) == (GOLDEN / "basic.m3u8").read_text(encoding="utf-8")


def test_untrusted_titles_cannot_add_lines():
    pl = Playlist("x", [Entry(path="/a.mp3", title="t\n/evil.mp3\u2028#EXTINF")])
    lines = render_m3u8(pl).splitlines()
    assert lines == ["#EXTM3U", "#PLAYLIST:x", "#EXTINF:-1,t /evil.mp3 #EXTINF", "/a.mp3"]


def test_compatible_keys_match_web():
    assert compatible_keys("8A") == ["8A", "9A", "7A", "8B"]
    assert compatible_keys("12B") == ["12B", "1B", "11B", "12A"]
    assert compatible_keys("1A") == ["1A", "2A", "12A", "1B"]
    assert compatible_keys("atonal") == ["atonal"]


def test_newest_live_file_wins():
    vs = [{"path_hint": "a.wav", "created_at": "2026-01-01", "deleted_at": None},
          {"path_hint": "b.wav", "created_at": "2026-03-01", "deleted_at": None},
          {"path_hint": "c.wav", "created_at": "2026-05-01", "deleted_at": "2026-06-01"},
          {"path_hint": None, "created_at": "2026-07-01", "deleted_at": None}]
    assert newest_file(vs)["path_hint"] == "b.wav"
    assert newest_file([]) is None


def test_build_playlist_paths_on_this_mac(tmp_path):
    (tmp_path / "Inbox").mkdir()
    (tmp_path / "Inbox" / "here.flac").write_bytes(b"x")
    tracks = [
        {"id": "1", "title": "Here", "artist": "A", "bpm": 140, "musical_key": "8A",
         "versions": [{"path_hint": "Inbox/here.flac", "duration_s": "301.2", "created_at": "1", "deleted_at": None}]},
        {"id": "2", "title": "Syncing", "artist": None, "bpm": None, "musical_key": None,
         "versions": [{"path_hint": "Inbox/later.flac", "duration_s": None, "created_at": "1", "deleted_at": None}]},
        {"id": "3", "title": "No file", "versions": []},
    ]
    built = build_playlist("Set", tracks, tmp_path)
    assert [e.path for e in built.playlist.entries] == [str(tmp_path / "Inbox/here.flac"),
                                                       str(tmp_path / "Inbox/later.flac")]
    assert built.playlist.entries[0].duration_s == 301.2
    assert built.not_on_this_mac == ["Syncing"]
    assert built.no_file == ["No file"]


def test_write_playlist_is_stable_and_safe(tmp_path):
    pl = Playlist("Peak: 145/150?", [Entry(path="/a.mp3", title="A")])
    first = write_playlist(pl, tmp_path)
    second = write_playlist(pl, tmp_path)
    assert first == second == tmp_path / "Peak 145 150.m3u8"
    assert first.read_text().startswith("#EXTM3U\n")
    assert [p.name for p in tmp_path.iterdir()] == ["Peak 145 150.m3u8"]
    assert safe_filename("../..") == "playlist"


def test_default_names():
    assert Selection(crate="Friday").default_name() == "Friday"
    assert Selection(genre="psytrance", bpm_min=140, bpm_max=146).default_name() == "psytrance 140-146 bpm"
    assert Selection(key="8A", mixable=True).default_name() == "8A mix"
    assert Selection().default_name() == "All tracks"


def _client():
    from supabase import create_client
    return create_client("https://example.supabase.co", "x" * 40)


def test_filters_build_the_same_query_as_the_web_app(monkeypatch):
    from musica_worker import export

    db = _client()
    sel = Selection(search="acid", bpm_min=138, bpm_max=150, key="8A", mixable=True,
                    source="ours", labels=["gig"], review=True)
    raw = str(export._filtered(db, sel).request.params)
    params = dict(p.split("=", 1) for p in raw.split("&"))
    assert params["search"] == "wfts%28simple%29.acid"
    assert "bpm=gte.138" in raw and "bpm=lte.150" in raw
    assert params["musical_key"] == "in.%288A%2C9A%2C7A%2C8B%29"
    assert params["source"] == "eq.ours"
    assert params["labels"] == "cs.%7Bgig%7D"
    assert params["needs_review"] == "eq.true"
    assert params["deleted_at"] == "is.null"
    assert params["order"] == "created_at.desc"
