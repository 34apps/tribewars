// A burst of due movements is resolved in budgeted slices (docs/SECURITY_ROADMAP.md section 2.5): same order and outcome as one
// long call, the request hook waits for the shared catch-up, the caretaker never settles villages past unresolved arrivals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUnits, type GameStateResponse, type Units } from '@clanfire/engine';
import { DUE_BUDGET } from '../src/game.ts';
import { HOUR, makeApp, ok, register, weakestAbandoned } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

const units = (partial: Partial<Units>): Units => ({ ...emptyUnits(), ...partial });
const count = (app: App, sql: string, ...args: number[]): number => (app.ctx.store.db.prepare(sql).get(...args) as { n: number }).n;

/** `n` one-Raider attacks on the nearest weak abandoned village, row ids ascending while arrival times jump around. */
async function burst(app: App, name: string, n: number, t0: number): Promise<{ playerId: number }> {
  const c = await register(app, name);
  const home = await c.village();
  const npc = await weakestAbandoned(c, 12);
  const insert = app.ctx.store.db.prepare(
    "INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)",
  );
  for (let i = 0; i < n; i++) insert.run(home.id, npc.id, JSON.stringify(units({ raider: 1 })), t0, t0 + 1000 + ((n - i) % 13) * 7 + Math.floor(i / 13));
  return { playerId: app.ctx.store.getVillage(home.id)?.ownerId ?? 0 };
}

const reportTimes = (app: App, playerId: number): number[] =>
  (app.ctx.store.db.prepare('SELECT created_at FROM reports WHERE player_id = ? ORDER BY id').all(playerId) as Array<{ created_at: number }>).map((r) => r.created_at);

test('budgeted slices resolve the same movements in the same order as one long call', async () => {
  const N = 60;
  // Reference: one unbudgeted call.
  const ref = await makeApp();
  const refT0 = ref.clock.now();
  const refPlayer = await burst(ref.app, 'burst', N, refT0);
  ref.clock.advance(HOUR);
  const refHandled = ref.app.ctx.game.processDue(ref.clock.now());
  assert.equal(ref.app.ctx.game.dueBacklog, false);

  const { app, clock } = await makeApp();
  const t0 = clock.now();
  assert.equal(t0, refT0, 'both worlds start at the same test time');
  const { playerId } = await burst(app, 'burst', N, t0);
  clock.advance(HOUR);
  const now = clock.now();
  const budget = { maxCount: 7, maxMs: 1e9 };

  // First slice: exactly the budget, and exactly the earliest rows by (arrive_at, id).
  const firstSeven = (app.ctx.store.db.prepare('SELECT id FROM movements WHERE arrive_at <= ? ORDER BY arrive_at, id LIMIT 7').all(now) as Array<{ id: number }>).map((r) => r.id);
  assert.equal(app.ctx.game.processDue(now, budget), 7);
  assert.equal(app.ctx.game.dueBacklog, true);
  for (const id of firstSeven) assert.equal(count(app, 'SELECT COUNT(*) AS n FROM movements WHERE id = ?', id), 0, 'the earliest rows went first');

  let handled = 7;
  let slices = 1;
  while (app.ctx.game.dueBacklog) {
    const n = app.ctx.game.processDue(now, budget);
    assert.ok(n <= 7, 'never more than the budget in one call');
    handled += n;
    assert.ok(++slices < 200, 'the backlog drains');
  }
  assert.equal(handled, refHandled, 'the same number of movements (attacks and the returns that were due) as one long call');
  assert.equal(count(app, 'SELECT COUNT(*) AS n FROM movements WHERE arrive_at <= ?', now), 0);
  assert.deepEqual(reportTimes(app, playerId), reportTimes(ref.app, refPlayer.playerId), 'reports written in the same arrival order');
  const times = reportTimes(app, playerId);
  for (let i = 1; i < times.length; i++) assert.ok((times[i - 1] ?? 0) <= (times[i] ?? 0), 'oldest first across slices');
  await app.close();
  await ref.app.close();
});

test('a call without a budget drains everything, and a budget larger than the work reports no backlog', async () => {
  const { app, clock } = await makeApp();
  await burst(app, 'plain', 20, clock.now());
  clock.advance(HOUR);
  assert.ok(app.ctx.game.processDue(clock.now(), { maxCount: 1000, maxMs: 1e9 }) >= 20);
  assert.equal(app.ctx.game.dueBacklog, false);
  assert.equal(app.ctx.game.processDue(clock.now()), 0);
  assert.equal(app.ctx.game.dueBacklog, false);
  await app.close();
});

test('a request during a backlog waits for the shared catch-up and sees every arrival resolved', async () => {
  const { app, clock } = await makeApp({ dueBudget: { maxCount: 5, maxMs: 1e9 } });
  const c = await register(app, 'waiter');
  await burst(app, 'burst', 40, clock.now());
  clock.advance(HOUR);
  // Two requests at once share one catch-up loop.
  const [a, b] = await Promise.all([c.get('/api/state'), c.get('/api/state')]);
  ok(a);
  ok(b);
  assert.equal(count(app, 'SELECT COUNT(*) AS n FROM movements WHERE arrive_at <= ?', clock.now()), 0, 'nothing due is left when the handler runs');
  assert.equal(app.ctx.game.dueBacklog, false);
  assert.ok(Array.isArray(a.json<GameStateResponse>().movements));
  await app.close();
});

test('the caretaker skips its pass while arrivals are still waiting', async () => {
  const { app, clock } = await makeApp();
  await burst(app, 'burst', DUE_BUDGET.maxCount + 30, clock.now());
  clock.advance(HOUR);
  assert.equal(app.ctx.game.runCaretaker(clock.now()), 0);
  assert.equal(app.ctx.game.dueBacklog, true, 'one budgeted slice ran, the rest waits for the tick');
  await app.ctx.game.catchUp();
  assert.equal(app.ctx.game.dueBacklog, false);
  assert.equal(count(app, 'SELECT COUNT(*) AS n FROM movements WHERE arrive_at <= ?', clock.now()), 0);
  await app.close();
});
