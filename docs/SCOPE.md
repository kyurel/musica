# Musica: scope (reference copy)

This is the repo copy of the agreed scope. The living document, with comments and
history, is the Claude Doc: https://claude.ai/artifact/D8nfE58uErZe1Mpkuvrn18 .
When the two disagree, the living doc wins and this file gets updated.

Last synced: 2026-11-19.

## What Musica is

A set of personal tools for two producers/DJs (Andre and a friend) around **one shared
music library**: our own tracks, references, commercial tracks, promos and sample packs.
Every finished track lands in the library.

Tools, in build order:

1. **Library**: drop files in, analyse them (BPM, key, genre suggestion, fingerprint),
   browse, filter, search, preview, export to DJ software.
2. **Rebuild**: take any audio file, split stems, rebuild drums and parts as MIDI, write an
   Ableton Live project where the rebuilt parts play over the muted original stems.
3. **Master**: club-ready mastering (Matchering + an assisted stock-Ableton chain).
4. **Claude power layer**: a local MCP server and one skill per tool.
5. **v2 search and creative tools**.

## Principles

- **Toolbox, not pipeline.** Track statuses are free labels, in any order.
- **No subscription lock-ins, no paid options at start.** Free tiers and open source only.
  Pay-per-use storage, cloud GPUs and Ozone are optional later add-ons.
- **Claude is the power layer, not a dependency.** The app works fully without it.
  Claude is model-agnostic in the design.
- **Fully shared v1.** One rating, shared crates, tags, cues and notes. Every change records
  who made it (and whether via the app, Claude or the worker) so a personal layer can be
  split out later. The personal layer is a later, unplanned step.
- **Private use only.** Two users.

## Users and machines

| | Andre | Friend |
|---|---|---|
| Machine | Apple Silicon Mac (main runner) | MacBook Air (hands heavy jobs to Andre's Mac) |
| DAW | Live 12 Suite | Live 12 Suite |
| DJ software | Rekordbox | Rekordbox |
| Uses Claude | yes | yes |
| GitHub account | yes | yes |

Shared plugins: Kick 3, Ozone, Serum, Sausage Fattener (more later).

## Genres

Main genres we make and play: techno, psytrance, tekno, hard groove, bounce.
**Acid is a style tag, not a genre.**

12 top-level genres, each with subgenres and a typical BPM range:
Techno, Hard Groove, Psytrance, Tekno, Bounce, House, Trance, Hard Dance, Breaks,
Drum & Bass, Ambient/Downtempo, Other.

The full list is seeded from Beatport during Library v1. Genre = fixed vocabulary +
auto-suggest (Essentia) + human confirm.

## Stack and hosting

- **Web:** Next.js + shadcn/ui (TypeScript), on Cloudflare Pages (free) under a subdomain of
  brakyuro.com, behind Cloudflare Access (GitHub as identity provider, 2 accounts).
- **Database/Auth:** Supabase free tier: Postgres + pgvector, Auth with GitHub.
- **Worker, Rebuild, Master:** Python. Worker runs on both Macs; Docker-portable later.
- **Storage (hybrid):**
  - Lossless files stay on the Macs, synced with Syncthing.
  - Cloudflare R2 free tier (10 GB) holds ~128 kbps previews for about 2,000 "active"
    tracks plus our own productions and WIPs. Usage alert at 8 GB; Backblaze B2 is the fallback.
  - Stems and Live projects stay local. Metadata lives in Supabase.
- Scale target: up to 50,000 tracks.

## Security

- RLS on every table from day one.
- Open sign-ups off. An allowlist of 2 GitHub user IDs is checked in the database.
- The `service_role` key is used only for migrations, from Andre's Mac. Never in the app,
  worker or MCP server.
- The worker signs in as a normal user with a narrow role (claim job, write results, mark done)
  and moves audio through per-job presigned URLs.
- The MCP server runs locally on each Mac, signed in as that user; its token lives in the
  macOS Keychain.
- Changes made through Claude are logged as "<user> via Claude". Deletes and merges need
  confirmation.
- Titles, tags and notes are untrusted data (never instructions).
- `.env` is never committed. R2 tokens are scoped per bucket. Preview URLs are signed.

## Data rules

- **Identity:** content hash (sha256) + Chromaprint fingerprint. Auto-merge only on an
  identical hash; similar fingerprints only suggest a link.
- **Provenance:** each analysed value keeps source and confidence. User edits always win.
- **Review:** a `needs_review` flag and a review inbox.
- **BPM:** read the file tag first, then check against the genre's BPM range, with a
  one-click halve/double.
- **Key:** "atonal" is a valid key. Shown as Camelot and musical notation.
- **File facts:** codec, bitrate, sample rate, duration, fake-lossless check.
- **Versions:** version naming; a version is frozen once "sent".
- Soft deletes. Migrations in git. Nightly `pg_dump` to both Macs.
- Health dashboard with a System status panel. Supabase keep-alive via Cloudflare Cron
  Trigger or the worker heartbeat.
- Read-only offline copy of library data on each Mac (1b).

## Job queue

- Jobs are claimed with `FOR UPDATE SKIP LOCKED`, with a lease, heartbeat, retry limit and
  capability tags.
- Enqueuing a duplicate request returns the existing job.
- If both Macs are off, jobs wait, and the UI says so.
- Heavy jobs started on the Air show a warning and can be handed to Andre's Mac.
- Claude cloud sessions are not runners in v1.

## Search

- **v1:** filters, Postgres full-text, CLAP "sounds like this" and description search
  (CLAP text encoder runs in the browser; model version pinned) in 1c.
- Essentia genre suggester (CC BY-NC-ND, fine for private use) behind an interface.
- **v2:** hybrid ranking, stem-level indexing, natural-language queries, set building.

## Rekordbox

- Rekordbox owns grids and cues; Musica owns library facts.
- Export never touches tracks Rekordbox already has (playlist membership only). New tracks get
  a grid plus auto cues, as memory cues only.
- Read-back is an approved preview (XML or pyrekordbox).
- Tracks are matched by stable path, then fingerprint. Export goes to one stable folder.
  Test on a Rekordbox backup first.
- Auto cues: first kick, 16 and 32 bar mix points, bass entry.
- Tags go into Comments; colours map to Rekordbox's 8-colour palette.
- Gig snapshot and USB check.
- Exporters are pluggable: M3U8 (1a) and Rekordbox XML (1b) first.

## Rebuild (Milestone 2)

- Free models only, 4 to 6 stems (Demucs or Live's built-in separation). Drum split is experimental.
- Lean v1 core: stems, locators, tempo, key, drum MIDI. Bass from the kick grid plus key;
  a 16-step 303 model for acid lines; melodic transcription is opt-in.
- Two Drum Racks: a cloned kit (from the track) and a clean kit. Compare later.
- Sound Palette: a folder of `.adg` presets, matched with CLAP (top 3).
- The `.als` is written from Python with a template. Split into a portable part and a
  Mac-only part. Test `.adg` embedding before M2.
- Plugin resilience: manifest with plugin major versions, printed audio, collected presets,
  post-update test project.
- Project sync: Syncthing, Collect All and Save, pinned Live version, check-out lock.
- Output is a starting sketch, not a finished track.

## Master (Milestone 3)

- Matchering on the drops, averaging 2 or 3 references. Mono check below 120 Hz.
- Per-genre loudness presets (psy and hard groove around -6 to -7 LUFS short-term).
  True-peak check after encoding.
- Stock Ableton chain by default; Ozone chain optional. Premaster export.
- Level-matched A/B in the player (built in 1a).

## Claude power layer (Milestone 4)

Local MCP server, one skill per tool. Parallel agents only for batch jobs.

## Milestones

- **1a**: GitHub login behind Cloudflare Access + RLS; upload; analysis on a Mac (BPM, key,
  genre suggestion); browse, filters, preview playback with level-matched A/B; M3U8 export;
  nightly backup; the Air hands heavy jobs to Andre's Mac.
- **1b**: fingerprints and duplicates, review inbox, health dashboard and System status,
  heavy-job warning, version naming and freeze, read-only offline copy, gig snapshot and USB
  check, Rekordbox XML export under the ownership rules.
- **1c**: CLAP search, Rekordbox read-back.
- **2** Rebuild. **3** Master. **4** Claude power layer. **5** v2 search and creative tools.

Later, not planned yet: commercial/promo protection, cloud runners (Claude sessions, cloud
GPUs), local-first editing, personal layer, release records and label stems.

## House rules

- A test set of 20 to 30 real tracks covering all main genres.
- Golden-file tests for XML, M3U8 and `.als` output.
- Verify at setup: R2 vs B2, Essentia on macOS (both Macs), Rekordbox free plan covering XML
  import and USB export.
