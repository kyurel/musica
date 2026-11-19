"""musica-worker command line."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        sys.exit(f"missing setting {name} (see .env.example)")
    return value


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="musica-worker", description="Musica analysis worker")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="sign in with GitHub and keep the token in the Keychain")
    sub.add_parser("logout", help="forget the stored token")
    sub.add_parser("run", help="claim and run jobs until stopped")
    add = sub.add_parser("add", help="add audio files or folders to the library and queue analysis")
    add.add_argument("paths", nargs="+", type=Path)
    add.add_argument("--source", default="reference",
                     help="ours, reference, commercial, promo or sample_pack (default: reference)")
    one = sub.add_parser("analyse", help="analyse one local file and print the results (no database)")
    one.add_argument("file", type=Path)
    one.add_argument("--bpm-range", help="genre BPM range, e.g. 138-150")

    exp = sub.add_parser("export", help="write a playlist file (M3U8) for a crate or a filtered view")
    exp.add_argument("format", choices=["m3u8"])
    exp.add_argument("--crate", help="crate name (keeps crate order)")
    exp.add_argument("--search", help="free text, like the library search box")
    exp.add_argument("--genre", help="genre slug, e.g. hard-groove")
    exp.add_argument("--bpm", help="BPM range, e.g. 138-150")
    exp.add_argument("--key", help="Camelot key, e.g. 8A, or atonal")
    exp.add_argument("--mixable", action="store_true", help="include harmonically compatible keys")
    exp.add_argument("--source", help="ours, reference, commercial, promo or sample_pack")
    exp.add_argument("--label", action="append", default=[], help="status label (repeatable)")
    exp.add_argument("--review", action="store_true", help="only tracks that need review")
    exp.add_argument("--name", help="playlist name (default: from the crate or filters)")
    exp.add_argument("--out", type=Path, help="folder (default: MUSICA_EXPORT_DIR)")

    svc = sub.add_parser("service", help="start the worker at login on this Mac (launchd)")
    svc_sub = svc.add_subparsers(dest="action", required=True)
    svc_on = svc_sub.add_parser("install", help="run the worker from login, restart it if it crashes")
    svc_on.add_argument("--env-file", type=Path, default=Path("../.env"), help="settings file (default ../.env)")
    svc_sub.add_parser("uninstall", help="stop starting the worker at login")

    bk = sub.add_parser("backup", help="back up the library database to this Mac")
    bk_sub = bk.add_subparsers(dest="action", required=True)
    bk_sub.add_parser("run", help="make a backup now and prune old ones")
    sch = bk_sub.add_parser("schedule", help="run the backup every night (launchd)")
    sch.add_argument("--at", default="03:30", help="time of day, HH:MM (default 03:30)")
    sch.add_argument("--env-file", type=Path, default=Path("../.env"), help="settings file (default ../.env)")
    bk_sub.add_parser("unschedule", help="stop the nightly backup")
    bk_sub.add_parser("set-db-url", help="store the database URL in the Keychain (enables pg_dump)")
    bk_sub.add_parser("forget-db-url", help="remove the database URL from the Keychain")
    ver = bk_sub.add_parser("verify", help="check a snapshot file is complete and count its rows")
    ver.add_argument("file", type=Path)
    tosql = bk_sub.add_parser("to-sql", help="print SQL that restores a snapshot into a fresh database")
    tosql.add_argument("file", type=Path)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.cmd == "analyse":
        from .analyse import analyse_file
        from .tempo import BpmRange

        rng = None
        if args.bpm_range:
            low, high = (float(x) for x in args.bpm_range.split("-"))
            rng = BpmRange(low, high)
        for r in analyse_file(args.file, rng):
            print(json.dumps({"analyser": r.analyser, "source": r.source, "values": r.values}, default=str))
        return

    if args.cmd == "service":
        _service(args)
        return
    if args.cmd == "backup" and args.action != "run":
        _backup_offline(args)
        return

    from . import session

    runner = _env("MUSICA_RUNNER_NAME")
    url, anon = _env("MUSICA_SUPABASE_URL"), _env("MUSICA_SUPABASE_ANON_KEY")

    if args.cmd == "login":
        print(f"Signed in as {session.login(url, anon, runner)}")
        return
    if args.cmd == "logout":
        session.logout(runner)
        return

    if args.cmd == "export":
        _export(args, session.signed_in_client(url, anon, runner))
        return
    if args.cmd == "backup":
        _backup_run(session.signed_in_client(url, anon, runner), runner)
        return

    if args.cmd == "add":
        from .ingest import AUDIO_SUFFIXES, add_to_library, prepare

        client = session.signed_in_client(url, anon, runner)
        root = Path(_env("MUSICA_LIBRARY_ROOT")).expanduser()
        files = []
        for p in args.paths:
            p = p.expanduser()
            files += sorted(f for f in p.rglob("*") if f.suffix.lower() in AUDIO_SUFFIXES) if p.is_dir() else [p]
        for f in files:
            try:
                version_id, created = add_to_library(client, prepare(f, root), args.source)
                print(f"{'added' if created else 'already in library'}: {f.name}")
            except Exception as e:  # keep going through a folder
                print(f"skipped {f.name}: {e}")
        return

    from .jobs import Worker
    from .supabase_queue import SupabaseQueue
    from .uploader import PresignedUploader

    client = session.signed_in_client(url, anon, runner)
    caps = [c.strip() for c in _env("MUSICA_CAPABILITIES", "analyse").split(",") if c.strip()]
    api = os.environ.get("MUSICA_API_URL")
    uploader = PresignedUploader(api, lambda: client.auth.get_session().access_token) if api else None
    if "preview" in caps and uploader is None:
        logging.warning("no MUSICA_API_URL: not taking preview jobs")
        caps.remove("preview")

    Worker(queue=SupabaseQueue(client), runner=runner, capabilities=caps,
           library_root=Path(_env("MUSICA_LIBRARY_ROOT")).expanduser(), uploader=uploader).run_forever()


def _backup_dir() -> Path:
    return Path(os.environ.get("MUSICA_BACKUP_DIR") or "~/Musica Backups").expanduser()


def _export(args, client) -> None:
    from .export import Selection, build_playlist, fetch_tracks, write_playlist

    bpm_min = bpm_max = None
    if args.bpm:
        low, _, high = args.bpm.partition("-")
        bpm_min, bpm_max = (float(low) if low else None), (float(high) if high else None)
    sel = Selection(crate=args.crate, search=args.search, genre=args.genre, bpm_min=bpm_min,
                    bpm_max=bpm_max, key=args.key, mixable=args.mixable, source=args.source,
                    labels=args.label, review=args.review)
    root = Path(_env("MUSICA_LIBRARY_ROOT")).expanduser()
    out = (args.out or Path(os.environ.get("MUSICA_EXPORT_DIR") or "~/Music/Musica Exports")).expanduser()
    try:
        built = build_playlist(args.name or sel.default_name(), fetch_tracks(client, sel), root)
    except ValueError as e:
        sys.exit(str(e))
    path = write_playlist(built.playlist, out, args.format)
    print(f"{len(built.playlist.entries)} tracks -> {path}")
    if built.not_on_this_mac:
        print(f"{len(built.not_on_this_mac)} listed but not on this Mac yet (Syncthing still copying?): "
              + ", ".join(built.not_on_this_mac[:10]))
    if built.no_file:
        print(f"{len(built.no_file)} left out, no file in the library: " + ", ".join(built.no_file[:10]))


def _backup_run(client, runner: str) -> None:
    import datetime as dt

    from . import backup

    out = _backup_dir()
    status: dict = {"started": dt.datetime.now().astimezone().isoformat(), "runner": runner, "files": []}
    failed = False
    try:
        path, counts = backup.write_snapshot(client, out, runner)
        status["files"].append(str(path))
        status["rows"] = counts
        print(f"snapshot: {path} ({sum(counts.values())} rows)")
    except Exception as e:
        failed = True
        status["snapshot_error"] = str(e)
        logging.exception("snapshot failed")
    db_url = backup.stored_db_url()
    if db_url:
        try:
            path = backup.write_pgdump(db_url, out, runner)
            status["files"].append(str(path))
            print(f"pg_dump: {path}")
        except Exception as e:
            failed = True
            status["pgdump_error"] = str(e)
            logging.error("pg_dump failed: %s", e)
    removed = backup.rotate(out)
    if removed:
        print(f"pruned {len(removed)} old backups")
    status["ok"] = not failed
    status["finished"] = dt.datetime.now().astimezone().isoformat()
    backup.write_status(out, status)
    if failed:
        sys.exit(1)


def _launchd_inputs(env_file: Path) -> tuple[Path, Path, str]:
    import shutil

    env_file = env_file.expanduser().resolve()
    if not env_file.exists():
        sys.exit(f"settings file not found: {env_file}")
    uv = shutil.which("uv") or sys.exit("uv not found on PATH")
    return Path(__file__).resolve().parents[2], env_file, uv


def _service(args) -> None:
    from . import schedule

    if args.action == "install":
        worker_dir, env_file, uv = _launchd_inputs(args.env_file)
        log = Path.home() / "Library" / "Logs" / "musica-worker.log"
        target = schedule.install(schedule.make_worker_plist(worker_dir, env_file, uv, log), schedule.WORKER_LABEL)
        print(f"The worker now starts at login and is running ({target}). Log: {log}")
    else:
        stopped = schedule.uninstall(schedule.WORKER_LABEL)
        print("Worker stopped and no longer starts at login." if stopped else "The worker was not installed.")


def _backup_offline(args) -> None:
    import getpass

    from . import backup, schedule

    if args.action == "schedule":
        hour, _, minute = args.at.partition(":")
        worker_dir, env_file, uv = _launchd_inputs(args.env_file)
        log = Path.home() / "Library" / "Logs" / "musica-backup.log"
        target = schedule.install(schedule.make_plist(worker_dir, env_file, uv, int(hour), int(minute or 0), log))
        print(f"Nightly backup at {int(hour):02d}:{int(minute or 0):02d} ({target}). Log: {log}")
    elif args.action == "unschedule":
        print("Nightly backup stopped." if schedule.uninstall() else "No nightly backup was scheduled.")
    elif args.action == "set-db-url":
        url = getpass.getpass("Database URL (Supabase > Connect > Session pooler; input hidden): ").strip()
        backup.pg_dump_command("pg_dump", url)   # validates the shape
        backup.store_db_url(url)
        print("Stored in the Keychain. Backups on this Mac now include a pg_dump.")
    elif args.action == "forget-db-url":
        import keyring

        try:
            keyring.delete_password(backup.KEYCHAIN_SERVICE, backup.DB_URL_ACCOUNT)
        except keyring.errors.PasswordDeleteError:
            pass
        print("Removed.")
    elif args.action == "verify":
        counts = backup.verify_snapshot(args.file.expanduser())
        for table, n in counts.items():
            print(f"{table:18} {n}")
        print("complete")
    elif args.action == "to-sql":
        for chunk in backup.snapshot_to_sql(args.file.expanduser()):
            sys.stdout.write(chunk)


if __name__ == "__main__":
    main()
