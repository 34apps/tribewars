// Drillyard rank rework (2026-11-18, schema v32): the Breach track on the siege units, which unit has which track (RANK_TRACKS_OF), the
// flat point price, a real siege with a stamped Breach rank, and the one-time data step that retires old tracks and trims over-spent pools.
// Security gate (docs/SECURITY_ROADMAP.md section 4) for POST /api/villages/:id/{rank,respec}: ownership, enum input, no client time: drillyard.test.ts.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  BUILDING_IDS,
  RANK_COST,
  RANK_MAX,
  RANK_POINTS,
  RANK_TRACKS_OF,
  emptyResources,
  emptyUnits,
  pointsSpent,
  pointsTotal,
  rankPointsUpTo,
  rankResourcesUpTo,
  resolveSiege,
  storageCapForLevel,
  villagePoints,
  type BuildingLevels,
  type Resources,
  type SendResponse,
  type Units,
  type VillageRanks,
  type VillageState,
} from '@clanfire/engine';
import { buildApp } from '../src/app.ts';
import { Clock, MINUTE, TEST_WORLD, TEST_WORLD_CONFIG, battleOf, errorOf, makeApp, ok, register } from './helpers.ts';
import { latestReport, world } from './warfare-helpers.ts';
import { clearedTarget, homeOf, player, runTo, strongHome, type App, type P } from './village-helpers.ts';

const post = (p: P, id: number | string, path: string, body: unknown) => p.c.post(`/api/villages/${id}/${path}`, body);
type RankedState = { ranks?: Record<string, Record<string, number>>; resources: Resources };

// ---- HTTP: Breach ------------------------------------------------------------------------------------

test('Breach: bought on a researched Log Ram; other units and tracks are refused; points run out; respec returns them', async () => {
  const { app, alice, bob } = await world();
  const v = app.ctx.store.villagesOfPlayer(alice.id)[0]!;
  v.state.buildings.drillyard = 3;
  v.state.buildings.storehouse = Math.max(v.state.buildings.storehouse, 15);
  Object.assign(v.state.resources, { wood: 50_000, food: 50_000, iron: 50_000, gold: 5000 });
  v.state.researched = ['logram']; // the Firecart stays unresearched
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  const id = v.id;
  const pool = pointsTotal(app.ctx.store.getVillage(id)!.state);

  const first = await post(alice, id, 'rank', { unit: 'logram', track: 'breach' });
  ok(first, 200);
  const s1 = first.json<{ state: RankedState }>().state;
  assert.equal(s1.ranks!.logram!.breach, 1);
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), RANK_POINTS[0]);
  assert.ok(s1.resources.wood <= 50_000 - RANK_COST[0]!.wood + 1, 'the rank price was paid in resources');

  // Wrong unit / wrong track combinations: invalid_input (400), nothing paid.
  const before = JSON.stringify(app.ctx.store.getVillage(id)!.state);
  for (const [unit, track] of [
    ['pikeman', 'breach'],
    ['raider', 'breach'],
    ['chieftain', 'breach'],
    ['logram', 'might'],
    ['logram', 'bulwark'],
    ['logram', 'keen'],
    ['raider', 'bulwark'],
    ['pikeman', 'might'],
    ['hearthwarden', 'might'],
  ]) {
    errorOf(await post(alice, id, 'rank', { unit, track }), 400, 'invalid_input');
  }
  errorOf(await post(alice, id, 'rank', { unit: 'logram', track: 'breach', cost: 0 }), 400, 'invalid_input'); // extra field
  errorOf(await post(alice, id, 'rank', { unit: 'firecart', track: 'breach' }), 409, 'requirements_not_met'); // not researched
  assert.equal(JSON.stringify(app.ctx.store.getVillage(id)!.state), before, 'refusals change nothing');

  // Buy on until the pool is empty: the refusal is "not enough points", not a crash, and every Log Ram rank is capped at RANK_MAX.
  let rank = 1;
  while (rank < RANK_MAX && rankPointsUpTo(rank + 1) <= pool) {
    ok(await post(alice, id, 'rank', { unit: 'logram', track: 'breach' }), 200);
    rank++;
  }
  if (rank < RANK_MAX) errorOf(await post(alice, id, 'rank', { unit: 'logram', track: 'breach' }), 409, 'requirements_not_met');
  else errorOf(await post(alice, id, 'rank', { unit: 'logram', track: 'breach' }), 409, 'max_level');
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), rankPointsUpTo(rank));

  // Another player cannot buy or reset in my village.
  errorOf(await post(bob, id, 'rank', { unit: 'logram', track: 'breach' }), 403, 'forbidden');
  errorOf(await post(bob, id, 'respec', { unit: 'logram', track: 'breach' }), 403, 'forbidden');

  const back = await post(alice, id, 'respec', { unit: 'logram', track: 'breach' });
  ok(back, 200);
  assert.equal(back.json<{ state: RankedState }>().state.ranks!.logram!.breach, 0);
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), 0, 'all points came back');
  // Ranks on a track the unit does not have (an old save) do nothing and cannot be "reset".
  const st = app.ctx.store.getVillage(id)!;
  st.state.ranks = { ...st.state.ranks, pikeman: { might: 3, bulwark: 0, keen: 0, breach: 0 } };
  app.ctx.store.saveVillage(id, st.state, st.points);
  errorOf(await post(alice, id, 'respec', { unit: 'pikeman', track: 'might' }), 400, 'invalid_input');
  assert.equal(pointsSpent(app.ctx.store.getVillage(id)!.state), 0, 'a stale rank costs no points');
});

test('RANK_TRACKS_OF is what the endpoint accepts: every unit/track pair answers 200/409 exactly when the unit has the track', async () => {
  const { app, alice } = await world();
  const v = app.ctx.store.villagesOfPlayer(alice.id)[0]!;
  v.state.buildings.drillyard = 20;
  v.state.buildings.storehouse = 15;
  Object.assign(v.state.resources, { wood: 90_000, food: 90_000, iron: 90_000, gold: 9000 });
  v.state.researched = ['guard', 'outrider', 'hearthwarden', 'knight', 'pathfinder', 'logram', 'firecart', 'chieftain'];
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  for (const unit of ['pikeman', 'guard', 'hearthwarden', 'raider', 'outrider', 'knight', 'pathfinder', 'logram', 'firecart', 'chieftain'] as const) {
    for (const track of ['might', 'bulwark', 'keen', 'breach'] as const) {
      const res = await post(alice, v.id, 'rank', { unit, track });
      if (RANK_TRACKS_OF[unit]?.includes(track)) ok(res, 200);
      else errorOf(res, 400, 'invalid_input');
    }
  }
});

// ---- a real siege with a stamped Breach rank -----------------------------------------------------------

const BASE: BuildingLevels = Object.fromEntries(BUILDING_IDS.map((b) => [b, b === 'hall' || b === 'storehouse' || b === 'farm' || b === 'longhouse' ? 1 : 0])) as BuildingLevels;

function setBuildings(app: App, villageId: number, levels: Partial<BuildingLevels>): void {
  const v = app.ctx.store.getVillage(villageId)!;
  v.state.buildings = { ...BASE, ...levels };
  app.ctx.store.saveVillage(villageId, v.state, villagePoints(v.state));
}

test('siege: a Breach rank stamped on the march lowers the Wall by more levels than the same Log Rams without it', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['sieger'], worldConfig: { npc: { selfBuild: false }, features: { morale: false } } });
  const p = await player(app, 'sieger');
  const homeId = strongHome(app, clock, p, {});
  const target = clearedTarget(app, homeOf(app, p));
  const WALL = 12;
  const topRanks: VillageRanks = { logram: { might: 0, bulwark: 0, keen: 0, breach: RANK_MAX } };

  // The smallest Log Ram count where the top Breach rank makes the final Wall lower, found with the real engine (no magic number).
  const wallAfter = (n: number, ranks?: VillageRanks): number => {
    const sent: Partial<Units> = { logram: n };
    const hits = resolveSiege(sent, { ...BASE, wall: WALL }, null, sent, 0, ranks);
    return hits.length > 0 ? Math.min(...hits.map((h) => h.to)) : WALL;
  };
  let n = 1;
  while (n < 400 && wallAfter(n, topRanks) >= wallAfter(n)) n++;
  assert.ok(n < 400, 'some Log Ram count shows the Breach rank');
  const without = wallAfter(n);
  const withRank = wallAfter(n, topRanks);
  assert.ok(withRank < without && withRank >= 0);

  const store = app.ctx.store;
  const wallOf = (): number => store.getVillage(target.id)!.state.buildings.wall;
  const run = async (): Promise<number> => {
    setBuildings(app, target.id, { wall: WALL });
    const h = store.getVillage(homeId)!;
    h.state.troops = { ...emptyUnits(), raider: 20, logram: n };
    h.state.away = emptyUnits();
    store.saveVillage(h.id, h.state, h.points);
    const res = await post(p, homeId, 'send', { x: target.x, y: target.y, units: { raider: 20, logram: n }, mission: 'attack', travelSeconds: 0, returnSeconds: 0 });
    ok(res, 201);
    const m = res.json<SendResponse>().movement;
    runTo(app, clock, m.arriveAt);
    clock.advance(MINUTE);
    const b = battleOf(await latestReport(p));
    assert.equal(b.attackerWon, true);
    return wallOf();
  };

  const plain = await run();
  assert.equal(plain, without, 'no rank: the engine number for these Log Rams');

  // Buy the Breach ranks through the real endpoint (research the Log Ram first, as a player would have).
  const h = store.getVillage(homeId)!;
  h.state.researched = [...(h.state.researched ?? []), 'logram'];
  store.saveVillage(h.id, h.state, h.points);
  for (let i = 0; i < RANK_MAX; i++) ok(await post(p, homeId, 'rank', { unit: 'logram', track: 'breach' }), 200);
  assert.equal(store.getVillage(homeId)!.state.ranks?.logram?.breach, RANK_MAX);

  const ranked = await run();
  assert.equal(ranked, withRank, 'the stamped Breach rank reached the battle');
  assert.ok(ranked < plain, 'the Wall dropped further than without the rank');

  // A respec while the army marches changes nothing: the stamp wins.
  setBuildings(app, target.id, { wall: WALL });
  const h2 = store.getVillage(homeId)!;
  h2.state.troops = { ...emptyUnits(), raider: 20, logram: n };
  h2.state.away = emptyUnits();
  store.saveVillage(h2.id, h2.state, h2.points);
  const res = await post(p, homeId, 'send', { x: target.x, y: target.y, units: { raider: 20, logram: n }, mission: 'attack', travelSeconds: 0, returnSeconds: 0 });
  ok(res, 201);
  const m = res.json<SendResponse>().movement;
  assert.equal(store.getMovement(m.id)?.ranks?.logram?.breach, RANK_MAX, 'stamped on the movement');
  ok(await post(p, homeId, 'respec', { unit: 'logram', track: 'breach' }), 200);
  runTo(app, clock, m.arriveAt);
  assert.equal(wallOf(), withRank, 'the stamp, not the village now, decides');
});

// ---- the one-time data step (schema v32) ---------------------------------------------------------------

const sum = (list: Resources[]): Resources => {
  const out = emptyResources();
  for (const r of list) for (const k of ['wood', 'food', 'iron', 'gold'] as const) out[k] += r[k];
  return out;
};

test('migration v32: retired tracks removed and refunded, over-spent pools trimmed (highest rank first), capped at storage, idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanfire-rank-rework-'));
  try {
    const dbPath = join(dir, 'game.sqlite');
    const clock = new Clock();
    const open = () => buildApp({ dbPath, now: clock.now, settings: TEST_WORLD, worldConfig: TEST_WORLD_CONFIG, webDistDir: '/nonexistent' });
    let app = await open();
    await register(app, 'alice');
    const [vA, vCap, vOk] = app.ctx.store.abandonedVillageIds();
    await app.close();

    const rk = (might: number, bulwark: number, keen = 0, breach = 0) => ({ might, bulwark, keen, breach });
    const rowState = (db: DatabaseSync, id: number): VillageState => JSON.parse((db.prepare('SELECT state_json FROM villages WHERE id = ?').get(id) as { state_json: string }).state_json) as VillageState;
    const raw = new DatabaseSync(dbPath);
    // A: old retired ranks (pikeman Might 3, hearthwarden Might 2, raider Bulwark 1) + rank 1 on every valid track (+ pikeman Bulwark 2) in a pool too small for it.
    const a = rowState(raw, vA!);
    a.buildings.drillyard = 2;
    a.buildings.storehouse = 20;
    a.resources = { wood: 0, food: 0, iron: 0, gold: 0 };
    a.ranks = {
      pikeman: rk(3, 2),
      guard: rk(0, 1),
      hearthwarden: rk(2, 1),
      raider: rk(1, 1),
      outrider: rk(1, 0),
      knight: rk(1, 1),
      pathfinder: rk(0, 0, 1),
      logram: rk(0, 0, 0, 1),
      firecart: rk(0, 0, 0, 1),
    };
    // B: a refund that would pass the storehouse: stored amount near the cap.
    const b = rowState(raw, vCap!);
    b.buildings.storehouse = 1;
    b.buildings.drillyard = 5;
    const cap = storageCapForLevel(1);
    b.resources = { wood: cap - 5, food: 0, iron: 0, gold: 0 };
    b.ranks = { raider: rk(0, 1) };
    // C: nothing to change (valid ranks inside the pool).
    const c = rowState(raw, vOk!);
    c.buildings.drillyard = 10;
    c.ranks = { raider: rk(2, 0), logram: rk(0, 0, 0, 1) };
    for (const [id, st] of [[vA!, a], [vCap!, b], [vOk!, c]] as const) raw.prepare('UPDATE villages SET state_json = ? WHERE id = ?').run(JSON.stringify(st), id);
    const cBefore = (raw.prepare('SELECT state_json FROM villages WHERE id = ?').get(vOk!) as { state_json: string }).state_json;
    // Stamped ranks of a march stay as they are (the engine ignores retired tracks).
    raw.exec("DELETE FROM meta WHERE key = 'rank_rework_applied'");
    raw.exec('PRAGMA user_version = 31');
    raw.close();

    app = await open();
    await app.close();
    const after = new DatabaseSync(dbPath, { readOnly: true });
    const A = rowState(after, vA!);
    // (a) retired: pikeman Might 3, hearthwarden Might 2, raider Bulwark 1, guard/knight/pikeman etc. are fine, outrider/raider Might fine,
    //     knight Might + Bulwark fine, pathfinder Keen fine. Retired ranks are all zero now.
    assert.equal(A.ranks!.pikeman!.might, 0);
    assert.equal(A.ranks!.hearthwarden!.might, 0);
    assert.equal(A.ranks!.raider!.bulwark, 0);
    assert.equal(A.ranks!.guard!.might, 0);
    // (b) the pool: spent fits, and the trim took the highest rank first (Pikeman Bulwark 2 -> 1), then the last units' rank 1s.
    assert.ok(pointsSpent(A) <= pointsTotal(A), `spent ${pointsSpent(A)} of ${pointsTotal(A)}`);
    assert.equal(A.ranks!.pikeman!.bulwark, 1, 'the one rank-2 track lost a rank first');
    assert.equal(A.ranks!.firecart!.breach, 0, 'ties: the later unit loses first');
    assert.equal(A.ranks!.logram!.breach, 0);
    assert.equal(A.ranks!.guard!.bulwark, 1, 'an earlier unit keeps its rank');
    // Refund = the retired ranks' full price + the trimmed ranks' price (ranks 1..n for a retired track, RANK_COST[rank - 1] per trimmed rank).
    const retiredPaid = sum([rankResourcesUpTo(3), rankResourcesUpTo(2), rankResourcesUpTo(1)]);
    const refunded = A.resources;
    const trimmedPaid = sum([RANK_COST[1]!, ...Array.from({ length: countTrimmedFirstRanks(A) }, () => RANK_COST[0]!)]);
    assert.deepEqual(refunded, sum([retiredPaid, trimmedPaid]), 'every retired and trimmed rank was paid back in full');

    const B = rowState(after, vCap!);
    assert.equal(B.ranks!.raider!.bulwark, 0);
    assert.equal(B.resources.wood, cap, 'the refund stops at the storehouse and takes nothing away');
    assert.ok(B.resources.iron > 0 && B.resources.iron <= cap, 'the other resources were refunded within the cap');

    assert.equal((after.prepare('SELECT state_json FROM villages WHERE id = ?').get(vOk!) as { state_json: string }).state_json, cBefore, 'a village with nothing to change is not rewritten');
    assert.equal((after.prepare("SELECT value FROM meta WHERE key = 'rank_rework_applied'").get() as { value: string }).value, '1', 'the flag is set');
    const snapshot = JSON.stringify(after.prepare('SELECT id, state_json FROM villages ORDER BY id').all());
    after.close();

    // A second start changes nothing; even with the flag removed (a re-run) nothing is left to refund or trim.
    app = await open();
    await app.close();
    const again = new DatabaseSync(dbPath);
    assert.equal(JSON.stringify(again.prepare('SELECT id, state_json FROM villages ORDER BY id').all()), snapshot);
    again.exec("DELETE FROM meta WHERE key = 'rank_rework_applied'");
    again.close();
    app = await open();
    await app.close();
    const last = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(JSON.stringify(last.prepare('SELECT id, state_json FROM villages ORDER BY id').all()), snapshot, 'a re-run is a no-op');
    last.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** How many rank-1 tracks (other than Pikeman Bulwark) the trim removed from village A: those that were set to 1 and are 0 now. */
function countTrimmedFirstRanks(a: VillageState): number {
  const wasOne: Array<[string, string]> = [
    ['guard', 'bulwark'],
    ['hearthwarden', 'bulwark'],
    ['raider', 'might'],
    ['outrider', 'might'],
    ['knight', 'might'],
    ['knight', 'bulwark'],
    ['pathfinder', 'keen'],
    ['logram', 'breach'],
    ['firecart', 'breach'],
  ];
  return wasOne.filter(([u, t]) => (a.ranks as Record<string, Record<string, number>>)[u]![t] === 0).length;
}
