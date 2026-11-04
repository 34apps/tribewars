// Defender Renown (docs/GAME_DESIGN.md section 18.2, source 4): a small daily trickle for keeping troops at home. Settled lazily
// when the village is saved (any action does that; reads only show it), nothing during beginner protection, never for support,
// troops away or sandbox accounts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFENDER_RENOWN_DAILY_CAP,
  DEFENDER_RENOWN_PER_DEFENCE,
  defenderRenownPerDay,
  settleVillage,
  stationedDefence,
  villagePoints,
  type Units,
} from '@clanfire/engine';
import { HOUR, makeApp } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import type { App, P } from './tribe-helpers.ts';
import { near, renownOf } from './renown-helpers.ts';

const SPEED = 10; // TEST_WORLD: one world "day" is 2.4 real hours
const DAY = (24 * HOUR) / SPEED;
const PER_PIKEMAN = stationedDefence({ pikeman: 1 });

/** Troops that give about `strength` defence points. */
const pikemen = (strength: number): number => Math.max(1, Math.round(strength / PER_PIKEMAN));

/** Put troops into the player's first village (settled to `now`, so the span before it is not touched). */
function giveTroops(app: App, playerId: number, troops: Partial<Units>, now: number, away: Partial<Units> = {}): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(playerId)[0];
  assert.ok(v);
  const settled = settleVillage(v.state, now, app.ctx.settings);
  settled.troops = { ...settled.troops, ...troops };
  settled.away = { ...settled.away, ...away };
  store.saveVillage(v.id, settled, villagePoints(settled));
}

/** What any action does to a village: settle it to `now` and save it (this is when the trickle is paid). */
function touch(app: App, playerId: number, now: number): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(playerId)[0];
  assert.ok(v);
  const settled = settleVillage(v.state, now, app.ctx.settings);
  store.saveVillage(v.id, settled, villagePoints(settled));
}

/** Leave beginner protection of `p` behind (a moment after it ends). */
async function pastProtection(p: P, clock: { set(t: number): void }): Promise<number> {
  const until = (await p.c.state()).player.protectedUntil;
  assert.ok(until > 0);
  clock.set(until + 1000);
  return until;
}

test('the rule in numbers: strength times the rate, capped per day, nothing for no troops', () => {
  assert.equal(defenderRenownPerDay(0), 0);
  assert.equal(defenderRenownPerDay(-5), 0);
  assert.equal(defenderRenownPerDay(Number.NaN), 0);
  near(defenderRenownPerDay(1000), 1000 * DEFENDER_RENOWN_PER_DEFENCE);
  assert.equal(defenderRenownPerDay(1e9), DEFENDER_RENOWN_DAILY_CAP);
  assert.ok(PER_PIKEMAN > 0);
});

test('nothing during beginner protection, then a trickle by the defence at home', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  const n = pikemen(1500);
  giveTroops(app, p.id, { pikeman: n }, clock.now());
  clock.advance(2 * HOUR); // protection lasts 7.2 real hours at this speed
  touch(app, p.id, clock.now());
  assert.equal(renownOf(app, p), 0, 'protected: nothing');
  assert.equal((await p.c.state()).renown.total, 0, 'and nothing is shown');

  await pastProtection(p, clock);
  touch(app, p.id, clock.now());
  const afterEdge = renownOf(app, p);
  assert.ok(afterEdge < 0.01, 'only the second after protection counts');

  clock.advance(DAY); // one world day with the same troops
  touch(app, p.id, clock.now());
  const perDay = defenderRenownPerDay(stationedDefence({ pikeman: n }));
  near(renownOf(app, p) - afterEdge, perDay, perDay * 0.001 + 1e-6);
  await app.close();
});

test('a read shows the earned but unsaved Renown and writes nothing; the next save pays exactly that', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  giveTroops(app, p.id, { pikeman: pikemen(3000) }, clock.now());
  await pastProtection(p, clock);
  touch(app, p.id, clock.now());
  const stored = renownOf(app, p);
  const markBefore = app.ctx.store.villagesOfPlayer(p.id)[0]?.state.defenceMark;

  clock.advance(2 * DAY);
  const st = await p.c.state();
  assert.equal(renownOf(app, p), stored, 'the read did not write');
  assert.deepEqual(app.ctx.store.villagesOfPlayer(p.id)[0]?.state.defenceMark, markBefore);
  assert.ok(st.renown.total >= Math.floor(stored + 2 * defenderRenownPerDay(stationedDefence({ pikeman: pikemen(3000) })) - 0.5), 'shown');

  touch(app, p.id, clock.now());
  const paid = renownOf(app, p);
  assert.equal(Math.floor(paid + 1e-9), st.renown.total, 'what was shown is what the save pays');
  assert.equal((await p.c.state()).renown.total, st.renown.total);
  await app.close();
});

test('the daily cap holds however big the army is', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  giveTroops(app, p.id, { pikeman: pikemen(500_000) }, clock.now());
  await pastProtection(p, clock);
  touch(app, p.id, clock.now());
  const before = renownOf(app, p);
  clock.advance(3 * DAY);
  touch(app, p.id, clock.now());
  near(renownOf(app, p) - before, 3 * DEFENDER_RENOWN_DAILY_CAP, 0.05);
  await app.close();
});

test('troops that are away, and troops that were never there, earn nothing', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  giveTroops(app, p.id, { pikeman: 0 }, clock.now(), { pikeman: pikemen(3000) });
  await pastProtection(p, clock);
  touch(app, p.id, clock.now());
  const before = renownOf(app, p);
  clock.advance(2 * DAY);
  touch(app, p.id, clock.now());
  near(renownOf(app, p), before, 1e-9);
  await app.close();
});

test('troops that leave in the middle of a span are not paid for it (the smaller of both ends counts)', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  giveTroops(app, p.id, { pikeman: pikemen(3000) }, clock.now());
  await pastProtection(p, clock);
  touch(app, p.id, clock.now());
  clock.advance(DAY);
  touch(app, p.id, clock.now()); // a full day with the troops at home: paid
  const paid = renownOf(app, p);
  assert.ok(paid > 0);
  clock.advance(DAY);
  giveTroops(app, p.id, { pikeman: 0 }, clock.now()); // they leave; the day just ended is not paid
  near(renownOf(app, p), paid, 1e-9);
  clock.advance(DAY);
  touch(app, p.id, clock.now());
  near(renownOf(app, p), paid, 1e-9);
  await app.close();
});

test('settling often or rarely gives the same Renown for the same troops (lazy, like resources)', async () => {
  const { app, clock } = await makeApp();
  const often = await newPlayer(app, 'often');
  const rarely = await newPlayer(app, 'rarely');
  const n = pikemen(2000);
  giveTroops(app, often.id, { pikeman: n }, clock.now());
  giveTroops(app, rarely.id, { pikeman: n }, clock.now());
  await pastProtection(often, clock);
  touch(app, rarely.id, clock.now());
  touch(app, often.id, clock.now());
  const o0 = renownOf(app, often);
  const r0 = renownOf(app, rarely);
  for (let i = 0; i < 24; i++) {
    clock.advance(DAY / 8);
    touch(app, often.id, clock.now());
  }
  touch(app, rarely.id, clock.now());
  const gainOften = renownOf(app, often) - o0;
  const gainRarely = renownOf(app, rarely) - r0;
  assert.ok(gainRarely > 0);
  near(gainOften, gainRarely, gainRarely * 0.002 + 1e-6);
  await app.close();
});

test('ending protection early by attacking does not pay for the protected time', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'alice');
  giveTroops(app, p.id, { pikeman: pikemen(2000) }, clock.now());
  const until = (await p.c.state()).player.protectedUntil;
  clock.advance(HOUR);
  app.ctx.store.setProtectedUntil(p.id, 0); // what attacking a player does
  clock.advance(HOUR);
  touch(app, p.id, clock.now());
  assert.equal(renownOf(app, p), 0, 'the natural end of protection still counts');
  assert.equal((await p.c.state()).renown.total, 0, 'and so does what is shown');
  clock.set(until + 1000);
  touch(app, p.id, clock.now());
  clock.advance(DAY);
  touch(app, p.id, clock.now());
  assert.ok(renownOf(app, p) > 0, 'after it, the trickle runs');
  await app.close();
});

test('sandbox accounts earn nothing, and a village saved before the mark existed starts with a mark and no payment', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['sandy'] });
  const sandy = await newPlayer(app, 'sandy');
  const p = await newPlayer(app, 'alice');
  giveTroops(app, sandy.id, { pikeman: pikemen(3000) }, clock.now());
  giveTroops(app, p.id, { pikeman: pikemen(3000) }, clock.now());
  await pastProtection(p, clock);
  touch(app, sandy.id, clock.now());
  touch(app, p.id, clock.now());
  clock.advance(2 * DAY);
  touch(app, sandy.id, clock.now());
  touch(app, p.id, clock.now());
  assert.equal(renownOf(app, sandy), 0);
  assert.equal((await sandy.c.state()).renown.total, 0, 'nothing shown either');
  assert.ok(renownOf(app, p) > 0);

  // An old state without the mark: the first save only sets it.
  const db = app.ctx.store.db;
  const row = db.prepare('SELECT id, state_json FROM villages WHERE owner_id = ?').get(p.id) as { id: number; state_json: string };
  const old = JSON.parse(row.state_json) as { defenceMark?: unknown };
  delete old.defenceMark;
  db.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(old), row.id);
  const before = renownOf(app, p);
  clock.advance(DAY);
  touch(app, p.id, clock.now());
  near(renownOf(app, p), before, 1e-9);
  const stored = JSON.parse((db.prepare('SELECT state_json FROM villages WHERE id = ?').get(row.id) as { state_json: string }).state_json) as { defenceMark?: { at: number } };
  assert.equal(stored.defenceMark?.at, clock.now());
  clock.advance(DAY);
  touch(app, p.id, clock.now());
  assert.ok(renownOf(app, p) > before, 'and the next span pays');
  await app.close();
});
