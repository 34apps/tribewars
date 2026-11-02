import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyResources,
  emptyUnits,
  pactNoticeMs,
  travelTimeMs,
  type MapResponse,
  type MapVillageDto,
  type MeResponse,
  type MyTribeResponse,
  type ReportDto,
  type ReportListResponse,
  type SendResponse,
} from '@tribewars/engine';
import { Client, PASSWORD, errorOf, makeApp, ok } from './helpers.ts';
import { count, formPact, inviteAndAccept, myTribe, newLeader, newPlayer, warSetup } from './tribe-helpers.ts';

const RADIUS = 12;
const wholeMap = async (who: Client | { c: Client }): Promise<MapVillageDto[]> => {
  const c = who instanceof Client ? who : who.c;
  const span = RADIUS * 2 + 1;
  const res = await c.get(`/api/map?x=${-RADIUS}&y=${-RADIUS}&w=${span}&h=${span}`);
  ok(res);
  return res.json<MapResponse>().villages;
};

// ---- sending -----------------------------------------------------------------------------------------------

test('send: refused against tribe-mates, allies and NAP partners (also during notice); allowed once the notice is over', async () => {
  const { app, clock, alice, bob, vidA, vb, send } = await warSetup();
  const home = async () => (await alice.c.state()).villages[0]?.state.troops.raider;
  const refusedAndHome = async (status: number, code: string): Promise<string> => {
    const res = await send();
    errorOf(res, status, code);
    assert.equal(await home(), 14, 'a refused send keeps the troops home');
    assert.deepEqual((await alice.c.state()).movements, []);
    return res.json<{ message: string }>().message;
  };

  // A tribe-mate, even one under beginner protection, is never a target.
  const carol = await newPlayer(app, 'carol');
  await inviteAndAccept(alice, carol);
  const vc = await carol.c.village();
  assert.ok((await carol.c.state()).player.protectedUntil > clock.now(), 'carol is under beginner protection');
  const mate = await alice.c.post(`/api/villages/${vidA}/send`, { x: vc.x, y: vc.y, units: { raider: 14 } });
  errorOf(mate, 400, 'invalid_target');
  assert.equal(mate.json<{ message: string }>().message, "You can't attack members of your own tribe.");
  assert.equal(await home(), 14);
  ok(await carol.c.post('/api/tribe/leave'));
  // Once she has left, only her beginner protection stops us.
  errorOf(await alice.c.post(`/api/villages/${vidA}/send`, { x: vc.x, y: vc.y, units: { raider: 14 } }), 409, 'target_protected');

  // Allies.
  await formPact(alice, 'BRAVO', bob, 'ally');
  const ally = await refusedAndHome(409, 'target_protected');
  assert.match(ally, /\[BRAVO\]/);
  assert.match(ally, /alliance/);
  // The pact protects both ways (the pact check comes before the troop check).
  const vbob = await bob.c.village();
  const valice = await alice.c.village();
  errorOf(await bob.c.post(`/api/villages/${vbob.id}/send`, { x: valice.x, y: valice.y, units: {} }), 409, 'target_protected');

  // NAP partners (the pact replaces the alliance).
  await formPact(alice, 'BRAVO', bob, 'nap');
  const nap = await refusedAndHome(409, 'target_protected');
  assert.match(nap, /\[BRAVO\]/);
  assert.match(nap, /non-aggression pact/);

  // Cancelling starts the notice: still protected until the very end.
  const rel = (await myTribe(alice)).tribe?.relations[0];
  const t0 = clock.now();
  ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  const endsAt = t0 + pactNoticeMs(app.ctx.settings);
  assert.match(await refusedAndHome(409, 'target_protected'), /being cancelled/);
  clock.set(endsAt - 1);
  await refusedAndHome(409, 'target_protected');
  clock.set(endsAt);
  const sent = await send();
  ok(sent, 201);
  assert.equal(sent.json<SendResponse>().movement.target.villageId, vb.id);
  // The expired relation was only ignored so far; the next tribe request removes it.
  await myTribe(alice);
  assert.equal(count(app, 'tribe_relations'), 0, 'the ended pact was cleaned up');
  await app.close();
});

test('enemies can be attacked; a war is only a label', async () => {
  const { app, alice, bob, send } = await warSetup();
  ok(await alice.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'enemy' }), 201);
  assert.equal((await wholeMap(alice)).find((v) => v.ownerName === 'bob')?.relation, 'enemy');
  assert.equal((await wholeMap(bob)).find((v) => v.ownerName === 'alice')?.relation, 'enemy');
  ok(await send(), 201);
  await app.close();
});

// ---- arrival -----------------------------------------------------------------------------------------------

for (const kind of ['ally', 'nap'] as const) {
  test(`an attack is called off on arrival when ${kind === 'ally' ? 'an alliance' : 'a NAP'} forms mid-march`, async () => {
    const { app, clock, alice, bob, vidA, vb, send } = await warSetup();
    const bobBefore = (await bob.c.village()).state;
    const sent = await send();
    ok(sent, 201);
    const { movement, village: aliceAtSend } = sent.json<SendResponse>();
    assert.equal(aliceAtSend.state.away.raider, 14);

    // While the army marches, the two tribes make peace. (A NAP is also kept when it is already being cancelled.)
    await formPact(bob, 'ALPHA', alice, kind);
    if (kind === 'nap') {
      const rel = (await myTribe(alice)).tribe?.relations[0];
      ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
    }
    clock.set(movement.arriveAt - 1);
    assert.equal((await alice.c.state()).unreadReports, 0);
    clock.set(movement.arriveAt);

    // No battle: Bob hears nothing and loses nothing.
    const bobState = await bob.c.state();
    assert.equal(bobState.unreadReports, 0);
    assert.deepEqual((await bob.c.get('/api/reports')).json<ReportListResponse>().reports, []);
    assert.deepEqual(bobState.movements, [], 'bob sees no attack any more');
    const bobNow = bobState.villages[0]?.state;
    assert.deepEqual(bobNow?.troops, bobBefore.troops);
    assert.equal(bobNow?.away.raider, 0);

    // Alice: her troops are on their way home, empty-handed, and she has a "called off" report.
    const st = await alice.c.state();
    assert.equal(st.unreadReports, 1);
    assert.equal(st.movements.length, 1);
    const ret = st.movements[0];
    assert.ok(ret);
    assert.deepEqual([ret.kind, ret.direction, ret.origin.villageId, ret.target.villageId, ret.departAt], ['return', 'outgoing', vb.id, vidA, movement.arriveAt]);
    assert.equal(ret.units?.raider, 14);
    assert.deepEqual(ret.loot, emptyResources());
    const home = await alice.c.village();
    assert.equal(
      ret.arriveAt - ret.departAt,
      travelTimeMs({ x: vb.x, y: vb.y }, { x: home.x, y: home.y }, ret.units ?? emptyUnits(), app.ctx.settings),
      'normal return path',
    );
    const list = (await alice.c.get('/api/reports')).json<ReportListResponse>().reports;
    assert.equal(list.length, 1);
    const summary = list[0];
    assert.deepEqual([summary?.side, summary?.won, summary?.read, summary?.createdAt], ['attack', false, false, movement.arriveAt]);
    assert.equal(summary?.title, `Attack on ${vb.name} (${vb.x}|${vb.y}) called off`);
    assert.equal(summary?.outcome, 'called_off', 'the list tells a called-off attack from a lost battle');
    const detailDto = (await alice.c.get(`/api/reports/${summary?.id}`)).json<ReportDto>();
    assert.deepEqual([detailDto.outcome, detailDto.won], ['called_off', false]);
    const b = detailDto.battle;
    assert.equal(b.outcome, 'called_off');
    assert.deepEqual([b.attackerWon, b.luck, b.attackPower, b.defensePower], [false, 0, 0, 0]);
    assert.deepEqual([b.attackerUnits.raider, b.attackerLosses, b.defenderUnits, b.defenderLosses, b.wallLevel, b.loot], [14, emptyUnits(), null, null, null, emptyResources()]);
    assert.deepEqual([b.attacker.villageId, b.attacker.ownerName, b.defender.villageId, b.defender.ownerName], [vidA, 'alice', vb.id, 'bob']);

    // The troops arrive home unchanged, with no loot.
    const before = (await alice.c.village()).state.resources;
    clock.set(ret.arriveAt);
    const back = await alice.c.state();
    assert.deepEqual(back.movements, []);
    assert.equal(back.villages[0]?.state.troops.raider, 14);
    assert.equal(back.villages[0]?.state.away.raider, 0);
    assert.ok(back.villages[0]?.state.resources.wood && before.wood <= back.villages[0].state.resources.wood);
    assert.equal(count(app, 'movements'), 0);
    await app.close();
  });
}

test('an alliance that has ended by the time the troops arrive no longer protects the target', async () => {
  const { app, clock, alice, bob, send } = await warSetup();
  const sent = await send();
  ok(sent, 201);
  const { movement } = sent.json<SendResponse>();
  await formPact(alice, 'BRAVO', bob, 'ally');
  const rel = (await myTribe(alice)).tribe?.relations[0];
  ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  // The notice ends exactly when the army gets there (arrival is the first moment without protection).
  app.ctx.store.db.prepare('UPDATE tribe_relations SET ends_at = ? WHERE id = ?').run(movement.arriveAt, rel?.id ?? 0);
  clock.set(movement.arriveAt);
  const reports = (await bob.c.get('/api/reports')).json<ReportListResponse>().reports;
  assert.equal(reports.length, 1, 'a real battle happened');
  assert.equal(reports[0]?.outcome, 'battle');
  const detail = (await bob.c.get(`/api/reports/${reports[0]?.id}`)).json<ReportDto>();
  assert.equal(detail.battle.outcome, 'battle');
  assert.equal(detail.outcome, 'battle');
  assert.equal(detail.side, 'defense');
  await app.close();
});

test('reports stored before tribes existed (no outcome) are read as battles', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'oldtimer');
  const ref = { villageId: 1, name: 'A', x: 0, y: 0, ownerName: null };
  const legacy = {
    attacker: ref,
    defender: ref,
    attackerWon: true,
    luck: 0.01,
    attackPower: 10,
    defensePower: 5,
    attackerUnits: emptyUnits(),
    attackerLosses: emptyUnits(),
    defenderUnits: emptyUnits(),
    defenderLosses: emptyUnits(),
    wallLevel: 0,
    loot: emptyResources(),
  };
  const id = app.ctx.store.insertReport({ playerId: p.id, side: 'attack', won: true, title: 'Raid', createdAt: clock.now(), battle: legacy as never });
  const listed = (await p.c.get('/api/reports')).json<ReportListResponse>().reports;
  assert.deepEqual(listed.map((r) => [r.id, r.outcome]), [[id, 'battle']]);
  const report = (await p.c.get(`/api/reports/${id}`)).json<ReportDto>();
  assert.equal(report.battle.outcome, 'battle');
  assert.equal(report.outcome, 'battle');
  assert.equal(report.battle.attackPower, 10);
  await app.close();
});

// ---- map and player info ---------------------------------------------------------------------------------------

test('map: tribe tag and relation from the viewer\'s side, loaded once per request', async () => {
  const { app, clock } = await makeApp();
  const v = await newLeader(app, 'viewer', 'View Tribe', 'VIEW', 'invite');
  const mate = await newPlayer(app, 'mate');
  await inviteAndAccept(v, mate);
  const al = await newLeader(app, 'ally1', 'Ally Tribe', 'ALLY', 'invite');
  const np = await newLeader(app, 'nap1', 'Nap Tribe', 'NAPT', 'invite');
  const en = await newLeader(app, 'enemy1', 'Enemy Tribe', 'ENEM', 'invite');
  const ne = await newLeader(app, 'neutral1', 'Neutral Tribe', 'NEUT', 'invite');
  const lo = await newPlayer(app, 'loner');
  await formPact(v, 'ALLY', al, 'ally');
  await formPact(np, 'VIEW', v, 'nap');
  ok(await v.c.post('/api/tribe/diplomacy', { tag: 'ENEM', kind: 'enemy' }), 201);

  const view = (villages: MapVillageDto[]) => Object.fromEntries(villages.filter((x) => x.ownerName !== null).map((x) => [x.ownerName, [x.relation, x.tribeTag, x.kind]]));
  assert.deepEqual(view(await wholeMap(v.c)), {
    viewer: ['self', 'VIEW', 'own'],
    mate: ['tribe', 'VIEW', 'player'],
    ally1: ['ally', 'ALLY', 'player'],
    nap1: ['nap', 'NAPT', 'player'],
    enemy1: ['enemy', 'ENEM', 'player'],
    neutral1: ['neutral', 'NEUT', 'player'],
    loner: ['neutral', null, 'player'],
  });
  // tribeId is the owner's tribe: the same id for tribe-mates, each other tribe's own, null when tribeless.
  const tribeIds = (villages: MapVillageDto[]) => Object.fromEntries(villages.filter((x) => x.ownerName !== null).map((x) => [x.ownerName, x.tribeId]));
  assert.deepEqual(tribeIds(await wholeMap(v.c)), {
    viewer: v.tribeId,
    mate: v.tribeId,
    ally1: al.tribeId,
    nap1: np.tribeId,
    enemy1: en.tribeId,
    neutral1: ne.tribeId,
    loner: null,
  });
  assert.equal(new Set([v.tribeId, al.tribeId, np.tribeId, en.tribeId, ne.tribeId]).size, 5);
  // Abandoned villages have neither.
  const abandoned = (await wholeMap(v.c)).filter((x) => x.kind === 'abandoned');
  assert.ok(abandoned.length > 0);
  assert.ok(abandoned.every((x) => x.relation === null && x.tribeTag === null && x.tribeId === null));

  // The same world from other seats: relations are symmetric, pairs without one are neutral.
  assert.deepEqual(view(await wholeMap(al.c)), {
    viewer: ['ally', 'VIEW', 'player'],
    mate: ['ally', 'VIEW', 'player'],
    ally1: ['self', 'ALLY', 'own'],
    nap1: ['neutral', 'NAPT', 'player'],
    enemy1: ['neutral', 'ENEM', 'player'],
    neutral1: ['neutral', 'NEUT', 'player'],
    loner: ['neutral', null, 'player'],
  });
  assert.equal((await wholeMap(en.c)).find((x) => x.ownerName === 'viewer')?.relation, 'enemy');
  assert.equal((await wholeMap(mate.c)).find((x) => x.ownerName === 'nap1')?.relation, 'nap');
  assert.equal((await wholeMap(ne.c)).find((x) => x.ownerName === 'viewer')?.relation, 'neutral');
  // A tribeless viewer: everybody is neutral except himself.
  const lonerView = view(await wholeMap(lo.c));
  assert.deepEqual(lonerView.loner, ['self', null, 'own']);
  assert.deepEqual(lonerView.viewer, ['neutral', 'VIEW', 'player']);

  // The viewer's tribe data is read once per request, not once per village.
  const ts = app.ctx.store.tribes;
  const calls = { membership: 0, kinds: 0, between: 0 };
  const membership = ts.membership.bind(ts);
  const kinds = ts.relationKindsOf.bind(ts);
  const between = ts.relationBetween.bind(ts);
  ts.membership = (id) => (calls.membership++, membership(id));
  ts.relationKindsOf = (id, at) => (calls.kinds++, kinds(id, at));
  ts.relationBetween = (x, y, at) => (calls.between++, between(x, y, at));
  const villages = await wholeMap(v.c);
  assert.ok(villages.length > 10);
  assert.deepEqual(calls, { membership: 1, kinds: 1, between: 0 });
  // Authentication does not go through the tribe store, so these counts are the map's own.

  // A pact being cancelled still shows as a pact until it ends, then the map ignores it even before cleanup.
  ts.membership = membership;
  ts.relationKindsOf = kinds;
  ts.relationBetween = between;
  const rel = (await myTribe(v)).tribe?.relations.find((r) => r.kind === 'ally');
  ok(await v.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  assert.equal((await wholeMap(v.c)).find((x) => x.ownerName === 'ally1')?.relation, 'ally');
  clock.advance(pactNoticeMs(app.ctx.settings));
  assert.equal(count(app, 'tribe_relations', "kind = 'ally'"), 1);
  assert.equal((await wholeMap(v.c)).find((x) => x.ownerName === 'ally1')?.relation, 'neutral');
  await app.close();
});

test('PlayerDto.tribe and GameState.tribeInvites show up on every route that returns them', async () => {
  const { app } = await makeApp();
  const c = new Client(app, '10.8.0.1');
  const reg = await c.post('/api/auth/register', { username: 'newbie', password: PASSWORD });
  ok(reg, 201);
  assert.equal(reg.json<MeResponse>().player?.tribe, null);
  assert.equal((await c.get('/api/auth/me')).json<MeResponse>().player?.tribe, null);
  const lead = await newLeader(app, 'lead', 'Dto Tribe', 'DTO', 'invite');
  ok(await lead.c.post('/api/tribe/invites', { username: 'newbie' }), 201);
  const st = await c.state();
  assert.deepEqual([st.player.tribe, st.tribeInvites], [null, 1]);

  const inv = (await c.get('/api/tribe')).json<MyTribeResponse>().invites[0];
  ok(await c.post(`/api/invites/${inv?.id}/accept`));
  const expected = { id: lead.tribeId, name: 'Dto Tribe', tag: 'DTO', role: 'member' };
  assert.deepEqual((await c.state()).player.tribe, expected);
  assert.deepEqual((await c.get('/api/auth/me')).json<MeResponse>().player?.tribe, expected);
  const login = new Client(app, '10.8.0.2');
  const res = await login.post('/api/auth/login', { username: 'newbie', password: PASSWORD });
  ok(res);
  assert.deepEqual(res.json<MeResponse>().player?.tribe, expected);
  assert.equal((await c.state()).tribeInvites, 0);
  // Role changes show immediately.
  ok(await lead.c.post(`/api/tribe/members/${(await c.state()).player.id}/role`, { role: 'officer' }));
  assert.equal((await c.state()).player.tribe?.role, 'officer');
  await app.close();
});
