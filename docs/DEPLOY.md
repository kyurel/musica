# Going live: Supabase, R2, Cloudflare

Everything here stays on free plans. It takes about 30 to 45 minutes, on Andre's Mac,
signed in to GitHub, Supabase and Cloudflare. The app ends up at
**https://musica.brakyuro.com** (change `routes` in `apps/web/wrangler.jsonc` for another
name).

There are two locks. Cloudflare Access only lets the two GitHub accounts reach the site.
After that, the app's own GitHub login and the database allowlist apply again, because
the Supabase API is outside Cloudflare.

Needs: Node 22, `uv`, the Supabase CLI (`brew install supabase/tap/supabase`).

## 1. Supabase project

1. supabase.com → New project (free), region Frankfurt (eu-central-1). Save the
   database password in your password manager.
2. From the repo:
   ```sh
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```
3. SQL editor: add both GitHub accounts (`curl https://api.github.com/users/<login>` shows the id):
   ```sql
   insert into public.allowed_users (github_id, github_login) values (<id>, '<andre>'), (<id>, '<friend>');
   ```
4. GitHub → Settings → Developer settings → OAuth Apps → New:
   homepage `https://musica.brakyuro.com`, callback `https://<ref>.supabase.co/auth/v1/callback`.
   Copy the client id and a new client secret.
5. Supabase → Authentication → Sign In / Providers → GitHub: on, paste id and secret.
6. Authentication → URL Configuration: Site URL `https://musica.brakyuro.com`; Redirect URLs
   `https://musica.brakyuro.com/auth/callback`, `http://localhost:3000/auth/callback`,
   `http://127.0.0.1:54329/callback` (worker login).
7. Keep "Allow new users to sign up" **on** until both of you have signed in once (the
   first GitHub sign-in creates the account; the allowlist trigger still rejects
   everyone else). Then turn it **off**.
8. Project Settings → API: copy the Project URL and the `anon` key (never the
   `service_role` key).

## 2. R2 bucket for previews

1. Cloudflare dashboard → R2 → Create bucket `musica-previews` (location: Europe).
2. Bucket → Settings → CORS policy, so the player can level-match previews:
   ```json
   [{ "AllowedOrigins": ["https://musica.brakyuro.com", "http://localhost:3000"],
      "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
3. R2 → Manage API tokens → Create: **Object Read & Write**, only bucket
   `musica-previews`. Copy the access key id, secret, and your account id.
4. Billing → set a usage notification so you hear about it before the 10 GB free tier
   is used up (scope: alert at 8 GB).

## 3. Cloudflare Access (Zero Trust, free up to 50 users)

1. Zero Trust → Settings → Authentication → Login methods → Add → GitHub. It asks for
   a second GitHub OAuth app; its callback is
   `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`.
2. Access → Applications → Add → Self-hosted: name Musica, domain `musica.brakyuro.com`,
   login method GitHub only. Policy "Members": Allow, Emails = the two GitHub emails.
3. Access → Service Auth → Service Tokens → Create `musica-worker`. Copy the client id
   and secret. Add a second policy to the Musica application: action **Service Auth**,
   include Service Token = `musica-worker`. The Macs' workers use it to ask the app for
   preview upload URLs.

## 4. Deploy the web app

```sh
cd apps/web
npm ci
cat > .env.production.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
ENV
npx wrangler login
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_PREVIEWS_BUCKET     # musica-previews
npm run cf:deploy
```

The first `secret put` creates the Worker if needed; if it complains, run
`npm run cf:deploy` once first and then add the secrets. The deploy adds the
`musica.brakyuro.com` DNS record itself. The `*.workers.dev` address is off, so the app is
only reachable through Access.

Later deploys: `npm run cf:deploy` again. `npm run cf:preview` runs the production build
locally.

## 5. Each Mac

In the repo's `.env` (never committed): the Supabase URL and anon key, `MUSICA_API_URL`,
and the Access service token as `MUSICA_ACCESS_CLIENT_ID` / `MUSICA_ACCESS_CLIENT_SECRET`.
Then:

```sh
cd worker && uv sync
set -a; source ../.env; set +a
uv run musica-worker login
uv run musica-worker backup schedule
uv run musica-worker backup set-db-url   # Andre's Mac only
uv run musica-worker service install     # worker runs from login
```

## Check it works

- Open https://musica.brakyuro.com in a private window: Cloudflare asks for GitHub, then
  the app asks for GitHub again, then the library shows.
- A third GitHub account is stopped at the Cloudflare step.
- `musica-worker add` a file: System status shows the jobs, and the preview plays.
