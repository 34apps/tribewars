import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CHIEFTAINS, DEFAULT_CHIEFTAIN, type ChatMessageDto, type ChatResponse, type MapResponse, type MeResponse, type TribeDto } from '@clanfire/engine';
import { applySchema } from '../src/db.ts';
import { Client, HOUR, PASSWORD, errorOf, makeApp, ok } from './helpers.ts';
import { addMember, newLeader, nextIp } from './tribe-helpers.ts';

const SECOND = CHIEFTAINS[1].id;
const THIRD = CHIEFTAINS[2].id;

const mapAll = async (c: Client, radius = 12): Promise<MapResponse['villages']> => {
  const span = radius * 2 + 1;
  const res = await c.get(`/api/map?x=${-radius}&y=${-radius}&w=${span}&h=${span}`);
  ok(res);
  return res.json<MapResponse>().villages;
};

test('register: chieftain optional, defaults, validated', async () => {
  const { app } = await makeApp();

  const plain = new Client(app, nextIp());
  const a = await plain.post('/api/auth/register', { username: 'plain_one', password: PASSWORD });
  ok(a, 201);
  assert.equal(a.json<MeResponse>().player?.chieftain, DEFAULT_CHIEFTAIN);

  const chosen = new Client(app, nextIp());
  const b = await chosen.post('/api/auth/register', { username: 'chosen_one', password: PASSWORD, chieftain: SECOND });
  ok(b, 201);
  assert.equal(b.json<MeResponse>().player?.chieftain, SECOND);

  for (const bad of ['nobody', '', 7, null, 'x'.repeat(100)]) {
    const c = new Client(app, nextIp());
    errorOf(await c.post('/api/auth/register', { username: 'bad_one', password: PASSWORD, chieftain: bad }), 400, 'invalid_input');
  }
  // A refused registration creates nothing: the name is still free.
  const retry = new Client(app, nextIp());
  ok(await retry.post('/api/auth/register', { username: 'bad_one', password: PASSWORD }), 201);
});

test('POST /api/me/chieftain changes the portrait; shows in me, state and login', async () => {
  const { app } = await makeApp();
  const c = new Client(app, nextIp());
  ok(await c.post('/api/auth/register', { username: 'changer', password: PASSWORD }), 201);

  const res = await c.post('/api/me/chieftain', { chieftain: THIRD });
  ok(res);
  assert.equal(res.json<MeResponse>().player?.chieftain, THIRD);
  assert.equal((await c.get('/api/auth/me')).json<MeResponse>().player?.chieftain, THIRD);
  assert.equal((await c.state()).player.chieftain, THIRD);

  const again = new Client(app, nextIp());
  const login = await again.post('/api/auth/login', { username: 'changer', password: PASSWORD });
  ok(login);
  assert.equal(login.json<MeResponse>().player?.chieftain, THIRD);

  errorOf(await c.post('/api/me/chieftain', { chieftain: 'nobody' }), 400, 'invalid_input');
  errorOf(await c.post('/api/me/chieftain', {}), 400, 'invalid_input');
  errorOf(await c.post('/api/me/chieftain', { chieftain: SECOND, extra: 1 }), 400, 'invalid_input');
  assert.equal((await c.get('/api/auth/me')).json<MeResponse>().player?.chieftain, THIRD, 'bad requests change nothing');

  errorOf(await c.post('/api/me/chieftain', { chieftain: SECOND }, { origin: 'http://evil.example' }), 403, 'forbidden');

  const anon = new Client(app, nextIp());
  errorOf(await anon.post('/api/me/chieftain', { chieftain: SECOND }), 401, 'unauthorized');
});

test('chieftain appears in tribe members, chat and the map', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'leader1', 'Portraits', 'PORT', 'open');
  const mem = await addMember(app, lead, 'member1');
  ok(await lead.c.post('/api/me/chieftain', { chieftain: SECOND }));
  ok(await mem.c.post('/api/me/chieftain', { chieftain: THIRD }));

  const tribe = (await lead.c.get(`/api/tribes/${lead.tribeId}`)).json<TribeDto>();
  const byName = new Map(tribe.memberList.map((m) => [m.username, m.chieftain]));
  assert.equal(byName.get('leader1'), SECOND);
  assert.equal(byName.get('member1'), THIRD);

  const posted = await mem.c.post('/api/tribe/chat', { text: 'hello' });
  ok(posted, 201);
  assert.equal(posted.json<ChatMessageDto>().chieftain, THIRD);
  const msgs = (await lead.c.get('/api/tribe/chat')).json<ChatResponse>().messages;
  assert.equal(msgs[0]?.chieftain, THIRD, 'listed messages carry the poster\'s current portrait');
  ok(await mem.c.post('/api/me/chieftain', { chieftain: SECOND }));
  assert.equal((await lead.c.get('/api/tribe/chat')).json<ChatResponse>().messages[0]?.chieftain, SECOND);

  const villages = await mapAll(lead.c);
  const own = villages.find((v) => v.kind === 'own');
  const other = villages.find((v) => v.kind === 'player');
  assert.equal(own?.ownerChieftain, SECOND);
  assert.equal(other?.ownerName, 'member1');
  assert.equal(other?.ownerChieftain, SECOND);
  const abandoned = villages.filter((v) => v.kind === 'abandoned');
  assert.ok(abandoned.length > 0);
  for (const v of abandoned) assert.equal(v.ownerChieftain, null);
});

test('an old database without the column is upgraded in place', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, protected_until INTEGER NOT NULL DEFAULT 0
  )`);
  db.prepare('INSERT INTO players (username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?)').run('Old', 'old', 'x', 1);

  const columns = (): string[] => (db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(!columns().includes('chieftain'));
  applySchema(db);
  assert.ok(columns().includes('chieftain'));
  const row = db.prepare('SELECT chieftain FROM players WHERE username_lower = ?').get('old') as { chieftain: string };
  assert.equal(row.chieftain, DEFAULT_CHIEFTAIN);

  applySchema(db); // running again is harmless
  assert.equal(columns().filter((n) => n === 'chieftain').length, 1);
  db.close();
});

test('map: abandoned villages are settled to now, without writing', async () => {
  // Growth step = 1h / speed 10 = 6 min of real time.
  const { app, clock } = await makeApp({ world: { npcGrowthHours: 1 } });
  const c = new Client(app, nextIp());
  ok(await c.post('/api/auth/register', { username: 'watcher', password: PASSWORD }), 201);

  const before = (await mapAll(c)).filter((v) => v.kind === 'abandoned');
  assert.ok(before.length > 0);
  const stored = (): number => (app.ctx.store.db.prepare('SELECT SUM(points) AS n FROM villages WHERE owner_id IS NULL').get() as { n: number }).n;
  const storedBefore = stored();

  clock.advance(12 * HOUR); // 120 growth steps
  const after = (await mapAll(c)).filter((v) => v.kind === 'abandoned');
  const sum = (vs: typeof after): number => vs.reduce((n, v) => n + v.points, 0);
  assert.equal(after.length, before.length);
  assert.ok(sum(after) > sum(before), `abandoned points grow: ${sum(before)} -> ${sum(after)}`);
  for (const v of after) {
    const was = before.find((b) => b.id === v.id);
    assert.ok(was && v.points >= was.points, 'no village shrinks');
  }
  assert.equal(stored(), storedBefore, 'GET /api/map does not write');
});
