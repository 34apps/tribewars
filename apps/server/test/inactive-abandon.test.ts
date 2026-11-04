// Inactive players' villages turn into abandoned villages that KEEP their buildings (docs/GAME_DESIGN.md 18.2, step 2).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NPC_TIER_WEIGHTS, abandonIdleMs, emptyUnits, fullGarrison, restartProtectionMs, type MapResponse } from '@clanfire/engine';
import { HOUR, MINUTE, makeApp } from './helpers.ts';
import { assertLedgerSane, ledger, player, reserveFor, strongHome, villagesOf } from './village-helpers.ts';

test('an idle owner\'s village becomes abandoned with every building kept; queues, old troops, contingents and the owner\'s marches are cleared', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const idle = await player(app, 'idle_one');
  const other = await player(app, 'other_one');
  const vid = strongHome(app, clock, idle, { raider: 30, chieftain: 2 });
  reserveFor(app, idle, 2, 500);
  const v = store.getVillage(vid)!;
  v.state.trainQueues.barracks = [{ unit: 'raider', count: 5, done: 0, perUnitMs: 1000, startAt: clock.now() }];
  v.state.away = { ...emptyUnits(), raider: 3 };
  store.saveVillage(vid, v.state, v.points);
  const buildings = structuredClone(v.state.buildings);
  const otherVillage = villagesOf(app, other)[0]!;
  store.insertMovement({ kind: 'attack', originVillageId: vid, targetVillageId: otherVillage.id, units: { ...emptyUnits(), raider: 3 }, loot: null, departAt: clock.now(), arriveAt: clock.now() + 100 * HOUR });
  store.addStationed(idle.id, vid, otherVillage.id, { ...emptyUnits(), pikeman: 2 }, clock.now());

  clock.advance(abandonIdleMs(app.ctx.settings) - HOUR);
  await other.c.state(); // the other player keeps showing up
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());

  const after = store.getVillage(vid)!;
  assert.equal(after.ownerId, null);
  assert.deepEqual(after.state.buildings, buildings, 'every building kept');
  assert.deepEqual(after.state.troops, fullGarrison(after.state.buildings.hall), 'the garrison of an abandoned village of that size');
  assert.deepEqual(after.state.trainQueues, { barracks: [], stables: [], bannerhall: [] });
  assert.deepEqual(after.state.buildQueue, []);
  assert.deepEqual(after.state.away, emptyUnits());
  assert.equal(after.state.npc?.tier, Math.min(NPC_TIER_WEIGHTS.length, Math.max(1, after.state.buildings.hall)));
  assert.equal(after.state.hearth, undefined);
  assert.equal(store.movementsFrom(vid).length, 0, 'the owner\'s march is gone');
  assert.equal(store.stationedHomedAt(vid).length, 0, 'the owner\'s contingent elsewhere is gone');
  assert.equal(store.getVillage(otherVillage.id)?.ownerId, other.id, 'the active player keeps their village');

  // The two Chieftains left the ledger like dead ones: their reservation ended and half of it came back.
  const l = ledger(app, idle);
  assert.equal(l.reserved, 0);
  assert.equal(l.spent, 500);
  assertLedgerSane(app, idle);

  // It is now a valuable target on the map: an abandoned village with the points of its buildings.
  const res = await other.c.get(`/api/map?x=${after.x}&y=${after.y}&w=1&h=1`);
  const tile = res.json<MapResponse>().villages[0];
  assert.equal(tile?.kind, 'abandoned');
  assert.ok((tile?.points ?? 0) > 1000, `points of a kept, fully built village: ${tile?.points}`);

  // The returning owner gets a fresh village with a short restart protection, and the notice about what happened.
  const st = await idle.c.state();
  assert.equal(st.villages.length, 1);
  assert.notEqual(st.villages[0]?.id, vid);
  assert.equal(st.player.protectedUntil, clock.now() + restartProtectionMs(app.ctx.settings));
  assert.equal(st.player.abandonedNotice?.villages, 1);
  await app.close();
});

test('owners still under beginner protection and sandbox accounts are never abandoned; active owners neither', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['tester'] });
  const store = app.ctx.store;
  const newbie = await player(app, 'newbie');
  const tester = await player(app, 'tester');
  const active = await player(app, 'active_one');
  const gone = await player(app, 'gone_one');
  store.setProtectedUntil(newbie.id, clock.now() + 1000 * HOUR); // beginner protection that outlasts the idle time

  const ms = abandonIdleMs(app.ctx.settings);
  clock.advance(ms - HOUR);
  await active.c.state();
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(villagesOf(app, newbie).length, 1, 'protected: kept');
  assert.equal(villagesOf(app, tester).length, 1, 'sandbox account: kept');
  assert.equal(villagesOf(app, active).length, 1, 'active: kept');
  assert.equal(villagesOf(app, gone).length, 0, 'idle and unprotected: abandoned');

  // Once the protection is over the idle newbie follows.
  store.setProtectedUntil(newbie.id, 0);
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(villagesOf(app, newbie).length, 0);
  assert.equal(villagesOf(app, tester).length, 1);
  await app.close();
});

test('every village of an idle owner is abandoned in one pass', async () => {
  const { app, clock } = await makeApp();
  const store = app.ctx.store;
  const idle = await player(app, 'idle_two');
  const second = store.insertVillage(idle.id, 'Second', 500, 500, 0, store.getVillage(villagesOf(app, idle)[0]!.id)!.state);
  const other = await player(app, 'keeper');
  clock.advance(abandonIdleMs(app.ctx.settings) + MINUTE);
  await other.c.state();
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(store.getVillage(second)?.ownerId, null);
  assert.equal(villagesOf(app, idle).length, 0);
  assert.equal(villagesOf(app, other).length, 1);
  await app.close();
});
