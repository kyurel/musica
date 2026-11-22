# Musica

Personal music tools around one shared library: Library, Rebuild (audio to Ableton
project), Master, and a Claude power layer. See [docs/SCOPE.md](docs/SCOPE.md) for the
agreed scope and milestones.

Current milestone: **1a, Library v1 basics.**

## Layout

| Path | What |
|---|---|
| `docs/` | Scope and decisions |
| `supabase/migrations/` | Database schema, row-level security, job queue (SQL, in order) |
| `supabase/tests/` | SQL tests for the migrations |
| `worker/` | Python analysis worker that runs on the Macs (`musica-worker add` puts files in the library) |
| `apps/web/` | Next.js web app: login, library, player, M3U8 export, System status |
| `apps/visuals/` | Live visuals for DJ sets, reacting to the music and the DJ's body (separate from the library; see its README) |
| `testdata/golden/` | Expected output files shared by the worker and web tests |

## Database

Migrations are plain SQL, applied in filename order. With the Supabase CLI:

```sh
supabase link --project-ref <ref>
supabase db push
```

After the first push, add the two GitHub user IDs to the allowlist (as the project owner,
in the SQL editor):

```sql
insert into public.allowed_users (github_id, github_login) values (123, 'andre'), (456, 'friend');
```

Find a GitHub user ID with `curl https://api.github.com/users/<login>`.

Run the SQL tests locally (needs Node, uses an in-memory Postgres):

```sh
cd supabase/tests && npm install && npm test
```

## Worker

```sh
cd worker
uv sync
uv run pytest
uv run musica-worker --help
```

It also exports playlists (`musica-worker export m3u8`) and makes the nightly backups
(`musica-worker backup schedule`); see `worker/README.md` and `docs/BACKUP.md`.

The worker signs in as a normal allowlisted user (never the `service_role` key). Its
refresh token lives in the macOS Keychain; see `worker/README.md`.

## Going live

Supabase, R2 and Cloudflare setup, step by step: [docs/DEPLOY.md](docs/DEPLOY.md).

## Secrets

Copy `.env.example` to `.env` and fill it in. `.env` is never committed.
