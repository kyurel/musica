# Musica worker

Runs on each Mac. Claims jobs from the shared Supabase queue and analyses audio files
that live on that Mac (under `MUSICA_LIBRARY_ROOT`, synced with Syncthing).

| Job | What it does | Capability |
|---|---|---|
| `analyse` | file facts (codec, bitrate, sample rate, duration, fake-lossless check, loudness), BPM and key from the file tags and from the audio, BPM folded into the genre's range | `analyse` |
| `preview` | ~128 kbps stereo MP3 preview, uploaded through a one-time URL from the web app | `preview` |

A job only goes to a Mac whose capabilities include everything the job asks for. The Air
leaves out `heavy`, so heavy jobs wait for Andre's Mac.

## Setup

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/) and ffmpeg (`brew install ffmpeg`).

```sh
cd worker
uv sync
cp ../.env.example ../.env   # fill in the MUSICA_* values
set -a; source ../.env; set +a
uv run musica-worker login   # GitHub sign-in in the browser; token goes to the Keychain
uv run musica-worker run
```

To keep the worker running without a Terminal window, start it at login instead
(restarted automatically if it crashes; log in `~/Library/Logs/musica-worker.log`):

```sh
uv run musica-worker service install     # uninstall to stop
```

Its queue checks (at least every two minutes) also stop the free Supabase project from
pausing after a week without activity.

In the Supabase dashboard, add `http://127.0.0.1:54329/callback` to
Authentication → URL Configuration → Redirect URLs, so the login callback is allowed.

The worker signs in as you, a normal member. It never uses the `service_role` key and
never holds storage keys: previews are uploaded through short-lived presigned URLs. Every
change it makes shows up in the change log as "<you> via worker".

Try the analysis on one file without the database:

```sh
uv run musica-worker analyse ~/Music/some-track.flac --bpm-range 138-150
```

## Playlists (M3U8)

```sh
uv run musica-worker export m3u8 --crate "Friday"
uv run musica-worker export m3u8 --genre hard-groove --bpm 140-150 --key 8A --mixable
uv run musica-worker export m3u8 --label gig --name "Gig 2026-12-05"
```

Files go to `MUSICA_EXPORT_DIR` (default `~/Music/Musica Exports`), one file per playlist
name, overwritten on the next export, so Rekordbox (or anything else) can re-import the
same file. Paths are absolute paths on this Mac. Tracks whose file has not synced to this
Mac yet are still listed, and the command says which ones.

The web app's library page has the same export as a button ("Export M3U8"): it exports
everything that matches the current filters, and asks once per Mac for the library folder.

Exporters are pluggable (`musica_worker/exporters/`); Rekordbox XML joins them in 1b.

## Nightly backup

Each Mac keeps its own backups of the library database in `MUSICA_BACKUP_DIR` (default
`~/Musica Backups`):

```sh
uv run musica-worker backup run        # once, now
uv run musica-worker backup schedule   # every night at 03:30 (launchd); --at 02:15 to change
uv run musica-worker backup unschedule
```

* **Snapshot** (every Mac): all library rows, read with your normal member sign-in. No
  extra secret needed.
* **pg_dump** (Andre's Mac only): a full data dump that also keeps the user accounts.
  Turn it on once with `brew install libpq` and
  `uv run musica-worker backup set-db-url`, pasting the **Session pooler** connection
  string from Supabase > Connect (with the database password filled in). It is stored in
  the Keychain, never in `.env`. It is the same password `supabase db push` uses, so it
  stays on Andre's Mac only.

The newest 14 backups of each kind are kept, plus one per month for a year. If the Mac
is asleep at backup time, launchd runs it on wake. `last-backup.json` in the backup
folder says how the last run went; the log is `~/Library/Logs/musica-backup.log`.

How to restore: [docs/BACKUP.md](../docs/BACKUP.md).

## Tests

```sh
uv run pytest
```

Tests use generated audio (kick loops, chords, noise), so they need no music files.

The backup restore tests need a Postgres server you can create databases on and are
skipped without one:

```sh
MUSICA_TEST_PG_URL=postgresql://postgres@127.0.0.1:5432/postgres uv run pytest tests/test_backup.py
```
