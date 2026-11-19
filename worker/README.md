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

In the Supabase dashboard, add `http://127.0.0.1:54329/callback` to
Authentication → URL Configuration → Redirect URLs, so the login callback is allowed.

The worker signs in as you, a normal member. It never uses the `service_role` key and
never holds storage keys: previews are uploaded through short-lived presigned URLs. Every
change it makes shows up in the change log as "<you> via worker".

Try the analysis on one file without the database:

```sh
uv run musica-worker analyse ~/Music/some-track.flac --bpm-range 138-150
```

## Tests

```sh
uv run pytest
```

Tests use generated audio (kick loops, chords, noise), so they need no music files.
