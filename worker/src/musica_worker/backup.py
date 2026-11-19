"""Nightly backups of the library database, kept on each Mac.

Two kinds of file, both gzipped, in MUSICA_BACKUP_DIR:

* snapshot (every Mac): every row the signed-in member can read, as JSON lines. Made with
  the normal member sign-in, so it needs no extra secret. `musica-worker backup to-sql`
  turns one into SQL that loads into a freshly migrated database.
* pgdump (only where a database URL is in the Keychain, i.e. Andre's Mac): a `pg_dump`
  of the data in `public` plus `auth.users` / `auth.identities`, as plain SQL. This is the
  full-fidelity restore path, with the original user ids.

The schema itself is in git (supabase/migrations), so both files hold data only.
Rotation keeps the newest 14 of each kind plus the newest of each of the last 12 months.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import re
import shutil
import subprocess
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Iterator

import keyring

from .session import KEYCHAIN_SERVICE

DB_URL_ACCOUNT = "database-url"
FORMAT = 1
PAGE = 1000

# Load order: parents before children. (table, columns that make a row unique, order by)
TABLES: list[tuple[str, str]] = [
    ("allowed_users", "github_id"),
    ("genres", "id"),
    ("style_tags", "id"),
    ("tracks", "id"),
    ("track_style_tags", "track_id,tag_id"),
    ("versions", "id"),
    ("analyses", "id"),
    ("crates", "id"),
    ("crate_tracks", "crate_id,track_id"),
    ("cues", "id"),
    ("runners", "name"),
    ("jobs", "id"),
    ("change_log", "id"),
]
GENERATED = {"tracks": {"search"}}          # computed by Postgres, never inserted
IDENTITY = {"genres", "style_tags", "change_log"}   # "generated always as identity" ids
TEXT_ARRAYS = {"labels", "capabilities"}            # text[] columns; every other list is jsonb

NAME_RE = re.compile(r"^musica-(snapshot|pgdump)-(?P<who>[a-z0-9-]+)-(?P<ts>\d{8}-\d{6})\.(jsonl|sql)\.gz$")


def _stamp(now: dt.datetime) -> str:
    return now.strftime("%Y%m%d-%H%M%S")


def _atomic_gzip(target: Path, write: Callable[[gzip.GzipFile], None]) -> Path:
    tmp = target.with_name(target.name + ".part")
    try:
        with gzip.open(tmp, "wb") as f:
            write(f)
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    return target


# ---------------------------------------------------------------- snapshot (member)

def read_table(db, table: str, order: str) -> Iterator[dict]:
    start = 0
    while True:
        q = db.table(table).select("*")
        for col in order.split(","):
            q = q.order(col)
        rows = q.range(start, start + PAGE - 1).execute().data or []
        yield from rows
        if len(rows) < PAGE:
            return
        start += PAGE


def write_snapshot(db, out_dir: Path, who: str, now: dt.datetime | None = None) -> tuple[Path, dict[str, int]]:
    now = now or dt.datetime.now()
    counts: dict[str, int] = {}

    def write(f):
        head = {"musica_snapshot": FORMAT, "taken_at": now.astimezone().isoformat(), "by": who,
                "tables": [t for t, _ in TABLES]}
        f.write((json.dumps(head) + "\n").encode())
        for table, order in TABLES:
            n = 0
            for row in read_table(db, table, order):
                f.write((json.dumps({"t": table, "r": row}, ensure_ascii=False, default=str) + "\n").encode())
                n += 1
            counts[table] = n
        f.write((json.dumps({"end": counts}) + "\n").encode())

    out_dir.mkdir(parents=True, exist_ok=True)
    path = _atomic_gzip(out_dir / f"musica-snapshot-{who}-{_stamp(now)}.jsonl.gz", write)
    return path, counts


def read_snapshot(path: Path) -> tuple[dict, Iterator[tuple[str, dict]]]:
    """Header and the rows. Raises if the file is cut short (no end marker)."""
    f = gzip.open(path, "rt", encoding="utf-8")
    head = json.loads(f.readline())
    if head.get("musica_snapshot") != FORMAT:
        f.close()
        raise ValueError(f"{path.name} is not a Musica snapshot (format {FORMAT})")

    def rows():
        with f:
            for line in f:
                obj = json.loads(line)
                if "end" in obj:
                    return
                yield obj["t"], obj["r"]
        raise ValueError(f"{path.name} is incomplete (no end marker)")

    return head, rows()


def verify_snapshot(path: Path) -> dict[str, int]:
    _, rows = read_snapshot(path)
    counts: dict[str, int] = {}
    for table, _ in rows:
        counts[table] = counts.get(table, 0) + 1
    return counts


def _literal(value, text_array: bool = False) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if text_array:
        inner = ",".join('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in value)
        return _literal("{" + inner + "}")
    if isinstance(value, (dict, list)):
        return _literal(json.dumps(value, ensure_ascii=False))
    return "'" + str(value).replace("'", "''") + "'"


def snapshot_to_sql(path: Path) -> Iterator[str]:
    """SQL that loads a snapshot into a database that has all migrations and no data yet.

    Run it as the database owner (psql or the SQL editor). Triggers are off while it runs,
    so the change log and timestamps are restored as they were. Members link up again on
    their next sign-in (allowlist user ids are cleared, because a new project gives new ids).
    """
    head, rows = read_snapshot(path)
    note = re.sub(r"[^\w .:+-]", "_", f"{head.get('taken_at')} by {head.get('by')}")
    yield f"-- Musica snapshot taken {note}\n"
    yield "begin;\nset local session_replication_role = replica;\n"
    for table, row in rows:
        row = {k: v for k, v in row.items() if k not in GENERATED.get(table, set())}
        if table == "allowed_users":
            row["user_id"] = None
        cols = ", ".join(f'"{c}"' for c in row)
        vals = ", ".join(_literal(v, k in TEXT_ARRAYS) for k, v in row.items())
        override = " overriding system value" if table in IDENTITY else ""
        yield f"insert into public.{table} ({cols}){override} values ({vals}) on conflict do nothing;\n"
    for table in sorted(IDENTITY):
        yield (f"select setval(pg_get_serial_sequence('public.{table}', 'id'), "
               f"coalesce((select max(id) from public.{table}), 0) + 1, false);\n")
    yield "commit;\n"


# ---------------------------------------------------------------- pg_dump (Andre's Mac)

def store_db_url(url: str) -> None:
    keyring.set_password(KEYCHAIN_SERVICE, DB_URL_ACCOUNT, url)


def stored_db_url() -> str | None:
    return keyring.get_password(KEYCHAIN_SERVICE, DB_URL_ACCOUNT)


def find_pg_dump() -> str | None:
    for p in (os.environ.get("MUSICA_PG_DUMP"), shutil.which("pg_dump"),
              "/opt/homebrew/opt/libpq/bin/pg_dump", "/usr/local/opt/libpq/bin/pg_dump"):
        if p and Path(p).exists():
            return p
    return None


def pg_dump_command(pg_dump: str, db_url: str) -> tuple[list[str], dict[str, str]]:
    """argv and environment. The password goes in the environment, never on the command line."""
    u = urllib.parse.urlsplit(db_url)
    if u.scheme not in ("postgres", "postgresql"):
        raise ValueError("database URL must start with postgresql://")
    env = {"PGPASSWORD": urllib.parse.unquote(u.password or ""), "PGSSLMODE": "require",
           "PGCONNECT_TIMEOUT": "20"}
    q = urllib.parse.parse_qs(u.query)
    if "sslmode" in q:
        env["PGSSLMODE"] = q["sslmode"][0]
    argv = [pg_dump, "--host", u.hostname or "", "--port", str(u.port or 5432),
            "--username", urllib.parse.unquote(u.username or "postgres"),
            "--dbname", (u.path or "/postgres").lstrip("/") or "postgres",
            "--data-only", "--inserts", "--rows-per-insert=500", "--on-conflict-do-nothing",
            "--no-owner", "--no-privileges",
            "--table=public.*", "--table=auth.users", "--table=auth.identities"]
    return argv, env


def write_pgdump(db_url: str, out_dir: Path, who: str, now: dt.datetime | None = None) -> Path:
    pg_dump = find_pg_dump()
    if not pg_dump:
        raise RuntimeError("pg_dump not found: `brew install libpq` (or set MUSICA_PG_DUMP)")
    argv, env = pg_dump_command(pg_dump, db_url)
    now = now or dt.datetime.now()

    def write(f):
        f.write(f"-- Musica pg_dump taken {now.astimezone().isoformat()} by {who}\n".encode())
        f.write(b"set session_replication_role = replica;\n")
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env={**os.environ, **env})
        assert proc.stdout is not None
        shutil.copyfileobj(proc.stdout, f)
        err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        if proc.wait() != 0:
            raise RuntimeError(f"pg_dump failed: {err.strip()[-2000:]}")
        f.write(b"\nset session_replication_role = origin;\n")

    out_dir.mkdir(parents=True, exist_ok=True)
    return _atomic_gzip(out_dir / f"musica-pgdump-{who}-{_stamp(now)}.sql.gz", write)


# ---------------------------------------------------------------- rotation

@dataclass(frozen=True)
class BackupFile:
    path: Path
    kind: str
    who: str
    taken: dt.datetime


def list_backups(out_dir: Path) -> list[BackupFile]:
    found = []
    for p in out_dir.glob("musica-*.gz") if out_dir.exists() else []:
        m = NAME_RE.match(p.name)
        if m:
            found.append(BackupFile(p, m[1], m["who"], dt.datetime.strptime(m["ts"], "%Y%m%d-%H%M%S")))
    return sorted(found, key=lambda b: b.taken, reverse=True)


def to_delete(files: Iterable[BackupFile], keep_last: int = 14, keep_months: int = 12) -> list[BackupFile]:
    """Per kind and Mac: keep the newest `keep_last`, plus the newest file of each of the
    newest `keep_months` months. Everything else can go."""
    groups: dict[tuple[str, str], list[BackupFile]] = {}
    for b in files:
        groups.setdefault((b.kind, b.who), []).append(b)
    doomed = []
    for group in groups.values():
        group.sort(key=lambda b: b.taken, reverse=True)
        keep = set(id(b) for b in group[:keep_last])
        months: dict[tuple[int, int], BackupFile] = {}
        for b in group:
            months.setdefault((b.taken.year, b.taken.month), b)
        for key in sorted(months, reverse=True)[:keep_months]:
            keep.add(id(months[key]))
        doomed += [b for b in group if id(b) not in keep]
    return doomed


def rotate(out_dir: Path) -> list[Path]:
    gone = []
    for b in to_delete(list_backups(out_dir)):
        b.path.unlink(missing_ok=True)
        gone.append(b.path)
    return gone


def write_status(out_dir: Path, status: dict) -> None:
    (out_dir / "last-backup.json").write_text(json.dumps(status, indent=2, default=str) + "\n")
