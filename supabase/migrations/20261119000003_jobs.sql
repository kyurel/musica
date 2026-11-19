-- Job queue for the analysis workers on the Macs.
-- Clients never write the jobs table directly; they use the functions below.
-- Claims use FOR UPDATE SKIP LOCKED with a lease, so two Macs never take the same job,
-- and a job whose Mac went to sleep is picked up again once its lease runs out.

create table public.runners (
  name           text primary key check (name ~ '^[a-z0-9-]{1,40}$'),
  owner          uuid not null references auth.users (id),
  capabilities   text[] not null default '{}',
  last_heartbeat timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),   -- e.g. 'analyse', 'preview'
  version_id   uuid references public.versions (id),
  payload      jsonb not null default '{}',
  capabilities text[] not null default '{}',   -- a runner needs all of these to claim the job
  priority     smallint not null default 100,  -- lower runs first
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts     smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  lease_until  timestamptz,
  claimed_by   text references public.runners (name),
  requested_by uuid default auth.uid() references auth.users (id),
  dedupe_key   text,
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create index jobs_queue_idx on public.jobs (priority, created_at) where status = 'queued';
create index jobs_lease_idx on public.jobs (lease_until) where status = 'running';
-- At most one live job per dedupe key: asking twice returns the same job.
create unique index jobs_dedupe_idx on public.jobs (dedupe_key) where status in ('queued', 'running');

create or replace function public.assert_member()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'musica: not a member' using errcode = '42501';
  end if;
end;
$$;

-- Lease length. Workers heartbeat well inside it.
create or replace function public.job_lease()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

-- Queue a job. If a live job with the same dedupe key exists, return that one.
create or replace function public.enqueue_job(
  p_kind         text,
  p_version_id   uuid    default null,
  p_payload      jsonb   default '{}',
  p_capabilities text[]  default '{}',
  p_dedupe_key   text    default null,
  p_priority     smallint default 100
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform public.assert_member();

  insert into public.jobs (kind, version_id, payload, capabilities, dedupe_key, priority, requested_by)
  values (p_kind, p_version_id, coalesce(p_payload, '{}'), coalesce(p_capabilities, '{}'),
          p_dedupe_key, coalesce(p_priority, 100), auth.uid())
  on conflict (dedupe_key) where status in ('queued', 'running') do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from public.jobs
     where dedupe_key = p_dedupe_key and status in ('queued', 'running');
  end if;

  return v_job;
end;
$$;

-- A worker announces itself (and keeps itself alive). Runner names belong to one user.
create or replace function public.register_runner(p_name text, p_capabilities text[])
returns public.runners
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runner public.runners;
begin
  perform public.assert_member();

  insert into public.runners (name, owner, capabilities, last_heartbeat)
  values (p_name, auth.uid(), coalesce(p_capabilities, '{}'), now())
  on conflict (name) do update
     set capabilities = excluded.capabilities, last_heartbeat = now()
   where public.runners.owner = auth.uid()
  returning * into v_runner;

  if v_runner.name is null then
    raise exception 'musica: runner name % belongs to another user', p_name using errcode = '42501';
  end if;
  return v_runner;
end;
$$;

-- Internal: the caller must own the runner.
create or replace function public.assert_runner_owner(p_runner text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_member();
  if not exists (select 1 from public.runners where name = p_runner and owner = auth.uid()) then
    raise exception 'musica: unknown runner %', p_runner using errcode = '42501';
  end if;
end;
$$;

-- Put expired leases back in the queue (or fail them once out of attempts).
create or replace function public.requeue_expired_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.jobs
     set status      = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error       = case when attempts >= max_attempts then 'lease expired, out of attempts' else error end,
         finished_at = case when attempts >= max_attempts then now() end,
         claimed_by  = null,
         lease_until = null
   where status = 'running' and lease_until < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Take the next job this runner can do. Returns null when there is none.
create or replace function public.claim_job(p_runner text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caps text[];
  v_job  public.jobs;
begin
  perform public.assert_runner_owner(p_runner);
  perform public.requeue_expired_jobs();

  update public.runners set last_heartbeat = now() where name = p_runner
  returning capabilities into v_caps;

  update public.jobs j
     set status      = 'running',
         attempts    = j.attempts + 1,
         claimed_by  = p_runner,
         lease_until = now() + public.job_lease(),
         started_at  = now(),
         error       = null
   where j.id = (
           select id from public.jobs
            where status = 'queued' and capabilities <@ v_caps
            order by priority, created_at
            for update skip locked
            limit 1)
  returning j.* into v_job;

  return v_job;
end;
$$;

-- Extend the lease while working. Returns false if the job is no longer ours
-- (lease expired and someone else took it, or it was cancelled): stop working then.
create or replace function public.heartbeat_job(p_job uuid, p_runner text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_runner_owner(p_runner);
  update public.runners set last_heartbeat = now() where name = p_runner;
  update public.jobs
     set lease_until = now() + public.job_lease()
   where id = p_job and claimed_by = p_runner and status = 'running';
  return found;
end;
$$;

create or replace function public.complete_job(p_job uuid, p_runner text, p_result jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_runner_owner(p_runner);
  update public.jobs
     set status = 'done', result = p_result, finished_at = now(), lease_until = null
   where id = p_job and claimed_by = p_runner and status = 'running';
  return found;
end;
$$;

-- Report a failure. Retries until max_attempts unless p_retry is false.
create or replace function public.fail_job(p_job uuid, p_runner text, p_error text, p_retry boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_runner_owner(p_runner);
  update public.jobs
     set status      = case when p_retry and attempts < max_attempts then 'queued' else 'failed' end,
         finished_at = case when p_retry and attempts < max_attempts then null else now() end,
         error       = left(p_error, 4000),
         claimed_by  = null,
         lease_until = null
   where id = p_job and claimed_by = p_runner and status = 'running';
  return found;
end;
$$;

create or replace function public.cancel_job(p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_member();
  update public.jobs
     set status = 'cancelled', finished_at = now(), lease_until = null
   where id = p_job and status in ('queued', 'running');
  return found;
end;
$$;

-- Store an analysis result and copy it onto the track, unless a better value is
-- already there. A user's own value always wins; otherwise higher confidence wins.
-- p_values keys used: bpm, bpm_confidence, key (Camelot or 'atonal'), key_confidence,
-- genre_slug, genre_confidence, and file facts (codec, bitrate_kbps, sample_rate,
-- bit_depth, channels, duration_s, suspected_fake_lossless, preview_lufs).
create or replace function public.record_analysis(
  p_version_id       uuid,
  p_analyser         text,
  p_analyser_version text,
  p_source           text,
  p_values           jsonb,
  p_job              uuid default null
)
returns public.analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.analyses;
  v_track    public.tracks;
  v_genre_id smallint;
  v_conf     real;
begin
  perform public.assert_member();

  insert into public.analyses (version_id, analyser, analyser_version, "values", job_id)
  values (p_version_id, p_analyser, p_analyser_version, p_values, p_job)
  returning * into v_row;

  select t.* into v_track
    from public.tracks t join public.versions v on v.track_id = t.id
   where v.id = p_version_id
   for update of t;

  -- file facts live on the version (the freeze trigger protects sent versions)
  update public.versions set
    codec                   = coalesce(p_values ->> 'codec', codec),
    bitrate_kbps            = coalesce((p_values ->> 'bitrate_kbps')::integer, bitrate_kbps),
    sample_rate             = coalesce((p_values ->> 'sample_rate')::integer, sample_rate),
    bit_depth               = coalesce((p_values ->> 'bit_depth')::smallint, bit_depth),
    channels                = coalesce((p_values ->> 'channels')::smallint, channels),
    duration_s              = case when sent_at is null
                                   then coalesce((p_values ->> 'duration_s')::numeric, duration_s)
                                   else duration_s end,
    suspected_fake_lossless = coalesce((p_values ->> 'suspected_fake_lossless')::boolean, suspected_fake_lossless),
    preview_lufs            = coalesce((p_values ->> 'preview_lufs')::real, preview_lufs)
  where id = p_version_id;

  if p_values ? 'bpm' then
    v_conf := coalesce((p_values ->> 'bpm_confidence')::real, 0.5);
    if v_track.bpm is null
       or (v_track.bpm_source is distinct from 'user' and v_conf >= coalesce(v_track.bpm_confidence, 0)) then
      update public.tracks
         set bpm = (p_values ->> 'bpm')::numeric, bpm_source = p_source, bpm_confidence = v_conf
       where id = v_track.id;
    end if;
  end if;

  if p_values ? 'key' then
    v_conf := coalesce((p_values ->> 'key_confidence')::real, 0.5);
    if v_track.musical_key is null
       or (v_track.key_source is distinct from 'user' and v_conf >= coalesce(v_track.key_confidence, 0)) then
      update public.tracks
         set musical_key = p_values ->> 'key', key_source = p_source, key_confidence = v_conf
       where id = v_track.id;
    end if;
  end if;

  if p_values ? 'genre_slug' then
    select id into v_genre_id from public.genres where slug = p_values ->> 'genre_slug';
    v_conf := coalesce((p_values ->> 'genre_confidence')::real, 0.5);
    if v_genre_id is not null and (v_track.genre_id is null
       or (v_track.genre_source is distinct from 'user' and v_conf >= coalesce(v_track.genre_confidence, 0))) then
      -- a suggestion, not a fact: flag for human confirmation
      update public.tracks
         set genre_id = v_genre_id, genre_source = p_source, genre_confidence = v_conf, needs_review = true
       where id = v_track.id;
    end if;
  end if;

  return v_row;
end;
$$;
