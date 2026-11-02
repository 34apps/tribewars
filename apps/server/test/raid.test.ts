import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESOURCE_IDS,
  emptyResources,
  totalUnits,
  travelTimeMs,
  type ReportDto,
  type ReportListResponse,
  type SendResponse,
  type Units,
} from '@clanfire/engine';
import { HOUR, battleOf, errorOf, makeApp, ok, register, trainRaiders, weakestAbandoned } from './helpers.ts';

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

test('full raid: attack, report, return movement, troops and loot come home', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'raider_one');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  const home = await c.village();
  const protectedBefore = (await c.state()).player.protectedUntil;
  assert.ok(protectedBefore > clock.now(), 'still under beginner protection');

  // ---- send --------------------------------------------------------------------------------
  const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: 14 }, mission: 'attack' });
  ok(sent, 201);
  const { village, movement } = sent.json<SendResponse>();
  assert.equal(village.state.troops.raider, 0);
  assert.equal(village.state.away.raider, 14);
  assert.equal(movement.kind, 'attack');
  assert.equal(movement.direction, 'outgoing');
  assert.deepEqual([movement.origin.villageId, movement.origin.ownerName], [vid, 'raider_one']);
  assert.deepEqual([movement.target.villageId, movement.target.x, movement.target.y, movement.target.ownerName], [npc.id, npc.x, npc.y, null]);
  assert.equal(movement.units?.raider, 14);
  assert.equal(movement.loot, null);
  assert.equal(movement.departAt, clock.now());
  assert.equal(
    movement.arriveAt - movement.departAt,
    travelTimeMs({ x: home.x, y: home.y }, { x: npc.x, y: npc.y }, movement.units as Units, app.ctx.settings),
  );
  // Raiding an abandoned village keeps beginner protection.
  assert.equal((await c.state()).player.protectedUntil, protectedBefore);

  // In flight: visible as outgoing, no report yet.
  clock.set(movement.arriveAt - 1);
  const flying = await c.state();
  assert.deepEqual(flying.movements.map((m) => [m.id, m.kind]), [[movement.id, 'attack']]);
  assert.equal(flying.unreadReports, 0);

  // ---- arrival ----------------------------------------------------------------------------
  clock.set(movement.arriveAt);
  const arrived = await c.state();
  assert.equal(arrived.unreadReports, 1);
  assert.equal(arrived.movements.length, 1);
  const ret = arrived.movements[0];
  assert.ok(ret);
  assert.equal(ret.kind, 'return');
  assert.equal(ret.direction, 'outgoing');
  assert.notEqual(ret.id, movement.id);
  // Physical direction: from the raided village back home.
  assert.equal(ret.origin.villageId, npc.id);
  assert.equal(ret.target.villageId, vid);
  assert.equal(ret.departAt, movement.arriveAt);
  assert.ok(ret.arriveAt > ret.departAt);
  assert.ok(ret.units);
  assert.ok(ret.loot);

  const list = (await c.get('/api/reports')).json<ReportListResponse>().reports;
  assert.equal(list.length, 1);
  const summary = list[0];
  assert.ok(summary);
  assert.deepEqual([summary.side, summary.won, summary.read, summary.createdAt], ['attack', true, false, movement.arriveAt]);
  assert.equal(summary.title, `Raid on Abandoned village (${npc.x}|${npc.y})`);
  assert.equal(summary.outcome, 'battle');

  const detail = await c.get(`/api/reports/${summary.id}`);
  ok(detail);
  const report = detail.json<ReportDto>();
  assert.equal(report.read, true, 'opening a report marks it read');
  assert.equal(report.outcome, 'battle');
  assert.equal((await c.state()).unreadReports, 0);
  const b = battleOf(report);
  assert.equal(b.attackerWon, true);
  assert.deepEqual([b.attacker.villageId, b.attacker.ownerName, b.defender.villageId, b.defender.ownerName], [vid, 'raider_one', npc.id, null]);
  assert.equal(b.attackerUnits.raider, 14);
  assert.ok(b.attackPower > b.defensePower);
  assert.ok(Math.abs(b.luck) <= 0.1);
  assert.ok(b.defenderUnits && b.defenderLosses, 'a surviving attacker sees the defence');
  assert.equal(typeof b.wallLevel, 'number');
  assert.equal(sum(b.defenderLosses), sum(b.defenderUnits), 'a won battle wipes out the garrison');
  assert.ok(sum(b.loot) > 0);
  const survivors = 14 - b.attackerLosses.raider;
  assert.ok(survivors > 0);
  assert.equal(ret.units?.raider, survivors);
  assert.deepEqual(ret.loot, b.loot);

  // The abandoned village paid for it.
  const target = app.ctx.store.getVillage(npc.id);
  assert.equal(totalUnits(target?.state.troops as Units), 0);
  assert.equal(target?.ownerId, null);
  // Survivors are away, nobody is home.
  const away = await c.village();
  assert.equal(away.state.troops.raider, 0);
  assert.equal(away.state.away.raider, survivors);

  // ---- coming home ------------------------------------------------------------------------
  clock.set(ret.arriveAt - 1);
  const justBefore = await c.village();
  assert.equal(justBefore.state.troops.raider, 0);
  clock.set(ret.arriveAt);
  const back = await c.state();
  assert.deepEqual(back.movements, []);
  const after = back.villages[0];
  assert.ok(after);
  assert.equal(after.state.troops.raider, survivors);
  assert.equal(after.state.away.raider, 0);
  for (const r of RESOURCE_IDS) {
    const gained = after.state.resources[r] - justBefore.state.resources[r];
    assert.ok(Math.abs(gained - b.loot[r]) < 1, `${r}: gained ${gained}, loot ${b.loot[r]}`);
  }
  assert.equal((app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n, 0);
  await app.close();
});

test('a lost raid: attacker sees no defence details and nobody comes home', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'doomed');
  const vid = await trainRaiders(c, clock, 1);
  const npc = await weakestAbandoned(c, 12);

  const sent = (await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: 1 }, mission: 'attack' })).json<SendResponse>();
  clock.set(sent.movement.arriveAt);
  const st = await c.state();
  assert.deepEqual(st.movements, [], 'no survivors, no return trip');
  assert.equal(st.unreadReports, 1);
  const village = st.villages[0];
  assert.ok(village);
  assert.equal(totalUnits(village.state.troops), 0);
  assert.equal(totalUnits(village.state.away), 0);

  const list = (await c.get('/api/reports')).json<ReportListResponse>().reports;
  assert.deepEqual([list[0]?.side, list[0]?.won], ['attack', false]);
  const b = battleOf((await c.get(`/api/reports/${list[0]?.id}`)).json<ReportDto>());
  assert.equal(b.attackerWon, false);
  assert.equal(b.attackerLosses.raider, 1);
  assert.deepEqual([b.defenderUnits, b.defenderLosses, b.wallLevel], [null, null, null]);
  assert.deepEqual(b.loot, emptyResources());
  await app.close();
});

test('attacking a player: protection rules, incoming view, both reports, protection ends', async () => {
  const { app, clock } = await makeApp();
  const b = await register(app, 'bob', '10.0.0.2');
  clock.advance(HOUR);
  const a = await register(app, 'alice', '10.0.0.1');
  const vidA = await trainRaiders(a, clock, 14);
  const vb = await b.village();
  const send = () => a.post(`/api/villages/${vidA}/send`, { x: vb.x, y: vb.y, units: { raider: 14 }, mission: 'attack' });

  // Bob is still protected (7.2 h from his registration); Alice's army is ready.
  const bobUntil = (await b.state()).player.protectedUntil;
  assert.ok(clock.now() < bobUntil);
  errorOf(await send(), 409, 'target_protected');
  assert.equal((await a.state()).villages[0]?.state.troops.raider, 14, 'a refused send keeps the troops home');
  assert.deepEqual((await a.state()).movements, []);

  // Protection runs out (it is `protectedUntil > now`, so at the instant itself it is over).
  // Alice registered later, so she is still protected herself.
  clock.set(bobUntil - 1);
  errorOf(await send(), 409, 'target_protected');
  clock.set(bobUntil);
  const aliceUntil = (await a.state()).player.protectedUntil;
  assert.ok(aliceUntil > clock.now());

  const sent = await send();
  ok(sent, 201);
  const { movement } = sent.json<SendResponse>();
  assert.equal(movement.target.ownerName, 'bob');
  // Attacking a player ends the attacker's own protection.
  assert.equal((await a.state()).player.protectedUntil, 0);
  assert.equal((await a.get('/api/auth/me')).json<{ player: { protectedUntil: number } }>().player.protectedUntil, 0);

  // Bob sees it coming, but not what is in it.
  const warned = (await b.state()).movements;
  assert.equal(warned.length, 1);
  const incoming = warned[0];
  assert.ok(incoming);
  assert.deepEqual([incoming.kind, incoming.direction, incoming.units, incoming.loot], ['attack', 'incoming', null, null]);
  assert.equal(incoming.origin.ownerName, 'alice');
  assert.equal(incoming.target.villageId, vb.id);
  assert.equal(incoming.arriveAt, movement.arriveAt);
  assert.equal(JSON.stringify(incoming).includes('raider'), false);
  assert.equal((await b.state()).unreadReports, 0);

  // ---- arrival ----------------------------------------------------------------------------
  clock.set(movement.arriveAt - 1);
  const bobJustBefore = (await b.village()).state.resources;
  clock.set(movement.arriveAt);

  const aliceReports = (await a.get('/api/reports')).json<ReportListResponse>().reports;
  const bobReports = (await b.get('/api/reports')).json<ReportListResponse>().reports;
  assert.equal(aliceReports.length, 1);
  assert.equal(bobReports.length, 1);
  const ra = aliceReports[0];
  const rb = bobReports[0];
  assert.ok(ra && rb);
  assert.deepEqual([ra.side, ra.won], ['attack', true]);
  assert.deepEqual([rb.side, rb.won, rb.read], ['defense', false, false]);
  assert.equal((await b.state()).unreadReports, 1);
  assert.equal((await a.state()).unreadReports, 1);

  const attackerCopy = battleOf((await a.get(`/api/reports/${ra.id}`)).json<ReportDto>());
  const defenderCopy = battleOf((await b.get(`/api/reports/${rb.id}`)).json<ReportDto>());
  assert.equal(attackerCopy.defender.ownerName, 'bob');
  assert.equal(defenderCopy.attacker.ownerName, 'alice');
  assert.deepEqual(defenderCopy.loot, attackerCopy.loot);
  assert.deepEqual(defenderCopy.attackerUnits, attackerCopy.attackerUnits);
  assert.ok(defenderCopy.defenderUnits, 'the defender always sees the defence');
  assert.ok(sum(attackerCopy.loot) > 0);

  // Bob paid the loot.
  const bobAfter = (await b.village()).state.resources;
  for (const r of RESOURCE_IDS) {
    assert.ok(Math.abs(bobJustBefore[r] - attackerCopy.loot[r] - bobAfter[r]) < 1, `${r} was taken from Bob`);
  }

  // Reports are private.
  errorOf(await a.get(`/api/reports/${rb.id}`), 404, 'not_found');
  errorOf(await b.get(`/api/reports/${ra.id}`), 404, 'not_found');
  assert.equal((await b.get(`/api/reports/${rb.id}`)).statusCode, 200);
  await app.close();
});
