import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, rows, one, ANDRE, FRIEND } from './helpers.js';

const HASH = 'a'.repeat(64);

async function trackWithVersion(db, user = ANDRE) {
  return as(db, user, async () => {
    const t = await one(db, `insert into public.tracks (title, artist) values ('Acid Line', 'Andre') returning id`);
    const v = await one(db, `insert into public.versions (track_id, content_hash) values ($1, $2) returning id`, [t.id, HASH]);
    return { track: t.id, version: v.id };
  });
}

test('library is shared: the friend sees and edits Andre\'s track', async () => {
  const db = await freshDb();
  const { track } = await trackWithVersion(db);
  await as(db, FRIEND, async () => {
    await db.query(`update public.tracks set rating = 4 where id = $1`, [track]);
  });
  const t = await one(db, `select rating, created_by, updated_by from public.tracks where id = $1`, [track]);
  assert.equal(t.rating, 4);
  assert.equal(t.created_by, ANDRE);
  assert.equal(t.updated_by, FRIEND);
});

test('tracks cannot be hard-deleted, only soft-deleted', async () => {
  const db = await freshDb();
  const { track } = await trackWithVersion(db);
  await as(db, ANDRE, async () => {
    await assert.rejects(db.query(`delete from public.tracks where id = $1`, [track]), /permission denied/);
    await db.query(`update public.tracks set deleted_at = now() where id = $1`, [track]);
  });
});

test('every change is logged with who and how', async () => {
  const db = await freshDb();
  const { track } = await trackWithVersion(db);
  await as(db, FRIEND, () => db.query(`update public.tracks set notes = 'great drop' where id = $1`, [track]),
    { 'x-musica-via': 'claude' });
  const log = await one(db, `select actor, via, op, diff from public.change_log
                              where table_name = 'tracks' and op = 'update'`);
  assert.equal(log.actor, FRIEND);
  assert.equal(log.via, 'claude');
  assert.deepEqual(Object.keys(log.diff), ['notes']);
  assert.equal(log.diff.notes.to, 'great drop');
});

test('unknown via header counts as app', async () => {
  const db = await freshDb();
  await as(db, ANDRE, () => db.query(`insert into public.tracks (title) values ('x')`), { 'x-musica-via': 'evil' });
  assert.equal((await one(db, `select via from public.change_log where table_name = 'tracks'`)).via, 'app');
});

test('members cannot write the change log', async () => {
  const db = await freshDb();
  await as(db, ANDRE, async () => {
    await assert.rejects(db.query(`insert into public.change_log (via, table_name, row_id, op) values ('app','x','1','insert')`),
      /permission denied/);
  });
});

test('identical file bytes cannot be added twice', async () => {
  const db = await freshDb();
  const { track } = await trackWithVersion(db);
  await as(db, FRIEND, async () => {
    await assert.rejects(db.query(`insert into public.versions (track_id, content_hash) values ($1, $2)`, [track, HASH]),
      /duplicate key/);
  });
});

test('a sent version is frozen', async () => {
  const db = await freshDb();
  const { version } = await trackWithVersion(db);
  await as(db, ANDRE, async () => {
    await db.query(`update public.versions set name = 'club mix v2', sent_at = now() where id = $1`, [version]);
    await assert.rejects(db.query(`update public.versions set name = 'v3' where id = $1`, [version]), /frozen/);
    // non-file facts can still change
    await db.query(`update public.versions set preview_key = 'p/1.mp3' where id = $1`, [version]);
  });
});

test('keys are Camelot codes or atonal', async () => {
  const db = await freshDb();
  const { track } = await trackWithVersion(db);
  await as(db, ANDRE, async () => {
    await db.query(`update public.tracks set musical_key = '12B' where id = $1`, [track]);
    await db.query(`update public.tracks set musical_key = 'atonal' where id = $1`, [track]);
    await assert.rejects(db.query(`update public.tracks set musical_key = 'C major' where id = $1`, [track]), /check/);
  });
});

test('full-text search finds title and artist', async () => {
  const db = await freshDb();
  await trackWithVersion(db);
  const r = await as(db, FRIEND, () =>
    rows(db, `select title from public.tracks where search @@ plainto_tsquery('simple', 'acid')`));
  assert.equal(r.length, 1);
});

test('analysis fills empty values, but a user value always wins', async () => {
  const db = await freshDb();
  const { track, version } = await trackWithVersion(db);
  await as(db, ANDRE, async () => {
    await db.query(`select public.record_analysis($1, 'librosa', '1', 'librosa', $2)`,
      [version, { bpm: 145, bpm_confidence: 0.6, key: '8A', key_confidence: 0.7, duration_s: 300.5, codec: 'flac' }]);
  });
  let t = await one(db, `select bpm, bpm_source, musical_key from public.tracks where id = $1`, [track]);
  assert.equal(Number(t.bpm), 145);
  assert.equal(t.musical_key, '8A');
  assert.equal((await one(db, `select codec from public.versions where id = $1`, [version])).codec, 'flac');

  await as(db, FRIEND, async () => {
    await db.query(`update public.tracks set bpm = 72.5, bpm_source = 'user' where id = $1`, [track]);
    await db.query(`select public.record_analysis($1, 'librosa', '2', 'librosa', $2)`,
      [version, { bpm: 145, bpm_confidence: 0.99 }]);
  });
  t = await one(db, `select bpm, bpm_source from public.tracks where id = $1`, [track]);
  assert.equal(Number(t.bpm), 72.5);
  assert.equal(t.bpm_source, 'user');
  assert.equal((await rows(db, `select 1 from public.analyses where version_id = $1`, [version])).length, 2);
});

test('lower-confidence analysis does not overwrite a better one', async () => {
  const db = await freshDb();
  const { track, version } = await trackWithVersion(db);
  await as(db, ANDRE, async () => {
    await db.query(`select public.record_analysis($1, 'a', '1', 'tag', $2)`, [version, { bpm: 140, bpm_confidence: 0.9 }]);
    await db.query(`select public.record_analysis($1, 'b', '1', 'librosa', $2)`, [version, { bpm: 70, bpm_confidence: 0.5 }]);
  });
  assert.equal(Number((await one(db, `select bpm from public.tracks where id = $1`, [track])).bpm), 140);
});

test('a genre suggestion is flagged for review', async () => {
  const db = await freshDb();
  const { track, version } = await trackWithVersion(db);
  await as(db, ANDRE, () =>
    db.query(`select public.record_analysis($1, 'essentia', '1', 'essentia', $2)`, [version, { genre_slug: 'psytrance', genre_confidence: 0.4 }]));
  const t = await one(db, `select g.slug, t.needs_review from public.tracks t join public.genres g on g.id = t.genre_id where t.id = $1`, [track]);
  assert.equal(t.slug, 'psytrance');
  assert.equal(t.needs_review, true);
});

test('subgenres sit under a top-level genre with sane BPM ranges', async () => {
  const db = await freshDb();
  const { rows } = await db.query(`
    select s.slug, s.bpm_min, s.bpm_max, p.parent_id as grandparent
      from public.genres s join public.genres p on p.id = s.parent_id`);
  assert.ok(rows.length >= 30);
  for (const r of rows) {
    assert.equal(r.grandparent, null, `${r.slug} must sit under a top-level genre`);
    if (r.bpm_min != null) assert.ok(Number(r.bpm_min) <= Number(r.bpm_max), r.slug);
  }
});
