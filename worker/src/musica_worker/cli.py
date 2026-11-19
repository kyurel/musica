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

    from . import session

    runner = _env("MUSICA_RUNNER_NAME")
    url, anon = _env("MUSICA_SUPABASE_URL"), _env("MUSICA_SUPABASE_ANON_KEY")

    if args.cmd == "login":
        print(f"Signed in as {session.login(url, anon, runner)}")
        return
    if args.cmd == "logout":
        session.logout(runner)
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


if __name__ == "__main__":
    main()
