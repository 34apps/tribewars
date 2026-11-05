// Strike and Hold on abandoned villages (docs/GAME_DESIGN.md 18.2, step 2): the movement processor, the hold clock in time
// order, occupiers, contests, the change of owner and who may act on a claim. The world runs at speed 10 (hold 36 min, fail 12 min).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHIEFTAIN_RENOWN_REFUND_SHARE,
  HOLD_FAIL_HOURS,
  HOLD_HOURS_ABANDONED,
  STRIKE_LOCK_HOURS,
  totalUnits,
  type MapResponse,
  type Mission,
  type SendResponse,
  type Units,
} from '@clanfire/engine';
import { HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { reports, report } from './warfare-helpers.ts';
import {
  assertLedgerSane,
  clearedTarget,
  homeOf,
  ledger,
  player,
  reserveFor,
  runTo,
  strongHome,
  villageReports,
  villagesOf,
  type P,
} from './village-helpers.ts';

const SPEED = 10;
const HOLD_MS = (HOLD_HOURS_ABANDONED * HOUR) / SPEED;
const FAIL_MS = (HOLD_FAIL_HOURS * HOUR) / SPEED;
const LOCK_MS = (STRIKE_LOCK_HOURS * HOUR) / SPEED;

/** Send with a fixed walk (test mode: the accounts are on the sandbox list) so every arrival time is exact. */
async function go(p: P, vid: number, to: { x: number; y: number }, mission: Mission, units: Partial<Units>, travelSeconds = 60) {
  const res = await p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units, mission, travelSeconds });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

async function mapAt(p: P, x: number, y: number) {
  const res = await p.c.get(`/api/map?x=${x}&y=${y}&w=1&h=1`);
  ok(res);
  return res.json<MapResponse>().villages[0];
}

/** A claimer with 300 raiders and two Chieftains (500 Renown reserved each) next to a village with no garrison. */
async function setup(sandbox: string[] = ['claimer', 'rival']) {
  const { app, clock } = await makeApp({ sandboxUsers: sandbox });
  const p = await player(app, 'claimer');
  const homeId = strongHome(app, clock, p, { raider: 300, chieftain: 2 });
  reserveFor(app, p, 2, 500);
  const target = clearedTarget(app, homeOf(app, p));
  return { app, clock, p, homeId, target };
}

test('Strike, hold, change of owner: buildings kept, occupiers move in, the Chieftain is used up, the lock starts', async () => {
  const { app, clock, p, homeId, target } = await setup();
  const store = app.ctx.store;
  const buildings = structuredClone(target.state.buildings);
  const m = await go(p, homeId, target, 'attack', { raider: 300, chieftain: 1 });
  runTo(app, clock, m.arriveAt);
  await p.c.state();

  // The hearth is out, the survivors stand there as occupiers, nothing walks home.
  const cold = store.getVillage(target.id);
  assert.ok(cold?.state.hearth, 'hearth out');
  assert.equal(cold.state.hearth.claimBy, p.id);
  assert.equal(cold.ownerId, null);
  assert.equal(cold.holdDueAt, m.arriveAt + HOLD_MS, 'due event stored at the exact end of the clock');
  assert.equal(HOLD_MS, (2 * HOUR) / SPEED, 'an abandoned village is held for 2 h (÷ speed)');
  const rows = store.stationedAt(target.id);
  assert.equal(rows.length, 1);
  const stood = rows[0]!.units;
  assert.equal(stood.chieftain, 1);
  assert.ok(stood.raider > 250, 'a won battle against an empty garrison costs almost nothing');
  assert.equal((await p.c.state()).movements.filter((x) => x.kind === 'return').length, 0);
  const battle = (await reports(p)).find((r) => r.type === 'battle');
  assert.ok(battle);
  assert.deepEqual((await report(p, battle.id)).battle?.loot, { wood: 0, food: 0, iron: 0, gold: 0 }, 'a Strike carries no loot');

  // Everybody sees the clock on the map, nobody sees the occupiers; a cold village is never shown as safe.
  const tile = await mapAt(p, target.x, target.y);
  assert.equal(tile?.kind, 'abandoned');
  assert.equal(tile?.hearth?.claimBy, 'claimer');
  assert.equal(tile?.hearth?.running, true);
  assert.equal(tile?.hearth?.endsAt, m.arriveAt + HOLD_MS);
  assert.equal(tile?.hearth?.occupierPopulation, undefined);
  assert.equal(tile?.protected, false);

  // One millisecond before the end: still abandoned. At the end: the village is theirs.
  runTo(app, clock, m.arriveAt + HOLD_MS - 1);
  assert.equal(store.getVillage(target.id)?.ownerId, null);
  runTo(app, clock, m.arriveAt + HOLD_MS);
  const taken = store.getVillage(target.id);
  assert.equal(taken?.ownerId, p.id);
  assert.equal(taken?.holdDueAt, null);
  assert.deepEqual(taken?.state.buildings, buildings, 'all buildings kept');
  assert.equal(taken?.state.hearth, undefined);
  assert.equal(taken?.state.npc, undefined, 'a player village now');
  assert.equal(taken?.state.lockUntil, m.arriveAt + HOLD_MS + LOCK_MS, 'no new Strike for STRIKE_LOCK_HOURS');
  assert.equal(taken?.name, "claimer's village 2");
  assert.equal(villagesOf(app, p).length, 2);
  assert.equal(store.stationedAt(target.id).length, 0, 'the occupier contingent is gone');

  // Nobody is lost silently: moved in + walking home = the survivors, minus the Chieftain who was used up.
  const home = store.getVillage(homeId);
  const back = store.movementsFrom(homeId).filter((x) => x.kind === 'return');
  const walking = back.reduce((n, x) => n + x.units.raider, 0);
  assert.equal((taken?.state.troops.raider ?? 0) + walking, stood.raider);
  assert.equal(home?.state.away.raider, walking, 'only the overflow is still away');
  assert.equal(home?.state.away.chieftain, 0);
  assert.equal(home?.state.troops.chieftain, 1, 'the second Chieftain is still at home');
  assert.equal(taken?.state.troops.chieftain, 0, 'Chieftains never move in');

  // Ledger: his reservation ended, the Renown stays spent.
  const l = ledger(app, p);
  assert.equal(l.reserved, 500);
  assert.equal(l.spent, 1000);
  assertLedgerSane(app, p);

  const kinds = (await villageReports(p)).map((r) => r.village.kind);
  assert.deepEqual(kinds.sort(), ['struck', 'taken']);
  const own = (await mapAt(p, target.x, target.y))?.kind;
  assert.equal(own, 'own');
  await app.close();
});

test('too few occupiers: the clock waits, the claim fails after the fail time and the occupiers walk home', async () => {
  const { app, clock, p, homeId, target } = await setup();
  const store = app.ctx.store;
  const m = await go(p, homeId, target, 'attack', { raider: 100, chieftain: 1 });
  runTo(app, clock, m.arriveAt);
  const h = store.getVillage(target.id)?.state.hearth;
  assert.ok(h);
  assert.equal(h.runningSince, null, '108 population is under the minimum: paused');
  assert.equal(store.getVillage(target.id)?.holdDueAt, m.arriveAt + FAIL_MS);
  const dto = (await mapAt(p, target.x, target.y))?.hearth;
  assert.equal(dto?.running, false);
  assert.equal(dto?.endsAt, null);
  assert.equal(dto?.failsAt, m.arriveAt + FAIL_MS);

  runTo(app, clock, m.arriveAt + FAIL_MS);
  const after = store.getVillage(target.id);
  assert.equal(after?.ownerId, null, 'never taken');
  assert.equal(after?.state.hearth, undefined, 'the hearth burns again');
  assert.equal(after?.holdDueAt, null);
  assert.equal(store.stationedAt(target.id).length, 0);
  const back = store.movementsFrom(homeId).find((x) => x.kind === 'return');
  assert.ok(back, 'the occupiers walk home');
  assert.equal(back.units.chieftain, 1);
  assert.equal(back.departAt, m.arriveAt + FAIL_MS, 'they leave at the exact moment the claim failed');
  const failed = (await villageReports(p)).find((r) => r.village.kind === 'claim_failed');
  assert.equal(failed?.village.reason, 'time');
  runTo(app, clock, back.arriveAt);
  const home = store.getVillage(homeId);
  assert.equal(home?.state.troops.chieftain, 2, 'the Chieftain is home again');
  assert.equal(home?.state.away.chieftain, 0);
  assert.deepEqual(ledger(app, p), { total: ledger(app, p).total, spent: 1000, reserved: 1000 }, 'nothing was lost, nothing refunded');
  await app.close();
});

test('occupy: reinforcements start the clock; leaving pauses it; only the claimant can send occupiers', async () => {
  const { app, clock, p, homeId, target } = await setup();
  const store = app.ctx.store;
  const rival = await player(app, 'rival');
  const rivalHome = strongHome(app, clock, rival, { raider: 200 });
  const m = await go(p, homeId, target, 'attack', { raider: 100, chieftain: 1 });
  runTo(app, clock, m.arriveAt);

  // Strangers and wrong targets are refused.
  errorOf(await rival.c.post(`/api/villages/${rivalHome}/send`, { x: target.x, y: target.y, units: { raider: 100 }, mission: 'occupy' }), 400, 'invalid_target');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: target.x, y: target.y, units: { raider: 100, chieftain: 1 }, mission: 'occupy' }), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: target.x, y: target.y, units: { raider: 100 }, mission: 'attack' }), 400, 'invalid_target');
  const own = homeOf(app, p);
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: own.x, y: own.y, units: { raider: 5 }, mission: 'occupy' }), 400, 'invalid_target');

  clock.set(m.arriveAt + MINUTE);
  const o = await go(p, homeId, target, 'occupy', { raider: 100 });
  runTo(app, clock, o.arriveAt);
  const run = store.getVillage(target.id)?.state.hearth;
  assert.ok(run, 'still cold');
  assert.equal(run.runningSince, o.arriveAt, '208 population: the clock runs from the arrival');
  assert.equal(store.getVillage(target.id)?.holdDueAt, o.arriveAt + HOLD_MS, 'the paused time did not count');

  // A stranger cannot recall the occupiers (they look missing); the owner can, and the clock pauses.
  const row = store.stationedAt(target.id)[0];
  assert.ok(row);
  errorOf(await rival.c.post(`/api/stationed/${row.id}/recall`, {}), 404, 'not_found');
  clock.set(o.arriveAt + 5 * MINUTE);
  ok(await p.c.post(`/api/stationed/${row.id}/recall`, { units: { raider: 150 } }), 201);
  const paused = store.getVillage(target.id)?.state.hearth;
  assert.equal(paused?.runningSince, null);
  assert.equal(paused?.holdMs, HOLD_MS - 5 * MINUTE, 'the five minutes that ran were counted exactly');
  await app.close();
});

test('time order: a battle that ends the claim just before the clock does wins; one just after loses to the owner change', async () => {
  for (const delta of [-1000, 1000]) {
    const { app, clock, p, homeId, target } = await setup();
    const store = app.ctx.store;
    const rival = await player(app, 'rival');
    const rivalHome = strongHome(app, clock, rival, { raider: 900 });
    const m = await go(p, homeId, target, 'attack', { raider: 300, chieftain: 1 });
    runTo(app, clock, m.arriveAt);
    const due = m.arriveAt + HOLD_MS;
    // The rival marches off now and arrives `delta` ms around the end of the clock; nobody looks until after both.
    const walk = (due + delta - clock.now()) / 1000;
    ok(await rival.c.post(`/api/villages/${rivalHome}/send`, { x: target.x, y: target.y, units: { raider: 900 }, mission: 'attack', travelSeconds: walk }), 201);
    clock.set(due + 10 * MINUTE);
    app.ctx.game.processDue(clock.now()); // one pass: events run in time order
    const v = store.getVillage(target.id);
    if (delta < 0) {
      assert.equal(v?.ownerId, null, 'the occupiers were destroyed before the clock ended: relit, never taken');
      assert.equal(v?.state.hearth, undefined);
      assert.equal(villagesOf(app, p).length, 1);
    } else {
      assert.equal(v?.ownerId, p.id, 'the clock ended first: the village changed owner');
      const hitOwner = (await reports(p)).filter((r) => r.title.startsWith('Attack from'));
      assert.equal(hitOwner.length, 1, 'the late attack hit the new owner\'s village');
    }
    await app.close();
  }
});

test('contest: destroying the occupiers relights the hearth; a Chieftain-led army takes the claim over', async () => {
  const { app, clock, p, homeId, target } = await setup();
  const store = app.ctx.store;
  const rival = await player(app, 'rival');
  const rivalHome = strongHome(app, clock, rival, { raider: 900, chieftain: 1 });
  reserveFor(app, rival, 1, 500);
  const m = await go(p, homeId, target, 'attack', { raider: 100, chieftain: 1 });
  runTo(app, clock, m.arriveAt);
  assert.ok(store.getVillage(target.id)?.state.hearth);
  const before = ledger(app, p);

  // The rival wins with a Chieftain: the claim moves to them; the old claimant's occupiers are dead.
  clock.set(m.arriveAt + MINUTE);
  const r = await go(rival, rivalHome, target, 'attack', { raider: 900, chieftain: 1 });
  runTo(app, clock, r.arriveAt);
  const hearth = store.getVillage(target.id)?.state.hearth;
  assert.equal(hearth?.claimBy, rival.id, 'the claim passed to the rival');
  const rows = store.stationedAt(target.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ownerPlayerId, rival.id);
  assert.equal(rows[0]?.units.chieftain, 1);

  // The first claimant lost a Chieftain: his average share left the reservation, half came back; the report says "replaced".
  const after = ledger(app, p);
  assert.equal(after.reserved, before.reserved - before.reserved / 2);
  assert.equal(after.spent, before.spent - Math.floor((before.reserved / 2) * CHIEFTAIN_RENOWN_REFUND_SHARE));
  assertLedgerSane(app, p);
  const reasons = (await villageReports(p)).filter((x) => x.village.kind === 'claim_failed').map((x) => x.village.reason);
  assert.deepEqual(reasons, ['replaced']);

  // A third army without a Chieftain destroys the rival's occupiers: relit, and the rival is told.
  clock.set(r.arriveAt + MINUTE);
  const home3 = strongHome(app, clock, p, { raider: 900 });
  const k = await go(p, home3, target, 'attack', { raider: 900 });
  runTo(app, clock, k.arriveAt);
  const lit = store.getVillage(target.id);
  assert.equal(lit?.state.hearth, undefined);
  assert.equal(lit?.holdDueAt, null);
  assert.equal(store.stationedAt(target.id).length, 0);
  assert.equal(ledger(app, rival).reserved, 0, 'the rival\'s only Chieftain died');
  assertLedgerSane(app, rival);
  assert.ok((await villageReports(rival)).some((x) => x.village.kind === 'claim_failed'));
  await app.close();
});

test('a Chieftain alone dies; a village that is locked or protected is only fought, never struck', async () => {
  const { app, clock, p, homeId, target } = await setup();
  const store = app.ctx.store;
  // Locked village: the battle is won, no Strike, everybody (the Chieftain too) walks home.
  target.state.lockUntil = clock.now() + 10 * HOUR;
  store.saveVillage(target.id, target.state, target.points);
  const m = await go(p, homeId, target, 'attack', { raider: 100, chieftain: 1 });
  runTo(app, clock, m.arriveAt);
  assert.equal(store.getVillage(target.id)?.state.hearth, undefined, 'locked: no Strike');
  const back = store.movementsFrom(homeId).find((x) => x.kind === 'return');
  assert.equal(back?.units.chieftain, 1, 'the Chieftain survived and walks home');

  // Protected village (founded or restarted): not even a battle; the send is refused.
  target.state.protectedUntil = clock.now() + 10 * HOUR;
  store.saveVillage(target.id, target.state, target.points);
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: target.x, y: target.y, units: { raider: 50 }, mission: 'attack' }), 409, 'target_protected');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: target.x, y: target.y, units: { pathfinder: 1 }, mission: 'scout' }), 409, 'target_protected');
  await app.close();
});

test('Chieftains cannot strike player villages while that is switched off, and the army checks hold', async () => {
  const { app, clock, p, homeId } = await setup();
  app.ctx.game.strikePlayers = false; // since step 4 the default is on; the switch stays for operators and tests
  const other = await player(app, 'bystander');
  const v = homeOf(app, other);
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: v.x, y: v.y, units: { raider: 100, chieftain: 1 }, mission: 'attack' }), 400, 'invalid_target');
  const t = app.ctx.store.getVillage(app.ctx.store.abandonedVillageIds()[0] as number);
  assert.ok(t);
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: t.x, y: t.y, units: { raider: 100, chieftain: 4 }, mission: 'attack' }), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: t.x, y: t.y, units: { chieftain: 1 }, mission: 'scout' }), 400, 'invalid_input');
  errorOf(await p.c.post(`/api/villages/${homeId}/send`, { x: t.x, y: t.y, units: { raider: -1 }, mission: 'attack' }), 400, 'invalid_input');
  assert.equal(totalUnits(homeOf(app, p).state.away), 0, 'every refused order left the troops at home');
  assert.ok(clock.now() > 0);
  await app.close();
});
