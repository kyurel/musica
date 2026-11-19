import datetime as dt
import gzip
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from musica_worker import backup
from musica_worker.backup import BackupFile, to_delete

REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------- rotation

def _files(days: int, kind="snapshot", who="andre-mac"):
    start = dt.datetime(2026, 1, 1, 3, 30)
    return [BackupFile(Path(f"{kind}-{i}"), kind, who, start + dt.timedelta(days=i)) for i in range(days)]


def test_rotation_keeps_last_14_and_one_per_month():
    files = _files(400)
    doomed = {id(b) for b in to_delete(files)}
    kept = sorted((b for b in files if id(b) not in doomed), key=lambda b: b.taken)
    newest = sorted(files, key=lambda b: b.taken)[-14:]
    assert all(b in kept for b in newest)
    monthly = [b for b in kept if b not in newest]
    # newest-per-month for the 12 newest months, minus the months already covered by the last 14
    assert len({(b.taken.year, b.taken.month) for b in kept}) == 12
    assert all(b.taken.day >= 28 for b in monthly)   # month ends
    assert len(kept) < 30


def test_rotation_is_per_kind_and_mac():
    files = _files(20) + _files(20, kind="pgdump") + _files(20, who="friend-air")
    assert len(to_delete(files)) == 3 * 6   # all in one month: just the newest 14 per group
    assert to_delete(_files(5)) == []


def test_list_backups_ignores_other_files(tmp_path):
    (tmp_path / "musica-snapshot-andre-mac-20261119-033000.jsonl.gz").write_bytes(b"")
    (tmp_path / "musica-pgdump-andre-mac-20261118-033000.sql.gz").write_bytes(b"")
    (tmp_path / "musica-snapshot-andre-mac-20261119-033000.jsonl.gz.part").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("keep me")
    found = backup.list_backups(tmp_path)
    assert [(b.kind, b.taken.day) for b in found] == [("snapshot", 19), ("pgdump", 18)]


# ---------------------------------------------------------------- pg_dump command

def test_pg_dump_password_stays_off_the_command_line():
    argv, env = backup.pg_dump_command(
        "pg_dump", "postgresql://postgres.abc:s%40cret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")
    assert "s@cret" not in " ".join(argv) and env["PGPASSWORD"] == "s@cret"
    assert argv[argv.index("--host") + 1] == "aws-0-eu-central-1.pooler.supabase.com"
    assert argv[argv.index("--username") + 1] == "postgres.abc"
    assert env["PGSSLMODE"] == "require"
    assert "--data-only" in argv and "--table=auth.users" in argv
    with pytest.raises(ValueError):
        backup.pg_dump_command("pg_dump", "https://example.com")


# ---------------------------------------------------------------- snapshot file

class FakeDb:
    """Just enough of the Supabase client: table(t).select('*').order(..).range(a, b).execute()."""

    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        db = self

        class Q:
            def select(self, _):
                return self

            def order(self, _):
                return self

            def range(self, a, b):
                self.slice = (a, b + 1)
                return self

            def execute(self):
                rows = db.tables.get(name, [])[self.slice[0]:self.slice[1]]
                return type("R", (), {"data": rows})()

        return Q()


def test_snapshot_pages_through_tables_and_verifies(tmp_path, monkeypatch):
    monkeypatch.setattr(backup, "PAGE", 2)
    tracks = [{"id": str(i), "title": f"t{i}", "labels": ["a"]} for i in range(5)]
    path, counts = backup.write_snapshot(FakeDb({"tracks": tracks, "genres": [{"id": 1}]}), tmp_path, "andre-mac",
                                         dt.datetime(2026, 11, 19, 3, 30))
    assert path.name == "musica-snapshot-andre-mac-20261119-033000.jsonl.gz"
    assert counts["tracks"] == 5 and counts["genres"] == 1 and counts["cues"] == 0
    assert backup.verify_snapshot(path) == {"genres": 1, "tracks": 5}
    assert not list(tmp_path.glob("*.part"))


def test_cut_short_snapshot_fails_verification(tmp_path):
    path = tmp_path / "musica-snapshot-x-20261119-033000.jsonl.gz"
    with gzip.open(path, "wt") as f:
        f.write(json.dumps({"musica_snapshot": 1, "taken_at": "x", "by": "x", "tables": []}) + "\n")
        f.write(json.dumps({"t": "tracks", "r": {"id": "1"}}) + "\n")
    with pytest.raises(ValueError, match="incomplete"):
        backup.verify_snapshot(path)


def test_sql_literals_quote_untrusted_text():
    assert backup._literal("it's'); drop table x; --") == "'it''s''); drop table x; --'"
    assert backup._literal(["a", 'b"c', "d\\e"], text_array=True) == "'{\"a\",\"b\\\"c\",\"d\\\\e\"}'"
    assert backup._literal(["a"]) == "'[\"a\"]'"        # jsonb list stays JSON
    assert backup._literal({"k": "it's"}) == "'{\"k\": \"it''s\"}'"
    assert backup._literal(None) == "null" and backup._literal(True) == "true"


# ---------------------------------------------------------------- real Postgres round trips
# Needs a Postgres server you can create databases on, e.g.
#   MUSICA_TEST_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres uv run pytest
# Skipped otherwise.

PG_URL = os.environ.get("MUSICA_TEST_PG_URL")
needs_pg = pytest.mark.skipif(not PG_URL or not shutil.which("psql"), reason="MUSICA_TEST_PG_URL not set")
ANDRE, FRIEND = "00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"


def _url(db: str) -> str:
    return PG_URL.rsplit("/", 1)[0] + "/" + db


def _psql(db: str, sql: str = "", file: Path | None = None) -> str:
    args = ["psql", _url(db), "-v", "ON_ERROR_STOP=1", "-qtAX"]
    args += ["-f", str(file)] if file else ["-c", sql]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(f"psql failed: {r.stderr[-3000:]}")
    return r.stdout


def _fresh(name: str) -> str:
    db = f"musica_test_{name}_{uuid.uuid4().hex[:8]}"
    _psql("postgres", f"create database {db}")
    stub = (REPO / "supabase/tests/auth_stub.sql").read_text()
    for role in ("anon", "authenticated"):   # roles are shared by every database on the server
        stub = stub.replace(f"create role {role} nologin;",
                            f"do $$ begin create role {role} nologin; exception when duplicate_object then null; end $$;")
    _psql(db, stub)
    for f in sorted((REPO / "supabase/migrations").glob("*.sql")):
        _psql(db, file=f)
    return db


def _seed(db: str) -> None:
    _psql(db, f"""
      insert into public.allowed_users (github_id, github_login) values (1, 'andre'), (2, 'friend');
      insert into auth.users (id, raw_app_meta_data, raw_user_meta_data) values
        ('{ANDRE}', '{{"provider":"github"}}', '{{"provider_id":"1"}}'),
        ('{FRIEND}', '{{"provider":"github"}}', '{{"provider_id":"2"}}');
      select set_config('request.jwt.claim.sub', '{ANDRE}', false);
      insert into public.genres (slug, name, parent_id, bpm_min, bpm_max) values ('peak-techno', 'Peak Time', 1, 128, 140);
      insert into public.tracks (id, title, artist, labels, notes, bpm, musical_key, genre_id)
        values ('11111111-1111-1111-1111-111111111111', 'It''s "Acid"', 'Rødhåd', '{{wip,"gig, friday"}}',
                e'line1\\nline2 \\\\ back', 142.5, '8A', 2);
      insert into public.versions (id, track_id, content_hash, path_hint, duration_s)
        values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
                repeat('a', 64), 'Inbox/x.flac', 412.123);
      select public.record_analysis('22222222-2222-2222-2222-222222222222', 'librosa-bpm', '1', 'librosa',
                                    '{{"bpm": 142.5, "bpm_confidence": 0.9, "nested": {{"a": [1, "x"]}}}}');
      insert into public.crates (id, name) values ('33333333-3333-3333-3333-333333333333', 'Friday');
      insert into public.crate_tracks (crate_id, track_id, position)
        values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 1);
      insert into public.track_style_tags (track_id, tag_id) values ('11111111-1111-1111-1111-111111111111', 1);
      insert into public.cues (version_id, position_s, label, color)
        values ('22222222-2222-2222-2222-222222222222', 32.5, 'drop', 3);
      select public.register_runner('andre-mac', '{{analyse,heavy}}');
      select public.enqueue_job('analyse', '22222222-2222-2222-2222-222222222222', '{{"x": [1]}}', '{{analyse}}', 'k1');
      update public.tracks set rating = 4 where id = '11111111-1111-1111-1111-111111111111';
    """)


def _dump_tables(db: str, tables: list[str], drop: dict[str, set[str]] | None = None) -> dict:
    out = {}
    for t in tables:
        cols = drop.get(t, set()) if drop else set()
        expr = "to_jsonb(x)" + "".join(f" - '{c}'" for c in cols)
        out[t] = json.loads(_psql(db, f"select coalesce(jsonb_agg({expr} order by to_jsonb(x)::text), '[]') "
                                      f"from {t} x"))
    return out


class PsqlDb:
    """The Supabase client's table reads, served by psql (as the database owner)."""

    def __init__(self, db):
        self.db = db

    def table(self, name):
        db = self.db

        class Q:
            orders: list[str] = []

            def select(self, _):
                self.orders = []
                return self

            def order(self, col):
                self.orders.append(col)
                return self

            def range(self, a, b):
                self.a, self.b = a, b
                return self

            def execute(self):
                sql = (f"select coalesce(json_agg(x), '[]') from (select * from public.{name} "
                       f"order by {', '.join(self.orders)} offset {self.a} limit {self.b - self.a + 1}) x")
                return type("R", (), {"data": json.loads(_psql(db, sql))})()

        return Q()


PUBLIC = [f"public.{t}" for t, _ in backup.TABLES]


@needs_pg
def test_snapshot_restores_into_a_fresh_database(tmp_path):
    src, dst = _fresh("src"), _fresh("dst")
    try:
        _seed(src)
        path, counts = backup.write_snapshot(PsqlDb(src), tmp_path, "andre-mac")
        assert counts["change_log"] > 5
        sql = tmp_path / "restore.sql"
        sql.write_text("".join(backup.snapshot_to_sql(path)))
        _psql(dst, file=sql)
        drop = {"public.allowed_users": {"user_id"}, "public.tracks": {"search"}}
        restored = _dump_tables(dst, PUBLIC, drop)
        assert restored == _dump_tables(src, PUBLIC, drop)
        assert restored["public.tracks"][0]["title"] == 'It\'s "Acid"'
        assert restored["public.tracks"][0]["labels"] == ["wip", "gig, friday"]
        assert _psql(dst, "select count(*) from public.allowed_users where user_id is null").strip() == "2"
        # identity sequences continue after the restored ids
        _psql(dst, "insert into public.genres (slug, name) values ('new-one', 'New')")
    finally:
        for db in (src, dst):
            _psql("postgres", f"drop database {db} with (force)")


@needs_pg
def test_pgdump_restores_with_user_ids(tmp_path):
    src, dst = _fresh("src"), _fresh("dst")
    try:
        _seed(src)
        path = backup.write_pgdump(_url(src) + "?sslmode=disable", tmp_path, "andre-mac")
        with gzip.open(path, "rt") as f:
            sql = f.read()
        assert "set session_replication_role = replica" in sql
        (tmp_path / "restore.sql").write_text(sql)
        _psql(dst, file=tmp_path / "restore.sql")
        tables = PUBLIC + ["auth.users"]
        assert _dump_tables(dst, tables) == _dump_tables(src, tables)
        _psql(dst, "insert into public.genres (slug, name) values ('new-one', 'New')")
    finally:
        for db in (src, dst):
            _psql("postgres", f"drop database {db} with (force)")
