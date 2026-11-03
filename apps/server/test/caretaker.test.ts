// Offline progress and the caretaker bot for idle owners (GAME_DESIGN.md section 17).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_WRITE_INTERVAL_MS, BOT_MAX_STEPS_PER_RUN, botIdleMs, botStepMs, totalUnits } from '@clanfire/engine';
import { HOUR, MINUTE, makeApp, ok } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

/** Plenty of stock and room, so the bot has something to choose from. */
function enrich(app: App, p: P): number {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0];
  assert.ok(v);
  v.state.resources = { wood: 9000, food: 9000, iron: 9000, gold: 500 };
  v.state.buildings.storehouse = 8;
  v.state.buildings.farm = 6;
  store.saveVillage(v.id, v.state, v.points);
  return v.id;
}

const queueOf = (app: App, id: number) => app.ctx.store.getVillage(id)?.state.buildQueue ?? [];
const nextAt = (app: App, id: number): number =>
  (app.ctx.store.db.prepare('SELECT bot_next_at AS t FROM villages WHERE id = ?').get(id) as { t: number }).t;

test('offline: after 24 h without a request, production has accrued and the build queue has finished', async () => {
  const { app, clock } = await makeApp({ world: { speed: 1 } });
  const p = await newPlayer(app, 'sleeper');
  const id = enrich(app, p);
  const own = app.ctx.store.getVillage(id);
  assert.ok(own);
  own.state.resources = { wood: 1500, food: 1500, iron: 1500, gold: 100 }; // well under the storehouse cap, so growth shows
  app.ctx.store.saveVillage(id, own.state, own.points);
  const before = (await p.c.village()).state;
  ok(await p.c.post(`/api/villages/${id}/build`, { building: 'lumber' }));
  const queued = (await p.c.village()).state;
  assert.equal(queued.buildQueue.length, 1);

  clock.advance(24 * HOUR); // no request in between
  const after = (await p.c.village()).state;
  assert.equal(after.buildQueue.length, 0, 'queue finished while offline');
  assert.equal(after.buildings.lumber, before.buildings.lumber + 1);
  assert.ok(after.resources.wood > queued.resources.wood, 'wood was produced');
  assert.ok(after.resources.iron > queued.resources.iron, 'iron was produced');
});

test('caretaker queues builds for an idle owner only, never touches troops, movements or shipments', async () => {
  const { app, clock } = await makeApp(); // speed 10: idle after 7.2 h
  const idle = await newPlayer(app, 'away_one');
  const active = await newPlayer(app, 'here_one');
  const idleId = enrich(app, idle);
  const activeId = enrich(app, active);
  const troopsBefore = structuredClone(app.ctx.store.getVillage(idleId)?.state.troops);
  const idleMs = botIdleMs(app.ctx.settings);

  clock.advance(idleMs - HOUR);
  ok(await active.c.get('/api/state')); // the active player shows up
  clock.advance(HOUR + MINUTE); // idle owner is now past the threshold; the active one is not
  assert.equal(app.ctx.game.runCaretaker(clock.now()), BOT_MAX_STEPS_PER_RUN);
  assert.ok(queueOf(app, idleId).length > 0, 'idle village got a build');
  assert.equal(queueOf(app, activeId).length, 0, 'active owner untouched');

  const v = app.ctx.store.getVillage(idleId);
  assert.ok(v);
  assert.deepEqual(v.state.troops, troopsBefore, 'no troops trained');
  assert.equal(totalUnits(v.state.away), 0);
  assert.equal(v.state.researchJob, undefined, 'no research');
  assert.deepEqual(v.state.trainQueues, { barracks: [], stables: [] });
  assert.equal(app.ctx.store.movementViewsForPlayer(idle.id).length, 0, 'no movements or shipments');
  assert.equal(app.ctx.store.shipmentsInTransit(idleId), 0);
});

test('caretaker: one step interval per village, picks affordable builds only, population cap holds', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'napper');
  const id = enrich(app, p);
  clock.advance(botIdleMs(app.ctx.settings) + MINUTE);
  const now = clock.now();
  const stockBefore = app.ctx.store.getVillage(id)?.state.resources;
  assert.ok(stockBefore);
  assert.ok(app.ctx.game.runCaretaker(now) > 0);
  assert.equal(nextAt(app, id), now + botStepMs(app.ctx.settings));
  const queued = queueOf(app, id).length;

  // Same moment, and a moment later: not due yet.
  assert.equal(app.ctx.game.runCaretaker(now), 0);
  assert.equal(app.ctx.game.runCaretaker(now + botStepMs(app.ctx.settings) - 1), 0);
  assert.equal(queueOf(app, id).length, queued);

  // Whatever it queued was paid for from the settled stock and fits the cap.
  const after = app.ctx.store.getVillage(id)?.state;
  assert.ok(after);
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.ok(after.resources[r] >= 0, `${r} never negative`);

  // A poor village is left alone but still rescheduled.
  const poor = await newPlayer(app, 'poor_one');
  const pv = app.ctx.store.villagesOfPlayer(poor.id)[0];
  assert.ok(pv);
  pv.state.resources = { wood: 0, food: 0, iron: 0, gold: 0 };
  pv.state.lastUpdate = now;
  app.ctx.store.saveVillage(pv.id, pv.state, pv.points);
  app.ctx.store.touchActive(poor.id, now - botIdleMs(app.ctx.settings) - 1, 0); // idle already
  assert.equal(app.ctx.game.runCaretaker(now), 0);
  assert.equal(queueOf(app, pv.id).length, 0);
});

test('caretaker skips banned owners; a returning player takes over instantly', async () => {
  const { app, clock } = await makeApp();
  const banned = await newPlayer(app, 'banned_one');
  const back = await newPlayer(app, 'comes_back');
  const bannedId = enrich(app, banned);
  const backId = enrich(app, back);
  clock.advance(botIdleMs(app.ctx.settings) + MINUTE);
  app.ctx.store.banPlayer(banned.id, 'test', clock.now());

  // The returning player's session is still valid; one request ends the idle state.
  ok(await back.c.get('/api/state'));
  assert.equal(app.ctx.game.runCaretaker(clock.now()), 0);
  assert.equal(queueOf(app, bannedId).length, 0, 'banned owner skipped');
  assert.equal(queueOf(app, backId).length, 0, 'returned owner is in control');

  // Away again for long enough: the bot is back.
  clock.advance(botIdleMs(app.ctx.settings) + MINUTE);
  assert.ok(app.ctx.game.runCaretaker(clock.now()) > 0);
  assert.ok(queueOf(app, backId).length > 0);
});

test('activity stamp is throttled: at most one write per interval', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'throttled');
  const stamp = (): number => app.ctx.store.getPlayer(p.id)?.lastActive ?? 0;
  const t0 = stamp();
  clock.advance(ACTIVITY_WRITE_INTERVAL_MS - 1000);
  ok(await p.c.get('/api/state'));
  assert.equal(stamp(), t0, 'too soon: no write');
  clock.advance(2000);
  ok(await p.c.get('/api/state'));
  assert.equal(stamp(), clock.now(), 'interval passed: stamped');
});

test('caretaker is deterministic: two identical worlds queue the same buildings', async () => {
  const run = async (): Promise<string[]> => {
    const { app, clock } = await makeApp();
    const p = await newPlayer(app, 'twin');
    const id = enrich(app, p);
    clock.advance(botIdleMs(app.ctx.settings) + MINUTE);
    app.ctx.game.runCaretaker(clock.now());
    return queueOf(app, id).map((j) => `${j.building}:${j.targetLevel}`);
  };
  const a = await run();
  assert.ok(a.length > 0);
  assert.deepEqual(a, await run());
});
