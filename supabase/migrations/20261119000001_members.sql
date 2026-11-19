-- Members: only allowlisted GitHub accounts can sign up or read anything.
-- Open sign-ups must also be turned off in the Supabase dashboard; this is the
-- database-side guard that holds even if that setting is changed by mistake.


create table public.allowed_users (
  github_id    bigint primary key,
  github_login text not null,
  user_id      uuid unique,           -- filled on first sign-in
  added_at     timestamptz not null default now()
);

comment on table public.allowed_users is
  'GitHub accounts allowed to use Musica. Edited only by the project owner (service role / SQL editor).';

-- True when the calling user is an allowlisted member.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users a where a.user_id = auth.uid()
  );
$$;

-- Runs before Supabase Auth creates a user. Rejects anything that is not an
-- allowlisted GitHub account, and links the auth user to the allowlist row.
create or replace function public.guard_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider  text := new.raw_app_meta_data ->> 'provider';
  v_github_id bigint;
begin
  if v_provider is distinct from 'github' then
    raise exception 'musica: only GitHub sign-in is allowed';
  end if;

  begin
    v_github_id := (new.raw_user_meta_data ->> 'provider_id')::bigint;
  exception when others then
    raise exception 'musica: missing GitHub id';
  end;

  update public.allowed_users
     set user_id = new.id
   where github_id = v_github_id
     and (user_id is null or user_id = new.id);

  if not found then
    raise exception 'musica: this GitHub account is not on the allowlist';
  end if;

  return new;
end;
$$;

create trigger musica_guard_new_user
  before insert on auth.users
  for each row execute function public.guard_new_user();

revoke all on function public.guard_new_user() from public, anon, authenticated;
