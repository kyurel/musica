-- Row-level security on every table. Only allowlisted members can read or write;
-- anonymous users get nothing. Tracks and versions are soft-deleted (deleted_at),
-- so there is no delete policy for them. Jobs and runners change only through the
-- functions in the jobs migration.

do $$
declare t text;
begin
  foreach t in array array['allowed_users', 'genres', 'style_tags', 'tracks', 'track_style_tags',
                           'versions', 'analyses', 'crates', 'crate_tracks', 'cues', 'change_log',
                           'runners', 'jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy members_read on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end;
$$;

-- members can add to the vocabulary (new subgenres, style tags)
grant insert, update on public.genres, public.style_tags to authenticated;
create policy members_insert on public.genres     for insert to authenticated with check (public.is_member());
create policy members_update on public.genres     for update to authenticated using (public.is_member()) with check (public.is_member());
create policy members_insert on public.style_tags for insert to authenticated with check (public.is_member());
create policy members_update on public.style_tags for update to authenticated using (public.is_member()) with check (public.is_member());

-- soft-delete tables: insert + update only
do $$
declare t text;
begin
  foreach t in array array['tracks', 'versions', 'crates'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy members_insert on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy members_update on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
  -- link and cue tables: full edit
  foreach t in array array['track_style_tags', 'crate_tracks', 'cues'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy members_insert on public.%I for insert to authenticated with check (public.is_member())', t);
    execute format('create policy members_update on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t);
    execute format('create policy members_delete on public.%I for delete to authenticated using (public.is_member())', t);
  end loop;
end;
$$;

-- analyses are append-only, written through record_analysis()

-- functions: members only, never anon
do $$
declare f text;
begin
  foreach f in array array[
    'public.is_member()',
    'public.assert_member()',
    'public.enqueue_job(text, uuid, jsonb, text[], text, smallint)',
    'public.register_runner(text, text[])',
    'public.assert_runner_owner(text)',
    'public.requeue_expired_jobs()',
    'public.claim_job(text)',
    'public.heartbeat_job(uuid, text)',
    'public.complete_job(uuid, text, jsonb)',
    'public.fail_job(uuid, text, text, boolean)',
    'public.cancel_job(uuid)',
    'public.record_analysis(uuid, text, text, text, jsonb, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function public.log_change() from public, anon, authenticated;
