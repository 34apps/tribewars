import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUnits, type ReportDto, type ReportListResponse, type Units, type VillageState } from '@clanfire/engine';
import { REPORTS_KEEP } from '../src/store.ts';
import { HOUR, makeApp, ok, register, weakestAbandoned } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>['app'];

function units(partial: Partial<Units>): Units {
  return { ...emptyUnits(), ...partial };
}

function patchVillage(app: App, id: number, fn: (s: VillageState) => void): void {
  const v = app.ctx.store.getVillage(id);
  assert.ok(v);
  fn(v.state);
  app.ctx.store.saveVillage(id, v.state, v.points);
}

test('due movements are processed in (arrive_at, id) order, in batches, without losing any', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'burst');
  const home = await c.village();
  const npc = await weakestAbandoned(c, 12);
  const t0 = clock.now();
  const N = 250; // more than two batches of 100

  // Insert out of arrival order: row ids ascend while arrive_at descends in blocks.
  const insert = app.ctx.store.db.prepare(
    "INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)",
  );
  const arrivals: number[] = [];
  for (let i = 0; i < N; i++) {
    const at = t0 + 1000 + ((N - i) % 50) * 7 + Math.floor(i / 50);
    arrivals.push(at);
    insert.run(home.id, npc.id, JSON.stringify(units({ raider: 1 })), t0, at);
  }
  clock.advance(HOUR);

  // Not yet due when asked about an earlier time.
  assert.equal(app.ctx.game.processDue(t0 + 500), 0);
  assert.equal(app.ctx.game.processDue(clock.now()), N);
  assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n, 0);

  // Reports were written in arrival order (report ids ascend with created_at; ties by movement id).
  const rows = app.ctx.store.db.prepare('SELECT id, created_at FROM reports WHERE player_id = ? ORDER BY id').all(app.ctx.store.getVillage(home.id)?.ownerId ?? 0) as Array<{
    id: number;
    created_at: number;
  }>;
  for (let i = 1; i < rows.length; i++) assert.ok((rows[i - 1]?.created_at ?? 0) <= (rows[i]?.created_at ?? 0), 'processed oldest first');
  // Old reports are pruned; the newest are kept.
  assert.equal(rows.length, REPORTS_KEEP);
  assert.equal(rows[rows.length - 1]?.created_at, Math.max(...arrivals));
  // The API lists at most 50, newest first.
  const list = (await c.get('/api/reports')).json<ReportListResponse>().reports;
  assert.equal(list.length, 50);
  for (let i = 1; i < list.length; i++) assert.ok((list[i - 1]?.createdAt ?? 0) >= (list[i]?.createdAt ?? 0));
  await app.close();
});

test('a return that is already due is applied before a later arrival', async () => {
  const { app, clock } = await makeApp();
  const alice = await register(app, 'alice', '10.0.0.1');
  const bob = await register(app, 'bob', '10.0.0.2');
  const va = await alice.village();
  const vb = await bob.village();
  const npc = await weakestAbandoned(alice, 12);
  const t0 = clock.now();

  // Alice's 14 raiders are out raiding (arrive t0+1h); Bob's single raider hits Alice at t0+3h.
  patchVillage(app, va.id, (s) => {
    s.away = units({ raider: 14 });
  });
  patchVillage(app, vb.id, (s) => {
    s.away = units({ raider: 1 });
  });
  const insert = app.ctx.store.db.prepare(
    "INSERT INTO movements (kind, origin_village_id, target_village_id, units_json, loot_json, depart_at, arrive_at) VALUES ('attack', ?, ?, ?, NULL, ?, ?)",
  );
  insert.run(va.id, npc.id, JSON.stringify(units({ raider: 14 })), t0, t0 + HOUR);
  insert.run(vb.id, va.id, JSON.stringify(units({ raider: 1 })), t0, t0 + 3 * HOUR);

  // Everything is overdue at once. Time order says: raid, return home (< 1 h later), then Bob arrives.
  clock.advance(6 * HOUR);
  assert.equal(app.ctx.game.processDue(clock.now()), 3);

  const aliceReports = (await alice.get('/api/reports')).json<ReportListResponse>().reports;
  const defense = aliceReports.find((r) => r.side === 'defense');
  assert.ok(defense, 'Alice defended');
  assert.equal(defense.won, true, 'her returned raiders were home when Bob arrived');
  const detail = (await alice.get(`/api/reports/${defense.id}`)).json<ReportDto>().battle;
  assert.ok((detail.defenderUnits?.raider ?? 0) >= 1);
  assert.equal(detail.attackerWon, false);

  // After the dust settles everything is home and nothing is left in flight.
  const st = await alice.state();
  assert.deepEqual(st.movements, []);
  assert.equal(st.villages[0]?.state.away.raider, 0);
  assert.ok((st.villages[0]?.state.troops.raider ?? 0) >= 1);
  await app.close();
});

test('API requests process due movements before answering', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'lazy');
  const home = await c.village();
  const npc = await weakestAbandoned(c, 12);
  patchVillage(app, home.id, (s) => {
    s.away = units({ raider: 1 });
  });
  app.ctx.store.insertMovement({
    kind: 'attack',
    originVillageId: home.id,
    targetVillageId: npc.id,
    units: units({ raider: 1 }),
    loot: null,
    departAt: clock.now(),
    arriveAt: clock.now() + 1000,
  });
  clock.advance(5000);
  // Even a request that is not about the world (/api/health) brings it up to date.
  ok(await c.get('/api/health'));
  assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n, 0);
  assert.equal((await c.state()).unreadReports, 1);
  await app.close();
});

test('a movement whose village is gone is dropped without breaking the queue', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'orphan');
  const home = await c.village();
  const npc = await weakestAbandoned(c, 12);
  const store = app.ctx.store;
  const t = clock.now();
  const mid = store.insertMovement({
    kind: 'return',
    originVillageId: home.id,
    targetVillageId: npc.id,
    units: units({ raider: 1 }),
    loot: null,
    departAt: t,
    arriveAt: t + 10,
  });
  // Simulate a vanished village (foreign keys would normally cascade the row; bypass for the test).
  store.db.exec('PRAGMA foreign_keys = OFF');
  store.db.prepare('DELETE FROM villages WHERE id = ?').run(home.id);
  store.db.exec('PRAGMA foreign_keys = ON');
  clock.advance(1000);
  assert.equal(app.ctx.game.processDue(clock.now()), 1);
  assert.equal(store.getMovement(mid), null);
  await app.close();
});
