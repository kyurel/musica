# Backups and restore

Supabase's free tier keeps its own daily backups, but they cannot be downloaded and go
away if the project is deleted or paused for good. So each Mac keeps its own copy.

| File | Made on | Holds | Restores |
|---|---|---|---|
| `musica-snapshot-<mac>-<time>.jsonl.gz` | every Mac, signed in as a member | every library row | library data; members link up again on their next sign-in |
| `musica-pgdump-<mac>-<time>.sql.gz` | Andre's Mac (database URL in the Keychain) | all `public` data plus `auth.users` and `auth.identities` | everything, with the original user ids |

Both hold data only. The schema is in git (`supabase/migrations`). Audio is not in the
database: lossless files live on the Macs (Syncthing), previews in R2 can be re-made by
the worker.

## Check a backup

```sh
uv run musica-worker backup verify "~/Musica Backups/musica-snapshot-andre-mac-20261119-033000.jsonl.gz"
```

prints the row count per table, and fails if the file was cut short.

## Restore into a new Supabase project

1. Create the project, link it and push the migrations:
   `supabase link --project-ref <new ref> && supabase db push`.
2. Load one backup, as the database owner, with the Session pooler URL of the new project:

   From a pg_dump (preferred):

   ```sh
   gunzip -c musica-pgdump-andre-mac-<time>.sql.gz | psql "<new database URL>" -v ON_ERROR_STOP=1
   ```

   From a snapshot:

   ```sh
   uv run musica-worker backup to-sql musica-snapshot-<mac>-<time>.jsonl.gz > restore.sql
   psql "<new database URL>" -v ON_ERROR_STOP=1 -f restore.sql
   ```

   A snapshot restore clears the links between the allowlist and user accounts, because a
   new project gives new account ids. Andre and the friend are linked again when they
   next sign in with GitHub. Old "who changed what" entries keep the old ids.
3. Turn on GitHub sign-in and turn off open sign-ups in the new project, and point the
   web app and the workers' `.env` at it.

Both restores turn triggers off while they load (`session_replication_role = replica`),
so timestamps and the change log come back exactly as they were. Rows that already exist
(the seeded genres) are skipped.

## Restore into the same project

For a mistake (a bad bulk edit), restore into a scratch project first, then copy back
only the rows you need. Loading a backup over live data skips rows that already exist,
so it does not undo edits.

The restore paths are tested against a real Postgres in `worker/tests/test_backup.py`.
