// Step 0 of GAME_DESIGN.md section 18.7: the secret battle seed and the limits on farming abandoned villages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BATTLE_LUCK,
  battleSeed,
  hashSeed,
  mulberry32,
  settleVillage,
  totalUnits,
  type ReportDto,
  type ReportListResponse,
  type SendResponse,
} from '@clanfire/engine';
import { HOUR, battleOf, makeApp, register, trainRaiders, weakestAbandoned, type Client } from './helpers.ts';

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const luckOf = (seed: number): number => mulberry32(seed)() * 2 * BATTLE_LUCK - BATTLE_LUCK;

/** Send everything at home at the abandoned village, wait for the battle and the walk home; returns the battle. */
async function raid(c: Client, clock: { set(t: number): void }, vid: number, npc: { x: number; y: number }) {
  const n = (await c.village()).state.troops.raider;
  assert.ok(n > 0, 'raiders at home');
  const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: n }, mission: 'attack' });
  assert.equal(sent.statusCode, 201, sent.body);
  const { movement } = sent.json<SendResponse>();
  clock.set(movement.arriveAt);
  const st = await c.state();
  const list = (await c.get('/api/reports')).json<ReportListResponse>().reports;
  const battle = battleOf((await c.get(`/api/reports/${list[0]?.id}`)).json<ReportDto>());
  const back = st.movements[0];
  if (back) {
    clock.set(back.arriveAt);
    await c.state();
  }
  return { battle, sent: n, movement };
}

test('loot is always full (owner 2026-11-05): repeat raids on one abandoned village carry the same load, no reduction and no table', async () => {
  const { app, clock } = await makeApp();
  const farmer = await register(app, 'farmer', '10.0.0.1');
  const other = await register(app, 'other', '10.0.0.2');
  const vf = await trainRaiders(farmer, clock, 14);
  const vo = await trainRaiders(other, clock, 14);
  const npc = await weakestAbandoned(farmer, 12);

  for (const who of ['first', 'second', 'third'] as const) {
    const r = await raid(farmer, clock, vf, npc);
    assert.ok(r.battle.attackerWon, `${who} raid won`);
    assert.equal((r.battle as unknown as Record<string, unknown>).lootShare, undefined, 'reports no longer carry a loot share');
    assert.equal(sum(r.battle.loot), (r.sent - r.battle.attackerLosses.raider) * 30, `${who} raid carries the full load`);
  }
  // Another player gets the same treatment, and so does the farmer after any wait.
  const mine = await raid(other, clock, vo, npc);
  assert.equal(sum(mine.battle.loot), (mine.sent - mine.battle.attackerLosses.raider) * 30);
  clock.set(clock.t + 3 * HOUR);
  const later = await raid(farmer, clock, vf, npc);
  assert.equal(sum(later.battle.loot), (later.sent - later.battle.attackerLosses.raider) * 30);

  // The repeat-raid table is gone from the schema.
  const t = app.ctx.store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'npc_raids'").all();
  assert.equal(t.length, 0);
  await app.close();
});

test('an abandoned village never regains the troops a raid killed, however long it waits; its buildings still grow', async () => {
  const { app, clock } = await makeApp({ worldConfig: { npc: { selfBuild: true } } });
  const c = await register(app, 'clearer');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const row = (): { troops: number; levels: number } => {
    const v = app.ctx.store.getVillageAt(npc.x, npc.y)!;
    const settled = settleVillage(v.state, clock.t, app.ctx.settings);
    return { troops: totalUnits(settled.troops), levels: Object.values(settled.buildings).reduce((a, b) => a + b, 0) };
  };
  const before = row();
  assert.ok(before.troops > 0);
  const { battle } = await raid(c, clock, vid, npc);
  assert.ok(battle.attackerWon);
  assert.equal(row().troops, 0, 'the whole garrison died in the raid');
  const levels = row().levels;
  clock.set(clock.t + 40 * HOUR);
  const after = row();
  assert.equal(after.troops, 0, 'nobody comes back');
  assert.ok(after.levels > levels, 'only the buildings grow');
  await app.close();
});

test('battle luck uses a secret salt kept in the world database, never shown to players', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'seeker');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const { battle, movement } = await raid(c, clock, vid, npc);

  const salt = app.ctx.store.battleSalt();
  assert.equal(salt.length, 4);
  assert.deepEqual(app.ctx.store.battleSalt(), salt, 'stable once created');
  const stored = app.ctx.store.getMeta('battle_salt');
  assert.match(stored ?? '', /^[0-9a-f]{32}$/);

  // The luck in the report is the salted one; the old public recipe (movement id + arrival time) no longer predicts it.
  assert.equal(battle.luck, luckOf(battleSeed(salt, movement.id, movement.arriveAt)));
  assert.notEqual(battle.luck, luckOf(hashSeed(movement.id, movement.arriveAt)));

  // Nothing a player can read contains the secret.
  const everything = JSON.stringify([await c.state(), (await c.get('/api/reports')).json(), battle, (await c.get('/api/auth/me')).json()]);
  assert.equal(everything.includes(stored as string), false);

  // Every world has its own secret.
  const second = await makeApp();
  assert.notDeepEqual(second.app.ctx.store.battleSalt(), salt);
  await second.app.close();
  await app.close();
});
