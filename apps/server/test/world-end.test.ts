// World end: the frozen world, the stored final rankings, what still works, and the live hint.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { test } from 'node:test';
import {
  ENTRY_PASS_DOMAIN,
  ENTRY_PASS_TTL_MS,
  abandonIdleMs,
  type LiveMessage,
  type MeResponse,
  type WorldEndResponse,
  type WorldInfoResponse,
} from '@clanfire/engine';
import { endWorld } from '../src/domination-service.ts';
import type { LiveSocket } from '../src/live.ts';
import { Client, HOUR, PASSWORD, errorOf, makeApp, ok, weakestAbandoned } from './helpers.ts';
import { ev, domWorld, setExact75, setPts, touchAll, DAY, STREAK_MS, auditRows } from './domination-helpers.ts';
import { giveTroops, movementsOf, reports, sendOk, send } from './warfare-helpers.ts';

const ENDED = 'This world has ended.';
const manual = (reason = 'test') => ({ kind: 'manual' as const, winner: null, reason, actorIp: 'cli' as const });

test('freeze: a march in flight still arrives, new orders are refused with 403, login works, registration is refused, talking is allowed', async () => {
  const w = await domWorld();
  const { app, clock, alice, bob } = w;
  giveTroops(app, alice, { raider: 10 });
  const target = await weakestAbandoned(alice.c, 12);
  const { movement } = await sendOk(alice, { x: target.x, y: target.y }, 'attack', { raider: 10 });
  const home = await alice.c.village();

  assert.equal(endWorld(app.ctx.store, { at: clock.now(), ...manual('freeze test') }), true);

  // New orders are refused by the one central check: 403 with a clear message, whatever the route.
  const refused = async (res: Awaited<ReturnType<Client['post']>>): Promise<void> => {
    errorOf(res, 403, 'forbidden');
    assert.equal(res.json<{ message: string }>().message, ENDED);
  };
  await refused(await alice.c.post(`/api/villages/${home.id}/build`, { building: 'lumber' }));
  await refused(await send(alice, { x: target.x, y: target.y }, 'attack', { raider: 1 }));
  await refused(await alice.c.post(`/api/villages/${home.id}/train`, { unit: 'raider', count: 1 }));
  await refused(await alice.c.post('/api/tribe/settings', { recruitment: 'invite' }));
  await refused(await alice.c.post('/api/tribe/leave'));
  await refused(await alice.c.post('/api/me/household', { shared: true }));
  await refused(await alice.c.post('/api/villages/1/rename', { name: 'x' }));
  await refused(await new Client(app, '10.1.1.1').post('/api/auth/register', { username: 'latecomer', password: PASSWORD }));
  assert.equal(app.ctx.store.getPlayerByLowerName('latecomer'), null, 'no account was created');

  // Reading still works, and the world says it ended.
  ok(await alice.c.get('/api/state'));
  const info = (await alice.c.get('/api/world/info')).json<WorldInfoResponse>();
  assert.equal(info.ended, true);

  // The march in flight still resolves: its battle report arrives after the end.
  assert.equal((await reports(alice)).length, 0);
  clock.set(movement.arriveAt + 1000);
  ok(await alice.c.get('/api/state'));
  assert.equal((await reports(alice)).length, 1, 'the battle happened after the end');
  assert.ok(!(await movementsOf(alice)).some((m) => m.id === movement.id), 'the outbound march is resolved');

  // Sign-in and talking still work.
  const again = new Client(app, '10.1.1.2');
  ok(await again.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
  ok(await again.post('/api/auth/logout'), 204);
  ok(await bob.c.post('/api/mail', { to: 'alice', subject: 'gg', body: 'well played' }), 201);
  ok(await alice.c.post('/api/tribe/chat', { text: 'what a game' }), 201);
  ok(await alice.c.post('/api/tickets', { category: 'feedback', subject: 'fun', body: 'thanks' }), 201);
  await app.close();
});

test('final rankings are stored once and never change', async () => {
  const w = await domWorld();
  const { app, clock } = w;
  const store = app.ctx.store;
  setPts(w, { alice: 7000, amy: 500, bob: 1500, lou: 1000 });

  assert.equal(endWorld(store, { at: clock.now(), kind: 'manual', winner: { tribeId: w.bob.tribeId, name: 'Bravo Clan', tag: 'BRAVO' }, reason: 'the operator says so', actorIp: 'cli' }), true);
  const first = app.ctx.domination.ended();
  assert.ok(first);
  assert.equal(first.kind, 'manual');
  assert.deepEqual(first.winner, { tribeId: w.bob.tribeId, name: 'Bravo Clan', tag: 'BRAVO' });
  assert.equal(first.reason, 'the operator says so');
  assert.deepEqual(first.finalTribes, [
    { rank: 1, tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA', points: 7500, members: 2, villages: 2 },
    { rank: 2, tribeId: w.bob.tribeId, name: 'Bravo Clan', tag: 'BRAVO', points: 1500, members: 1, villages: 1 },
  ]);
  assert.deepEqual(first.finalPlayers.map((p) => [p.rank, p.name, p.points, p.villages, p.tribeTag]), [
    [1, 'alice', 7000, 1, 'ALPHA'],
    [2, 'bob', 1500, 1, 'BRAVO'],
    [3, 'lou', 1000, 1, null],
    [4, 'amy', 500, 1, 'ALPHA'],
  ]);

  // Later changes and a second end attempt change nothing.
  const rawBefore = store.db.prepare('SELECT * FROM world_end').all();
  setPts(w, { alice: 1, amy: 99_999, bob: 50, lou: 60 });
  clock.advance(HOUR);
  assert.equal(endWorld(store, { at: clock.now(), kind: 'domination', winner: { tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA' }, reason: 'again', actorIp: 'server' }), false);
  assert.deepEqual(store.db.prepare('SELECT * FROM world_end').all(), rawBefore);
  assert.deepEqual(app.ctx.domination.ended(), first);
  assert.equal(auditRows(app, 'world_end').length, 1, 'only the real end is logged');

  // The row is protected in the database itself.
  assert.throws(() => store.db.prepare("UPDATE world_end SET reason = 'x'").run(), /final/);
  assert.throws(() => store.db.prepare('DELETE FROM world_end').run(), /final/);

  // The API shape.
  const res = await w.lou.c.get('/api/world-end');
  ok(res);
  const body = res.json<WorldEndResponse>();
  assert.deepEqual(Object.keys(body), ['ended']);
  assert.ok(body.ended);
  assert.deepEqual(Object.keys(body.ended).sort(), ['badgeCounts', 'endedAt', 'finalPlayers', 'finalTribes', 'kind', 'myBadges', 'playerBadges', 'reason', 'winner']);
  assert.deepEqual(body.ended, first);
  const status = (await w.lou.c.get('/api/domination')).json<{ ended: unknown }>();
  assert.deepEqual(status.ended, first);
  await app.close();
});

test('a manual end without a winner has winner null; the DTO lists are capped at 50 and the database keeps up to 200', async () => {
  const w = await domWorld();
  const store = w.app.ctx.store;
  for (let i = 0; i < 60; i++) {
    const id = store.insertPlayer(`pawn${i}`, 'x', w.t0, 0);
    const [home] = store.villagesOfPlayer(w.alice.id);
    assert.ok(home);
    store.insertVillage(id, `pawn village ${i}`, 20 + i, 20, 10 + i, home.state);
  }
  endWorld(store, { at: w.clock.now(), ...manual() });
  const dto = w.app.ctx.domination.ended();
  assert.ok(dto);
  assert.equal(dto.winner, null);
  assert.equal(dto.finalPlayers.length, 50);
  const stored = JSON.parse((store.db.prepare('SELECT final_json FROM world_end').get() as { final_json: string }).final_json) as { players: unknown[] };
  assert.equal(stored.players.length, 64, 'all players with a village are stored (the cap is 200)');
  await w.app.close();
});

test('the caretaker and the idle-abandon pass stop when the world has ended', async () => {
  const control = await domWorld();
  control.clock.advance(abandonIdleMs(control.app.ctx.settings) + HOUR);
  control.app.ctx.game.runCaretaker(control.clock.now());
  assert.equal(control.app.ctx.store.villagesOfPlayer(control.alice.id).length, 0, 'control: without an end, idle owners lose their villages');
  await control.app.close();

  const w = await domWorld();
  const store = w.app.ctx.store;
  endWorld(store, { at: w.clock.now(), ...manual() });
  w.clock.advance(abandonIdleMs(w.app.ctx.settings) + HOUR);
  assert.equal(w.app.ctx.game.runCaretaker(w.clock.now()), 0);
  assert.equal(store.villagesOfPlayer(w.alice.id).length, 1, 'nobody loses a village after the end');
  await w.app.close();
});

class FakeSocket {
  readyState = 1;
  readonly frames: LiveMessage[] = [];
  send(data: string): void {
    this.frames.push(JSON.parse(data) as LiveMessage);
  }
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  ping(): void {}
  on(): this {
    return this;
  }
  hints(): string[][] {
    return this.frames.flatMap((f) => (f.type === 'hint' ? [f.topics] : []));
  }
}

test('every open socket gets one "world" hint when the world ends, also when the operator tool ended it in another process', async () => {
  const w = await domWorld();
  const hub = w.app.ctx.live;
  assert.ok(hub);
  const a = new FakeSocket();
  const b = new FakeSocket();
  hub.attach(a as unknown as LiveSocket, { playerId: w.alice.id, tokenHash: 'a'.repeat(64), ip: '1.1.1.1' });
  hub.attach(b as unknown as LiveSocket, { playerId: w.lou.id, tokenHash: 'b'.repeat(64), ip: '1.1.1.2' });
  assert.equal(a.hints().length, 0);

  endWorld(w.app.ctx.store, { at: w.clock.now(), ...manual() });
  for (const s of [a, b]) {
    assert.equal(s.hints().length, 1);
    assert.ok(s.hints()[0]?.includes('world'));
  }
  w.app.ctx.domination.evaluate(w.clock.now() + 1000, true);
  assert.equal(a.hints().length, 1, 'announced once');
  await w.app.close();

  // Ended behind the server's back (the CLI writes the row from its own process): the next evaluation tells the players, once.
  const x = await domWorld();
  const sock = new FakeSocket();
  x.app.ctx.live?.attach(sock as unknown as LiveSocket, { playerId: x.alice.id, tokenHash: 'c'.repeat(64), ip: '1.1.1.3' });
  x.app.ctx.store.db
    .prepare("INSERT INTO world_end (id, ended_at, kind, reason, final_json) VALUES (1, ?, 'manual', 'cli', '{\"tribes\":[],\"players\":[]}')")
    .run(x.clock.now());
  assert.equal(sock.hints().length, 0);
  assert.equal(x.app.ctx.domination.evaluate(x.clock.now() + 1000), null);
  assert.equal(sock.hints().length, 1);
  assert.ok(sock.hints()[0]?.includes('world'));
  x.app.ctx.domination.evaluate(x.clock.now() + 2000);
  assert.equal(sock.hints().length, 1);
  // ... and the next request is already refused.
  errorOf(await x.alice.c.post('/api/tribe/leave'), 403, 'forbidden');
  await x.app.close();
});

test('a domination win freezes the world through the request that settles it, and later calls cannot move the winning time', async () => {
  const w = await domWorld({ minAgeDays: 0 });
  setExact75(w);
  const start = ev(w, w.t0 + 1000).streak?.startedAt;
  assert.ok(start);
  const tEnd = start + STREAK_MS;
  w.clock.set(tEnd);
  touchAll(w.app, tEnd);
  // The first request after the streak ran out settles the win (processDue), and the write after it meets the frozen rule.
  const home = await w.alice.c.village();
  assert.equal(w.app.ctx.store.isWorldEnded(), true);
  errorOf(await w.alice.c.post(`/api/villages/${home.id}/build`, { building: 'lumber' }), 403, 'forbidden');
  const end = w.app.ctx.domination.ended();
  assert.equal(end?.endedAt, tEnd);
  assert.equal(end?.kind, 'domination');
  w.clock.advance(3 * DAY);
  ok(await w.alice.c.get('/api/state'));
  assert.equal(w.app.ctx.domination.ended()?.endedAt, tEnd);
  await w.app.close();
});

// ---- entry passes (lobby worlds): nobody new after the end ----------------------------------------------------------------

test('a lobby pass cannot create a new player after the end (and burns no nonce); a known player can still sign in', async () => {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  const kid = createHash('sha256').update(der).digest('hex').slice(0, 16);
  const { app, clock } = await makeApp({ lobbyPublicKey: der.toString('base64') });
  const pass = (aid: number, name: string): string => {
    const claims = { v: 1, kid, aid, name, wid: 'w1', chn: 'ysra', role: null, iat: clock.t, exp: clock.t + ENTRY_PASS_TTL_MS, nonce: randomBytes(16).toString('base64url') };
    const part = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    return `${part}.${edSign(null, Buffer.from(`${ENTRY_PASS_DOMAIN}\n${part}`, 'utf8'), pair.privateKey).toString('base64url')}`;
  };
  const enter = (ip: string, p: string) => new Client(app, ip).post('/api/auth/enter', { pass: p });

  ok(await enter('10.2.0.1', pass(1, 'first_one')), 201);
  endWorld(app.ctx.store, { at: clock.now(), ...manual() });
  const nonces = app.ctx.store.countEntryNonces();

  const refused = await enter('10.2.0.2', pass(2, 'second_one'));
  errorOf(refused, 403, 'forbidden');
  assert.equal(refused.json<{ message: string }>().message, ENDED);
  assert.equal(app.ctx.store.getPlayerByAccountId(2), null);
  assert.equal(app.ctx.store.countEntryNonces(), nonces, 'the refused pass is not used up');

  const known = await enter('10.2.0.3', pass(1, 'first_one'));
  ok(known, 200);
  assert.equal(known.json<MeResponse>().player?.username, 'first_one');
  await app.close();
});
