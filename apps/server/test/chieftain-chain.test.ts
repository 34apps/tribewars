// Chieftain chain (docs/GAME_DESIGN.md 18.2, "Conquest changes 2026-11-05"): the Chieftains a player village needs may arrive in
// SEPARATE attacks. Survivors add up with earlier entries of the same attacker on the same village that are inside the window
// (STRIKE_CHAIN_WINDOW_HOURS / speed, edge inclusive) and whose return movement still exists. The world runs at speed 10
// (window 12 min). Walking times are fixed (sandbox accounts), so every arrival time is exact and no test waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILDING_IDS,
  STRIKE_CHAIN_WINDOW_HOURS,
  chieftainsNeeded,
  villagePoints,
  type SendResponse,
  type Units,
  type VillageState,
} from '@clanfire/engine';
import { HOUR, errorOf, makeApp, ok } from './helpers.ts';
import {
  assertLedgerSane,
  homeOf,
  player,
  reserveFor,
  runTo,
  strongHome,
  type App,
  type P,
} from './village-helpers.ts';
import type { Clock } from './helpers.ts';

const SPEED = 10;
const WINDOW_S = (STRIKE_CHAIN_WINDOW_HOURS * 3600) / SPEED; // 720 s
const ARMY = 3000; // raiders per attack: enough to beat the (empty) village, wall and militia included

/** Send with fixed walking times (sandbox account). */
async function go(p: P, vid: number, to: { x: number; y: number }, units: Partial<Units>, travelSeconds: number, returnSeconds = 100_00) {
  const res = await p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units, mission: 'attack', travelSeconds, returnSeconds });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

/** Give the player's first village the size that needs exactly `need` Chieftains (all buildings scaled down from the maximum, no troops). */
function sizedVictim(app: App, clock: Clock, p: P, need: number) {
  const store = app.ctx.store;
  const id = strongHome(app, clock, p, {});
  const full = store.getVillage(id)!.state;
  for (let f = 1; f > 0; f -= 0.02) {
    const st: VillageState = structuredClone(full);
    for (const b of BUILDING_IDS) st.buildings[b] = Math.floor(full.buildings[b] * f);
    if (chieftainsNeeded(false, villagePoints(st)) === need) {
      store.saveVillage(id, st, villagePoints(st));
      return store.getVillage(id)!;
    }
  }
  throw new Error(`no size with need ${need}`);
}

async function setup(need: number, users: string[] = ['claimer', 'other']) {
  const { app, clock } = await makeApp({ sandboxUsers: users });
  const claimer = await player(app, 'claimer');
  const victim = await player(app, 'victim');
  const target = sizedVictim(app, clock, victim, need);
  const home = strongHome(app, clock, claimer, { raider: ARMY * 3, chieftain: 3 });
  reserveFor(app, claimer, 3, 500);
  return { app, clock, claimer, victim, target, home };
}

const chainOf = (app: App, villageId: number, p: P) => app.ctx.store.strikeChainOf(villageId, p.id);

test('two Chieftains in separate attacks inside the window strike a village that needs two; the hold starts', async () => {
  const { app, clock, claimer, victim, target, home } = await setup(2);
  const store = app.ctx.store;
  const m1 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  const m2 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60 + 300);

  runTo(app, clock, m1.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined, 'one Chieftain alone is not enough');
  assert.deepEqual(chainOf(app, target.id, claimer).map((e) => [e.chieftains, e.at]), [[1, m1.arriveAt]], 'written down for later');
  assert.equal(store.getVillage(target.id)?.ownerId, victim.id);
  assert.ok(store.movementsFrom(home).some((m) => m.kind === 'return'), 'the survivors walk home as before');

  runTo(app, clock, m2.arriveAt);
  const cold = store.getVillage(target.id);
  assert.ok(cold?.state.hearth, 'the second Chieftain completes the chain: hearth out');
  assert.equal(cold.state.hearth.claimBy, claimer.id);
  assert.ok(cold.holdDueAt !== null, 'the hold has started');
  const occupiers = store.stationedAt(target.id);
  assert.equal(occupiers.length, 1);
  assert.equal(occupiers[0]!.units.chieftain, 1, 'the occupiers are the survivors of the completing attack only');
  assert.deepEqual(chainOf(app, target.id, claimer), [], 'the chain entries are used up');
  assert.ok(store.movementsFrom(home).some((m) => m.kind === 'return'), 'the first Chieftain still walks home');
  assertLedgerSane(app, claimer);
  await app.close();
});

test('three Chieftains for a big village: 1 + 1 + 1 in three attacks; two are not enough', async () => {
  const { app, clock, claimer, target, home } = await setup(3);
  const store = app.ctx.store;
  const m1 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  const m2 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 120);
  const m3 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 180);
  runTo(app, clock, m2.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined, '1 + 1 is short of 3');
  assert.equal(chainOf(app, target.id, claimer).length, 2);
  runTo(app, clock, m3.arriveAt);
  assert.ok(store.getVillage(target.id)?.state.hearth, '1 + 1 + 1 strikes');
  assert.equal(m1.arriveAt < m2.arriveAt && m2.arriveAt < m3.arriveAt, true);
  await app.close();
});

test('window edge: the second attack arriving exactly one window after the first strikes, one millisecond later it does not', async () => {
  for (const lateMs of [0, 1]) {
    const { app, clock, claimer, target, home } = await setup(2);
    const store = app.ctx.store;
    const t0 = clock.now();
    const m1 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
    clock.set(t0 + lateMs); // the second march leaves lateMs later, so it arrives lateMs after the edge
    const m2 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60 + WINDOW_S);
    assert.equal(m2.arriveAt - m1.arriveAt, WINDOW_S * 1000 + lateMs);
    runTo(app, clock, m1.arriveAt);
    runTo(app, clock, m2.arriveAt);
    const hearth = store.getVillage(target.id)?.state.hearth;
    if (lateMs === 0) {
      assert.ok(hearth, 'exactly one window apart still counts');
      assert.deepEqual(chainOf(app, target.id, claimer), []);
    } else {
      assert.equal(hearth, undefined, 'one millisecond too late: the first entry is out of the window');
      assert.deepEqual(chainOf(app, target.id, claimer).map((e) => e.at), [m2.arriveAt], 'only the fresh entry is left');
    }
    await app.close();
  }
});

test('a Chieftain who is home again counts as fresh: one Chieftain attacking twice never strikes a village that needs two', async () => {
  const { app, clock, claimer, target, home } = await setup(2);
  const store = app.ctx.store;
  const m1 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60, 60);
  runTo(app, clock, m1.arriveAt);
  assert.equal(chainOf(app, target.id, claimer).length, 1);
  const back = store.movementsFrom(home).find((m) => m.kind === 'return');
  assert.ok(back, 'the survivors walk home');
  runTo(app, clock, back.arriveAt + 1000); // home again: the return movement row is gone
  assert.equal(store.getMovement(back.id), null);
  assert.deepEqual(chainOf(app, target.id, claimer), [], 'the entry is invalid now, it is the same man');

  // He goes out again, still well inside the window of the first attack.
  const m2 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 30, 60);
  assert.ok(m2.arriveAt - m1.arriveAt < WINDOW_S * 1000);
  runTo(app, clock, m2.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined, 'one Chieftain can never stand for two');
  assert.equal(chainOf(app, target.id, claimer).length, 1, 'only the new entry');
  await app.close();
});

test('a lost attack, an attack without Chieftains and a lone raid bank nothing', async () => {
  const { app, clock, claimer, victim, target, home } = await setup(2);
  const store = app.ctx.store;
  // No Chieftains: a plain raid never writes an entry.
  const raid = await go(claimer, home, target, { raider: ARMY }, 30);
  runTo(app, clock, raid.arriveAt);
  assert.deepEqual(chainOf(app, target.id, claimer), []);

  // A lost attack: a defended village beats a tiny army carrying a Chieftain; nobody survives.
  const st = structuredClone(store.getVillage(target.id)!.state);
  st.troops = { ...st.troops, guard: 3000 };
  store.saveVillage(target.id, st, villagePoints(st));
  const lost = await go(claimer, home, target, { raider: 20, chieftain: 1 }, 60);
  runTo(app, clock, lost.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined);
  assert.deepEqual(chainOf(app, target.id, claimer), [], 'a lost battle banks nothing');
  assert.equal(store.getVillage(target.id)?.ownerId, victim.id);
  assertLedgerSane(app, claimer);
  await app.close();
});

test('entries of another attacker do not count, and neither attacker loses their own', async () => {
  const { app, clock, claimer, target, home } = await setup(2);
  const store = app.ctx.store;
  const other = await player(app, 'other');
  const otherHome = strongHome(app, clock, other, { raider: ARMY, chieftain: 1 });
  reserveFor(app, other, 1, 500);
  const m1 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  const m2 = await go(other, otherHome, target, { raider: ARMY, chieftain: 1 }, 120);
  runTo(app, clock, m2.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined, 'one Chieftain each is not a strike for either');
  assert.equal(chainOf(app, target.id, claimer).length, 1);
  assert.equal(chainOf(app, target.id, other).length, 1);
  assert.equal(m1.arriveAt < m2.arriveAt, true);

  // The first attacker's second Chieftain completes HER chain, not the other player's.
  const m3 = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  runTo(app, clock, m3.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth?.claimBy, claimer.id);
  assert.deepEqual(chainOf(app, target.id, claimer), []);
  assert.equal(chainOf(app, target.id, other).length, 1, 'the other attacker keeps their own entry');
  await app.close();
});

test('a village that needs one Chieftain still strikes at once; no chain entry is written', async () => {
  const { app, clock, claimer, victim, home } = await setup(1);
  const store = app.ctx.store;
  const target = homeOf(app, victim);
  const m = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  runTo(app, clock, m.arriveAt);
  assert.ok(store.getVillage(target.id)?.state.hearth);
  assert.deepEqual(chainOf(app, target.id, claimer), []);
  await app.close();
});

test('a cold village builds ONLY its Wall (HTTP): the Wall is queued, everything else and training is refused', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const store = app.ctx.store;
  const claimer = await player(app, 'claimer');
  const victim = await player(app, 'victim');
  const home = strongHome(app, clock, claimer, { raider: 400, chieftain: 1 });
  reserveFor(app, claimer, 1, 500);
  const target = homeOf(app, victim);
  // The victim has a Barracks (the Wall needs it) and full stores, so only the cold-village rule can refuse anything.
  const st = structuredClone(target.state);
  st.buildings.barracks = Math.max(1, st.buildings.barracks);
  st.buildings.storehouse = 10;
  st.resources = { wood: 9000, food: 9000, iron: 9000, gold: 100 };
  store.saveVillage(target.id, st, villagePoints(st));

  const m = await go(claimer, home, target, { raider: 400, chieftain: 1 }, 60);
  runTo(app, clock, m.arriveAt);
  assert.ok(store.getVillage(target.id)?.state.hearth, 'the hearth is out');

  errorOf(await victim.c.post(`/api/villages/${target.id}/build`, { building: 'lumber' }), 409, 'requirements_not_met');
  errorOf(await victim.c.post(`/api/villages/${target.id}/build`, { building: 'barracks' }), 409, 'requirements_not_met');
  errorOf(await victim.c.post(`/api/villages/${target.id}/train`, { unit: 'pikeman', count: 1 }), 409, 'requirements_not_met');
  ok(await victim.c.post(`/api/villages/${target.id}/build`, { building: 'wall' }));
  assert.equal(store.getVillage(target.id)?.state.buildQueue.filter((j) => j.building === 'wall').length, 1, 'the Wall is queued');
  ok(await victim.c.post(`/api/villages/${target.id}/build`, { building: 'wall' }));
  assert.equal(store.getVillage(target.id)?.state.buildQueue.filter((j) => j.building === 'wall').length, 2, 'and can be upgraded again');
  assert.ok(store.getVillage(target.id)?.state.hearth, 'building the Wall does not relight the hearth');
  await app.close();
});

test('hold time of a player village is 8 h divided by world speed (the abandoned 2 h is checked in strike-hold.test.ts)', async () => {
  const { app, clock, claimer, victim, home } = await setup(1);
  const store = app.ctx.store;
  const target = homeOf(app, victim);
  const m = await go(claimer, home, target, { raider: ARMY, chieftain: 1 }, 60);
  runTo(app, clock, m.arriveAt);
  assert.equal(store.getVillage(target.id)?.holdDueAt, m.arriveAt + (8 * HOUR) / SPEED);
  await app.close();
});
