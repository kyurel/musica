-- Library schema: genres, tracks, versions, analyses, crates, cues, change log.
-- Everything is shared between members in v1. created_by / updated_by and the
-- change log record who changed what, so a personal layer can be split out later.

-- ---------------------------------------------------------------- vocabulary

create table public.genres (
  id        smallint generated always as identity primary key,
  slug      text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name      text not null,
  parent_id smallint references public.genres (id),   -- null = top-level genre
  bpm_min   numeric(5,1),
  bpm_max   numeric(5,1),
  sort      smallint not null default 100,
  check (bpm_min is null or bpm_max is null or bpm_min <= bpm_max)
);

comment on table public.genres is
  'Fixed genre vocabulary. Top-level rows have parent_id null; subgenres point at their genre. Full list seeded from Beatport during Library v1.';

-- Typical BPM ranges, used to sanity-check detected BPM (halve/double hints).
insert into public.genres (slug, name, bpm_min, bpm_max, sort) values
  ('techno',            'Techno',            125, 150,  1),
  ('hard-groove',       'Hard Groove',       138, 152,  2),
  ('psytrance',         'Psytrance',         138, 150,  3),
  ('tekno',             'Tekno',             160, 190,  4),
  ('bounce',            'Bounce',            140, 160,  5),
  ('house',             'House',             118, 130,  6),
  ('trance',            'Trance',            130, 145,  7),
  ('hard-dance',        'Hard Dance',        145, 165,  8),
  ('breaks',            'Breaks',            120, 140,  9),
  ('drum-and-bass',     'Drum & Bass',       165, 180, 10),
  ('ambient-downtempo', 'Ambient/Downtempo',  60, 115, 11),
  ('other',             'Other',            null, null, 99);

create table public.style_tags (
  id   smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null
);

insert into public.style_tags (slug, name) values ('acid', 'Acid');

-- ---------------------------------------------------------------- tracks

create table public.tracks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(title) between 1 and 500),
  artist           text check (length(artist) <= 500),
  source           text not null default 'reference'
                   check (source in ('ours', 'reference', 'commercial', 'promo', 'sample_pack')),
  labels           text[] not null default '{}',  -- free status labels, any order (toolbox, not pipeline)

  genre_id         smallint references public.genres (id),
  genre_source     text check (genre_source in ('user', 'tag', 'essentia', 'claude', 'import')),
  genre_confidence real check (genre_confidence between 0 and 1),

  bpm              numeric(6,2) check (bpm > 0 and bpm < 400),
  bpm_source       text check (bpm_source in ('user', 'tag', 'librosa', 'essentia', 'rekordbox', 'claude', 'import')),
  bpm_confidence   real check (bpm_confidence between 0 and 1),

  -- Camelot code (1A..12B) or 'atonal'. Musical notation is derived in the UI.
  musical_key      text check (musical_key ~ '^(1[0-2]|[1-9])[AB]$' or musical_key = 'atonal'),
  key_source       text check (key_source in ('user', 'tag', 'librosa', 'essentia', 'rekordbox', 'claude', 'import')),
  key_confidence   real check (key_confidence between 0 and 1),

  energy           smallint check (energy between 1 and 10),
  rating           smallint check (rating between 0 and 5),
  notes            text check (length(notes) <= 20000),
  active           boolean not null default false,  -- has a cloud preview
  needs_review     boolean not null default false,

  created_by       uuid default auth.uid() references auth.users (id),
  updated_by       uuid default auth.uid() references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  search           tsvector generated always as (
                     setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                     setweight(to_tsvector('simple', coalesce(artist, '')), 'A') ||
                     setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
                   ) stored
);

create index tracks_search_idx on public.tracks using gin (search);
create index tracks_genre_idx  on public.tracks (genre_id) where deleted_at is null;
create index tracks_bpm_idx    on public.tracks (bpm) where deleted_at is null;
create index tracks_key_idx    on public.tracks (musical_key) where deleted_at is null;
create index tracks_labels_idx on public.tracks using gin (labels);

create table public.track_style_tags (
  track_id uuid not null references public.tracks (id) on delete cascade,
  tag_id   smallint not null references public.style_tags (id),
  primary key (track_id, tag_id)
);

-- ---------------------------------------------------------------- versions (files)

create table public.versions (
  id                      uuid primary key default gen_random_uuid(),
  track_id                uuid not null references public.tracks (id),
  name                    text not null default 'original' check (length(name) between 1 and 200),
  content_hash            text not null unique check (content_hash ~ '^[0-9a-f]{64}$'),  -- sha256 of the file bytes
  fingerprint             text,          -- Chromaprint (1b)
  codec                   text,
  bitrate_kbps            integer check (bitrate_kbps > 0),
  sample_rate             integer check (sample_rate > 0),
  bit_depth               smallint,
  channels                smallint,
  duration_s              numeric(9,3) check (duration_s >= 0),
  suspected_fake_lossless boolean,
  path_hint               text,          -- path relative to the library root on the Macs
  preview_key             text,          -- object key of the ~128 kbps preview in R2
  preview_lufs            real,          -- integrated loudness, for level-matched A/B
  sent_at                 timestamptz,   -- once set, the file facts are frozen
  created_by              uuid default auth.uid() references auth.users (id),
  updated_by              uuid default auth.uid() references auth.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create index versions_track_idx on public.versions (track_id);

-- A "sent" version is frozen: its file facts and name can no longer change.
create or replace function public.freeze_sent_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sent_at is not null and (
       new.content_hash is distinct from old.content_hash or
       new.name         is distinct from old.name or
       new.track_id     is distinct from old.track_id or
       new.duration_s   is distinct from old.duration_s or
       new.sent_at      is distinct from old.sent_at
     ) then
    raise exception 'musica: version % was sent and is frozen', old.id;
  end if;
  return new;
end;
$$;

create trigger versions_freeze
  before update on public.versions
  for each row execute function public.freeze_sent_version();

-- ---------------------------------------------------------------- analyses

create table public.analyses (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references public.versions (id),
  analyser         text not null,      -- e.g. 'librosa-bpm', 'ks-key', 'essentia-genre'
  analyser_version text not null,
  "values"         jsonb not null,
  job_id           uuid,
  created_by       uuid default auth.uid() references auth.users (id),
  created_at       timestamptz not null default now()
);

create index analyses_version_idx on public.analyses (version_id, analyser);

-- ---------------------------------------------------------------- crates and cues

create table public.crates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 200),
  notes      text,
  created_by uuid default auth.uid() references auth.users (id),
  updated_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.crate_tracks (
  crate_id   uuid not null references public.crates (id) on delete cascade,
  track_id   uuid not null references public.tracks (id) on delete cascade,
  position   integer not null default 0,
  added_by   uuid default auth.uid() references auth.users (id),
  added_at   timestamptz not null default now(),
  primary key (crate_id, track_id)
);

create table public.cues (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.versions (id) on delete cascade,
  kind       text not null default 'memory' check (kind in ('memory', 'hot')),
  position_s numeric(9,3) not null check (position_s >= 0),
  label      text check (length(label) <= 100),
  color      smallint check (color between 1 and 8),   -- Rekordbox 8-colour palette
  source     text not null default 'user' check (source in ('user', 'auto', 'rekordbox', 'claude')),
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index cues_version_idx on public.cues (version_id);

-- ---------------------------------------------------------------- who changed what

create table public.change_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  via        text not null check (via in ('app', 'claude', 'worker', 'system')),
  table_name text not null,
  row_id     text not null,
  op         text not null check (op in ('insert', 'update', 'delete')),
  diff       jsonb,
  at         timestamptz not null default now()
);

create index change_log_row_idx on public.change_log (table_name, row_id, at desc);

-- Clients say how a change was made with the 'x-musica-via' request header
-- (app, claude, worker). Anything else counts as 'app'.
create or replace function public.request_via()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'system'
    else coalesce(
      (select v from (select nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-musica-via' as v) h
        where v in ('app', 'claude', 'worker')),
      'app')
  end;
$$;

-- Stamps updated_at / updated_by.
create or replace function public.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- Writes one change_log row per change, with only the changed columns.
create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_diff jsonb;
  v_id   text;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value))
      into v_diff
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'updated_by', 'search')
       and (v_old -> n.key) is distinct from n.value;
    if v_diff is null then
      return new;
    end if;
  else
    v_diff := coalesce(v_new, v_old) - 'search';
  end if;

  v_id := coalesce(v_new, v_old) ->> 'id';
  if v_id is null then
    -- link tables have composite keys
    v_id := concat_ws(':', coalesce(v_new, v_old) ->> 'crate_id', coalesce(v_new, v_old) ->> 'track_id',
                           coalesce(v_new, v_old) ->> 'tag_id');
  end if;

  insert into public.change_log (actor, via, table_name, row_id, op, diff)
  values (auth.uid(), public.request_via(), tg_table_name, v_id, lower(tg_op), v_diff);

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tracks', 'versions', 'crates'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_row()',
                   t || '_touch', t);
  end loop;
  foreach t in array array['tracks', 'versions', 'crates', 'crate_tracks', 'cues', 'track_style_tags'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_change()',
                   t || '_log', t);
  end loop;
end;
$$;
