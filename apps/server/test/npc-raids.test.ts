// Step 0 of GAME_DESIGN.md section 18.7: the secret battle seed and the limits on farming abandoned villages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BATTLE_LUCK,
  NPC_REPEAT_LOOT_FACTOR,
  battleSeed,
  hashSeed,
  mulberry32,
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

test('repeat raids by the same player on one abandoned village carry less inside the window; others and later raids are not affected', async () => {
  const { app, clock } = await makeApp();
  const farmer = await register(app, 'farmer', '10.0.0.1');
  const other = await register(app, 'other', '10.0.0.2');
  const vf = await trainRaiders(farmer, clock, 14);
  const vo = await trainRaiders(other, clock, 14);
  const npc = await weakestAbandoned(farmer, 12);

  const first = await raid(farmer, clock, vf, npc);
  assert.ok(first.battle.attackerWon);
  assert.equal(first.battle.lootShare, undefined, 'the first raid carries the full load');
  const cap1 = (first.sent - first.battle.attackerLosses.raider) * 30;
  assert.equal(sum(first.battle.loot), cap1);

  const second = await raid(farmer, clock, vf, npc);
  assert.ok(second.battle.attackerWon);
  assert.equal(second.battle.lootShare, Math.round(NPC_REPEAT_LOOT_FACTOR * 100));
  const survivors2 = second.sent - second.battle.attackerLosses.raider;
  assert.equal(sum(second.battle.loot), Math.floor(survivors2 * 30 * NPC_REPEAT_LOOT_FACTOR));

  const third = await raid(farmer, clock, vf, npc);
  assert.equal(third.battle.lootShare, Math.round(NPC_REPEAT_LOOT_FACTOR ** 2 * 100));
  const survivors3 = third.sent - third.battle.attackerLosses.raider;
  assert.equal(sum(third.battle.loot), Math.floor(survivors3 * 30 * NPC_REPEAT_LOOT_FACTOR ** 2));

  // Another player raiding the same village is not penalised for the farmer's raids.
  const mine = await raid(other, clock, vo, npc);
  assert.ok(mine.battle.attackerWon);
  assert.equal(mine.battle.lootShare, undefined);

  // The farmer's raids fall out of the window (24 h / world speed 10 = 2.4 h): the full load is back.
  clock.set(clock.t + 3 * HOUR);
  const later = await raid(farmer, clock, vf, npc);
  assert.equal(later.battle.lootShare, undefined);
  assert.equal(sum(later.battle.loot), (later.sent - later.battle.attackerLosses.raider) * 30);

  // Only won raids are written down, one row each, and only for this pair.
  const rows = app.ctx.store.db.prepare('SELECT player_id, COUNT(*) AS n FROM npc_raids GROUP BY player_id').all() as Array<{ n: number }>;
  assert.equal(rows.length, 2);
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
