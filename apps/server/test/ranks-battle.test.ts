// Unit ranks in the server: stamped on movements at send time, used by battles and the scout duel (GAME_DESIGN.md section 15).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSeed, resolveBattle, resolveScouting, keenMultiplier, settleVillage, type VillageRanks } from '@clanfire/engine';
import { giveKeen, giveTroops, latestReport, sendOk, stateOf, village, world, type App, type P } from './warfare-helpers.ts';

const ranksOf = (might: number, bulwark: number, keen = 0): VillageRanks => ({
  raider: { might, bulwark: 0, keen: 0 },
  pikeman: { might: 0, bulwark, keen: 0 },
  pathfinder: { might: 0, bulwark: 0, keen },
});

function setRanks(app: App, p: P, ranks: VillageRanks | undefined): void {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  v.state.ranks = ranks;
  app.ctx.store.saveVillage(v.id, v.state, v.points);
}

test('a battle uses the attacker ranks stamped at send time (a respec in flight changes nothing) and the defender current ranks', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 20 });
  giveTroops(app, bob, { pikeman: 10 });
  setRanks(app, alice, ranksOf(5, 0));
  setRanks(app, bob, ranksOf(0, 3));

  const { movement } = await sendOk(alice, bob, 'attack', { raider: 20 });
  setRanks(app, alice, undefined); // respec while the army marches: the stamp must win
  const row = app.ctx.store.getMovement(movement.id);
  assert.equal(row?.ranks?.raider?.might, 5);

  const bobState = (await village(bob)).state;
  clock.set(movement.arriveAt);
  const expected = resolveBattle({
    attackerUnits: row!.units,
    defender: settleVillage(bobState, movement.arriveAt, app.ctx.settings),
    support: [],
    attackerRanks: ranksOf(5, 0),
    defenderRanks: ranksOf(0, 3),
    seed: hashSeed(movement.id, movement.arriveAt),
  });
  const plain = resolveBattle({
    attackerUnits: row!.units,
    defender: settleVillage(bobState, movement.arriveAt, app.ctx.settings),
    support: [],
    seed: hashSeed(movement.id, movement.arriveAt),
  });
  assert.notEqual(expected.attackPower, plain.attackPower, 'ranks make a difference in this setup');

  const b = (await latestReport(alice)).battle;
  assert.ok(b);
  assert.equal(b.attackPower, expected.attackPower);
  assert.equal(b.defensePower, expected.defensePower);
  await app.close();
});

test('support defends with the ranks stamped when it left home; a later arrival re-stamps the contingent', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 10 });
  setRanks(app, amy, ranksOf(0, 4));
  const s1 = await sendOk(amy, alice, 'support', { pikeman: 6 });
  clock.set(s1.movement.arriveAt);
  await stateOf(alice); // settle: the support arrives
  let here = app.ctx.store.stationedAt((await village(alice)).id);
  assert.equal(here.length, 1);
  assert.equal(here[0]?.ranks?.pikeman?.bulwark, 4);

  setRanks(app, amy, ranksOf(0, 1));
  const s2 = await sendOk(amy, alice, 'support', { pikeman: 2 });
  clock.set(s2.movement.arriveAt);
  await stateOf(alice);
  here = app.ctx.store.stationedAt((await village(alice)).id);
  assert.equal(here[0]?.units.pikeman, 8);
  assert.equal(here[0]?.ranks?.pikeman?.bulwark, 1);

  // Bob raids Alice: the support's stamped Bulwark enters the battle.
  giveTroops(app, bob, { raider: 30 });
  const atk = await sendOk(bob, alice, 'attack', { raider: 30 });
  const aliceState = (await village(alice)).state;
  const contingent = app.ctx.store.stationedAt((await village(alice)).id);
  clock.set(atk.movement.arriveAt);
  const expected = resolveBattle({
    attackerUnits: atk.movement.units!,
    defender: settleVillage(aliceState, atk.movement.arriveAt, app.ctx.settings),
    support: contingent.map((c) => c.units),
    supportRanks: contingent.map((c) => c.ranks ?? undefined),
    seed: hashSeed(atk.movement.id, atk.movement.arriveAt),
  });
  const b = (await latestReport(bob)).battle;
  assert.equal(b?.defensePower, expected.defensePower);
  await app.close();
});

test('Keen decides the scout duel and the amount of intel (tiers)', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, bob, { pikeman: 33, pathfinder: 5 });
  giveTroops(app, alice, { pathfinder: 5 });

  // Equal numbers lose without Keen...
  assert.equal(resolveScouting({ scouts: 5, defenderScouts: 5 }).success, false);
  // ...and win with it.
  assert.equal(resolveScouting({ scouts: 5, defenderScouts: 5, scoutMultiplier: keenMultiplier(ranksOf(0, 0, 1)) }).success, true);

  giveKeen(app, alice, 1);
  const { movement } = await sendOk(alice, bob, 'scout', { pathfinder: 5 });
  clock.set(movement.arriveAt);
  const s = (await latestReport(alice)).scout;
  assert.ok(s?.success && s.intel, 'Keen 1 tips an equal duel');
  assert.equal(s.intel.keen, 1);
  assert.equal(s.intel.troopsApprox, true);
  assert.equal(s.intel.troops?.pikeman, 30, '33 shows as about 30');
  assert.equal(s.intel.wallLevel, null);
  assert.equal(s.intel.buildings, null);
  assert.equal(s.intel.ranks, null);
  await app.close();
});
