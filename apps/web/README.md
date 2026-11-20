# Musica web app

Next.js (App Router) + shadcn/ui-style components + Supabase. Members sign in with GitHub;
Cloudflare Access sits in front of the whole site.

## Pages

- `/login`: GitHub sign-in. Accounts not on the allowlist are refused by the database.
- `/`: the library. Search (title, artist, notes), filters for genre, BPM range, key
  (exact or harmonically mixable), source and "needs review". Previews play through one
  shared, level-matched player; switching tracks keeps the position for quick A/B.
- `/system`: System status. Which Macs are online and what they can do, and the job queue.
  Says so when jobs are waiting because no Mac is on.
- `POST /api/previews/upload-url`: one-time R2 upload URL for the worker (bearer token).
- `GET /api/previews/<version>`: short-lived signed playback URL for members.

## Run locally

```sh
npm install
cp ../../.env.example .env.local   # fill in the Supabase and R2 values
npm run dev
npm test          # unit tests
npm run typecheck
```

## Setup notes

- Supabase → Authentication → Providers: enable GitHub, turn off email and open sign-ups.
- Supabase → Authentication → URL Configuration: add `https://<musica host>/auth/callback`
  and `http://localhost:3000/auth/callback`.
- R2: a `musica-previews` bucket, an API token scoped to that bucket only, and a CORS rule
  allowing GET from the Musica host (needed for level-matched playback).
- Hosting on Cloudflare Pages uses the OpenNext Cloudflare adapter; that setup comes with
  the deploy step.

## Deploy

Runs on Cloudflare Workers through the OpenNext adapter (free plan), behind Cloudflare
Access on musica.brakyuro.com. Cloudflare now recommends Workers over Pages for Next.js;
cost and Access work the same. Full steps: [docs/DEPLOY.md](../../docs/DEPLOY.md).

```sh
npm run cf:preview   # production build, served locally by workerd
npm run cf:deploy    # build and deploy
```
