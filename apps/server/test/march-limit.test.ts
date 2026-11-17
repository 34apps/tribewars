// Per-player cap on marches in flight (MAX_MARCHES_IN_FLIGHT; docs/SECURITY_ROADMAP.md 2.6). Rows are written straight to the database.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MARCHES_IN_FLIGHT, emptyUnits, type Units } from '@clanfire/engine';
import { errorOf } from './helpers.ts';
import { giveTroops, send, sendOk, stationSupport, units, world, type App, type P } from './warfare-helpers.ts';

/** Put `n` marches of `kind` on the road for `p` (from their first village to `targetVillageId`), arriving at `arriveAt`. */
function seed(app: App, p: P, n: number, kind: 'attack' | 'return' | 'shipment', targetVillageId: number, arriveAt: number): void {
  const home = app.ctx.store.villagesOfPlayer(p.id)[0];
  assert.ok(home);
  const ins = app.ctx.store.db.prepare(
    'INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  );
  for (let i = 0; i < n; i++) ins.run(kind, home.id, targetVillageId, JSON.stringify(emptyUnits()), 0, arriveAt);
}

const count = (app: App, p: P): number => app.ctx.store.marchesInFlight(p.id, 10_000);
const homeId = (app: App, p: P): number => app.ctx.store.villagesOfPlayer(p.id)[0]?.id ?? 0;

test('at cap-1 a send works; at the cap send and shipment answer 409 march_limit and nothing is written', async () => {
  const { app, clock, alice, bob } = await world();
  giveTroops(app, alice, { raider: 50 });
  const far = clock.now() + 24 * 3_600_000;
  seed(app, alice, MAX_MARCHES_IN_FLIGHT - 1, 'attack', homeId(app, bob), far);
  assert.equal(count(app, alice), MAX_MARCHES_IN_FLIGHT - 1);
  await sendOk(alice, bob, 'attack', { raider: 5 });
  assert.equal(count(app, alice), MAX_MARCHES_IN_FLIGHT);

  const snap = (): { troops: Units; wood: number } => {
    const st = app.ctx.store.villagesOfPlayer(alice.id)[0]?.state;
    assert.ok(st);
    return { troops: { ...st.troops }, wood: st.resources.wood };
  };
  const before = snap();
  const homeV = await alice.c.village();
  const rows = count(app, alice);
  const res = await send(alice, bob, 'attack', { raider: 5 });
  errorOf(res, 409, 'march_limit');
  assert.match(res.json<{ message: string }>().message, /200 marches on the way/);
  const ship = await alice.c.post(`/api/villages/${homeV.id}/ship`, { x: (await bob.c.village()).x, y: (await bob.c.village()).y, resources: { wood: 10 } });
  errorOf(ship, 409, 'march_limit');
  const after = snap();
  assert.deepEqual(after.troops, before.troops, 'troops unchanged');
  assert.equal(after.wood, before.wood, 'resources unchanged');
  assert.equal(count(app, alice), rows, 'no row written');
  await app.close();
});

test('returning marches count, another player is unaffected, and a send works again once one arrives', async () => {
  const { app, clock, alice, bob, lou } = await world();
  giveTroops(app, alice, { raider: 50 });
  const soon = clock.now() + 60_000;
  seed(app, alice, MAX_MARCHES_IN_FLIGHT - 1, 'return', homeId(app, alice), clock.now() + 24 * 3_600_000);
  seed(app, alice, 1, 'return', homeId(app, alice), soon);
  errorOf(await send(alice, bob, 'attack', { raider: 5 }), 409, 'march_limit');
  giveTroops(app, lou, { raider: 5 });
  await sendOk(lou, bob, 'attack', { raider: 5 });
  clock.set(soon + 1);
  await alice.c.state(); // resolves what is due
  assert.equal(count(app, alice), MAX_MARCHES_IN_FLIGHT - 1);
  await sendOk(alice, bob, 'attack', { raider: 5 });
  await app.close();
});

test('recalling standing support still works at the cap', async () => {
  const { app, clock, alice, amy } = await world();
  const entry = await stationSupport(app, clock, alice, amy, units({ pikeman: 4 }));
  seed(app, alice, MAX_MARCHES_IN_FLIGHT, 'attack', homeId(app, amy), clock.now() + 24 * 3_600_000);
  const res = await alice.c.post(`/api/stationed/${entry.id}/recall`, {});
  assert.equal(res.statusCode, 201);
  assert.equal(count(app, alice), MAX_MARCHES_IN_FLIGHT + 1, 'the way home is allowed past the cap');
  await app.close();
});

test('the count query uses the owner and origin indexes', async () => {
  const { app, alice } = await world();
  const plan = app.ctx.store.db
    .prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) AS n FROM (SELECT 1 FROM movements WHERE origin_village_id IN (SELECT id FROM villages WHERE owner_id = ?) LIMIT ?)')
    .all(alice.id, 200)
    .map((r) => String((r as { detail: string }).detail))
    .join(' | ');
  assert.match(plan, /idx_movements_origin/);
  assert.match(plan, /idx_villages_owner/);
  await app.close();
});

void (undefined as unknown as Units);
