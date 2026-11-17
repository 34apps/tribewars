// The numbers behind a report title (ReportDigest): worked out when the report is read, from the stored JSON; old reports work too.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BattleReportData, ReportListResponse, ScoutReportData, Units } from '@clanfire/engine';
import { reportDigest } from '../src/report-digest.ts';
import { ok, weakestAbandoned } from './helpers.ts';
import { giveTroops, report, reports, sendOk, units, world } from './warfare-helpers.ts';

const ref = (villageId: number, name: string, x: number, y: number) => ({ villageId, name, x, y, ownerName: null });

function battle(over: Partial<BattleReportData> = {}): BattleReportData {
  return {
    outcome: 'battle',
    attacker: ref(1, 'Home', 1, 2),
    defender: ref(2, 'Target', 7, -3),
    attackerWon: true,
    luck: 1,
    attackPower: 10,
    defensePower: 5,
    attackerUnits: units({ raider: 20, outrider: 5 }),
    attackerLosses: units({ raider: 3 }),
    defenderUnits: units({ pikeman: 8 }),
    defenderLosses: units({ pikeman: 8 }),
    supportUnits: units({ guard: 4 }),
    supportLosses: units({ guard: 1 }),
    wallLevel: 0,
    loot: { wood: 100, food: 50, iron: 20, gold: 0 },
    ...over,
  };
}

function scout(over: Partial<ScoutReportData> = {}): ScoutReportData {
  return { scout: ref(1, 'Home', 1, 2), target: ref(2, 'Target', 7, -3), success: true, scoutsSent: 5, scoutsLost: 2, defenderScouts: null, defenderScoutsLost: 0, intel: null, ...over };
}

test('attack side: sent, lost, loot and the march to send again', () => {
  const d = reportDigest('attack', { type: 'battle', battle: battle() });
  assert.ok(d);
  assert.deepEqual([d.sent, d.lost, d.loot], [25, 3, 170]);
  assert.deepEqual(d.again, { fromVillageId: 1, x: 7, y: -3, mission: 'attack', units: units({ raider: 20, outrider: 5 }), targetName: 'Target' });
});

test('a called-off attack has no loot, but can be sent again', () => {
  const d = reportDigest('attack', { type: 'battle', battle: battle({ outcome: 'called_off', attackerWon: false, attackerLosses: units({}), loot: { wood: 5, food: 0, iron: 0, gold: 0 } }) });
  assert.ok(d);
  assert.deepEqual([d.sent, d.lost, d.loot], [25, 0, 0]);
  assert.equal(d.again?.mission, 'attack');
});

test('defense and support side: the defending force, what died, what was taken; never a send-again', () => {
  for (const side of ['defense', 'support'] as const) {
    const d = reportDigest(side, { type: 'battle', battle: battle() });
    assert.ok(d);
    assert.deepEqual([d.sent, d.lost, d.loot, d.again], [12, 9, 170, null]);
  }
  const hidden = reportDigest('defense', { type: 'battle', battle: battle({ defenderUnits: null, defenderLosses: null, supportUnits: null, supportLosses: null }) });
  assert.deepEqual([hidden?.sent, hidden?.lost, hidden?.again], [null, null, null]);
});

test('scout reports: scouts sent and lost; send-again only on the sender\'s own report', () => {
  const mine = reportDigest('attack', { type: 'scout', scout: scout() });
  assert.deepEqual([mine?.sent, mine?.lost, mine?.loot], [5, 2, 0]);
  assert.deepEqual(mine?.again, { fromVillageId: 1, x: 7, y: -3, mission: 'scout', units: units({ pathfinder: 5 }), targetName: 'Target' });
  const theirs = reportDigest('defense', { type: 'scout', scout: scout() });
  assert.deepEqual([theirs?.sent, theirs?.lost, theirs?.again], [5, 2, null]);
});

test('shipment, support and village reports have no digest', () => {
  const r = { wood: 0, food: 0, iron: 0, gold: 0 };
  assert.equal(reportDigest('shipment', { type: 'shipment', shipment: { role: 'sent', from: ref(1, 'a', 0, 0), to: ref(2, 'b', 1, 1), resources: r, stored: r, lost: r } }), undefined);
  assert.equal(reportDigest('support', { type: 'support', support: { reason: 'relation_changed', home: ref(1, 'a', 0, 0), host: ref(2, 'b', 1, 1), units: units({}) } }), undefined);
});

test('old reports with missing fields give zeros and nulls, never an error', () => {
  const bare = {} as unknown as BattleReportData;
  const a = reportDigest('attack', { type: 'battle', battle: bare });
  assert.deepEqual(a, { loot: 0, sent: 0, lost: 0, again: null });
  const d = reportDigest('defense', { type: 'battle', battle: bare });
  assert.deepEqual(d, { loot: 0, sent: null, lost: null, again: null });
  const s = reportDigest('attack', { type: 'scout', scout: {} as unknown as ScoutReportData });
  assert.deepEqual(s, { loot: 0, sent: 0, lost: 0, again: null });
  // garbage values count as zero
  const odd = reportDigest('attack', { type: 'battle', battle: battle({ attackerUnits: { raider: -4, guard: 'x' } as unknown as Units, loot: { wood: NaN } as never }) });
  assert.deepEqual([odd?.sent, odd?.loot, odd?.again], [0, 0, null]);
});

test('the report list and the open report carry the digest; only the owner\'s own rows', async () => {
  const { app, clock, alice, bob, lou } = await world();
  const npc = await weakestAbandoned(alice.c, 12);
  giveTroops(app, alice, { raider: 12, pathfinder: 4 });
  giveTroops(app, bob, { pikeman: 2 });
  const home = await alice.c.village();

  const raid = await sendOk(alice, npc, 'attack', { raider: 12 });
  clock.set(raid.movement.arriveAt);
  const scoutRun = await sendOk(alice, bob, 'scout', { pathfinder: 4 });
  clock.set(scoutRun.movement.arriveAt);

  const list = await reports(alice);
  const raidSummary = list.find((r) => r.type === 'battle');
  const scoutSummary = list.find((r) => r.type === 'scout');
  assert.ok(raidSummary?.digest && scoutSummary?.digest);
  const full = await report(alice, raidSummary.id);
  assert.ok(full.battle);
  const lootSum = Object.values(full.battle.loot).reduce((a, b) => a + b, 0);
  assert.ok(lootSum > 0);
  assert.equal(raidSummary.digest.loot, lootSum);
  assert.equal(raidSummary.digest.sent, 12);
  assert.equal(raidSummary.digest.lost, Object.values(full.battle.attackerLosses).reduce((a, b) => a + b, 0));
  assert.deepEqual(raidSummary.digest.again, { fromVillageId: home.id, x: npc.x, y: npc.y, mission: 'attack', units: units({ raider: 12 }), targetName: full.battle.defender.name });
  assert.deepEqual(full.digest, raidSummary.digest, 'the open report has the same digest');
  assert.equal(scoutSummary.digest.again?.mission, 'scout');
  assert.deepEqual([scoutSummary.digest.sent, scoutSummary.digest.again?.units.pathfinder], [4, 4]);

  // Someone else's list never shows alice's numbers; a player with no reports gets an empty list.
  assert.deepEqual(await reports(lou), []);
  for (const r of await reports(bob)) assert.equal(r.digest?.again ?? null, null, 'a defender is never offered the attacker\'s march');
});

test('reports saved before the digest existed (fields missing) still list and open', async () => {
  const { app, alice } = await world();
  const t = Date.UTC(2026, 5, 1);
  const add = (title: string, json: string): number =>
    Number(app.ctx.store.db.prepare("INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, 'attack', 1, ?, ?, 0, ?)").run(alice.id, title, t, json).lastInsertRowid);
  const bareId = add('old bare', '{"type":"battle"}');
  const noTypeId = add('old no type', JSON.stringify({ attackerWon: true, attackerUnits: { raider: 3 }, loot: { wood: 7, food: 0, iron: 0, gold: 0 } }));
  const scoutId = add('old scout', '{"type":"scout","scoutsSent":2}');
  const res = await alice.c.get('/api/reports');
  ok(res);
  const list = res.json<ReportListResponse>().reports;
  const by = new Map(list.map((r) => [r.id, r]));
  assert.deepEqual(by.get(bareId)?.digest, { loot: 0, sent: 0, lost: 0, again: null });
  assert.deepEqual([by.get(noTypeId)?.digest?.sent, by.get(noTypeId)?.digest?.loot, by.get(noTypeId)?.digest?.again], [3, 7, null]);
  assert.deepEqual([by.get(scoutId)?.digest?.sent, by.get(scoutId)?.digest?.lost], [2, 0]);
  ok(await alice.c.get(`/api/reports/${bareId}`));
  ok(await alice.c.get(`/api/reports/${noTypeId}`));
  ok(await alice.c.get(`/api/reports/${scoutId}`));
});
