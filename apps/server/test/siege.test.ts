// Siege units (docs/GAME_DESIGN.md 18.9): the sender's pick, validation without an oracle, what a won attack lowers, the reports,
// training rules and the schema upgrade. Troops and village levels are put into the database directly; the rules themselves
// have engine tests, these tests are about the server wiring.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  BUILDING_IDS,
  battleSeed,
  createPlayerVillage,
  emptyUnits,
  resolveBattle,
  resolveSiege,
  settleVillage,
  villagePoints,
  type BuildJob,
  type BuildingLevels,
  type SendResponse,
  type Units,
  type UnitId,
} from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { SCHEMA_VERSION } from '../src/db.ts';
import { subtractUnits } from '../src/units.ts';
import { Client, Clock, HOUR, MINUTE, PASSWORD, TEST_WORLD, battleOf, errorOf, makeApp, ok, TEST_WORLD_CONFIG } from './helpers.ts';
import { giveTroops, latestReport, sendFails, world } from './warfare-helpers.ts';
import { clearedTarget, freeTileNear, homeOf, player, reserveFor, runTo, strongHome, type App, type P } from './village-helpers.ts';

/** The levels of an untouched test target: only what every village needs, so a random pick has few places to land. */
const BASE: BuildingLevels = Object.fromEntries(BUILDING_IDS.map((b) => [b, b === 'hall' || b === 'storehouse' || b === 'farm' ? 1 : 0])) as BuildingLevels;

function setBuildings(app: App, villageId: number, levels: Partial<BuildingLevels>, queue?: BuildJob[]): void {
  const store = app.ctx.store;
  const v = store.getVillage(villageId);
  assert.ok(v, 'village exists');
  v.state.buildings = { ...BASE, ...levels };
  if (queue) v.state.buildQueue = queue;
  store.saveVillage(villageId, v.state, villagePoints(v.state));
}

const buildingsOf = (app: App, villageId: number): BuildingLevels => ({ ...app.ctx.store.getVillage(villageId)!.state.buildings });

/** Put exactly `troops` at home in the player's first village. */
function restock(app: App, p: P, troops: Partial<Units>): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0]!;
  v.state.troops = { ...emptyUnits(), ...troops };
  v.state.away = emptyUnits();
  store.saveVillage(v.id, v.state, v.points);
}

/** The newest battle report of a player. */
const lastBattle = async (p: P) => battleOf(await latestReport(p));

interface Ctx {
  app: App;
  clock: Clock;
  p: P;
  homeId: number;
  /** A village of abandoned land without a garrison (every attack wins). */
  target: { id: number; x: number; y: number };
}

/** A sandbox player (fixed march times) with raiders, Log Rams and Boulder Slings, next to an empty abandoned village with plain levels. */
async function setup(troops: Partial<Units> = {}, extra: string[] = []): Promise<Ctx> {
  const { app, clock } = await makeApp({ sandboxUsers: ['sieger', ...extra], worldConfig: { npc: { selfBuild: false }, features: { morale: false } } }); // morale has its own tests
  const p = await player(app, 'sieger');
  const homeId = strongHome(app, clock, p, { raider: 300, logram: 100, boulder: 100, ...troops });
  const target = clearedTarget(app, homeOf(app, p));
  setBuildings(app, target.id, {});
  return { app, clock, p, homeId, target };
}

interface Sent {
  id: number;
  arriveAt: number;
}

/** Send an attack that arrives at once; nothing is processed yet. `pick` undefined sends no targetBuilding field at all. */
async function launch(c: Ctx, to: { x: number; y: number }, army: Partial<Units>, pick?: unknown, returnSeconds = 0, from: P = c.p, fromId = c.homeId): Promise<Sent> {
  const body = { x: to.x, y: to.y, units: army, mission: 'attack', travelSeconds: 0, returnSeconds, ...(pick === undefined ? {} : { targetBuilding: pick }) };
  const res = await from.c.post(`/api/villages/${fromId}/send`, body);
  ok(res, 201);
  const m = res.json<SendResponse>().movement;
  return { id: m.id, arriveAt: m.arriveAt };
}

/** Launch and process the arrival; the clock moves a minute on afterwards so the next report is clearly the newest. */
async function attack(c: Ctx, army: Partial<Units>, pick?: unknown, to: { x: number; y: number } = c.target): Promise<Sent> {
  restock(c.app, c.p, army);
  const m = await launch(c, to, army, pick);
  runTo(c.app, c.clock, m.arriveAt);
  c.clock.advance(MINUTE);
  return m;
}

/** What a shape-only comparison of two responses looks like: keys and value types, no values. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v === null ? 'null' : typeof v;
}

// ---- sending: validation ---------------------------------------------------------------------------

test('a send with a valid pick and Boulder Slings is accepted; the pick is stored for the attack, the answer does not show it', async () => {
  const c = await setup();
  restock(c.app, c.p, { raider: 20, boulder: 10 });
  const res = await c.p.c.post(`/api/villages/${c.homeId}/send`, { x: c.target.x, y: c.target.y, units: { raider: 20, boulder: 10 }, mission: 'attack', targetBuilding: 'barracks' });
  ok(res, 201);
  const { movement } = res.json<SendResponse>();
  assert.equal(movement.kind, 'attack');
  assert.ok(!('siegeTarget' in movement) && !('targetBuilding' in movement), 'the movement view carries no pick');
  assert.equal(c.app.ctx.store.getMovement(movement.id)?.siegeTarget, 'barracks');

  // No pick: stored as none. Rams alone need no pick either.
  restock(c.app, c.p, { raider: 20, logram: 10 });
  const plain = (await c.p.c.post(`/api/villages/${c.homeId}/send`, { x: c.target.x, y: c.target.y, units: { raider: 20, logram: 10 }, mission: 'attack' })).json<SendResponse>();
  assert.equal(c.app.ctx.store.getMovement(plain.movement.id)?.siegeTarget, null);
});

test('a bad pick is 400 invalid_input and changes nothing: unknown id, not a string, null, wrong mission, no Boulder Slings', async () => {
  const c = await setup();
  const store = c.app.ctx.store;
  const post = (body: object) => c.p.c.post(`/api/villages/${c.homeId}/send`, { x: c.target.x, y: c.target.y, ...body });
  const before = JSON.stringify(store.getVillage(c.homeId)?.state.troops);
  const movements = store.movementsFrom(c.homeId).length;

  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: 'dragon' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: '' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: 'constructor' }), 400, 'invalid_input'); // a property of every object, not a building
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: 7 }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: null }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: ['wall'] }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: { wall: 1 } }), 400, 'invalid_input');
  // Right id, wrong mission or army.
  errorOf(await post({ units: { pathfinder: 1 }, mission: 'scout', targetBuilding: 'hall' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5 }, mission: 'support', targetBuilding: 'hall' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5 }, mission: 'found', targetBuilding: 'hall' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5 }, mission: 'occupy', targetBuilding: 'hall' }), 400, 'invalid_input');
  errorOf(await post({ units: { raider: 5 }, mission: 'attack', targetBuilding: 'hall' }), 400, 'invalid_input'); // no Boulder Slings
  errorOf(await post({ units: { raider: 5, logram: 5 }, mission: 'attack', targetBuilding: 'wall' }), 400, 'invalid_input'); // rams always hit the Wall

  assert.equal(JSON.stringify(store.getVillage(c.homeId)?.state.troops), before, 'no troops left');
  assert.equal(store.movementsFrom(c.homeId).length, movements, 'no movement was created');
});

test('no oracle: the same send to a village that has the building and one that has not looks the same; an unscouted pick never errors', async () => {
  const c = await setup();
  const [a, b] = c.app.ctx.store.abandonedVillageIds().slice(0, 2).map((id) => c.app.ctx.store.getVillage(id)!);
  assert.ok(a && b && a.id !== b.id, 'two abandoned villages');
  for (const v of [a, b]) {
    v.state.troops = emptyUnits();
    c.app.ctx.store.saveVillage(v.id, v.state, v.points);
  }
  setBuildings(c.app, a.id, { market: 5, wall: 3 });
  setBuildings(c.app, b.id, { market: 0, wall: 0 });

  const answers: Array<{ status: number; body: unknown }> = [];
  for (const [v, pick] of [[a, 'market'], [b, 'market'], [a, 'vault'], [b, 'vault'], [a, 'hall'], [b, 'bannerhall']] as const) {
    restock(c.app, c.p, { raider: 10, boulder: 5 });
    const res = await c.p.c.post(`/api/villages/${c.homeId}/send`, { x: v.x, y: v.y, units: { raider: 10, boulder: 5 }, mission: 'attack', targetBuilding: pick });
    answers.push({ status: res.statusCode, body: shape(res.json<SendResponse>().movement) });
  }
  for (const x of answers) assert.equal(x.status, 201);
  for (const x of answers) assert.deepEqual(x.body, answers[0]!.body, 'same shape whatever the village holds');
  // The stored picks are exactly what was sent, whether or not the building is there.
  const picks = c.app.ctx.store.movementsFrom(c.homeId).filter((m) => m.kind === 'attack').map((m) => m.siegeTarget);
  assert.deepEqual(picks, ['market', 'market', 'vault', 'vault', 'hall', 'bannerhall']);
});

test('another player cannot use my village id to send, with or without a pick; nothing leaves', async () => {
  const c = await setup({}, ['rival']);
  const rival = await player(c.app, 'rival');
  strongHome(c.app, c.clock, rival, { raider: 50 });
  const before = c.app.ctx.store.movementsFrom(c.homeId).length;
  const body = { x: c.target.x, y: c.target.y, units: { raider: 5, boulder: 5 }, mission: 'attack', targetBuilding: 'wall' };
  errorOf(await rival.c.post(`/api/villages/${c.homeId}/send`, body), 403, 'forbidden');
  errorOf(await rival.c.post('/api/villages/999999/send', body), 404, 'not_found');
  assert.equal(c.app.ctx.store.movementsFrom(c.homeId).length, before);
  assert.equal(c.app.ctx.store.getVillage(c.homeId)?.state.troops.boulder, 100, 'my troops stay');
});

test('siege units cannot scout, support, found or occupy', async () => {
  const c = await setup({ pathfinder: 5, chieftain: 2, pikeman: 50 });
  reserveFor(c.app, c.p, 2, 500);
  const store = c.app.ctx.store;
  const fresh = createPlayerVillage(c.clock.now());
  const second = store.insertVillage(c.p.id, 'Second', homeOf(c.app, c.p).x - 1, homeOf(c.app, c.p).y, villagePoints(fresh), fresh);
  const own = store.getVillage(second)!;
  const tile = freeTileNear(c.app, c.p);

  for (const unit of ['logram', 'boulder'] as const) {
    const army = { [unit]: 1, pathfinder: 1 };
    await sendFails(c.p, c.target, 'scout', army, 400, 'invalid_input');
    await sendFails(c.p, own, 'support', { [unit]: 1, pikeman: 5 }, 400, 'invalid_input');
    await sendFails(c.p, tile, 'found', { [unit]: 1, chieftain: 1 }, 400, 'invalid_input');
  }

  // Occupy: only after a Strike made the claim.
  const strike = await launch(c, c.target, { raider: 100, chieftain: 1 });
  runTo(c.app, c.clock, strike.arriveAt);
  assert.ok(store.getVillage(c.target.id)?.state.hearth, 'the hearth is out: a claim exists');
  await sendFails(c.p, c.target, 'occupy', { raider: 20, logram: 1 }, 400, 'invalid_input');
  await sendFails(c.p, c.target, 'occupy', { raider: 20, boulder: 1 }, 400, 'invalid_input');
  assert.equal(store.getVillage(c.homeId)?.state.troops.logram, 100, 'no ram left');
});

// ---- battle: what a won attack lowers --------------------------------------------------------------

test('a won attack with Log Rams lowers the Wall; both reports say so, the Wall counted in full, the return carries no pick', async () => {
  const c = await setup({}, ['victim']);
  const victim = await player(c.app, 'victim');
  const vid = strongHome(c.app, c.clock, victim, {});
  setBuildings(c.app, vid, { wall: 10, hall: 5, storehouse: 5, farm: 5 });
  const store = c.app.ctx.store;
  const target = store.getVillage(vid)!;

  const army = { raider: 300, logram: 100 };
  restock(c.app, c.p, army);
  const m = await launch(c, target, army, undefined, 3600);
  // What the engine says about this exact battle, computed from the village as it stands before anything is processed.
  const seed = battleSeed(store.battleSalt(), m.id, m.arriveAt);
  const settled = settleVillage(target.state, m.arriveAt, c.app.ctx.settings);
  const input = {
    attackerUnits: { ...emptyUnits(), ...army },
    defender: settled,
    support: [],
    attackerRanks: store.getMovement(m.id)?.ranks ?? undefined,
    defenderRanks: settled.ranks,
    supportRanks: [],
    seed,
  };
  const exp = resolveBattle(input);
  assert.equal(exp.attackerWon, true);
  const wallHit = exp.siege?.find((h) => h.unit === 'logram');
  assert.ok(wallHit && wallHit.building === 'wall' && wallHit.to < wallHit.from, 'rams lower the Wall');
  assert.equal(wallHit.from, 10);

  runTo(c.app, c.clock, m.arriveAt);
  const mine = await lastBattle(c.p);
  const theirs = await lastBattle(victim);
  assert.equal(buildingsOf(c.app, vid).wall, wallHit.to, 'the Wall is lower now');
  for (const b of [mine, theirs]) {
    assert.deepEqual(b.siege, exp.siege, 'the report lists the engine hits');
    assert.equal(b.wallLevel, exp.wallDuring, 'wallLevel is the Wall as it counted in the battle (after the rams fired)');
    assert.ok(exp.wallDuring < 10, 'the rams already lowered it during the battle');
    assert.equal(b.attackerWon, true);
    // The same battle as the engine plays it, wall-hit and all.
    assert.equal(b.attackPower, exp.attackPower);
    assert.equal(b.defensePower, exp.defensePower);
    assert.equal(b.luck, exp.luck);
    assert.deepEqual(b.attackerLosses, exp.attackerLosses);
    assert.deepEqual(b.loot, exp.loot);
  }
  // The defence used the lowered Wall, not the full one.
  const full = resolveBattle({ ...input, attackerUnits: { ...input.attackerUnits, logram: 0 } });
  assert.ok(theirs.defensePower < full.defensePower, 'a lower Wall defends less');

  // The units walking home carry no pick.
  const back = store.movementsFrom(c.homeId).filter((x) => x.kind === 'return');
  assert.ok(back.length > 0, 'the survivors are on their way home');
  for (const x of back) assert.equal(x.siegeTarget ?? null, null);
});

test('a Boulder Sling hits the picked building; with no pick the hit is random but follows the battle seed and lands on a building above its floor', async () => {
  const c = await setup();
  const store = c.app.ctx.store;
  setBuildings(c.app, c.target.id, { market: 5, stables: 2, wall: 0 });

  await attack(c, { raider: 300, boulder: 100 }, 'market');
  const hit = (await lastBattle(c.p)).siege;
  assert.equal(hit?.length, 1);
  assert.equal(hit[0]?.unit, 'boulder');
  assert.equal(hit[0]?.building, 'market');
  assert.equal(hit[0]?.from, 5);
  assert.ok(hit[0]!.to < 5);
  assert.equal(hit[0]?.random, undefined, 'a chosen building is not a random one');
  assert.equal(buildingsOf(c.app, c.target.id).market, hit[0]?.to);

  // No pick: the same engine call with the same seed gives the same building. Only buildings above their floor can be drawn.
  setBuildings(c.app, c.target.id, { market: 4, stables: 2 });
  const before = buildingsOf(c.app, c.target.id);
  const m = await attack(c, { raider: 300, boulder: 100 });
  const b = await lastBattle(c.p);
  const seed = battleSeed(store.battleSalt(), m.id, m.arriveAt);
  const expected = resolveSiege(subtractUnits({ ...emptyUnits(), ...b.attackerUnits }, { ...emptyUnits(), ...b.attackerLosses }), before, null, seed);
  assert.deepEqual(b.siege, expected);
  assert.equal(b.siege?.length, 1);
  assert.equal(b.siege?.[0]?.random, true);
  const drawn = b.siege![0]!.building;
  assert.ok(['farm', 'storehouse', 'market', 'stables'].includes(drawn), `drew ${drawn}`);
  assert.ok(before[drawn] > (drawn === 'hall' ? 1 : 0));
});

test('the Town Hall never drops below 1, every other building never below 0', async () => {
  const c = await setup();
  setBuildings(c.app, c.target.id, { hall: 2, market: 1 });
  const last = async () => (await lastBattle(c.p)).siege?.[0];

  await attack(c, { raider: 300, boulder: 100 }, 'hall');
  assert.deepEqual([(await last())?.from, (await last())?.to], [2, 1]);
  assert.equal(buildingsOf(c.app, c.target.id).hall, 1);
  await attack(c, { raider: 300, boulder: 100 }, 'hall');
  assert.deepEqual([(await last())?.from, (await last())?.to], [1, 1], 'a miss: nothing left to knock down');
  assert.equal(buildingsOf(c.app, c.target.id).hall, 1);

  await attack(c, { raider: 300, boulder: 100 }, 'market');
  assert.deepEqual([(await last())?.from, (await last())?.to], [1, 0]);
  await attack(c, { raider: 300, boulder: 100 }, 'market');
  assert.deepEqual([(await last())?.from, (await last())?.to], [0, 0]);
  assert.equal(buildingsOf(c.app, c.target.id).market, 0);

  // Aimed at something that is not there at all: a miss, not an error.
  await attack(c, { raider: 300, boulder: 100 }, 'bannerhall');
  assert.deepEqual([(await last())?.from, (await last())?.to], [0, 0]);
  // Rams on a Wall that is already gone.
  await attack(c, { raider: 300, logram: 100 });
  assert.equal((await lastBattle(c.p)).siege?.[0]?.building, 'wall');
  assert.equal(buildingsOf(c.app, c.target.id).wall, 0);
});

test('the Farm and the Storehouse never drop below 1 either (owner 2026-11-05), like the Town Hall', async () => {
  const c = await setup();
  setBuildings(c.app, c.target.id, { farm: 2, storehouse: 2 });
  const last = async () => (await lastBattle(c.p)).siege?.[0];
  for (const b of ['farm', 'storehouse'] as const) {
    await attack(c, { raider: 300, boulder: 100 }, b);
    assert.deepEqual([(await last())?.from, (await last())?.to], [2, 1], `${b} 2 -> 1`);
    await attack(c, { raider: 300, boulder: 100 }, b);
    assert.deepEqual([(await last())?.from, (await last())?.to], [1, 1], `${b} at 1 is a miss`);
    assert.equal(buildingsOf(c.app, c.target.id)[b], 1);
  }
});

test('a hopeless lost attack lowers nothing: the few rams cannot lower a level, no survivors count; the wiped-out attacker sees only the (missed) Wall line', async () => {
  const c = await setup({}, ['victim']);
  const victim = await player(c.app, 'victim');
  const vid = strongHome(c.app, c.clock, victim, { pikeman: 4000 });
  setBuildings(c.app, vid, { wall: 10, market: 6, hall: 5, storehouse: 5, farm: 5 });
  const before = buildingsOf(c.app, vid);

  await attack(c, { raider: 20, logram: 10, boulder: 10 }, 'market', { x: c.app.ctx.store.getVillage(vid)!.x, y: c.app.ctx.store.getVillage(vid)!.y });
  const mine = await lastBattle(c.p);
  const theirs = await lastBattle(victim);
  assert.equal(mine.attackerWon, false);
  assert.deepEqual(buildingsOf(c.app, vid), before, 'not a level lost');
  assert.ok((theirs.siege ?? []).every((h) => h.from === h.to), 'the defender sees only misses');
  assert.ok((mine.siege ?? []).every((h) => h.unit === 'logram'), 'a wiped-out army sees nothing of the picked building');
  assert.equal(mine.wallLevel, null);
  assert.equal(mine.defenderUnits, null);
});

test('a LOST attack with many Log Rams still lowers the Wall (during hit); the defender sees the lowered Wall in the report, the wiped-out attacker only the Wall hit', async () => {
  const c = await setup({}, ['victim']);
  const victim = await player(c.app, 'victim');
  const vid = strongHome(c.app, c.clock, victim, { pikeman: 4000 });
  setBuildings(c.app, vid, { wall: 10, market: 6, hall: 5, storehouse: 5, farm: 5 });
  const target = c.app.ctx.store.getVillage(vid)!;

  await attack(c, { raider: 20, logram: 100, boulder: 10 }, 'market', target);
  const mine = await lastBattle(c.p);
  const theirs = await lastBattle(victim);
  assert.equal(mine.attackerWon, false);
  // 100 rams fire half their points during the battle: 50 points drop two Wall levels (26 + 24); the defence used Wall 8.
  const after = buildingsOf(c.app, vid);
  assert.equal(after.wall, 8, 'two levels gone although the attack was lost');
  assert.equal(after.market, 6, 'the Boulder Slings did nothing: no survivors counted at this ratio');
  assert.equal(theirs.wallLevel, 8, 'wallLevel is the Wall as it counted in the battle');
  const hit = (theirs.siege ?? []).find((h) => h.unit === 'logram');
  assert.deepEqual(hit && [hit.building, hit.from, hit.to], ['wall', 10, 8]);
  assert.deepEqual(mine.siege, [hit], 'the attacker sees the Wall hit and nothing else');
  assert.equal(mine.wallLevel, null, 'but not the defence');
  assert.equal(mine.defenderUnits, null);
  assert.equal(mine.defenderLosses, null);
  assert.deepEqual(mine.loot, { wood: 0, food: 0, iron: 0, gold: 0 });
});

test('a queued upgrade of a lowered building is aimed lower too', async () => {
  const c = await setup({}, ['victim']);
  const victim = await player(c.app, 'victim');
  const vid = strongHome(c.app, c.clock, victim, {});
  const job: BuildJob = { building: 'market', targetLevel: 6, startAt: c.clock.now(), finishAt: c.clock.now() + 100 * HOUR };
  setBuildings(c.app, vid, { market: 5, hall: 5, storehouse: 5, farm: 5 }, [job]);
  const t = c.app.ctx.store.getVillage(vid)!;

  await attack(c, { raider: 300, boulder: 100 }, 'market', t);
  const hit = (await lastBattle(victim)).siege?.[0];
  assert.ok(hit && hit.to < 5);
  const after = c.app.ctx.store.getVillage(vid)!.state;
  assert.equal(after.buildings.market, hit.to);
  const queued = after.buildQueue.find((j) => j.building === 'market');
  assert.ok(queued, 'the job is still queued');
  assert.equal(queued.targetLevel, Math.max(hit.to + 1, 6 - (5 - hit.to)), 'it aims as many levels lower as the building fell');
});

// ---- training and research -------------------------------------------------------------------------

function prepare(app: App, p: P, level: { barracks: number; drillyard: number }, researched: UnitId[] = []): number {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  Object.assign(v.state.buildings, { hall: 10, farm: 15, storehouse: 15, barracks: level.barracks, drillyard: level.drillyard });
  if (researched.length > 0) v.state.researched = researched;
  else delete v.state.researched;
  Object.assign(v.state.resources, { wood: 50000, food: 50000, iron: 50000, gold: 5000 });
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  return v.id;
}

test('a Log Ram and a Boulder Sling need research and Barracks 5 / 8 before they can be trained', async () => {
  const { app, alice } = await world();
  const train = (id: number, unit: string) => alice.c.post(`/api/villages/${id}/train`, { unit, count: 1 });

  let id = prepare(app, alice, { barracks: 5, drillyard: 3 });
  const noResearch = await train(id, 'logram');
  errorOf(noResearch, 409, 'requirements_not_met');
  assert.match(noResearch.json<{ message: string }>().message, /researched/);

  id = prepare(app, alice, { barracks: 4, drillyard: 3 }, ['logram']);
  const lowBarracks = await train(id, 'logram');
  errorOf(lowBarracks, 409, 'requirements_not_met');
  assert.doesNotMatch(lowBarracks.json<{ message: string }>().message, /researched/);

  id = prepare(app, alice, { barracks: 5, drillyard: 3 }, ['logram']);
  ok(await train(id, 'logram'), 200);

  id = prepare(app, alice, { barracks: 7, drillyard: 5 }, ['boulder']);
  errorOf(await train(id, 'boulder'), 409, 'requirements_not_met');
  id = prepare(app, alice, { barracks: 8, drillyard: 5 });
  errorOf(await train(id, 'boulder'), 409, 'requirements_not_met');
  id = prepare(app, alice, { barracks: 8, drillyard: 5 }, ['boulder']);
  ok(await train(id, 'boulder'), 200);
});

test('researching a Log Ram needs Drillyard 3, a Boulder Sling Drillyard 5', async () => {
  const { app, alice } = await world();
  const research = (id: number, unit: string) => alice.c.post(`/api/villages/${id}/research`, { unit });
  let id = prepare(app, alice, { barracks: 8, drillyard: 2 });
  errorOf(await research(id, 'logram'), 409, 'requirements_not_met');
  id = prepare(app, alice, { barracks: 8, drillyard: 3 });
  ok(await research(id, 'logram'), 200);
  errorOf(await research(id, 'boulder'), 409, 'requirements_not_met');
  id = prepare(app, alice, { barracks: 8, drillyard: 5 });
  ok(await research(id, 'boulder'), 200);
});

// ---- an old database -------------------------------------------------------------------------------

test('a version 5 database without movements.siege_target is upgraded in place; old movements keep working, picks are stored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-siege-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    const c = new Client(app);
    ok(await c.post('/api/auth/register', { username: 'alice', password: PASSWORD }), 201);
    const state = await c.state();
    const homeId = state.villages[0]!.id;
    const playerId = state.player.id;
    const npcId = app.ctx.store.abandonedVillageIds()[0]!;
    await app.close();

    // Make the file look like version 5: no siege_target column, one attack on the road.
    const raw = new DatabaseSync(dbPath);
    raw.exec('ALTER TABLE movements DROP COLUMN siege_target');
    const t = clock.now();
    raw.prepare("INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)").run(
      homeId,
      npcId,
      JSON.stringify({ ...emptyUnits(), raider: 3 }),
      t,
      t + 5 * HOUR,
    );
    raw.exec('PRAGMA user_version = 5');
    raw.close();

    app = await open();
    assert.equal(readdirSync(join(dir, 'backups')).filter((f) => f.startsWith(`pre-migrate-v5-v${SCHEMA_VERSION}-`)).length, 1, 'the old file is copied first');
    const db = app.ctx.store.db;
    const cols = (db.prepare('PRAGMA table_info(movements)').all() as Array<{ name: string }>).map((x) => x.name);
    assert.ok(cols.includes('siege_target'));
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, SCHEMA_VERSION);
    const old = app.ctx.store.dueMovements(t + 10 * HOUR, 10);
    assert.equal(old.length, 1);
    assert.equal(old[0]?.siegeTarget, null, 'an old movement has no pick');
    assert.equal(old[0]?.units.raider, 3);

    // The upgraded database takes a pick and keeps it.
    const c2 = new Client(app);
    ok(await c2.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    giveTroops(app, { c: c2, id: playerId, name: 'alice' }, { boulder: 4, raider: 5 });
    const npc = app.ctx.store.getVillage(npcId)!;
    const sent = await c2.post(`/api/villages/${homeId}/send`, { x: npc.x, y: npc.y, units: { boulder: 4, raider: 5 }, mission: 'attack', targetBuilding: 'vault' });
    ok(sent, 201);
    assert.equal(app.ctx.store.getMovement(sent.json<SendResponse>().movement.id)?.siegeTarget, 'vault');
    await app.close();

    // Opening it again changes nothing.
    app = await open();
    assert.equal(readdirSync(join(dir, 'backups')).length, 1, 'no second backup');
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
