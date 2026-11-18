// Fighter rankings (docs/GAME_DESIGN.md, "Fighter rankings"): value of enemy troops destroyed per player, attacker / defender / total,
// counted in the battle's own transaction, listed for players and tribes through GET /api/rankings/fighters.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { troopValue, type FighterRankingResponse, type PlayerProfileDto, type Units } from '@clanfire/engine';
import { battleOf, makeApp, register, trainRaiders, weakestAbandoned, garrisonAbandoned, type Client } from './helpers.ts';
import { giveTroops, latestReport, sendOk, stationSupport, world, type App, type P } from './warfare-helpers.ts';
import { near } from './renown-helpers.ts';

async function latestReportOf(c: Client) {
  const list = (await c.get('/api/reports')).json<{ reports: Array<{ id: number }> }>().reports;
  const res = await c.get(`/api/reports/${list[0]?.id}`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json<import('@clanfire/engine').ReportDto>();
}

const tribes0 = (app: App, id: number): number | null => app.ctx.store.tribes.membership(id)?.tribeId ?? null;
const totals = (app: App, id: number): { attack: number; defence: number } => app.ctx.store.fighters.totalsOf(id);
const rowCount = (app: App): number => (app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM fighter_totals').get() as { n: number }).n;

async function ranking(p: P, scope: string, kind: string): Promise<FighterRankingResponse> {
  const res = await p.c.get(`/api/rankings/fighters?scope=${scope}&kind=${kind}`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json<FighterRankingResponse>();
}

test('a battle counts the destroyed value for the attacker and the defender exactly once, and the reports say it', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  assert.equal(rowCount(app), 0, 'starts at 0 for everyone, no back-fill');
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  clock.set(movement.arriveAt);

  const mine = battleOf(await latestReport(bob));
  const theirs = battleOf(await latestReport(lou));
  const killed = troopValue(mine.defenderLosses as Units);
  const lost = troopValue(mine.attackerLosses);
  assert.ok(killed > 0 && lost > 0, 'both sides killed something');
  near(totals(app, bob.id).attack, killed);
  assert.equal(totals(app, bob.id).defence, 0);
  near(totals(app, lou.id).defence, lost);
  assert.equal(totals(app, lou.id).attack, 0);
  assert.equal(mine.destroyedValue, Math.floor(killed + 1e-9));
  assert.equal(theirs.destroyedValue, Math.floor(lost + 1e-9));

  // Reading, polling and letting the clock run (the returning troops) never counts it again.
  for (const t of [1, 2]) {
    clock.advance(t * 3_600_000);
    await bob.c.state();
    await lou.c.state();
    await ranking(bob, 'players', 'total');
  }
  near(totals(app, bob.id).attack, killed);
  near(totals(app, lou.id).defence, lost);
  await app.close();
});

test('a support owner is credited as defender next to the village owner; the shares add up to the attacker losses', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 18 });
  await stationSupport(app, clock, alice, amy, { guard: 10 });
  giveTroops(app, bob, { raider: 20 });
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 20 });
  clock.set(movement.arriveAt);
  const b = battleOf(await latestReport(amy)); // the wiped-out attacker would not see the defence
  const lost = troopValue(b.attackerLosses);
  const killed = troopValue(b.defenderLosses as Units) + troopValue(b.supportLosses as Units);
  const a = totals(app, alice.id);
  const m = totals(app, amy.id);
  assert.ok(a.defence > 0 && m.defence > 0, 'the supporter and the village owner both earn as defenders');
  assert.ok(a.defence > m.defence * 0.5, 'the 10 shieldbearers carried more than the 18 pikemen');
  near(a.defence + m.defence, lost);
  assert.equal(a.attack + m.attack, 0);
  near(totals(app, bob.id).attack, killed);
  // The supporter's own report shows their share.
  const read = battleOf(await latestReport(alice));
  assert.equal(read.destroyedValue, Math.floor(a.defence + 1e-9));
  await app.close();
});

test('troops of an abandoned village count for the attacker', async () => {
  const { app, clock } = await makeApp();
  const c: Client = await register(app, 'farmer', '10.0.0.1');
  const vid = await trainRaiders(c, clock, 14);
  const npc = await weakestAbandoned(c, 12);
  garrisonAbandoned(app, npc.id, { pikeman: 4, guard: 2 });
  const n = (await c.village()).state.troops.raider;
  const sent = await c.post(`/api/villages/${vid}/send`, { x: npc.x, y: npc.y, units: { raider: n }, mission: 'attack' });
  assert.equal(sent.statusCode, 201, sent.body);
  clock.set(sent.json<{ movement: { arriveAt: number } }>().movement.arriveAt);
  await c.state();
  const id = (await c.state()).player.id;
  const killed = troopValue(battleOf(await latestReportOf(c)).defenderLosses as Units);
  assert.ok(killed > 0);
  near(totals(app, id).attack, killed);
  assert.equal(rowCount(app), 1, 'the village without an owner has no row');
  await app.close();
});

test('lists: sign-in needed, input checked, top list by kind, ties share a rank, own row also outside the top 100', async () => {
  const { app, clock, alice, amy, bob, bea, lou } = await world();
  const anon = await app.inject({ method: 'GET', url: '/api/rankings/fighters', headers: { host: 'clanfire.test' } });
  assert.equal(anon.statusCode, 401);
  assert.equal((await lou.c.get('/api/rankings/fighters?scope=clans')).statusCode, 400);
  assert.equal((await lou.c.get('/api/rankings/fighters?kind=best')).statusCode, 400);
  assert.equal((await lou.c.get('/api/rankings/fighters?extra=1')).statusCode, 400);

  // Nobody has fought: everyone is on 0 and shares rank 1 (name order).
  let r = await ranking(lou, 'players', 'total');
  assert.equal(r.total, 5);
  assert.deepEqual(r.rows.map((x) => x.rank), [1, 1, 1, 1, 1]);
  assert.deepEqual(r.rows.map((x) => x.name), ['alice', 'amy', 'bea', 'bob', 'lou']);
  assert.equal(r.me?.name, 'lou');

  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  clock.set(movement.arriveAt);
  await bob.c.state();

  const att = await ranking(lou, 'players', 'attacker');
  assert.equal(att.rows[0]?.name, 'bob');
  assert.deepEqual(att.rows.map((x) => x.rank), [1, 2, 2, 2, 2], 'the four on 0 share rank 2');
  assert.equal(att.rows[0]?.value, att.rows[0]?.attacker);
  const def = await ranking(lou, 'players', 'defender');
  assert.equal(def.rows[0]?.name, 'lou');
  assert.equal(def.rows[0]?.value, def.rows[0]?.defender);
  const tot = await ranking(bob, 'players', 'total');
  const bobRow = tot.rows.find((x) => x.name === 'bob');
  const louRow = tot.rows.find((x) => x.name === 'lou');
  assert.equal(bobRow?.total, bobRow?.attacker);
  assert.equal(louRow?.total, louRow?.defender);
  assert.equal(tot.me?.name, 'bob');
  assert.equal(bobRow?.tag, 'BRAVO');
  assert.equal(bobRow?.tribeId, tribes0(app, bob.id));

  // Tribe totals are the members' totals added up, read live.
  const tribes = await ranking(lou, 'tribes', 'attacker');
  assert.equal(tribes.total, 2);
  assert.equal(tribes.rows[0]?.name, 'Bravo Clan');
  assert.equal(tribes.rows[0]?.value, bobRow?.attacker);
  assert.equal(tribes.rows[0]?.size, 2);
  assert.equal(tribes.me, null, 'lou has no tribe');
  const mine = await ranking(bea, 'tribes', 'defender');
  assert.equal(mine.me?.name, 'Bravo Clan');
  assert.equal(mine.me?.rank, 1, 'both tribes are on 0 as defenders');
  const alphaDef = await ranking(alice, 'tribes', 'total');
  assert.equal(alphaDef.me?.name, 'Alpha Pack');
  assert.equal(alphaDef.me?.rank, 2);
  void amy;

  // 105 stronger fighters: lou falls out of the top 100 but still sees their own rank and value.
  const store = app.ctx.store;
  const state = store.villagesOfPlayer(lou.id)[0]!.state;
  for (let i = 0; i < 105; i += 1) {
    const pid = store.insertPlayer(`filler${i}`, 'x', 0, 0);
    store.insertVillage(pid, `v${i}`, 500 + i, 500, 1000 + i, state);
    store.fighters.add(pid, 1_000_000 + i, 0);
  }
  r = await ranking(lou, 'players', 'attacker');
  assert.equal(r.rows.length, 100);
  assert.equal(r.total, 110);
  assert.ok(!r.rows.some((x) => x.name === 'lou'));
  assert.ok((r.me?.rank ?? 0) > 100);
  assert.equal(r.me?.defender, louRow?.defender, 'the caller\'s three values come with the row');
  await app.close();
});

test('the profile carries the three values', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  clock.set(movement.arriveAt);
  await bob.c.state();
  const res = await lou.c.get(`/api/players/${bob.id}`);
  assert.equal(res.statusCode, 200, res.body);
  const p = res.json<PlayerProfileDto>();
  assert.equal(p.fighting?.attacker, Math.floor(totals(app, bob.id).attack + 1e-9));
  assert.equal(p.fighting?.defender, 0);
  assert.equal(p.fighting?.total, p.fighting?.attacker);
  await app.close();
});

test('a report says why no Renown was paid (not allowed against this opponent)', async () => {
  const { app, clock, bob, lou } = await world();
  // Same connection: a real battle, the fighter counters still run, Renown is refused and the report says so.
  giveTroops(app, bob, { raider: 30 });
  giveTroops(app, lou, { pikeman: 30 });
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 30 });
  app.ctx.store.recordIp(bob.id, '10.77.0.1', clock.t);
  app.ctx.store.recordIp(lou.id, '10.77.0.1', clock.t);
  clock.set(movement.arriveAt);
  const mine = battleOf(await latestReport(bob));
  const theirs = battleOf(await latestReport(lou));
  assert.equal(mine.renownGained, undefined);
  assert.equal(mine.renownNote, 'not_allowed');
  assert.equal(theirs.renownNote, 'not_allowed');
  assert.ok((theirs.destroyedValue ?? 0) > 0, 'what was destroyed still counts for the rankings');
  assert.ok(totals(app, lou.id).defence > 0);
  await app.close();
});

test('a battle under the minimum says it was too small; a wiped-out attacker gets no destroyed line but the defender is still credited', async () => {
  const { app, clock, bob, lou } = await world();
  giveTroops(app, bob, { raider: 1 });
  giveTroops(app, lou, { pikeman: 30 });
  const { movement } = await sendOk(bob, lou, 'attack', { raider: 1 });
  clock.set(movement.arriveAt);
  const mine = battleOf(await latestReport(bob));
  const theirs = battleOf(await latestReport(lou));
  assert.equal(mine.defenderLosses, null, 'the attacker was wiped out');
  assert.equal(mine.destroyedValue, undefined);
  assert.equal(mine.renownNote, 'too_small');
  assert.equal(theirs.renownNote, 'too_small');
  assert.equal(theirs.destroyedValue, Math.floor(troopValue(theirs.attackerLosses) + 1e-9));
  await app.close();
});

test('a wiped-out attack that was at least half the defence still shows the defender units; under half it stays hidden; the Wall stays hidden', async () => {
  for (const [raiders, close] of [[8, true], [1, false]] as const) {
    const { app, clock, bob, lou } = await world();
    giveTroops(app, bob, { raider: raiders });
    giveTroops(app, lou, { pikeman: 30 });
    const { movement } = await sendOk(bob, lou, 'attack', { raider: raiders });
    clock.set(movement.arriveAt);
    const mine = battleOf(await latestReport(bob));
    assert.equal(mine.attackerWon, false);
    assert.equal(mine.attackerLosses.raider, raiders, 'wiped out');
    const ratio = mine.attackPower / mine.defensePower;
    if (close) {
      assert.ok(ratio >= 0.5, `ratio ${ratio}`);
      assert.ok(mine.defenderUnits !== null && mine.defenderLosses !== null, 'units shown');
      assert.equal(mine.seenInLoss, true);
      assert.ok((mine.destroyedValue ?? 0) > 0 || troopValue(mine.defenderLosses as Units) === 0);
    } else {
      assert.ok(ratio < 0.5, `ratio ${ratio}`);
      assert.equal(mine.defenderUnits, null);
      assert.equal(mine.seenInLoss, undefined);
    }
    assert.equal(mine.wallLevel, null, 'the Wall is never revealed this way');
    await app.close();
  }
});
