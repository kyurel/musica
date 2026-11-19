import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', 'migrations');

export const ANDRE = '00000000-0000-0000-0000-00000000000a';
export const FRIEND = '00000000-0000-0000-0000-00000000000b';
export const STRANGER = '00000000-0000-0000-0000-00000000000c';

// Fresh database with the auth stub, all migrations, and two members signed up.
export async function freshDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, 'auth_stub.sql'), 'utf8'));
  for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrations, f), 'utf8'));
  }
  await db.exec(`insert into public.allowed_users (github_id, github_login) values (1, 'andre'), (2, 'friend')`);
  await signUp(db, ANDRE, 1);
  await signUp(db, FRIEND, 2);
  return db;
}

export function signUp(db, id, githubId, provider = 'github') {
  return db.query(
    `insert into auth.users (id, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3)`,
    [id, { provider }, { provider_id: String(githubId) }],
  );
}

// Run fn as a signed-in user (role authenticated), like a PostgREST request.
export async function as(db, userId, fn, headers = {}) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.headers', $2, false)`,
    [userId ?? '', JSON.stringify(headers)]);
  await db.exec(userId ? 'set role authenticated' : 'set role anon');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '', false)`);
  }
}

export async function rows(db, sql, params) {
  return (await db.query(sql, params)).rows;
}

export async function one(db, sql, params) {
  return (await rows(db, sql, params))[0];
}
