// Private notes and tags: create / replace / list / delete, input checks, the cap, privacy between players, owner change,
// the rate limit and plain-text storage.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTES_PER_PLAYER_MAX, NOTE_TEXT_MAX, type NoteResponse, type NotesResponse } from '@clanfire/engine';
import { errorOf, makeApp, MINUTE, ok, register, type Client } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

const list = async (c: Client): Promise<NotesResponse> => {
  const res = await c.get('/api/notes');
  ok(res);
  return res.json<NotesResponse>();
};
const save = async (c: Client, body: object): Promise<NoteResponse['note']> => {
  const res = await c.post('/api/notes', body);
  ok(res);
  return res.json<NoteResponse>().note;
};
const homeId = (app: App, p: P): number => app.ctx.store.villagesOfPlayer(p.id)[0]!.id;
const rows = (app: App, where = '1 = 1'): number => (app.ctx.store.db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE ${where}`).get() as { n: number }).n;

async function two() {
  const { app, clock } = await makeApp();
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  return { app, clock, alice, bob };
}

test('create a village note and a player note; the list shows names, tile and owner', async () => {
  const { app, alice, bob } = await two();
  const v = app.ctx.store.getVillage(homeId(app, bob))!;
  const n = await save(alice.c, { kind: 'village', targetId: v.id, text: '  Easy loot  ', tags: ['prey'] });
  assert.equal(n.text, 'Easy loot');
  assert.deepEqual(
    { kind: n.kind, targetId: n.targetId, targetName: n.targetName, x: n.x, y: n.y, ownerName: n.ownerName, tags: n.tags },
    { kind: 'village', targetId: v.id, targetName: v.name, x: v.x, y: v.y, ownerName: 'bob', tags: ['prey'] },
  );
  const p = await save(alice.c, { kind: 'player', targetId: bob.id, text: 'Strong', tags: ['menace'] });
  assert.equal(p.targetName, 'bob');
  assert.equal(p.x, undefined);
  assert.equal(p.ownerName, undefined);
  const l = await list(alice.c);
  assert.deepEqual(l.limits, { textMax: NOTE_TEXT_MAX, max: NOTES_PER_PLAYER_MAX });
  assert.equal(l.notes.length, 2);
});

test('saving again replaces the note: same id, one row; the list is newest edit first', async () => {
  const { app, clock, alice, bob } = await two();
  const vid = homeId(app, bob);
  const first = await save(alice.c, { kind: 'village', targetId: vid, text: 'one', tags: [] });
  clock.advance(MINUTE);
  const other = await save(alice.c, { kind: 'player', targetId: bob.id, text: 'two', tags: [] });
  assert.deepEqual((await list(alice.c)).notes.map((n) => n.id), [other.id, first.id]);
  clock.advance(MINUTE);
  const again = await save(alice.c, { kind: 'village', targetId: vid, text: 'changed', tags: ['watch'] });
  assert.equal(again.id, first.id);
  assert.equal(again.text, 'changed');
  assert.ok(again.updatedAt > first.updatedAt);
  assert.equal(rows(app, `player_id = ${alice.id}`), 2);
  assert.deepEqual((await list(alice.c)).notes.map((n) => n.id), [first.id, other.id], 'the edited note moved to the top');
});

test('tags: fixed order, duplicates collapse, empty text is fine with a tag', async () => {
  const { app, alice, bob } = await two();
  const n = await save(alice.c, { kind: 'village', targetId: homeId(app, bob), text: '', tags: ['plan', 'prey', 'plan', 'friend'] });
  assert.deepEqual(n.tags, ['prey', 'friend', 'plan']);
  assert.equal(n.text, '');
  assert.deepEqual((await list(alice.c)).notes[0]!.tags, ['prey', 'friend', 'plan']);
});

test('bad input is invalid_input and nothing is saved', async () => {
  const { app, alice, bob } = await two();
  const t = homeId(app, bob);
  const good = { kind: 'village', targetId: t, text: 'ok', tags: ['prey'] };
  const bad: unknown[] = [
    { ...good, text: '', tags: [] }, // both empty
    { ...good, text: '   ', tags: [] },
    { ...good, text: 'x'.repeat(NOTE_TEXT_MAX + 1) },
    { ...good, text: 'a\nb' },
    { ...good, text: 'a\tb' },
    { ...good, text: 'a\u0000b' },
    { ...good, text: 'a‮b' }, // bidi override
    { ...good, tags: ['nope'] },
    { ...good, tags: 'prey' },
    { ...good, tags: [5] },
    { ...good, text: 5 },
    { ...good, extra: 1 },
    { ...good, targetId: String(t) },
    { ...good, targetId: 0 },
    { ...good, targetId: 1.5 },
    { ...good, kind: 'tribe' },
    { kind: 'village', targetId: t, text: 'ok' },
    { targetId: t, text: 'ok', tags: [] },
    {},
  ];
  for (const body of bad) errorOf(await alice.c.post('/api/notes', body), 400, 'invalid_input');
  assert.equal(rows(app), 0);
  // The limit itself is fine, counted in characters (an emoji is one).
  ok(await alice.c.post('/api/notes', { ...good, text: 'x'.repeat(NOTE_TEXT_MAX) }));
  ok(await alice.c.post('/api/notes', { ...good, text: '\u{1F525}'.repeat(NOTE_TEXT_MAX) }));
  assert.equal(rows(app), 1);
  errorOf(await alice.c.get('/api/notes?x=1'), 400, 'invalid_input');
  errorOf(await alice.c.post('/api/notes/1/delete', { a: 1 }), 400, 'invalid_input');
});

test('an unknown village or player is 404; an abandoned village can be noted', async () => {
  const { app, alice } = await two();
  errorOf(await alice.c.post('/api/notes', { kind: 'village', targetId: 999_999, text: 'x', tags: [] }), 404, 'not_found');
  errorOf(await alice.c.post('/api/notes', { kind: 'player', targetId: 999_999, text: 'x', tags: [] }), 404, 'not_found');
  assert.equal(rows(app), 0);
  const abandoned = app.ctx.store.abandonedVillageIds()[0]!;
  const n = await save(alice.c, { kind: 'village', targetId: abandoned, text: 'empty', tags: ['prey'] });
  assert.equal(n.ownerName, null);
  assert.equal(typeof n.x, 'number');
});

test('the cap: a new note past the limit is 409 note_limit; replacing and deleting still work at the cap', async () => {
  const { app, alice, bob } = await two();
  const store = app.ctx.store;
  const target = homeId(app, bob);
  // Fill up directly (player notes on ids that do not matter for the cap check); one real note first.
  const first = await save(alice.c, { kind: 'village', targetId: target, text: 'real', tags: [] });
  const ins = store.db.prepare("INSERT INTO notes (player_id, kind, target_id, text, tags, updated_at) VALUES (?, 'village', ?, 'filler', '[]', 1)");
  store.db.exec('BEGIN');
  for (let i = 1; i < NOTES_PER_PLAYER_MAX; i++) ins.run(alice.id, 1_000_000 + i);
  store.db.exec('COMMIT');
  assert.equal(rows(app, `player_id = ${alice.id}`), NOTES_PER_PLAYER_MAX);
  errorOf(await alice.c.post('/api/notes', { kind: 'player', targetId: bob.id, text: 'one too many', tags: [] }), 409, 'note_limit');
  assert.equal(rows(app, `player_id = ${alice.id}`), NOTES_PER_PLAYER_MAX);
  const again = await save(alice.c, { kind: 'village', targetId: target, text: 'still works', tags: ['plan'] });
  assert.equal(again.id, first.id);
  // Another player has their own allowance.
  await save(bob.c, { kind: 'player', targetId: alice.id, text: 'mine', tags: [] });
  ok(await alice.c.post(`/api/notes/${first.id}/delete`, {}), 204);
  await save(alice.c, { kind: 'player', targetId: bob.id, text: 'room again', tags: [] });
});

test('delete: 204, then 404; someone else\'s note id is 404 and the row survives', async () => {
  const { app, alice, bob } = await two();
  const n = await save(alice.c, { kind: 'player', targetId: bob.id, text: 'secret plan', tags: ['plan'] });
  errorOf(await bob.c.post(`/api/notes/${n.id}/delete`, {}), 404, 'not_found');
  assert.equal(rows(app, `id = ${n.id}`), 1, 'the row survived');
  assert.equal((await list(alice.c)).notes.length, 1);
  ok(await alice.c.post(`/api/notes/${n.id}/delete`, {}), 204);
  assert.equal(rows(app), 0);
  errorOf(await alice.c.post(`/api/notes/${n.id}/delete`, {}), 404, 'not_found');
  errorOf(await alice.c.post('/api/notes/999999/delete', {}), 404, 'not_found');
});

test('notes are private: two players noting the same target see only their own, and nobody reads another list', async () => {
  const { app, alice, bob } = await two();
  const carol = await newPlayer(app, 'carol');
  const target = homeId(app, carol);
  const a = await save(alice.c, { kind: 'village', targetId: target, text: 'alice thinks: weak', tags: ['prey'] });
  const b = await save(bob.c, { kind: 'village', targetId: target, text: 'bob thinks: strong', tags: ['menace'] });
  assert.notEqual(a.id, b.id);
  assert.deepEqual((await list(alice.c)).notes.map((n) => n.text), ['alice thinks: weak']);
  assert.deepEqual((await list(bob.c)).notes.map((n) => n.text), ['bob thinks: strong']);
  const mine = await list(carol.c);
  assert.deepEqual(mine.notes, [], 'the target never sees notes about them');
  assert.equal(JSON.stringify(await list(bob.c)).includes('alice thinks'), false);
  // Saving over the same target never touches the other author's row.
  await save(bob.c, { kind: 'village', targetId: target, text: 'bob again', tags: [] });
  assert.equal((await list(alice.c)).notes[0]!.text, 'alice thinks: weak');
});

test('a village note stays when the village changes owner and shows the new owner', async () => {
  const { app, alice, bob } = await two();
  const carol = await newPlayer(app, 'carol');
  const vid = homeId(app, bob);
  await save(alice.c, { kind: 'village', targetId: vid, text: 'bob\'s place', tags: ['watch'] });
  assert.equal((await list(alice.c)).notes[0]!.ownerName, 'bob');
  app.ctx.store.db.prepare('UPDATE villages SET owner_id = ? WHERE id = ?').run(carol.id, vid);
  const n = (await list(alice.c)).notes[0]!;
  assert.equal(n.ownerName, 'carol');
  assert.equal(n.text, "bob's place");
  app.ctx.store.db.prepare('UPDATE villages SET owner_id = NULL WHERE id = ?').run(vid);
  assert.equal((await list(alice.c)).notes[0]!.ownerName, null, 'abandoned now');
  // The renamed village shows its current name.
  app.ctx.store.db.prepare("UPDATE villages SET name = 'Renamed' WHERE id = ?").run(vid);
  assert.equal((await list(alice.c)).notes[0]!.targetName, 'Renamed');
});

test('signed-out calls are 401', async () => {
  const { app } = await makeApp();
  const anon = await register(app, 'someone', '10.0.0.1');
  anon.cookie = '';
  errorOf(await anon.get('/api/notes'), 401, 'unauthorized');
  errorOf(await anon.post('/api/notes', { kind: 'player', targetId: 1, text: 'x', tags: [] }), 401, 'unauthorized');
  errorOf(await anon.post('/api/notes/1/delete', {}), 401, 'unauthorized');
});

test('text is plain text: markup is stored and returned verbatim as a string', async () => {
  const { alice, bob } = await two();
  const text = '<script>alert(1)</script> & "quotes" <b>bold</b>';
  const n = await save(alice.c, { kind: 'player', targetId: bob.id, text, tags: [] });
  assert.equal(n.text, text);
  const res = await alice.c.get('/api/notes');
  assert.match(String(res.headers['content-type']), /application\/json/);
  assert.equal((await list(alice.c)).notes[0]!.text, text);
});

test('deleting an account removes its notes (cascade); other authors keep theirs', async () => {
  const { app, alice, bob } = await two();
  await save(alice.c, { kind: 'player', targetId: bob.id, text: 'a', tags: [] });
  await save(bob.c, { kind: 'player', targetId: alice.id, text: 'b', tags: [] });
  app.ctx.store.db.exec('PRAGMA foreign_keys = ON');
  app.ctx.store.db.prepare('DELETE FROM players WHERE id = ?').run(alice.id);
  assert.equal(rows(app, `player_id = ${alice.id}`), 0);
  assert.equal(rows(app, `player_id = ${bob.id}`), 1);
});

test('rate limit: 60 per minute per account for notes, then 429, and it resets', async () => {
  const { app, clock, alice, bob } = await two();
  for (let i = 0; i < 60; i++) assert.notEqual((await alice.c.get('/api/notes')).statusCode, 429);
  errorOf(await alice.c.post('/api/notes', { kind: 'player', targetId: bob.id, text: 'x', tags: [] }), 429, 'rate_limited');
  assert.notEqual((await bob.c.get('/api/notes')).statusCode, 429);
  clock.advance(MINUTE + 1);
  ok(await alice.c.get('/api/notes'));
});
