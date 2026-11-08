// Morale (GAME_DESIGN battle section): a player attacking a much smaller player fights at 75% attack strength.
// Points are read on the server at arrival; not for abandoned villages, scouting or when the world switch is off.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MORALE_ATTACK_FACTOR, battleSeed, resolveBattle, settleVillage } from '@clanfire/engine';
import { makeApp, weakestAbandoned } from './helpers.ts';
import { addMember, newLeader } from './tribe-helpers.ts';
import { giveTroops, latestReport, sendOk, unprotect, village, type App, type P } from './warfare-helpers.ts';

async function duel(morale?: boolean) {
  const { app, clock } = await makeApp(morale === undefined ? {} : { worldConfig: { npc: { selfBuild: false }, features: { morale } } });
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  unprotect(app, alice, bob);
  return { app, clock, alice, bob };
}

/** Points are recomputed whenever a village is saved, so pin the totals the fight reads (the server reads them via the store). */
const pinned = new WeakMap<App, Map<number, number>>();
function setPoints(app: App, p: P, points: number): void {
  let m = pinned.get(app);
  if (!m) {
    const map = new Map<number, number>();
    const real = app.ctx.store.playerPoints.bind(app.ctx.store);
    app.ctx.store.playerPoints = (id: number) => map.get(id) ?? real(id);
    pinned.set(app, (m = map));
  }
  m.set(p.id, points);
}

async function attack(app: App, clock: { set(t: number): void }, from: P, to: P) {
  giveTroops(app, from, { raider: 20 });
  giveTroops(app, to, { pikeman: 5 });
  const { movement } = await sendOk(from, to, 'attack', { raider: 20 });
  const row = app.ctx.store.getMovement(movement.id);
  const target = app.ctx.store.villagesOfPlayer(to.id)[0];
  assert.ok(row && target);
  const settled = settleVillage(target.state, movement.arriveAt, app.ctx.settings);
  const seed = battleSeed(app.ctx.store.battleSalt(), movement.id, movement.arriveAt);
  clock.set(movement.arriveAt);
  const report = await latestReport(from);
  return { report, row, settled, seed, movement };
}

async function powers(app: App, clock: { set(t: number): void }, from: P, to: P) {
  const r = await attack(app, clock, from, to);
  const b = r.report.battle;
  assert.ok(b);
  const plain = resolveBattle({ attackerUnits: r.row.units, defender: r.settled, support: [], seed: r.seed, attackerRanks: r.row.ranks ?? undefined, defenderRanks: r.settled.ranks });
  return { b, plain };
}

test('morale: a player 3x bigger than the target fights at 75%, the report says so', async () => {
  const { app, clock, alice, bob } = await duel();
  setPoints(app, alice, 3000);
  setPoints(app, bob, 999);
  const { b, plain } = await powers(app, clock, alice, bob);
  assert.equal(b.morale, MORALE_ATTACK_FACTOR);
  assert.ok(Math.abs(b.attackPower - plain.attackPower * 0.75) < 1e-6, 'attack is 75% of the plain battle');
  assert.equal(b.defensePower, plain.defensePower);
  await app.close();
});

test('morale: exactly a third of the points = no morale', async () => {
  const { app, clock, alice, bob } = await duel();
  setPoints(app, alice, 3000);
  setPoints(app, bob, 1000);
  const { b, plain } = await powers(app, clock, alice, bob);
  assert.ok(b.morale === undefined || b.morale === null);
  assert.equal(b.attackPower, plain.attackPower);
  await app.close();
});

test('morale: world switch off = no morale', async () => {
  const { app, clock, alice, bob } = await duel(false);
  setPoints(app, alice, 3000);
  setPoints(app, bob, 10);
  const { b, plain } = await powers(app, clock, alice, bob);
  assert.ok(b.morale === undefined || b.morale === null);
  assert.equal(b.attackPower, plain.attackPower);
  await app.close();
});

test('morale: never against an abandoned village', async () => {
  const { app, clock, alice } = await duel();
  setPoints(app, alice, 100_000);
  const npc = await weakestAbandoned(alice.c, 12);
  giveTroops(app, alice, { raider: 30 });
  const { movement } = await sendOk(alice, { x: npc.x, y: npc.y }, 'attack', { raider: 30 });
  clock.set(movement.arriveAt);
  const b = (await latestReport(alice)).battle;
  assert.ok(b);
  assert.ok(b.morale === undefined || b.morale === null);
  await app.close();
});

test('morale: a scouting march has none (and no battle fields)', async () => {
  const { app, clock, alice, bob } = await duel();
  setPoints(app, alice, 3000);
  setPoints(app, bob, 10);
  giveTroops(app, alice, { pathfinder: 5 });
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(movement.arriveAt);
  const rep = await latestReport(alice);
  assert.equal(rep.type, 'scout');
  assert.equal(rep.battle ?? null, null);
  await app.close();
});

test('map rows carry the owner points, null for abandoned villages', async () => {
  const { app, alice, bob } = await duel();
  const b = await village(bob);
  const expected = app.ctx.store.playerPoints(bob.id);
  assert.ok(expected > 0);
  const res = await alice.c.get(`/api/map?x=${b.x - 1}&y=${b.y - 1}&w=3&h=3`);
  const rows = res.json<{ villages: { id: number; kind: string; ownerPoints?: number | null }[] }>().villages;
  assert.equal(rows.find((v) => v.id === b.id)?.ownerPoints, expected);
  const npc = await weakestAbandoned(alice.c, 12);
  const all = (await alice.c.get('/api/map?x=-12&y=-12&w=25&h=25')).json<{ villages: { id: number; ownerPoints?: number | null }[] }>().villages;
  assert.equal(all.find((v) => v.id === npc.id)?.ownerPoints, null);
  await app.close();
});
