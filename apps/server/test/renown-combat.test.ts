// Combat Renown (docs/GAME_DESIGN.md section 18.2, the bonus source): who earns from a battle, the anti-abuse rules,
// the 24 h pair window and the line in the reports. The maths of one battle is the engine's (packages/engine/test/renown.test.ts);
// these tests check what the server decides and stores around it. Two kinds: whole battles through the HTTP API, and
// crafted battles handed to RenownService directly so every relation can be set up exactly.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RENOWN_MIN_BATTLE_VALUE,
  battleValueShares,
  emptyResources,
  pairRenown,
  pairRenownTotal,
  rawRenown,
  renownPairWindowMs,
  resourceValue,
  sizeFactor,
  troopValue,
  villagePoints,
  type BattleReportData,
  type BattleResult,
  type VillageState,
} from '@clanfire/engine';
import { RenownService } from '../src/renown-service.ts';
import type { StationedRow } from '../src/store.ts';
import { battleOf, makeApp, register, trainRaiders, weakestAbandoned, type Client, type Clock } from './helpers.ts';
import { formPact, join, newPlayer } from './tribe-helpers.ts';
import { giveTroops, latestReport, sendOk, stationSupport, unprotect, units, world, type App, type P } from './warfare-helpers.ts';
import { near, pairRows, renownOf } from './renown-helpers.ts';

/** Renown a battle's report data is worth to the attacker / to the defending side as one, before the pair window and the size factor. */
const attackerRaw = (b: BattleReportData): number =>
  rawRenown({ lootValue: resourceValue(b.loot), killValue: troopValue(b.defenderLosses ?? units({})) + troopValue(b.supportLosses ?? units({})) });
const defenderRaw = (b: BattleReportData): number => rawRenown({ lootValue: 0, killValue: troopValue(b.attackerLosses) });

const pointsOf = (app: App, p: P): number => villagePoints(app.ctx.store.villagesOfPlayer(p.id)[0]?.state as VillageState);

// ---- whole battles over HTTP ------------------------------------------------------------------------

test('a player battle pays attacker and defender each, keeps a pair window per side, and the reports say how much', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  const bobBefore = renownOf(app, bob);
  const louBefore = renownOf(app, lou);
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  clock.set(movement.arriveAt);

  const mine = battleOf(await latestReport(bob));
  const theirs = battleOf(await latestReport(lou));
  const bobPaid = renownOf(app, bob) - bobBefore;
  const louPaid = renownOf(app, lou) - louBefore;
  assert.ok(resourceValue(mine.loot) + troopValue(mine.defenderLosses as never) >= RENOWN_MIN_BATTLE_VALUE, 'a battle big enough to pay');
  assert.ok(troopValue(mine.attackerLosses) >= RENOWN_MIN_BATTLE_VALUE, 'and a defence that killed enough');

  near(bobPaid, pairRenown(0, attackerRaw(mine)) * sizeFactor(pointsOf(app, lou), pointsOf(app, bob)));
  near(louPaid, pairRenown(0, defenderRaw(theirs)) * sizeFactor(pointsOf(app, bob), pointsOf(app, lou)));
  assert.ok(bobPaid > 0 && louPaid > 0);
  assert.equal(mine.renownGained, Math.floor(bobPaid + 1e-9));
  assert.equal(theirs.renownGained, Math.floor(louPaid + 1e-9));

  const [b] = pairRows(app, bob.id);
  const [l] = pairRows(app, lou.id);
  assert.deepEqual([b?.opponent, b?.window_start], [`p:${lou.id}`, movement.arriveAt]);
  assert.deepEqual([l?.opponent, l?.window_start], [`p:${bob.id}`, movement.arriveAt]);
  near(b?.value ?? 0, attackerRaw(mine));
  near(l?.value ?? 0, defenderRaw(theirs));
  await app.close();
});

test('a support owner earns for the defence they helped with, next to the village owner; each report shows its own line', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 18 });
  await stationSupport(app, clock, alice, amy, { guard: 10 });
  giveTroops(app, bob, { raider: 20 });
  const before = [alice, amy, bob].map((p) => renownOf(app, p));
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 20 });
  clock.set(movement.arriveAt);

  const reads = [battleOf(await latestReport(alice)), battleOf(await latestReport(amy)), battleOf(await latestReport(bob))];
  const paid = [alice, amy, bob].map((p, i) => renownOf(app, p) - (before[i] as number));
  for (const [i, read] of reads.entries()) {
    assert.ok((paid[i] as number) > 0, `player ${i} earned`);
    assert.equal(read.renownGained, Math.floor((paid[i] as number) + 1e-9), `report ${i} shows its own reader's Renown`);
  }
  assert.deepEqual(pairRows(app, alice.id).map((r) => r.opponent), [`p:${bob.id}`]);
  assert.deepEqual(pairRows(app, amy.id).map((r) => r.opponent), [`p:${bob.id}`]);
  assert.deepEqual(pairRows(app, bob.id).map((r) => r.opponent), [`p:${amy.id}`]);
  // The defending side shares what the attacker's losses are worth: the sizes of the two shares follow the strength they brought.
  assert.ok((paid[0] as number) > (paid[1] as number) * 0.5, 'the 10 shieldbearers (450) carried more than the 18 pikemen (270), size factors apart');
  await app.close();
});

test('a raid on an abandoned village pays the attacker only, under the village key (no size factor); a small repeat raid pays nothing', async () => {
  const { app, clock } = await makeApp();
  const c: Client = await register(app, 'farmer', '10.0.0.1');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const player = (await c.state()).player;
  const raid = async (): Promise<{ battle: BattleReportData; arriveAt: number }> => {
    const n = (await c.village()).state.troops.raider;
    const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: n }, mission: 'attack' });
    assert.equal(sent.statusCode, 201, sent.body);
    const arriveAt = sent.json<{ movement: { arriveAt: number } }>().movement.arriveAt;
    clock.set(arriveAt);
    const st = await c.state();
    const battle = battleOf(await latestReportOf(c));
    const back = st.movements[0];
    if (back) {
      clock.set(back.arriveAt);
      await c.state();
    }
    return { battle, arriveAt };
  };
  const factor = (): number => 1; // abandoned villages are exempt from the size factor
  const total = (): number => renownOf(app, player.id);

  const t0 = total();
  const first = await raid();
  assert.ok(first.battle.attackerWon && first.battle.defenderLosses);
  const raw1 = attackerRaw(first.battle);
  assert.ok(resourceValue(first.battle.loot) + troopValue(first.battle.defenderLosses) >= RENOWN_MIN_BATTLE_VALUE);
  near(total() - t0, pairRenown(0, raw1) * factor());
  assert.equal(first.battle.renownGained, Math.floor(total() - t0 + 1e-9));
  const [row] = pairRows(app, player.id);
  assert.deepEqual([row?.opponent, row?.window_start], [`v:${npc.id}`, first.arriveAt]);
  near(row?.value ?? 0, raw1);
  assert.equal(pairRows(app).length, 1, 'the village itself has no owner and earns nothing');

  // The repeat raid carries half the load and the garrison is already dead: under the minimum, it pays nothing and is not counted.
  const t1 = total();
  const second = await raid();
  assert.ok(resourceValue(second.battle.loot) + troopValue(second.battle.defenderLosses as never) < RENOWN_MIN_BATTLE_VALUE);
  assert.equal(total(), t1);
  assert.equal(second.battle.renownGained, undefined);
  near(pairRows(app, player.id)[0]?.value ?? 0, raw1);
  await app.close();
});

test('a won raid on an abandoned village adds Renown (paid at the battle) and it is still there once the troops are home', async () => {
  const { app, clock } = await makeApp();
  const c: Client = await register(app, 'homecomer', '10.0.0.2');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const player = (await c.state()).player;
  const n = (await c.village()).state.troops.raider;
  const before = renownOf(app, player.id);
  const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: n }, mission: 'attack' });
  assert.equal(sent.statusCode, 201, sent.body);
  clock.set(sent.json<{ movement: { arriveAt: number } }>().movement.arriveAt);
  const atBattle = await c.state();
  const battle = battleOf(await latestReportOf(c));
  assert.ok(battle.attackerWon);
  const paid = renownOf(app, player.id) - before;
  assert.ok(paid > 0, 'Renown was added by the won raid');
  const back = atBattle.movements.find((m) => m.kind === 'return');
  assert.ok(back, 'the survivors are walking home');
  clock.set(back.arriveAt);
  const home = await c.state();
  assert.equal(home.movements.length, 0, 'everyone is home');
  assert.ok(home.villages[0]!.state.troops.raider > 0, 'raiders are back at home');
  near(renownOf(app, player.id) - before, paid);
  assert.equal(home.renown.total, Math.floor(renownOf(app, player.id) + 1e-9), 'the state shows the same total (whole numbers)');
  await app.close();
});

test('a raider with a big village earns the full pair-window Renown from a small abandoned village (no size rule), also in test mode', async () => {
  const { app, clock } = await makeApp();
  const c: Client = await register(app, 'bigfish', '10.0.0.3');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const player = (await c.state()).player;
  // Make the raider's village far bigger than the target (size factor would be the floor if it applied), and a test-mode account.
  const home = app.ctx.store.getVillage(vid)!;
  const big = structuredClone(home.state);
  for (const b of Object.keys(big.buildings) as Array<keyof typeof big.buildings>) big.buildings[b] = Math.max(big.buildings[b], 10);
  app.ctx.store.saveVillage(vid, big, villagePoints(big));
  app.ctx.store.sandboxUsers = new Set(['bigfish']);
  const n = (await c.village()).state.troops.raider;
  const before = renownOf(app, player.id);
  const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: n }, mission: 'attack' });
  assert.equal(sent.statusCode, 201, sent.body);
  clock.set(sent.json<{ movement: { arriveAt: number } }>().movement.arriveAt);
  const atBattle = await c.state();
  const battle = battleOf(await latestReportOf(c));
  assert.ok(battle.attackerWon && battle.defenderLosses);
  const raw = attackerRaw(battle);
  assert.ok(raw > 0 && resourceValue(battle.loot) + troopValue(battle.defenderLosses) >= RENOWN_MIN_BATTLE_VALUE);
  const back = atBattle.movements.find((m) => m.kind === 'return');
  assert.ok(back);
  clock.set(back.arriveAt);
  assert.equal((await c.state()).movements.length, 0, 'troops are home');
  near(renownOf(app, player.id) - before, pairRenown(0, raw));
  await app.close();
});

/** The newest report of a client, opened in full. */
async function latestReportOf(c: Client) {
  const list = (await c.get('/api/reports')).json<{ reports: Array<{ id: number }> }>().reports;
  const res = await c.get(`/api/reports/${list[0]?.id}`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json<import('@clanfire/engine').ReportDto>();
}

test('a battle too small to count pays nothing and is not written into the pair window', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 1 });
  const before = [renownOf(app, bob), renownOf(app, lou)];
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 1 });
  clock.set(movement.arriveAt);
  const b = battleOf(await latestReport(bob));
  assert.ok(resourceValue(b.loot) + troopValue(b.defenderLosses ?? units({})) < RENOWN_MIN_BATTLE_VALUE);
  assert.deepEqual([renownOf(app, bob), renownOf(app, lou)], before);
  assert.equal(b.renownGained, undefined);
  assert.equal(pairRows(app).length, 0);
  await app.close();
});

test('accounts on one connection earn nothing from fighting each other, even when the link appears while the army marches', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  const before = [renownOf(app, bob), renownOf(app, lou)];
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  app.ctx.store.recordIp(bob.id, '10.77.0.1', clock.t);
  app.ctx.store.recordIp(lou.id, '10.77.0.1', clock.t);
  clock.set(movement.arriveAt);
  const mine = battleOf(await latestReport(bob));
  const theirs = battleOf(await latestReport(lou));
  assert.ok(troopValue(mine.attackerLosses) >= RENOWN_MIN_BATTLE_VALUE, 'a real battle was fought');
  assert.deepEqual([renownOf(app, bob), renownOf(app, lou)], before);
  assert.equal(mine.renownGained, undefined);
  assert.equal(theirs.renownGained, undefined);
  assert.equal(pairRows(app).length, 0);
  await app.close();
});

test('an attacker who shares a connection with a supporter earns nothing and neither does that supporter; the village owner still does', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 18 });
  await stationSupport(app, clock, alice, amy, { guard: 10 });
  giveTroops(app, bob, { raider: 20 });
  const before = [alice, amy, bob].map((p) => renownOf(app, p));
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 20 });
  app.ctx.store.recordIp(bob.id, '10.77.0.2', clock.t);
  app.ctx.store.recordIp(alice.id, '10.77.0.2', clock.t);
  clock.set(movement.arriveAt);
  await latestReport(amy);
  const after = [alice, amy, bob].map((p) => renownOf(app, p));
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
  assert.ok((after[1] as number) > (before[1] as number));
  assert.deepEqual(pairRows(app).map((r) => r.earner_id), [amy.id]);
  await app.close();
});

test('no Renown for scouting, and none for an attack that is called off on arrival', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { pathfinder: 5, raider: 30 });
  const before = [renownOf(app, bob), renownOf(app, lou)];
  const scout = await sendOk(bob, lou, 'scout', { pathfinder: 5 });
  clock.set(scout.movement.arriveAt);
  await latestReport(bob);
  // The loner joins bob's tribe while the raid marches: called off, no battle.
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  await join(lou, (await bob.c.get('/api/tribe')).json<{ tribe: { id: number } }>().tribe.id);
  clock.set(movement.arriveAt);
  const report = battleOf(await latestReport(bob));
  assert.equal(report.outcome, 'called_off');
  assert.deepEqual([renownOf(app, bob), renownOf(app, lou)], before);
  assert.equal(pairRows(app).length, 0);
  await app.close();
});

// ---- crafted battles: every relation and the window -------------------------------------------------

/** A won battle worth far more than RENOWN_MIN_BATTLE_VALUE to both sides. */
const BIG: BattleResult = {
  attackerWon: true,
  luck: 0,
  attackPower: 100,
  defensePower: 50,
  attackerLosses: units({ raider: 5 }),
  attackerSurvivors: units({ raider: 25 }),
  defenderUnits: units({ pikeman: 20 }),
  defenderLosses: units({ pikeman: 20 }),
  supportLosses: [],
  loot: { ...emptyResources(), wood: 300, food: 300, iron: 300 },
};

/** Hand `result` to the service as a battle of `att` against `def` (both players' first villages), at `at`. */
function award(app: App, clock: Clock, att: P, def: P, result: BattleResult = BIG, opts: { at?: number; contingents?: StationedRow[]; originState?: VillageState } = {}): Map<number, number> {
  const store = app.ctx.store;
  const origin = store.villagesOfPlayer(att.id)[0];
  const target = store.villagesOfPlayer(def.id)[0];
  assert.ok(origin && target);
  return new RenownService(store, app.ctx.game.settings).awardBattle({
    at: opts.at ?? clock.t,
    result,
    origin,
    target,
    originState: opts.originState ?? origin.state,
    targetState: target.state,
    attackerRanks: undefined,
    contingents: opts.contingents ?? [],
  });
}

const paidTo = (gains: Map<number, number>, ...ps: P[]): number[] => ps.map((p) => gains.get(p.id) ?? 0);

test('neutral players earn, both sides', async () => {
  const { app, clock, bob, lou } = await world();
  const [att, def] = paidTo(award(app, clock, lou, bob), lou, bob);
  assert.ok((att as number) > 0 && (def as number) > 0);
  await app.close();
});

test('tribe-mates earn nothing from each other', async () => {
  const { app, clock, alice, amy } = await world();
  assert.deepEqual(paidTo(award(app, clock, alice, amy), alice, amy), [0, 0]);
  assert.equal(pairRows(app).length, 0);
  await app.close();
});

for (const [kind, pays] of [['ally', false], ['nap', true], ['enemy', true]] as const) {
  test(`${kind} tribes ${pays ? 'earn from each other (only a pact between friends is ruled out)' : 'earn nothing from each other'}`, async () => {
    const { app, clock, alice, bob } = await world();
    if (kind === 'enemy') {
      const res = await alice.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'enemy' });
      assert.equal(res.statusCode, 201, res.body);
    } else {
      await formPact(alice, 'BRAVO', bob, kind);
    }
    const [att, def] = paidTo(award(app, clock, alice, bob), alice, bob) as [number, number];
    if (pays) assert.ok(att > 0 && def > 0);
    else assert.deepEqual([att, def], [0, 0]);
    assert.equal(pairRows(app).length, pays ? 2 : 0);
    await app.close();
  });
}

test('a supporter from the attacker\'s own tribe earns nothing; the attacker and the village owner still do', async () => {
  const { app, clock, bob, bea, amy } = await world();
  const store = app.ctx.store;
  const host = store.villagesOfPlayer(amy.id)[0];
  const home = store.villagesOfPlayer(bea.id)[0];
  assert.ok(host && home);
  const contingent: StationedRow = { id: 1, ownerPlayerId: bea.id, homeVillageId: home.id, hostVillageId: host.id, units: units({ pikeman: 10 }), arrivedAt: clock.t, ranks: null };
  const withSupport: BattleResult = { ...BIG, supportLosses: [units({ pikeman: 5 })] };
  const gains = award(app, clock, bob, amy, withSupport, { contingents: [contingent] });
  const [att, def, sup] = paidTo(gains, bob, amy, bea);
  assert.ok((att as number) > 0 && (def as number) > 0);
  assert.equal(sup, 0);
  assert.equal(pairRows(app, bea.id).length, 0);
  await app.close();
});

test('sandbox accounts earn nothing from fighting; their opponent does', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['sandy'] });
  const sandy = await newPlayer(app, 'sandy');
  const norma = await newPlayer(app, 'norma');
  unprotect(app, sandy, norma);
  const [s, n] = paidTo(award(app, clock, sandy, norma), sandy, norma);
  assert.equal(s, 0);
  assert.ok((n as number) > 0);
  assert.equal(pairRows(app, sandy.id).length, 0);
  await app.close();
});

test('the pair window: many small battles pay what one big one does; a second one pays less; after the window it starts again', async () => {
  const { app, clock, bob, bea, lou } = await world();
  const store = app.ctx.store;
  const windowMs = renownPairWindowMs(app.ctx.game.settings);
  const small: BattleResult = {
    ...BIG,
    attackerLosses: units({ raider: 2 }),
    attackerSurvivors: units({ raider: 20 }),
    defenderUnits: units({ pikeman: 10 }),
    defenderLosses: units({ pikeman: 10 }),
    loot: { ...emptyResources(), wood: 100, food: 100, iron: 100 },
  };
  const big: BattleResult = {
    ...BIG,
    attackerLosses: units({ raider: 10 }),
    attackerSurvivors: units({ raider: 100 }),
    defenderUnits: units({ pikeman: 50 }),
    defenderLosses: units({ pikeman: 50 }),
    loot: { ...emptyResources(), wood: 500, food: 500, iron: 500 },
  };
  const raw = (r: BattleResult): number => rawRenown(battleValueShares(r)[0] as never);

  // lou hits bob five times with the small battle, and bea once with the five-fold one (same sizes, same earner).
  const t0 = renownOf(app, lou);
  let first = 0;
  for (let i = 0; i < 5; i++) {
    const g = (award(app, clock, lou, bob, small).get(lou.id) ?? 0) + 0;
    if (i === 0) first = renownOf(app, lou) - t0;
    assert.ok(g >= 0);
  }
  const fiveSmall = renownOf(app, lou) - t0;
  const t1 = renownOf(app, lou);
  award(app, clock, lou, bea, big);
  const oneBig = renownOf(app, lou) - t1;
  near(fiveSmall, oneBig);
  near(fiveSmall, pairRenownTotal(5 * raw(small)) * sizeFactor(villagePoints(store.villagesOfPlayer(bob.id)[0]?.state as VillageState), pointsOf(app, lou)));
  assert.ok(first > (fiveSmall - first) / 4, 'the first small battle pays more than each of the next four');
  near(pairRows(app, lou.id).find((r) => r.opponent === `p:${bob.id}`)?.value ?? 0, 5 * raw(small));

  // After the window closes the next battle is paid as if it were the first.
  const start = pairRows(app, lou.id).find((r) => r.opponent === `p:${bob.id}`)?.window_start as number;
  const t2 = renownOf(app, lou);
  award(app, clock, lou, bob, small, { at: start + windowMs - 1 });
  const justInside = renownOf(app, lou) - t2;
  const t3 = renownOf(app, lou);
  award(app, clock, lou, bob, small, { at: start + windowMs });
  const afterWindow = renownOf(app, lou) - t3;
  assert.ok(afterWindow > justInside, 'a new window pays more than the end of the old one');
  near(afterWindow, first);
  const row = pairRows(app, lou.id).find((r) => r.opponent === `p:${bob.id}`);
  assert.equal(row?.window_start, start + windowMs);
  near(row?.value ?? 0, raw(small));
  await app.close();
});

test('hitting a far smaller player pays less (the size factor), by the engine formula', async () => {
  const { app, clock, bob, lou } = await world();
  const store = app.ctx.store;
  const origin = store.villagesOfPlayer(lou.id)[0] as { state: VillageState };
  const big: VillageState = { ...origin.state, buildings: { ...origin.state.buildings, hall: 20, barracks: 20, storehouse: 20, wall: 20 } };
  const target = store.villagesOfPlayer(bob.id)[0] as { state: VillageState };
  const factor = sizeFactor(villagePoints(target.state), villagePoints(big));
  assert.ok(factor < 1, 'the crafted attacker is much bigger');
  const t0 = renownOf(app, lou);
  award(app, clock, lou, bob, BIG, { originState: big });
  const attShare = battleValueShares(BIG)[0] as never;
  near(renownOf(app, lou) - t0, pairRenown(0, rawRenown(attShare)) * factor);
  await app.close();
});

test('abandoned villages are exempt from the size factor: a big player raiding a tiny one gets the full amount', async () => {
  const { app, clock, lou } = await world();
  const store = app.ctx.store;
  const origin = store.villagesOfPlayer(lou.id)[0] as { state: VillageState };
  const bigState: VillageState = { ...origin.state, buildings: { ...origin.state.buildings, hall: 20, barracks: 20, storehouse: 20, wall: 20 } };
  const npcRecord = store.getVillage(store.abandonedVillageIds()[0] as number);
  assert.ok(npcRecord);
  assert.ok(sizeFactor(villagePoints(npcRecord.state), villagePoints(bigState)) < 1, 'a player village of that size would be cut');
  const t0 = renownOf(app, lou);
  new RenownService(store, app.ctx.game.settings).awardBattle({
    at: clock.t,
    result: BIG,
    origin: store.villagesOfPlayer(lou.id)[0] as never,
    target: npcRecord,
    originState: bigState,
    targetState: npcRecord.state,
    attackerRanks: undefined,
    contingents: [],
  });
  near(renownOf(app, lou) - t0, pairRenown(0, rawRenown(battleValueShares(BIG)[0] as never)));
  assert.equal(pairRows(app, lou.id)[0]?.opponent, `v:${npcRecord.id}`);
  await app.close();
});

test('Renown is credited to the right accounts only: nobody else changes', async () => {
  const { app, clock, bob, lou, alice } = await world();
  const before = renownOf(app, alice);
  award(app, clock, lou, bob);
  assert.equal(renownOf(app, alice), before);
  assert.deepEqual(
    pairRows(app).map((r) => r.earner_id).sort(),
    [bob.id, lou.id].sort(),
  );
  await app.close();
});
