// Support troops: arrival, merging, defending, turning back (GAME_DESIGN.md section 12).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battleSeed, resolveBattle, settleVillage, travelTimeMs, totalUnits, type MovementDto } from '@clanfire/engine';
import { battleOf, errorOf, ok } from './helpers.ts';
import { addMember, formPact, myTribe } from './tribe-helpers.ts';
import {
  giveTroops,
  latestReport,
  movementsOf,
  reports,
  sendOk,
  stateOf,
  stationSupport,
  unprotect,
  units,
  village,
  world,
  type App,
} from './warfare-helpers.ts';

/** What the engine will decide for an attack on `hostVillageId`; call before the clock reaches the arrival. */
function replay(app: App, hostVillageId: number, movement: MovementDto, attackerUnits: Parameters<typeof resolveBattle>[0]['attackerUnits']) {
  const host = app.ctx.store.getVillage(hostVillageId);
  assert.ok(host);
  return resolveBattle({
    attackerUnits,
    defender: settleVillage(host.state, movement.arriveAt, app.ctx.settings),
    support: app.ctx.store.stationedAt(hostVillageId).map((c) => c.units),
    seed: battleSeed(app.ctx.store.battleSalt(), movement.id, movement.arriveAt),
  });
}

test('support in flight: the sender sees it going out, the host sees it coming in with its units; on arrival it is stationed and merges', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, alice, { pikeman: 15, guard: 2 });
  const from = await village(alice);
  const host = await village(amy);

  const { movement } = await sendOk(alice, amy, 'support', { pikeman: 10 });
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(from, host, units({ pikeman: 10 }), app.ctx.settings));

  clock.set(movement.arriveAt - 1);
  const incoming = (await movementsOf(amy))[0];
  assert.ok(incoming);
  assert.deepEqual([incoming.id, incoming.kind, incoming.direction, incoming.origin.ownerName, incoming.target.villageId], [movement.id, 'support', 'incoming', 'alice', host.id]);
  assert.equal(incoming.units?.pikeman, 10, 'incoming support shows what is coming');
  assert.equal(incoming.loot, null);
  assert.equal((await stateOf(amy)).tribeAlerts, 0, 'support is not an alert');
  assert.deepEqual(await movementsOf(bob), [], 'outsiders see nothing');
  assert.deepEqual((await stateOf(amy)).stationed, { here: [], abroad: [] });

  clock.set(movement.arriveAt);
  assert.deepEqual(await movementsOf(amy), []);
  assert.deepEqual(await movementsOf(alice), [], 'the order is done');
  assert.deepEqual([await reports(alice), await reports(amy)], [[], []], 'staying is not a report');
  const stationed = (await stateOf(amy)).stationed;
  assert.equal(stationed.here.length, 1);
  assert.deepEqual(stationed.abroad, []);
  const entry = stationed.here[0];
  assert.ok(entry);
  assert.deepEqual([entry.home.villageId, entry.home.ownerName, entry.host.villageId, entry.host.ownerName, entry.arrivedAt], [from.id, 'alice', host.id, 'amy', movement.arriveAt]);
  assert.equal(entry.units.pikeman, 10);
  assert.deepEqual(Object.keys(entry.units).sort(), Object.keys(units({})).sort());
  const mine = await stateOf(alice);
  assert.deepEqual(mine.stationed.abroad, stationed.here);
  assert.deepEqual(mine.stationed.here, []);
  // The units are still alice's: counted in her `away` (so she keeps feeding them), not at home, and not amy's.
  assert.deepEqual([mine.villages[0]?.state.troops.pikeman, mine.villages[0]?.state.away.pikeman], [5, 10]);
  assert.equal((await village(amy)).state.troops.pikeman, 0);

  // More support from the same village merges into the one contingent, which keeps its arrival time.
  clock.advance(60_000);
  const second = await sendOk(alice, amy, 'support', { pikeman: 5, guard: 2 });
  clock.set(second.movement.arriveAt);
  const merged = (await stateOf(amy)).stationed.here;
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0]?.id, merged[0]?.units.pikeman, merged[0]?.units.guard, merged[0]?.arrivedAt], [entry.id, 15, 2, movement.arriveAt]);
  assert.equal((await village(alice)).state.away.pikeman, 15);
  await app.close();
});

test('support defends: the host\'s own troops and every contingent fight; each loses its share; owners\' away counts shrink; everyone is told', async () => {
  const { app, clock, alice, amy, bob } = await world();
  const dan = await addMember(app, alice, 'dan');
  unprotect(app, dan);
  giveTroops(app, amy, { pikeman: 6 });
  await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  await stationSupport(app, clock, dan, amy, { guard: 8 });
  // 11 raiders: 440 attack (+-10%) against 620 defense. The defence always holds and every group loses a part, never all.
  giveTroops(app, bob, { raider: 11 });
  const amyHome = await village(amy);

  const attackers = units({ raider: 11 });
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 11 });
  const alicesBefore = (await village(alice)).state.away;
  const expected = replay(app, amyHome.id, movement, attackers);
  assert.equal(expected.attackerWon, false);
  const [lossAlice, lossDan] = expected.supportLosses;
  assert.ok(lossAlice && lossDan && lossAlice.pikeman > 0 && lossDan.guard > 0 && expected.defenderLosses.pikeman > 0, 'everybody loses something');
  assert.ok(lossAlice.pikeman < 10 && lossDan.guard < 8, 'and keeps something');

  clock.set(movement.arriveAt);

  // Contingents and away counts.
  const here = (await stateOf(amy)).stationed.here;
  const byOwner = Object.fromEntries(here.map((e) => [e.home.ownerName, e]));
  assert.equal(byOwner.alice?.units.pikeman, 10 - lossAlice.pikeman);
  assert.equal(byOwner.dan?.units.guard, 8 - lossDan.guard);
  assert.equal((await village(alice)).state.away.pikeman, alicesBefore.pikeman - lossAlice.pikeman);
  assert.equal((await village(dan)).state.away.guard, 8 - lossDan.guard);
  assert.equal((await village(amy)).state.troops.pikeman, 6 - expected.defenderLosses.pikeman);
  assert.deepEqual((await stateOf(alice)).stationed.abroad.map((e) => e.units.pikeman), [10 - lossAlice.pikeman]);

  // The attacker is wiped out: sees only its own side (support figures are hidden like the defenders').
  const theirs = battleOf(await latestReport(bob));
  assert.deepEqual([theirs.attackerWon, theirs.defenderUnits, theirs.defenderLosses, theirs.supportUnits, theirs.supportLosses, theirs.wallLevel], [false, null, null, null, null, null]);
  assert.equal((await reports(bob))[0]?.side, 'attack');

  // The host and the supporters get the whole picture: totals of all contingents.
  const total = units({ pikeman: 10, guard: 8 });
  const totalLoss = units({ pikeman: lossAlice.pikeman, guard: lossDan.guard });
  const hostReport = await latestReport(amy);
  assert.deepEqual([hostReport.side, hostReport.type, hostReport.won], ['defense', 'battle', true]);
  const b = battleOf(hostReport);
  assert.deepEqual([b.supportUnits, b.supportLosses], [total, totalLoss]);
  assert.deepEqual([b.defenderUnits?.pikeman, b.defenderLosses?.pikeman], [6, expected.defenderLosses.pikeman], 'defenderUnits stay the village\'s own troops');
  for (const p of [alice, dan]) {
    const list = await reports(p);
    assert.equal(list.length, 1, 'one report per supporter');
    assert.deepEqual([list[0]?.side, list[0]?.type, list[0]?.won, list[0]?.outcome, list[0]?.read], ['support', 'battle', true, 'battle', false]);
    assert.equal(list[0]?.title, `Your troops at ${amyHome.name} (${amyHome.x}|${amyHome.y}) were attacked`);
    const sb = battleOf(await latestReport(p));
    // Same battle; only the Renown line is per reader.
    assert.deepEqual({ ...sb, renownGained: undefined }, { ...b, renownGained: undefined }, 'the supporter reads the same battle');
    assert.equal(sb.attacker.ownerName, 'bob');
  }
  assert.deepEqual((await reports(amy)).length, 1);
  await app.close();
});

test('an attacker who wins kills the whole defence including support: contingents are gone, away counts drop, the attacker sees it all', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 6 });
  await stationSupport(app, clock, alice, amy, { pikeman: 10, guard: 2 });
  giveTroops(app, bob, { raider: 60 });
  const amyHome = await village(amy);
  const aliceMeanwhile = (await village(alice)).state.resources;

  const { movement } = await sendOk(bob, amy, 'attack', { raider: 60 });
  const expected = replay(app, amyHome.id, movement, units({ raider: 60 }));
  assert.equal(expected.attackerWon, true);
  assert.deepEqual(expected.supportLosses, [units({ pikeman: 10, guard: 2 })]);
  clock.set(movement.arriveAt);

  assert.deepEqual((await stateOf(amy)).stationed.here, []);
  assert.deepEqual((await stateOf(alice)).stationed.abroad, []);
  assert.equal(app.ctx.store.stationedAt(amyHome.id).length, 0, 'the empty contingent row is deleted');
  const home = (await village(alice)).state;
  assert.deepEqual([home.away.pikeman, home.away.guard, home.troops.pikeman], [0, 0, 0]);
  // Loot only ever comes out of the host's stores.
  for (const r of ['wood', 'food', 'iron', 'gold'] as const) assert.ok(home.resources[r] >= aliceMeanwhile[r], `alice's ${r} was not touched`);

  const mine = battleOf(await latestReport(bob));
  assert.equal(mine.attackerWon, true);
  assert.deepEqual([mine.supportUnits, mine.supportLosses], [units({ pikeman: 10, guard: 2 }), units({ pikeman: 10, guard: 2 })]);
  assert.deepEqual(mine.defenderUnits, units({ pikeman: 6 }));
  const supporter = await latestReport(alice);
  assert.deepEqual([supporter.side, supporter.won], ['support', false]);
  assert.equal(battleOf(supporter).attackerWon, true);
  await app.close();
});

test('a battle without support has null support figures', async () => {
  const { app, clock, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 3 });
  giveTroops(app, bob, { raider: 20 });
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 20 });
  clock.set(movement.arriveAt);
  for (const p of [bob, amy]) {
    const b = battleOf(await latestReport(p));
    assert.deepEqual([b.supportUnits, b.supportLosses], [null, null]);
  }
  await app.close();
});

test('a supporter who later attacks the host fights their own stationed troops; their home village is settled once and not overwritten', async () => {
  const { app, clock, alice, amy } = await world();
  await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  // Amy leaves the tribe: alice's troops stay where they are, and now alice can attack amy.
  ok(await amy.c.post('/api/tribe/leave'));
  giveTroops(app, alice, { raider: 40 });
  const amyHome = await village(amy);
  const { movement } = await sendOk(alice, amy, 'attack', { raider: 40 });
  const expected = replay(app, amyHome.id, movement, units({ raider: 40 }));
  assert.equal(expected.attackerWon, true);
  clock.set(movement.arriveAt);

  const away = (await village(alice)).state.away;
  assert.equal(away.pikeman, 0, 'her stationed pikemen died against her own raiders');
  assert.equal(away.raider, 40 - expected.attackerLosses.raider, 'survivors are still on the road');
  const ret = (await movementsOf(alice))[0];
  assert.ok(ret);
  clock.set(ret.arriveAt);
  const back = (await village(alice)).state;
  assert.deepEqual([back.troops.raider, back.away.raider, back.away.pikeman], [40 - expected.attackerLosses.raider, 0, 0]);
  assert.equal((await reports(alice)).length, 2, 'she reads the raid and, as a supporter, the same battle');
  await app.close();
});

test('strict arrival order: support that arrives first defends; support that arrives after the attack does not', async () => {
  for (const supportFirst of [true, false]) {
    const { app, clock, alice, amy, bob } = await world();
    giveTroops(app, alice, { pikeman: 10 });
    giveTroops(app, bob, { raider: 3 });
    const amyHome = await village(amy);
    const t0 = clock.now();
    const sup = await sendOk(alice, amy, 'support', { pikeman: 10 });
    const atk = await sendOk(bob, amy, 'attack', { raider: 3 });
    // Both are overdue by the time anyone asks; only the stored arrival times decide the order.
    const sql = app.ctx.store.db.prepare('UPDATE movements SET arrive_at = ? WHERE id = ?');
    sql.run(t0 + (supportFirst ? 1000 : 2000), sup.movement.id);
    sql.run(t0 + (supportFirst ? 2000 : 1000), atk.movement.id);
    clock.set(t0 + 5000);

    const b = battleOf(await latestReport(amy));
    if (supportFirst) {
      assert.deepEqual(b.supportUnits, units({ pikeman: 10 }), 'the support was already there');
      assert.ok(totalUnits(b.supportLosses ?? units({})) > 0);
      assert.equal(app.ctx.store.stationedAt(amyHome.id).length, 1);
    } else {
      assert.equal(b.supportUnits, null, 'the support was still on the road');
      assert.equal((await reports(alice)).length, 0);
      assert.equal(app.ctx.store.stationedAt(amyHome.id)[0]?.units.pikeman, 10, 'it arrived afterwards and is untouched');
    }
    await app.close();
  }
});

// ---- the relation changes while the troops march ----------------------------------------------------------------

test('support turns back, with a support report, when the host left the tribe while it marched', async () => {
  const { app, clock, alice, amy } = await world();
  giveTroops(app, alice, { pikeman: 10 });
  const from = await village(alice);
  const host = await village(amy);
  const { movement } = await sendOk(alice, amy, 'support', { pikeman: 10 });
  ok(await amy.c.post('/api/tribe/leave'));
  clock.set(movement.arriveAt);

  assert.deepEqual((await stateOf(amy)).stationed, { here: [], abroad: [] });
  assert.deepEqual(await reports(amy), [], 'the host is not told');
  const list = await reports(alice);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]?.type, list[0]?.side, list[0]?.won, list[0]?.outcome, list[0]?.createdAt], ['support', 'support', false, 'called_off', movement.arriveAt]);
  const full = await latestReport(alice);
  assert.deepEqual([full.battle, full.scout], [null, null]);
  assert.ok(full.support);
  assert.equal(full.support.reason, 'relation_changed');
  assert.deepEqual([full.support.home.villageId, full.support.host.villageId, full.support.units.pikeman], [from.id, host.id, 10]);
  assert.match(full.title, /turned back/);

  const ret = (await movementsOf(alice))[0];
  assert.ok(ret);
  assert.deepEqual([ret.kind, ret.direction, ret.origin.villageId, ret.target.villageId, ret.units?.pikeman, ret.departAt], ['return', 'outgoing', host.id, from.id, 10, movement.arriveAt]);
  assert.equal(ret.arriveAt - ret.departAt, travelTimeMs(host, from, units({ pikeman: 10 }), app.ctx.settings));
  clock.set(ret.arriveAt);
  const home = (await village(alice)).state;
  assert.deepEqual([home.troops.pikeman, home.away.pikeman], [10, 0]);
  assert.deepEqual((await stateOf(alice)).stationed.abroad, []);
  await app.close();
});

test('support to an ally turns back when the alliance has ended by arrival, but stays while it is still serving its notice', async () => {
  for (const noticeOutlastsArrival of [false, true]) {
    const { app, clock, alice, bob } = await world();
    await formPact(alice, 'BRAVO', bob, 'ally');
    giveTroops(app, alice, { pikeman: 6 });
    const { movement } = await sendOk(alice, bob, 'support', { pikeman: 6 });
    const rel = (await myTribe(alice)).tribe?.relations[0];
    ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
    const endsAt = noticeOutlastsArrival ? movement.arriveAt + 1 : movement.arriveAt;
    app.ctx.store.db.prepare('UPDATE tribe_relations SET ends_at = ? WHERE id = ?').run(endsAt, rel?.id ?? 0);
    clock.set(movement.arriveAt);
    const st = await stateOf(bob);
    if (noticeOutlastsArrival) {
      assert.equal(st.stationed.here.length, 1);
      assert.deepEqual(await reports(alice), []);
    } else {
      assert.deepEqual(st.stationed.here, []);
      assert.equal((await reports(alice))[0]?.type, 'support');
      assert.equal((await movementsOf(alice))[0]?.kind, 'return');
    }
    await app.close();
  }
});

test('troops that are already stationed stay, and keep defending, after the relation changes', async () => {
  const { app, clock, alice, amy, bob } = await world();
  giveTroops(app, amy, { pikeman: 6 });
  await stationSupport(app, clock, alice, amy, { pikeman: 10 });
  ok(await amy.c.post('/api/tribe/leave'));
  assert.equal((await stateOf(amy)).stationed.here.length, 1);
  assert.equal((await stateOf(alice)).stationed.abroad.length, 1);

  giveTroops(app, bob, { raider: 5 }); // 200 attack against 260 defense: the defenders hold, with losses
  const { movement } = await sendOk(bob, amy, 'attack', { raider: 5 });
  clock.set(movement.arriveAt);
  const fought = battleOf(await latestReport(alice));
  assert.equal(fought.supportUnits?.pikeman, 10, 'still defending although amy is no longer a tribe-mate');
  assert.equal(fought.attackerWon, false);
  // ...and they can be sent home: the host owner may do so at any time.
  const again = (await stateOf(amy)).stationed.here[0];
  assert.ok(again);
  errorOf(await alice.c.post(`/api/stationed/${again.id}/send-back`), 403, 'forbidden');
  ok(await amy.c.post(`/api/stationed/${again.id}/send-back`), 201);
  await app.close();
});
