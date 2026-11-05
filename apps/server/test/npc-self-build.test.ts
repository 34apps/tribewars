// Owner rule 2026-11-05: abandoned villages build themselves up like a player, from their OWN resources (docs/GAME_DESIGN.md section 8).
// The rules have engine tests (packages/engine/test/village.test.ts); these tests are about the server wiring: a stored village is settled
// lazily on read, a village raided empty stays small, and a state saved by the old growth timer keeps working.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fullGarrison, settleVillage, totalUnits, villagePoints, type VillageState } from '@clanfire/engine';
import { HOUR, makeApp, register } from './helpers.ts';
import type { App } from './village-helpers.ts';

const SELF_BUILD = { npc: { selfBuild: true } };
const levels = (v: VillageState): number => Object.values(v.buildings).reduce((a, b) => a + b, 0);

/** The first two abandoned villages of the same tier (so they have the same start levels and stock). */
function twinNpcs(app: App): [number, number] {
  const store = app.ctx.store;
  const byTier = new Map<number, number[]>();
  for (const id of store.abandonedVillageIds()) {
    const tier = store.getVillage(id)!.state.npc!.tier;
    byTier.set(tier, [...(byTier.get(tier) ?? []), id]);
  }
  const pair = [...byTier.values()].find((ids) => ids.length >= 2);
  assert.ok(pair, 'the test world has two abandoned villages of one tier');
  return [pair[0]!, pair[1]!];
}

const settled = (app: App, id: number, t: number): VillageState => settleVillage(app.ctx.store.getVillage(id)!.state, t, app.ctx.settings);

test('an abandoned village spends its own stock on building levels; one that was raided empty cannot, and stays smaller', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  const [rich, raided] = twinNpcs(app);
  const store = app.ctx.store;
  const poor = store.getVillage(raided)!;
  poor.state.resources = { wood: 0, food: 0, iron: 0, gold: 0 }; // what a raid that took everything leaves behind
  store.saveVillage(raided, poor.state, poor.points);

  const start = store.getVillage(rich)!.state;
  const t = clock.t + HOUR / 2; // speed 10 in the test world: 30 minutes is 5 world hours
  const a = settled(app, rich, t);
  const b = settled(app, raided, t);
  assert.ok(levels(a) + a.buildQueue.length >= levels(start) + 2, 'the unraided village built several levels');
  assert.ok(levels(b) + b.buildQueue.length < levels(a) + a.buildQueue.length, 'the raided one built less');
  for (const v of [a, b]) for (const x of Object.values(v.resources)) assert.ok(x >= 0, 'never spends more than it has');
  await app.close();
});

test('the stored village is settled on read and the new levels are real: points rise, troops and queues stay untouched', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  const [id] = twinNpcs(app);
  const before = app.ctx.store.getVillage(id)!;
  clock.advance(60 * HOUR);
  const later = settled(app, id, clock.t);
  assert.ok(villagePoints(later) > villagePoints(before.state), 'more points after a long wait');
  assert.deepEqual(later.troops, before.state.troops, 'the garrison is exactly as created');
  assert.equal(totalUnits(later.troops), totalUnits(fullGarrison(before.state.buildings.hall)));
  assert.deepEqual(later.trainQueues, { barracks: [], stables: [], bannerhall: [] });
  await app.close();
});

test('a village saved by the old growth timer (growthSteps, createdAt, no build queue) keeps working and carries on building', async () => {
  const { app, clock } = await makeApp({ worldConfig: SELF_BUILD });
  await register(app, 'watcher');
  const [id] = twinNpcs(app);
  const store = app.ctx.store;
  const rec = store.getVillage(id)!;
  // The shape the timer era stored: an npc block with growthSteps and createdAt only, an empty build queue.
  rec.state.npc = { tier: rec.state.npc!.tier, growthSteps: 9, createdAt: clock.t - 20 * 24 * HOUR };
  rec.state.buildQueue = [];
  store.saveVillage(id, rec.state, rec.points);
  // Round trip through the database like any request does.
  const back = store.getVillage(id)!.state;
  assert.equal(back.npc?.growthSteps, 9);
  const later = settled(app, id, clock.t + 40 * HOUR);
  assert.ok(levels(later) + later.buildQueue.length > levels(back), 'it builds');
  assert.ok((later.npc?.growthSteps ?? 0) > 9, 'from its old pointer on');
  await app.close();
});

test('a world with self-building off (npc.selfBuild false) keeps its abandoned villages as created', async () => {
  const { app, clock } = await makeApp();
  await register(app, 'watcher');
  const [id] = twinNpcs(app);
  const before = app.ctx.store.getVillage(id)!.state;
  const later = settled(app, id, clock.t + 100 * HOUR);
  assert.deepEqual(later.buildings, before.buildings);
  await app.close();
});
