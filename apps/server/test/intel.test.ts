// GET /api/intel/:id: the caller's OWN newest usable report (scout or attack) on a village, for the "you need N troops" hint.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BattleReportData, ScoutReportData, Units, VillageIntelDto, VillageRefDto } from '@clanfire/engine';
import { Client, battleOf, errorOf, ok } from './helpers.ts';
import { giveKeen, giveTroops, latestReport, sendOk, units, village, world, type App, type P } from './warfare-helpers.ts';

const NONE: VillageIntelDto = { at: null, source: null, troops: null, troopsApprox: false, wallLevel: null };

const intel = async (p: P, id: number): Promise<VillageIntelDto> => {
  const res = await p.c.get(`/api/intel/${id}`);
  ok(res);
  return res.json<VillageIntelDto>();
};

/** Set (merge) the troops standing in a player's first village. */
function setTroops(app: App, p: P, t: Partial<Units>): void {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  v.state.troops = { ...v.state.troops, ...t };
  app.ctx.store.saveVillage(v.id, v.state, v.points);
}

const ref = (id: number, name: string): VillageRefDto => ({ villageId: id, name, x: 0, y: 0, ownerName: name });

/** A hand-made battle report of `p` (attacker) on `target`, for cases a real fight cannot produce (survivors) and for ordering. */
function craftBattle(app: App, p: P, target: number, createdAt: number, over: Partial<BattleReportData>): number {
  const battle: BattleReportData = {
    outcome: 'battle',
    attacker: ref(1, p.name),
    defender: ref(target, 'target'),
    attackerWon: false,
    luck: 0,
    attackPower: 1,
    defensePower: 1,
    attackerUnits: units({ raider: 5 }),
    attackerLosses: units({ raider: 2 }),
    defenderUnits: units({}),
    defenderLosses: units({}),
    supportUnits: null,
    supportLosses: null,
    wallLevel: null,
    loot: { wood: 0, food: 0, iron: 0, gold: 0 },
    ...over,
  };
  return app.ctx.store.insertReport({ playerId: p.id, side: 'attack', type: 'battle', won: battle.attackerWon, title: 'crafted battle', createdAt, battle });
}

function craftScout(app: App, p: P, target: number, createdAt: number, intelPart: ScoutReportData['intel']): number {
  const scout: ScoutReportData = {
    scout: ref(1, p.name),
    target: ref(target, 'target'),
    success: true,
    scoutsSent: 5,
    scoutsLost: 0,
    defenderScouts: 0,
    defenderScoutsLost: 0,
    intel: intelPart,
  };
  return app.ctx.store.insertReport({ playerId: p.id, side: 'attack', type: 'scout', won: true, title: 'crafted scout', createdAt, scout });
}

const res0 = { wood: 0, food: 0, iron: 0, gold: 0 };

test('intel: no report gives every field null / false', async () => {
  const { app, alice, bob } = await world();
  assert.deepEqual(await intel(alice, (await village(bob)).id), NONE);
  await app.close();
});

test('intel: scouts by Keen rank (none, rough, exact + Wall); a newer blind scout does not hide an older report that showed troops', async () => {
  const { app, clock, alice, bob } = await world();
  const bobId = (await village(bob)).id;
  setTroops(app, bob, { pikeman: 27, raider: 4 });
  giveTroops(app, alice, { pathfinder: 40 });

  // Keen 0: the scout succeeded but saw no troops and no Wall.
  const blind = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(blind.movement.arriveAt);
  await alice.c.state();
  assert.deepEqual(await intel(alice, bobId), { at: blind.movement.arriveAt, source: 'scout', troops: null, troopsApprox: false, wallLevel: null });

  // Keen 1: rough troops (rounded to 10).
  giveKeen(app, alice, 1);
  const rough = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(rough.movement.arriveAt);
  await alice.c.state();
  const r = await intel(alice, bobId);
  assert.equal(r.at, rough.movement.arriveAt);
  assert.equal(r.troopsApprox, true);
  assert.equal(r.troops?.pikeman, 30);
  assert.equal(r.wallLevel, null);

  // Keen 3: exact troops and the Wall.
  giveKeen(app, alice, 3);
  const exact = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(exact.movement.arriveAt);
  await alice.c.state();
  const e = await intel(alice, bobId);
  assert.equal(e.at, exact.movement.arriveAt);
  assert.equal(e.source, 'scout');
  assert.equal(e.troopsApprox, false);
  assert.equal(e.troops?.pikeman, 27);
  assert.equal(e.troops?.raider, 4);
  assert.equal(typeof e.wallLevel, 'number');

  // A newer blind scout (Keen 0 again) does not hide the older report that showed troops.
  giveKeen(app, alice, 0);
  const blind2 = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(blind2.movement.arriveAt);
  await alice.c.state();
  assert.deepEqual(await intel(alice, bobId), e);
  await app.close();
});

test('intel: a won attack leaves no defenders; a lost one hides them; a report with survivors subtracts losses (own and support)', async () => {
  const { app, clock, alice, bob } = await world();
  const bobId = (await village(bob)).id;

  // Lost (wiped out): the report hides the defence, so troops stay null; the source is the battle.
  setTroops(app, bob, { pikeman: 50 });
  giveTroops(app, alice, { raider: 5 });
  const lost = await sendOk(alice, bob, 'attack', { raider: 5 });
  clock.set(lost.movement.arriveAt);
  await alice.c.state();
  assert.equal(battleOf(await latestReport(alice)).attackerWon, false);
  assert.deepEqual(await intel(alice, bobId), { at: lost.movement.arriveAt, source: 'battle', troops: null, troopsApprox: false, wallLevel: null });

  // Won: nobody is left.
  setTroops(app, bob, { pikeman: 1 });
  giveTroops(app, alice, { raider: 40 });
  const won = await sendOk(alice, bob, 'attack', { raider: 40 });
  clock.set(won.movement.arriveAt);
  await alice.c.state();
  const wonReport = battleOf(await latestReport(alice));
  assert.equal(wonReport.attackerWon, true);
  const w = await intel(alice, bobId);
  assert.equal(w.source, 'battle');
  assert.equal(w.at, won.movement.arriveAt);
  assert.deepEqual(w.troops, units({}));
  assert.equal(w.wallLevel, wonReport.wallLevel);
  assert.equal(w.troopsApprox, false);

  // Survivors (not produced by today's fights, but the arithmetic is part of the contract).
  const t = clock.now() + 10_000;
  craftBattle(app, alice, bobId, t, {
    defenderUnits: units({ pikeman: 10, raider: 4 }),
    defenderLosses: units({ pikeman: 3 }),
    supportUnits: units({ guard: 5, pikeman: 2 }),
    supportLosses: units({ guard: 5, pikeman: 1 }),
    wallLevel: 2,
  });
  assert.deepEqual(await intel(alice, bobId), {
    at: t,
    source: 'battle',
    troops: units({ pikeman: 8, raider: 4 }),
    troopsApprox: false,
    wallLevel: 2,
  });
  await app.close();
});

test('intel: the newest of scout and battle wins, by time then id; called-off and defence reports do not count', async () => {
  const { app, clock, alice, bob } = await world();
  const bobId = (await village(bob)).id;
  const t = clock.now();
  craftScout(app, alice, bobId, t + 1000, { resources: res0, troops: units({ pikeman: 9 }), wallLevel: 4, buildings: null });
  assert.deepEqual(await intel(alice, bobId), { at: t + 1000, source: 'scout', troops: units({ pikeman: 9 }), troopsApprox: false, wallLevel: 4 });

  craftBattle(app, alice, bobId, t + 2000, { defenderUnits: units({ pikeman: 5 }), defenderLosses: units({ pikeman: 1 }), wallLevel: 3 });
  assert.deepEqual(await intel(alice, bobId), { at: t + 2000, source: 'battle', troops: units({ pikeman: 4 }), troopsApprox: false, wallLevel: 3 });

  // Same time: the later report (higher id) wins.
  craftScout(app, alice, bobId, t + 2000, { resources: res0, troops: units({ pikeman: 6 }), troopsApprox: true, wallLevel: null, buildings: null });
  assert.deepEqual(await intel(alice, bobId), { at: t + 2000, source: 'scout', troops: units({ pikeman: 6 }), troopsApprox: true, wallLevel: null });

  // Newer, but not usable: a called-off attack and a report from the defence side.
  craftBattle(app, alice, bobId, t + 3000, { outcome: 'called_off', defenderUnits: null, defenderLosses: null });
  app.ctx.store.insertReport({ playerId: alice.id, side: 'defense', type: 'battle', won: true, title: 'defence', createdAt: t + 4000, battle: { ...battleStub(bobId), defenderUnits: units({ pikeman: 99 }) } });
  assert.equal((await intel(alice, bobId)).at, t + 2000);

  // Other villages are separate.
  assert.deepEqual(await intel(alice, (await village(alice)).id), NONE);
  await app.close();
});

function battleStub(target: number): BattleReportData {
  return {
    outcome: 'battle',
    attacker: ref(1, 'x'),
    defender: ref(target, 'target'),
    attackerWon: false,
    luck: 0,
    attackPower: 1,
    defensePower: 1,
    attackerUnits: units({}),
    attackerLosses: units({}),
    defenderUnits: units({}),
    defenderLosses: units({}),
    supportUnits: null,
    supportLosses: null,
    wallLevel: null,
    loot: res0,
  };
}

test('intel: another player never gets what you scouted or fought (tribe-mate, target, stranger)', async () => {
  const { app, clock, alice, amy, bob, lou } = await world();
  const bobId = (await village(bob)).id;
  setTroops(app, bob, { pikeman: 3 });
  giveKeen(app, alice, 5);
  giveTroops(app, alice, { pathfinder: 10, raider: 40 });
  const scout = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(scout.movement.arriveAt);
  await alice.c.state();
  const atk = await sendOk(alice, bob, 'attack', { raider: 40 });
  clock.set(atk.movement.arriveAt);
  await alice.c.state();
  assert.equal((await intel(alice, bobId)).source, 'battle');

  for (const other of [amy, bob, lou]) assert.deepEqual(await intel(other, bobId), NONE, other.name);
  // The defender's own report of the fight is not "his intel on himself" either.
  assert.ok((await (await bob.c.get('/api/reports')).json<{ reports: unknown[] }>()).reports.length > 0);
  await app.close();
});

test('intel: signed out 401, unknown village 404, bad id 400', async () => {
  const { app, alice } = await world();
  const anon = new Client(alice.c.app, '10.88.0.9');
  errorOf(await anon.get('/api/intel/1'), 401, 'unauthorized');
  errorOf(await alice.c.get('/api/intel/987654'), 404, 'not_found');
  errorOf(await alice.c.get('/api/intel/abc'), 400, 'invalid_input');
  errorOf(await alice.c.get('/api/intel/-1'), 400, 'invalid_input');
  await app.close();
});
