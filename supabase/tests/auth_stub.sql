-- Minimal stand-in for the parts of Supabase the migrations rely on.
-- Only used by the local tests; never applied to a real project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  raw_app_meta_data  jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- Supabase gives these roles broad default grants; the migrations must revoke them.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
