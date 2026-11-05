// Taking PLAYER villages (docs/GAME_DESIGN.md 18.2, step 4): no pair cap (2026-11-05), breaking a hold (relief attacks by the owner, a
// tribe-mate or an ally), alerts and live hints for the owner's tribe, build and train blocked in a cold village, and who may
// act on a claim. The world runs at speed 10 (hold 72 min). Custom walking times need sandbox accounts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOLD_HOURS,
  createPlayerVillage,
  villagePoints,
  type Mission,
  type SendResponse,
  type TribeAlertsResponse,
  type Units,
} from '@clanfire/engine';
import type { LiveEvent } from '../src/live-events.ts';
import { HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { addMember, formPact, newLeader, newPlayer } from './tribe-helpers.ts';
import { unprotect } from './warfare-helpers.ts';
import { homeOf, ledger, player, reserveFor, runTo, strongHome, villageReports, villagesOf, type App, type P } from './village-helpers.ts';

const SPEED = 10;
const HOLD_MS = (HOLD_HOURS * HOUR) / SPEED;

async function go(p: P, vid: number, to: { x: number; y: number }, mission: Mission, units: Partial<Units>, travelSeconds = 60) {
  const res = await p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units, mission, travelSeconds });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

/** A second (third, ...) village of `p` far away from everything, as a fresh starting village. */
function extraVillage(app: App, p: P, nowMs: number, slot: number) {
  const state = createPlayerVillage(nowMs);
  const id = app.ctx.store.insertVillage(p.id, `Extra ${slot}`, 15 + slot * 2, 15, villagePoints(state), state);
  return app.ctx.store.getVillage(id)!;
}

test('no pair cap: three villages are taken from the same victim in a row, three holds at once', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const store = app.ctx.store;
  assert.equal(HOLD_MS, (8 * HOUR) / SPEED, 'a player village is held for 8 h (÷ speed)');
  const claimer = await player(app, 'claimer');
  const victim = await player(app, 'victim');
  const home = strongHome(app, clock, claimer, { raider: 1200, chieftain: 3 });
  reserveFor(app, claimer, 3, 500);
  const a = homeOf(app, victim);
  const b = extraVillage(app, victim, clock.now(), 1);
  const c = extraVillage(app, victim, clock.now(), 2);

  // Three Strikes land one after the other (nothing has been taken yet, so every send and every Strike is allowed).
  const m1 = await go(claimer, home, a, 'attack', { raider: 300, chieftain: 1 }, 60);
  const m2 = await go(claimer, home, b, 'attack', { raider: 300, chieftain: 1 }, 61);
  const m3 = await go(claimer, home, c, 'attack', { raider: 300, chieftain: 1 }, 62);
  runTo(app, clock, m3.arriveAt);
  for (const v of [a, b, c]) assert.ok(store.getVillage(v.id)?.state.hearth, 'every hearth is out');

  // The clocks end in order: all three villages are taken, there is no limit per victim any more.
  runTo(app, clock, m3.arriveAt + HOLD_MS + MINUTE);
  for (const v of [a, b, c]) assert.equal(store.getVillage(v.id)?.ownerId, claimer.id, 'taken');
  assert.deepEqual((await villageReports(claimer)).filter((r) => r.village.kind === 'claim_failed'), []);
  // The victim lost their last village; a fresh one is made at their next request (rule from step 2).
  await victim.c.state();
  const left = store.villagesOfPlayer(victim.id);
  assert.equal(left.length, 1);
  assert.ok(![a.id, b.id, c.id].includes(left[0]!.id));
  await app.close();
});

test('the owner, a tribe-mate and an ally break the hold by beating the occupiers; the hearth relights at once', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer', 'alice', 'amy', 'bob'] });
  const store = app.ctx.store;
  const claimer = await player(app, 'claimer');
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  unprotect(app, alice, amy, bob);
  await formPact(alice, 'BRAVO', bob, 'ally');
  const claimHome = strongHome(app, clock, claimer, { raider: 500, chieftain: 2 });
  reserveFor(app, claimer, 2, 500);
  const aliceHome = strongHome(app, clock, alice, { raider: 2000 });
  const bobHome = strongHome(app, clock, bob, { raider: 2000 });
  const amyVillage = homeOf(app, amy);
  const amySecond = extraVillage(app, amy, clock.now(), 3);
  strongHome(app, clock, amy, { raider: 2000 }, 1);

  // Strike 1: the owner (from her second village) beats the occupiers.
  const s1 = await go(claimer, claimHome, amyVillage, 'attack', { raider: 250, chieftain: 1 });
  runTo(app, clock, s1.arriveAt);
  assert.equal(store.getVillage(amyVillage.id)?.state.hearth?.claimBy, claimer.id);
  // While it is cold: only the Wall can be built, no training; the caretaker skips it.
  errorOf(await amy.c.post(`/api/villages/${amyVillage.id}/build`, { building: 'lumber' }), 409, 'requirements_not_met');
  errorOf(await amy.c.post(`/api/villages/${amyVillage.id}/train`, { unit: 'pikeman', count: 1 }), 409, 'requirements_not_met');
  const before = ledger(app, claimer);
  const r1 = await go(amy, amySecond.id, amyVillage, 'attack', { raider: 1500 });
  runTo(app, clock, r1.arriveAt);
  assert.equal(store.getVillage(amyVillage.id)?.state.hearth, undefined, 'the owner relit her own hearth');
  assert.equal(store.getVillage(amyVillage.id)?.ownerId, amy.id);
  assert.equal(store.stationedAt(amyVillage.id).length, 0, 'the occupiers are dead');
  assert.equal(store.getVillage(amyVillage.id)?.holdDueAt, null);
  assert.ok(ledger(app, claimer).reserved < before.reserved, 'the dead Chieftain left the reservation');
  assert.ok(store.movementsFrom(amySecond.id).some((m) => m.kind === 'return'), 'the relief army walks home');
  assert.ok((await villageReports(claimer)).some((r) => r.village.kind === 'claim_failed' && r.village.reason === 'relit'));
  assert.ok((await villageReports(amy)).some((r) => r.village.kind === 'relit'));

  // Strike 2: a tribe-mate beats the occupiers.
  clock.set(r1.arriveAt + MINUTE);
  const s2 = await go(claimer, claimHome, amyVillage, 'attack', { raider: 250, chieftain: 1 });
  runTo(app, clock, s2.arriveAt);
  assert.ok(store.getVillage(amyVillage.id)?.state.hearth);
  const r2 = await go(alice, aliceHome, amyVillage, 'attack', { raider: 1500 });
  runTo(app, clock, r2.arriveAt);
  assert.equal(store.getVillage(amyVillage.id)?.state.hearth, undefined, 'a tribe-mate relit it');

  // The relief army left no loot and did not touch the village's own stock or buildings.
  assert.equal(store.getVillage(amyVillage.id)?.state.buildings.wall, villagesOf(app, amy)[0]?.state.buildings.wall);

  // Strike 3 on a village of the ally's tribe? The ally BRAVO may relieve a member of ALPHA too (allies stand together).
  clock.set(r2.arriveAt + MINUTE);
  // The claimer has no Chieftain left: put one back.
  const home = store.getVillage(claimHome)!;
  home.state.troops.chieftain = 1;
  home.state.troops.raider = 500;
  store.saveVillage(home.id, home.state, home.points);
  reserveFor(app, claimer, 1, 500);
  const s3 = await go(claimer, claimHome, amyVillage, 'attack', { raider: 250, chieftain: 1 });
  runTo(app, clock, s3.arriveAt);
  assert.ok(store.getVillage(amyVillage.id)?.state.hearth);
  const r3 = await go(bob, bobHome, amyVillage, 'attack', { raider: 1500 });
  runTo(app, clock, r3.arriveAt);
  assert.equal(store.getVillage(amyVillage.id)?.state.hearth, undefined, 'an ally relit it');
  await app.close();
});

test('relief attacks have limits: weak ones only wear the occupiers down, Chieftains and siege are refused, lit villages stay protected', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer', 'alice', 'amy'] });
  const store = app.ctx.store;
  const claimer = await player(app, 'claimer');
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  unprotect(app, alice, amy);
  const claimHome = strongHome(app, clock, claimer, { raider: 500, chieftain: 1 });
  reserveFor(app, claimer, 1, 500);
  const aliceHome = strongHome(app, clock, alice, { raider: 40, chieftain: 1, logram: 2 });
  const amyVillage = homeOf(app, amy);

  // Lit village: a tribe-mate and the owner still cannot attack it.
  errorOf(await alice.c.post(`/api/villages/${aliceHome}/send`, { x: amyVillage.x, y: amyVillage.y, units: { raider: 10 }, mission: 'attack' }), 400, 'invalid_target');
  const amySecond = extraVillage(app, amy, clock.now(), 4);
  errorOf(await amy.c.post(`/api/villages/${amySecond.id}/send`, { x: amyVillage.x, y: amyVillage.y, units: { raider: 10 }, mission: 'attack' }), 400, 'invalid_target');

  const s = await go(claimer, claimHome, amyVillage, 'attack', { raider: 300, chieftain: 1 });
  runTo(app, clock, s.arriveAt);
  assert.ok(store.getVillage(amyVillage.id)?.state.hearth);

  // Chieftains and siege units are refused on a relief; a Chieftain cannot "re-strike" for the owner's side.
  errorOf(await alice.c.post(`/api/villages/${aliceHome}/send`, { x: amyVillage.x, y: amyVillage.y, units: { raider: 10, chieftain: 1 }, mission: 'attack' }), 400, 'invalid_target');
  errorOf(await alice.c.post(`/api/villages/${aliceHome}/send`, { x: amyVillage.x, y: amyVillage.y, units: { raider: 10, logram: 1 }, mission: 'attack' }), 400, 'invalid_target');
  // The claimer cannot attack the village they hold (they send occupiers).
  errorOf(await claimer.c.post(`/api/villages/${claimHome}/send`, { x: amyVillage.x, y: amyVillage.y, units: { raider: 10 }, mission: 'attack' }), 400, 'invalid_target');

  // A weak relief loses, the occupiers lose a little, the clock keeps going, nobody was looted, protection is not ended.
  const protectedBefore = store.getPlayer(alice.id)?.protectedUntil;
  const occupiersBefore = store.stationedAt(amyVillage.id)[0]!.units.raider;
  const r = await go(alice, aliceHome, amyVillage, 'attack', { raider: 40 });
  runTo(app, clock, r.arriveAt);
  assert.ok(store.getVillage(amyVillage.id)?.state.hearth, 'the hold goes on');
  assert.ok(store.stationedAt(amyVillage.id)[0]!.units.raider <= occupiersBefore);
  assert.equal(store.getPlayer(alice.id)?.protectedUntil, protectedBefore);
  assert.equal(store.getVillage(amyVillage.id)?.ownerId, amy.id);
  await app.close();
});

test('beginner and restart protection stop a Strike; a stranger cannot act on your Chieftain or your claim', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const store = app.ctx.store;
  const claimer = await player(app, 'claimer');
  const newbie = await newPlayer(app, 'newbie'); // still under beginner protection
  const home = strongHome(app, clock, claimer, { raider: 300, chieftain: 1 });
  reserveFor(app, claimer, 1, 500);
  const nv = homeOf(app, newbie);
  errorOf(await claimer.c.post(`/api/villages/${home}/send`, { x: nv.x, y: nv.y, units: { raider: 300, chieftain: 1 }, mission: 'attack' }), 409, 'target_protected');

  // A real claim on a free player, then a stranger tries to act on it.
  const victim = await player(app, 'victim');
  const target = homeOf(app, victim);
  const stranger = await player(app, 'stranger');
  const m = await go(claimer, home, target, 'attack', { raider: 300, chieftain: 1 });
  errorOf(await stranger.c.post(`/api/movements/${m.id}/cancel`), 404, 'not_found'); // the march (and the Chieftain in it) is not theirs
  runTo(app, clock, m.arriveAt);
  const row = store.stationedAt(target.id)[0];
  assert.ok(row, 'the occupiers stand there');
  const sHome = strongHome(app, clock, stranger, { raider: 400 });
  errorOf(await stranger.c.post(`/api/villages/${sHome}/send`, { x: target.x, y: target.y, units: { raider: 100 }, mission: 'occupy' }), 400, 'invalid_target');
  errorOf(await stranger.c.post(`/api/stationed/${row.id}/recall`, {}), 404, 'not_found');
  errorOf(await stranger.c.post(`/api/stationed/${row.id}/send-back`), 404, 'not_found');
  errorOf(await victim.c.post(`/api/stationed/${row.id}/recall`, {}), 403, 'forbidden');
  errorOf(await victim.c.post(`/api/stationed/${row.id}/send-back`), 400, 'invalid_target');
  // Nobody but the claimant can send occupiers; the claim is still intact.
  assert.equal(store.getVillage(target.id)?.state.hearth?.claimBy, claimer.id);
  assert.equal(store.stationedAt(target.id)[0]?.ownerPlayerId, claimer.id);
  await app.close();
});

test('alerts and live hints: the owner\'s tribe sees the hold, gets hints at the strike, at the end and when the village is taken', async () => {
  const { app, clock } = await makeApp({ sandboxUsers: ['claimer'] });
  const store = app.ctx.store;
  const events: LiveEvent[] = [];
  store.onLive = (batch) => events.push(...batch);
  const claimer = await player(app, 'claimer');
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  unprotect(app, alice, amy);
  const home = strongHome(app, clock, claimer, { raider: 400, chieftain: 1 });
  reserveFor(app, claimer, 1, 500);
  const target = homeOf(app, amy);

  const incoming = await go(claimer, home, target, 'attack', { raider: 400, chieftain: 1 });
  // The incoming attack alert never says what is coming.
  const early = (await alice.c.get('/api/tribe/alerts')).json<TribeAlertsResponse>();
  assert.equal(early.alerts.length, 1);
  assert.equal(JSON.stringify(early).includes('chieftain'), false, 'no hint of Chieftains before the strike');
  assert.equal(early.holds.length, 0);
  assert.equal((await alice.c.state()).tribeAlerts, 1);

  events.length = 0;
  runTo(app, clock, incoming.arriveAt);
  const tribeId = alice.tribeId;
  assert.ok(events.some((e) => e.kind === 'tribe' && e.tribeId === tribeId && e.topics.includes('tribe')), 'the tribe is told at the strike');
  assert.ok(events.some((e) => e.kind === 'player' && e.playerId === amy.id), 'the owner is told');
  assert.ok(events.some((e) => e.kind === 'player' && e.playerId === claimer.id), 'the claimant is told');

  // The hold clock is on the alert list for every member, the same clock for all; occupier numbers only for the owner.
  const forAlice = (await alice.c.get('/api/tribe/alerts')).json<TribeAlertsResponse>();
  const forAmy = (await amy.c.get('/api/tribe/alerts')).json<TribeAlertsResponse>();
  assert.equal(forAlice.holds.length, 1);
  assert.equal(forAlice.holds[0]?.village.villageId, target.id);
  assert.equal(forAlice.holds[0]?.hearth.claimBy, 'claimer');
  assert.equal(forAlice.holds[0]?.hearth.endsAt, forAmy.holds[0]?.hearth.endsAt);
  assert.equal(forAlice.holds[0]?.hearth.occupierPopulation, undefined, 'a tribe-mate does not see the occupiers\' strength');
  assert.ok((forAmy.holds[0]?.hearth.occupierPopulation ?? 0) >= 150, 'the owner does');
  assert.equal((await alice.c.state()).tribeAlerts, 1, 'the badge counts the held village');
  const stranger = await player(app, 'stranger');
  errorOf(await stranger.c.get('/api/tribe/alerts'), 409, 'not_in_tribe');

  // The clock ends: hints again, and the list is empty.
  events.length = 0;
  runTo(app, clock, incoming.arriveAt + HOLD_MS + MINUTE);
  assert.equal(store.getVillage(target.id)?.ownerId, claimer.id);
  assert.ok(events.some((e) => e.kind === 'tribe' && e.tribeId === tribeId), 'the tribe is told the village is taken');
  assert.equal((await alice.c.get('/api/tribe/alerts')).json<TribeAlertsResponse>().holds.length, 0);
  assert.equal(store.villagesOfPlayer(amy.id).length, 0, 'her only village was taken (a fresh one comes at her next request)');
  await app.close();
});
