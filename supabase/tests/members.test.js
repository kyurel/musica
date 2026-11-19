import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, rows, one, signUp, ANDRE, STRANGER } from './helpers.js';

test('allowlisted GitHub accounts get linked on sign-up', async () => {
  const db = await freshDb();
  const r = await rows(db, `select github_login, user_id from public.allowed_users order by github_id`);
  assert.equal(r[0].user_id, ANDRE);
  assert.equal(r.length, 2);
});

test('a GitHub account not on the allowlist cannot sign up', async () => {
  const db = await freshDb();
  await assert.rejects(signUp(db, STRANGER, 999), /not on the allowlist/);
});

test('non-GitHub sign-ups are rejected', async () => {
  const db = await freshDb();
  await db.exec(`insert into public.allowed_users (github_id, github_login) values (3, 'x')`);
  await assert.rejects(signUp(db, STRANGER, 3, 'email'), /only GitHub/);
});

test('anon sees nothing and cannot write', async () => {
  const db = await freshDb();
  await as(db, null, async () => {
    await assert.rejects(db.query(`select * from public.tracks`), /permission denied/);
    await assert.rejects(db.query(`select * from public.genres`), /permission denied/);
    await assert.rejects(db.query(`select public.enqueue_job('analyse')`), /permission denied/);
  });
});

test('a signed-in non-member sees no rows and cannot write', async () => {
  const db = await freshDb();
  // a user that exists in auth but is not linked to the allowlist (e.g. removed later)
  await db.query(`update public.allowed_users set user_id = null where user_id = $1`, [ANDRE]);
  await as(db, ANDRE, async () => {
    assert.equal((await rows(db, `select * from public.genres`)).length, 0);
    await assert.rejects(db.query(`insert into public.tracks (title) values ('x')`), /row-level security/);
    await assert.rejects(db.query(`select public.enqueue_job('analyse')`), /not a member/);
  });
});

test('members can read the genre vocabulary', async () => {
  const db = await freshDb();
  const g = await as(db, ANDRE, () => rows(db, `select slug from public.genres where parent_id is null order by sort`));
  assert.equal(g.length, 12);
  assert.equal(g[0].slug, 'techno');
});

test('members cannot edit the allowlist', async () => {
  const db = await freshDb();
  await as(db, ANDRE, async () => {
    await assert.rejects(db.query(`insert into public.allowed_users (github_id, github_login) values (5, 'x')`), /permission denied/);
  });
});
