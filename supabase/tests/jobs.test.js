import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, rows, one, ANDRE, FRIEND } from './helpers.js';

async function setup() {
  const db = await freshDb();
  await as(db, ANDRE, () => db.query(`select public.register_runner('andre-mac', '{analyse,preview,heavy}')`));
  await as(db, FRIEND, () => db.query(`select public.register_runner('friend-air', '{analyse,preview}')`));
  return db;
}

const enqueue = (db, user, kind, caps = '{}', dedupe = null) =>
  as(db, user, () => one(db, `select * from public.enqueue_job($1, null, '{}', $2, $3)`, [kind, caps, dedupe]));
const claim = (db, user, runner) => as(db, user, () => one(db, `select * from public.claim_job($1)`, [runner]));

test('asking twice for the same job returns the existing one', async () => {
  const db = await setup();
  const a = await enqueue(db, ANDRE, 'analyse', '{analyse}', 'analyse:v1');
  const b = await enqueue(db, FRIEND, 'analyse', '{analyse}', 'analyse:v1');
  assert.equal(a.id, b.id);
  assert.equal((await rows(db, `select 1 from public.jobs`)).length, 1);
});

test('a job is claimed once, by a runner with the needed capabilities', async () => {
  const db = await setup();
  const heavy = await enqueue(db, FRIEND, 'stems', '{heavy}');
  // the Air cannot take the heavy job; it waits for Andre's Mac
  assert.equal((await claim(db, FRIEND, 'friend-air')).id, null);
  const c = await claim(db, ANDRE, 'andre-mac');
  assert.equal(c.id, heavy.id);
  assert.equal(c.status, 'running');
  assert.equal(c.attempts, 1);
  assert.equal((await claim(db, ANDRE, 'andre-mac')).id, null);
});

test('jobs cannot be written directly', async () => {
  const db = await setup();
  await as(db, ANDRE, async () => {
    await assert.rejects(db.query(`insert into public.jobs (kind) values ('analyse')`), /permission denied/);
  });
  const j = await enqueue(db, ANDRE, 'analyse');
  await as(db, ANDRE, async () => {
    await assert.rejects(db.query(`update public.jobs set status = 'done' where id = $1`, [j.id]), /permission denied/);
  });
});

test('you cannot use or take over someone else\'s runner', async () => {
  const db = await setup();
  await enqueue(db, ANDRE, 'analyse');
  await assert.rejects(claim(db, FRIEND, 'andre-mac'), /unknown runner/);
  await assert.rejects(as(db, FRIEND, () => db.query(`select public.register_runner('andre-mac', '{}')`)), /belongs to another user/);
});

test('complete and fail only work for the runner holding the job', async () => {
  const db = await setup();
  const j = await enqueue(db, ANDRE, 'analyse', '{analyse}');
  await claim(db, FRIEND, 'friend-air');
  const ok = await as(db, ANDRE, () => one(db, `select public.complete_job($1, 'andre-mac', '{}') as ok`, [j.id]));
  assert.equal(ok.ok, false);
  const done = await as(db, FRIEND, () => one(db, `select public.complete_job($1, 'friend-air', '{"bpm":140}') as ok`, [j.id]));
  assert.equal(done.ok, true);
  assert.equal((await one(db, `select status from public.jobs where id = $1`, [j.id])).status, 'done');
});

test('a failed job retries until max attempts, then stays failed', async () => {
  const db = await setup();
  const j = await enqueue(db, ANDRE, 'analyse');
  for (let i = 1; i <= 3; i++) {
    const c = await claim(db, ANDRE, 'andre-mac');
    assert.equal(c.id, j.id);
    await as(db, ANDRE, () => db.query(`select public.fail_job($1, 'andre-mac', 'boom')`, [j.id]));
  }
  const s = await one(db, `select status, attempts, error from public.jobs where id = $1`, [j.id]);
  assert.deepEqual([s.status, s.attempts, s.error], ['failed', 3, 'boom']);
  // once failed, the same request can be queued again
  const again = await enqueue(db, ANDRE, 'analyse', '{}', null);
  assert.notEqual(again.id, j.id);
});

test('an expired lease goes back to the queue for another Mac', async () => {
  const db = await setup();
  const j = await enqueue(db, ANDRE, 'analyse', '{analyse}');
  await claim(db, ANDRE, 'andre-mac');
  // Andre's Mac went to sleep
  await db.query(`update public.jobs set lease_until = now() - interval '1 second' where id = $1`, [j.id]);
  const c = await claim(db, FRIEND, 'friend-air');
  assert.equal(c.id, j.id);
  assert.equal(c.attempts, 2);
  // the sleeping Mac wakes up: its heartbeat tells it to stop
  const hb = await as(db, ANDRE, () => one(db, `select public.heartbeat_job($1, 'andre-mac') as ok`, [j.id]));
  assert.equal(hb.ok, false);
});

test('higher priority jobs run first', async () => {
  const db = await setup();
  await enqueue(db, ANDRE, 'analyse');
  const urgent = await as(db, ANDRE, () => one(db, `select * from public.enqueue_job('preview', null, '{}', '{}', null, 1::smallint)`));
  assert.equal((await claim(db, ANDRE, 'andre-mac')).id, urgent.id);
});

test('cancelled jobs are not claimed', async () => {
  const db = await setup();
  const j = await enqueue(db, ANDRE, 'analyse');
  await as(db, FRIEND, () => db.query(`select public.cancel_job($1)`, [j.id]));
  assert.equal((await claim(db, ANDRE, 'andre-mac')).id, null);
});
