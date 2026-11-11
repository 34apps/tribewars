// Player statistics and achievements on the profile (GAME_DESIGN.md section 16).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAT_KEYS, type PlayerProfileDto, type ReportDto, type ReportListResponse, type SendResponse } from '@clanfire/engine';
import { battleOf, makeApp, ok, trainRaiders, weakestAbandoned } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { stateOf, village } from './warfare-helpers.ts';

const profile = async (viewer: { c: { get: (u: string) => Promise<{ statusCode: number; json: <T>() => T }> } }, id: number): Promise<PlayerProfileDto> => {
  const res = await viewer.c.get(`/api/players/${id}`);
  assert.equal(res.statusCode, 200);
  return res.json<PlayerProfileDto>();
};

test('fresh profile: every counter zero, every achievement locked', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'zero');
  const p = await profile(a, a.id);
  for (const k of STAT_KEYS) assert.equal(p.stats[k], 0, k);
  assert.ok(p.achievements.length >= 18);
  assert.ok(p.achievements.every((x) => x.tier === 0 && x.value === 0 && x.next !== null));
});

test('build, train, raid an abandoned village: counters follow the real events', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'tally');
  const vid = await trainRaiders(a.c, clock, 14); // hall, barracks, barracks, then 14 raiders
  let p = await profile(a, a.id);
  assert.equal(p.stats.buildingLevelsBuilt, 3);
  assert.equal(p.stats.troopsTrained, 14);

  const npc = await weakestAbandoned(a.c, 12);
  const sent = await a.c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: 14 }, mission: 'attack' });
  ok(sent, 201);
  const { movement } = sent.json<SendResponse>();
  // Before the troops arrive nothing is counted.
  assert.equal((await profile(a, a.id)).stats.attacksWon, 0);
  clock.set(movement.arriveAt);
  await stateOf(a); // resolves the arrival
  const summary = (await a.c.get('/api/reports')).json<ReportListResponse>().reports[0];
  assert.ok(summary);
  const b = battleOf((await a.c.get(`/api/reports/${summary.id}`)).json<ReportDto>());
  assert.equal(b.attackerWon, true);

  p = await profile(a, a.id);
  const s = p.stats;
  assert.equal(s.attacksWon, 1);
  assert.equal(s.attacksLost, 0);
  assert.equal(s.abandonedRaided, 1);
  assert.equal(s.lootWood, Math.floor(b.loot.wood));
  assert.equal(s.lootFood, Math.floor(b.loot.food));
  assert.equal(s.lootIron, Math.floor(b.loot.iron));
  assert.equal(s.lootGold, Math.floor(b.loot.gold));
  const killed = Object.values(b.defenderLosses ?? {}).reduce((x, y) => x + y, 0);
  assert.equal(s.troopsKilled, killed);
  assert.equal(s.troopsLost, Object.values(b.attackerLosses).reduce((x, y) => x + y, 0));
  assert.equal(s.defencesWon + s.defencesLost, 0, 'abandoned villages have no owner to credit');
  const fire = p.achievements.find((x) => x.id === 'fireStarter');
  assert.equal(fire?.value, 1);
  assert.equal(fire?.tier, 0);
});

test('shipments count at send; stats cannot be written through any endpoint', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'carter');
  const b = await newPlayer(app, 'receiver');
  const home = await village(a);
  const dest = await village(b);
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(a.id)[0];
  assert.ok(v);
  v.state.buildings.market = 1;
  v.state.resources = { wood: 500, food: 500, iron: 500, gold: 0 };
  store.saveVillage(v.id, v.state, v.points);
  // Unprotected both ways is not needed for shipments; household checks use different IPs (newPlayer).
  const res = await a.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources: { wood: 100, food: 50 } });
  ok(res, 201);
  const p = await profile(a, a.id);
  assert.equal(p.stats.shipmentsSent, 1);
  assert.equal(p.stats.resourcesShipped, 150);
  assert.equal((await profile(b, b.id)).stats.resourcesShipped, 0, 'the receiver is not credited');

  for (const method of ['post', 'put'] as const) {
    const w = await a.c.call(method.toUpperCase() as 'POST' | 'PUT', `/api/players/${a.id}`, { stats: { attacksWon: 999 } });
    assert.ok(w.statusCode >= 400, 'no write endpoint');
  }
  assert.equal((await profile(a, a.id)).stats.attacksWon, 0);
});
