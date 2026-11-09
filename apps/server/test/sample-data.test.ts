// Sandbox "Fill with sample data": refused for everyone off the allow-list, works for a sandbox player, safe to press twice.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameStateResponse, MyTribeResponse, ReportDto, ReportListResponse } from '@clanfire/engine';
import type { SampleDataResponse } from '../src/sample-data.ts';
import { errorOf, ok } from './helpers.ts';
import { stateOf, world } from './warfare-helpers.ts';

function okJson<T>(res: Parameters<typeof ok>[0]): T {
  ok(res, res.statusCode === 201 ? 201 : 200);
  return res.json<T>();
}

test('sample data: refused for a normal player and for signed-out requests, nothing written', async () => {
  const { app, alice, bob } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  errorOf(await bob.c.post('/api/sandbox/sample-data', {}), 403, 'forbidden');
  errorOf(await app.inject({ method: 'POST', url: '/api/sandbox/sample-data', payload: {} }), 401, 'unauthorized');
  assert.equal((await bob.c.get('/api/reports')).json<ReportListResponse>().reports.length, 0);
  assert.equal(app.ctx.store.getMeta(`sample_data:${bob.id}`), null);
  assert.ok(alice);
});

test('sample data: off for everyone when the allow-list is empty (production)', async () => {
  const { alice } = await world();
  errorOf(await alice.c.post('/api/sandbox/sample-data', {}), 403, 'forbidden');
});

test('sample data: a sandbox player gets every report kind, mail, a tribe and troops; a second press changes nothing', async () => {
  const { app, alice } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  const first = okJson<SampleDataResponse>(await alice.c.post('/api/sandbox/sample-data', {}));
  assert.equal(first.created, true);
  assert.ok(first.counts.reports >= 40);

  // Reports: every type, every village-event kind, both outcomes, siege, tribe-store loot.
  const list = (await alice.c.get('/api/reports?limit=200')).json<ReportListResponse>().reports;
  assert.ok(list.length >= 40);
  for (const type of ['battle', 'scout', 'support', 'shipment', 'village'] as const) assert.ok(list.some((r) => r.type === type), type);
  assert.ok(list.some((r) => r.outcome === 'called_off'));
  assert.ok(list.some((r) => r.type === 'battle' && r.won) && list.some((r) => r.type === 'battle' && !r.won));
  assert.ok(list.some((r) => r.read) && list.some((r) => !r.read), 'a mix of read and unread');
  const kinds = new Set<string>();
  let siege = false;
  let boulder = false;
  let storeLoot = false;
  let richBattle = 0;
  let bigArmy = false;
  let intelLayers = new Set<number>();
  for (const r of list) {
    const full = okJson<ReportDto>(await alice.c.get(`/api/reports/${r.id}`));
    if (full.village) kinds.add(full.village.kind);
    if (full.battle?.siege?.some((h) => h.unit === 'logram')) siege = true;
    if (full.battle?.siege?.some((h) => h.unit === 'boulder')) boulder = true;
    if (full.battle?.lootFromTribeStore) storeLoot = true;
    if (full.battle && full.battle.outcome === 'battle') {
      const kinds = Object.values(full.battle.attackerUnits).filter((n) => n > 0).length;
      if (kinds >= 3) richBattle++;
      if (Object.values(full.battle.attackerUnits).some((n) => n >= 100)) bigArmy = true;
    }
    if (full.scout?.intel) intelLayers = new Set([...intelLayers, full.scout.intel.keen ?? -1]);
  }
  assert.deepEqual([...kinds].sort(), ['claim_failed', 'found_failed', 'founded', 'hearth_out', 'lost', 'relit', 'struck', 'taken']);
  assert.ok(siege && boulder && storeLoot);
  assert.ok(richBattle >= 10 && bigArmy, 'battle reports have mixed, large armies');
  assert.deepEqual([...intelLayers].sort(), [0, 1, 2, 3, 4, 5]);

  // Tribe: member list, chat, diplomacy, applications, a project running.
  const tribe = (await alice.c.get('/api/tribe')).json<MyTribeResponse>();
  assert.ok(tribe.tribe);
  assert.ok(tribe.tribe.memberList.length >= 5);
  assert.ok(tribe.tribe.relations.length >= 4);
  assert.ok(tribe.applications.length >= 2);
  assert.ok(tribe.events.length >= 8);
  assert.ok((await alice.c.get('/api/tribe/chat')).json<{ messages: unknown[] }>().messages.length >= 10);

  // Troops: every unit except the locked ones at home, some away, marches both ways, support in and out.
  const state: GameStateResponse = await stateOf(alice);
  const v = state.villages[0]!.state;
  for (const u of ['pikeman', 'guard', 'raider', 'outrider', 'knight', 'pathfinder', 'logram'] as const) assert.ok(v.troops[u] > 0, u);
  assert.equal(v.troops.chieftain, 0);
  assert.equal(v.troops.boulder, 0);
  assert.ok(v.away.raider > 0);
  assert.ok(state.movements.some((m) => m.kind === 'attack' && m.target.ownerName === 'alice'), 'incoming attack');
  assert.ok(state.movements.some((m) => m.kind === 'attack' && m.origin.ownerName === 'alice'), 'outgoing attack');
  assert.ok(state.movements.some((m) => m.kind === 'return'));
  assert.ok(state.stationed.here.length >= 1 && state.stationed.abroad.length >= 1);

  // Second press: only the sample reports are replaced; a report that came later (a real one) and everything else stay.
  const marker = Number(app.ctx.store.getMeta(`sample_data:${alice.id}`));
  const realId = app.ctx.store.insertReport({ playerId: alice.id, side: 'shipment', type: 'shipment', won: true, title: 'Real report', createdAt: marker + 1000, shipment: { role: 'sent', from: { villageId: 1, name: 'a', x: 0, y: 0, ownerName: 'alice' }, to: { villageId: 1, name: 'a', x: 0, y: 0, ownerName: 'alice' }, resources: { wood: 1, food: 0, iron: 0, gold: 0 }, stored: { wood: 1, food: 0, iron: 0, gold: 0 }, lost: { wood: 0, food: 0, iron: 0, gold: 0 } } });
  const sampleBefore = list.map((r) => r.id);
  const second = okJson<SampleDataResponse>(await alice.c.post('/api/sandbox/sample-data', {}));
  assert.equal(second.created, false);
  assert.equal(second.refreshed, true);
  assert.equal(second.counts.reports, first.counts.reports);
  assert.equal(second.counts.players, 0);
  assert.equal(second.counts.mails, 0);
  assert.equal(second.counts.marches, 0);
  const again = (await alice.c.get('/api/reports?limit=200')).json<ReportListResponse>().reports;
  assert.equal(again.length, list.length, 'the list is capped; the real report is in it, so the same page size');
  assert.ok(again.some((r) => r.id === realId), 'the real report is kept');
  assert.ok(sampleBefore.every((id) => !again.some((r) => r.id === id)), 'the earlier sample reports were replaced');
  const mailBefore = (await alice.c.get('/api/mail')).statusCode;
  assert.equal(mailBefore, 200);
  // A third press keeps replacing only the ids it recorded.
  okJson<SampleDataResponse>(await alice.c.post('/api/sandbox/sample-data', {}));
  const third = (await alice.c.get('/api/reports?limit=200')).json<ReportListResponse>().reports;
  assert.equal(third.length, list.length);
  assert.ok(third.some((r) => r.id === realId));
});

test('sample data: a legacy account (no recorded ids) keeps its real reports on refresh', async () => {
  const { app, alice } = await world();
  app.ctx.store.sandboxUsers = new Set(['alice']);
  okJson<SampleDataResponse>(await alice.c.post('/api/sandbox/sample-data', {}));
  // Make it look like an account filled before ids were recorded, with a real raid by a computer player from before the first press.
  app.ctx.store.setMeta(`sample_reports:${alice.id}`, ''); // empty = no ids recorded
  const marker = Number(app.ctx.store.getMeta(`sample_data:${alice.id}`));
  const v = { villageId: 1, name: 'Raven Hold', x: 3, y: 4, ownerName: 'Mira_of_Vale' };
  const realId = app.ctx.store.insertReport({
    playerId: alice.id, side: 'attack', type: 'scout', won: true, title: 'Real scouting', createdAt: marker - 5 * 86_400_000 - 12_345,
    scout: { scout: v, target: v, success: false, scoutsSent: 3, scoutsLost: 3, defenderScouts: null, defenderScoutsLost: 0, intel: null },
  });
  const second = okJson<SampleDataResponse>(await alice.c.post('/api/sandbox/sample-data', {}));
  assert.equal(second.refreshed, true);
  const after = (await alice.c.get('/api/reports?limit=200')).json<ReportListResponse>().reports;
  assert.ok(after.some((r) => r.id === realId), 'the real report is kept');
});
