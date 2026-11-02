import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  PLAYER_MAX_APPLICATIONS,
  TRIBE_APPLICATION_MESSAGE_MAX,
  TRIBE_DESCRIPTION_MAX,
  TRIBE_EVENTS_KEEP,
  TRIBE_INVITE_TTL_HOURS,
  TRIBE_MAX_MEMBERS,
  TRIBE_MAX_OPEN_INVITES,
  villagePoints,
  type GameStateResponse,
  type MeResponse,
  type MyTribeResponse,
  type TribeDto,
} from '@tribewars/engine';
import { buildApp } from '../src/app.ts';
import { HOUR, MINUTE, TEST_WORLD, errorOf, makeApp, ok, register } from './helpers.ts';
import {
  addMember,
  count,
  fillerPlayer,
  found,
  inviteAndAccept,
  join,
  myTribe,
  newLeader,
  newPlayer,
  setHall,
  type App,
  type P,
} from './tribe-helpers.ts';

const DAY = 24 * HOUR;

// ---- founding ----------------------------------------------------------------------------------------------

test('founding needs Town Hall 3 (built through the real game); the founder leads a one-member tribe', async () => {
  const { app, clock } = await makeApp();
  const c = await register(app, 'founder1');
  const vid = (await c.village()).id;
  const body = { name: 'Iron Wolves', tag: 'wolf', recruitment: 'open' };

  errorOf(await c.post('/api/tribes', body), 409, 'requirements_not_met');
  for (const level of [2, 3]) {
    ok(await c.post(`/api/villages/${vid}/build`, { building: 'hall' }));
    clock.advance(10 * MINUTE);
    if (level === 2) errorOf(await c.post('/api/tribes', body), 409, 'requirements_not_met');
  }
  assert.equal((await c.village()).state.buildings.hall, 3);

  const res = await c.post('/api/tribes', { ...body, description: '  We raid at dawn.  ' });
  ok(res, 201);
  const mine = res.json<MyTribeResponse>();
  const village = await c.village();
  assert.ok(mine.tribe);
  assert.equal(mine.role, 'leader');
  assert.deepEqual(
    [mine.tribe.name, mine.tribe.tag, mine.tribe.members, mine.tribe.rank, mine.tribe.recruitment, mine.tribe.description],
    ['Iron Wolves', 'WOLF', 1, 1, 'open', 'We raid at dawn.'],
  );
  assert.equal(mine.tribe.createdAt, clock.now());
  assert.deepEqual(mine.tribe.relations, []);
  assert.equal(mine.tribe.points, villagePoints(village.state));
  assert.deepEqual(mine.tribe.memberList.map((m) => [m.username, m.role, m.points, m.villageX, m.villageY, m.joinedAt]), [
    ['founder1', 'leader', mine.tribe.points, village.x, village.y, clock.now()],
  ]);
  assert.deepEqual([mine.invites, mine.applications, mine.proposals], [[], [], []]);
  assert.deepEqual(mine.events.map((e) => e.text), ['founder1 founded the tribe.']);

  // PlayerDto.tribe on every route that returns a player.
  const st: GameStateResponse = await c.state();
  assert.deepEqual(st.player.tribe, { id: mine.tribe.id, name: 'Iron Wolves', tag: 'WOLF', role: 'leader' });
  assert.equal(st.tribeInvites, 0);
  const me = (await c.get('/api/auth/me')).json<MeResponse>();
  assert.deepEqual(me.player?.tribe, st.player.tribe);

  // Already in a tribe.
  errorOf(await c.post('/api/tribes', { name: 'Other Name', tag: 'OTH', recruitment: 'open' }), 409, 'already_in_tribe');
  await app.close();
});

test('founding validates identity, description and shape; names and tags are unique', async () => {
  const { app } = await makeApp();
  const a = await newPlayer(app, 'anna');
  const b = await newPlayer(app, 'bert');
  setHall(app, a.id, 3);
  setHall(app, b.id, 3);

  // Nothing leaks through without a session.
  const anon = await app.inject({ method: 'POST', url: '/api/tribes', headers: { host: 'tribewars.test', 'content-type': 'application/json' }, payload: '{}' });
  assert.equal(anon.statusCode, 401);

  const good = { name: 'Ünïcode Wölfe', tag: 'uw', recruitment: 'application' };
  const bad = (patch: Record<string, unknown>, code = 'invalid_input') => b.c.post('/api/tribes', { ...good, name: 'Fresh Name', tag: 'FRSH', ...patch }).then((r) => errorOf(r, 400, code));
  await bad({ name: '<b>x</b>' });
  await bad({ name: 'ab' });
  await bad({ name: 'x'.repeat(31) });
  await bad({ name: 'Wolf Pack\u0000' });
  await bad({ tag: 'X' });
  await bad({ tag: 'TOOLONG1' });
  await bad({ tag: 'A-B' });
  await bad({ tag: 'ÄÖ' });
  await bad({ recruitment: 'closed' });
  await bad({ description: 'x'.repeat(TRIBE_DESCRIPTION_MAX + 1) });
  await bad({ description: 'bad\u0007bell' });
  await bad({ extra: 1 });
  errorOf(await b.c.post('/api/tribes', { name: 'No Tag', recruitment: 'open' }), 400, 'invalid_input');
  errorOf(await b.c.post('/api/tribes', { name: 5, tag: 'AB', recruitment: 'open' }), 400, 'invalid_input');
  assert.equal(count(app, 'tribes'), 0, 'nothing was created');

  const created = await found(a, '  Ünïcode   Wölfe ', ' uw ', 'application', '<b>plain</b> text & more');
  assert.ok(created.tribe);
  assert.deepEqual([created.tribe.name, created.tribe.tag, created.tribe.description], ['Ünïcode Wölfe', 'UW', '<b>plain</b> text & more']);

  // Case-insensitive unique names (whitespace-normalised) and unique tags.
  errorOf(await b.c.post('/api/tribes', { name: 'ünïcode wölfe', tag: 'OTHER', recruitment: 'open' }), 409, 'tribe_name_taken');
  errorOf(await b.c.post('/api/tribes', { name: 'ÜNÏCODE  WÖLFE', tag: 'OTHER', recruitment: 'open' }), 409, 'tribe_name_taken');
  errorOf(await b.c.post('/api/tribes', { name: 'Other Name', tag: 'uw', recruitment: 'open' }), 409, 'tribe_name_taken');
  assert.equal(count(app, 'tribes'), 1);
  const second = await found(b, 'Other Name', 'OTHER');
  assert.equal(second.tribe?.rank, 2);
  await app.close();
});

// ---- joining -------------------------------------------------------------------------------------------------

test('open tribe: anyone tribeless joins at once; recruitment modes gate the direct route', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Open House', 'OPEN', 'open');
  const closed = await newLeader(app, 'lead2', 'Invite Only', 'INV', 'invite');
  const apply = await newLeader(app, 'lead3', 'By Application', 'APP', 'application');
  const joiner = await newPlayer(app, 'joiner');

  // Joining needs no Town Hall.
  const res = await join(joiner, lead.tribeId);
  assert.equal(res.role, 'member');
  assert.deepEqual([res.tribe?.members, res.tribe?.memberList.map((m) => m.username)], [2, ['lead', 'joiner']]);
  assert.deepEqual(res.events.map((e) => e.text), ['joiner joined the tribe.', 'lead founded the tribe.']);
  assert.deepEqual((await joiner.c.state()).player.tribe, { id: lead.tribeId, name: 'Open House', tag: 'OPEN', role: 'member' });
  assert.deepEqual(res.invites, [], 'members never see the invitation list');
  assert.deepEqual(res.applications, []);

  // One tribe per player.
  errorOf(await joiner.c.post(`/api/tribes/${lead.tribeId}/join`), 409, 'already_in_tribe');
  errorOf(await joiner.c.post(`/api/tribes/${closed.tribeId}/join`), 409, 'already_in_tribe');

  const other = await newPlayer(app, 'other');
  errorOf(await other.c.post(`/api/tribes/${closed.tribeId}/join`), 403, 'forbidden');
  errorOf(await other.c.post(`/api/tribes/${apply.tribeId}/join`), 403, 'forbidden');
  errorOf(await other.c.post('/api/tribes/99999/join'), 404, 'not_found');
  errorOf(await other.c.post(`/api/tribes/${lead.tribeId}/apply`, { message: 'hi' }), 403, 'forbidden');
  errorOf(await other.c.post(`/api/tribes/${closed.tribeId}/apply`, { message: 'hi' }), 403, 'forbidden');
  assert.equal((await other.c.state()).player.tribe, null);

  // The tribeless view of GET /api/tribe.
  const none = await myTribe(other);
  assert.deepEqual([none.tribe, none.role, none.invites, none.applications, none.proposals, none.events], [null, null, [], [], [], []]);
  await app.close();
});

test('applications: limits, accept withdraws the rest, decline, withdraw, permissions', async () => {
  const { app, clock } = await makeApp();
  const x = await newLeader(app, 'xlead', 'Tribe X', 'XX', 'application');
  const y = await newLeader(app, 'ylead', 'Tribe Y', 'YY', 'application');
  const z = await newLeader(app, 'zlead', 'Tribe Z', 'ZZ', 'application');
  const w = await newLeader(app, 'wlead', 'Tribe W', 'WW', 'application');
  const a = await newPlayer(app, 'applicant');
  assert.equal(PLAYER_MAX_APPLICATIONS, 3);

  // Message rules.
  errorOf(await a.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'x'.repeat(TRIBE_APPLICATION_MESSAGE_MAX + 1) }), 400, 'invalid_input');
  errorOf(await a.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'bad\u0000' }), 400, 'invalid_input');
  errorOf(await a.c.post(`/api/tribes/${x.tribeId}/apply`, {}), 400, 'invalid_input');
  errorOf(await a.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'hi', extra: true }), 400, 'invalid_input');

  const first = await a.c.post(`/api/tribes/${x.tribeId}/apply`, { message: '  Let me in!  ' });
  ok(first, 201);
  const mine = first.json<MyTribeResponse>();
  assert.deepEqual(mine.applications.map((p) => [p.tribe.tag, p.message, p.username, p.createdAt]), [['XX', 'Let me in!', 'applicant', clock.now()]]);
  assert.equal(mine.tribe, null);
  errorOf(await a.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'again' }), 409, 'requirements_not_met');
  ok(await a.c.post(`/api/tribes/${y.tribeId}/apply`, { message: 'y' }), 201);
  ok(await a.c.post(`/api/tribes/${z.tribeId}/apply`, { message: '' }), 201);
  errorOf(await a.c.post(`/api/tribes/${w.tribeId}/apply`, { message: 'w' }), 409, 'requirements_not_met');
  assert.equal((await myTribe(a)).applications.length, 3);

  // The tribe's officers see it, with the applicant's points; plain members do not.
  const seen = (await myTribe(x)).applications;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]?.username, seen[0]?.message, seen[0]?.points], ['applicant', 'Let me in!', app.ctx.store.tribes.playerPoints(a.id)]);
  assert.ok((seen[0]?.points ?? 0) > 0);
  const appId = seen[0]?.id ?? 0;

  // Withdraw one and the fourth fits; somebody else's application is not yours to withdraw.
  const zApp = (await myTribe(a)).applications.find((p) => p.tribe.tag === 'ZZ');
  errorOf(await x.c.post(`/api/applications/${zApp?.id}/withdraw`), 404, 'not_found');
  const afterWithdraw = await a.c.post(`/api/applications/${zApp?.id}/withdraw`);
  ok(afterWithdraw);
  assert.equal(afterWithdraw.json<MyTribeResponse>().applications.length, 2);
  ok(await a.c.post(`/api/tribes/${w.tribeId}/apply`, { message: 'w' }), 201);
  assert.equal(count(app, 'tribe_applications', 'player_id = ?', a.id), 3);

  // Only officers+ of the right tribe handle it.
  const member = await addMemberViaOpen(app, x, 'xmember');
  errorOf(await member.c.post(`/api/tribe/applications/${appId}/accept`), 403, 'forbidden');
  errorOf(await member.c.post(`/api/tribe/applications/${appId}/decline`), 403, 'forbidden');
  errorOf(await y.c.post(`/api/tribe/applications/${appId}/accept`), 404, 'not_found');
  errorOf(await a.c.post(`/api/tribe/applications/${appId}/accept`), 409, 'not_in_tribe');

  // Accepting joins the applicant and withdraws every other application.
  const accepted = await x.c.post(`/api/tribe/applications/${appId}/accept`);
  ok(accepted);
  const after = accepted.json<MyTribeResponse>();
  assert.deepEqual(after.applications, []);
  assert.equal(after.tribe?.members, 3);
  assert.equal(count(app, 'tribe_applications', 'player_id = ?', a.id), 0);
  assert.equal((await myTribe(y)).applications.length, 0);
  assert.equal((await a.c.state()).player.tribe?.tag, 'XX');
  assert.match(after.events[0]?.text ?? '', /^applicant joined the tribe \(accepted by xlead\)\.$/);
  errorOf(await x.c.post(`/api/tribe/applications/${appId}/accept`), 404, 'not_found');
  errorOf(await a.c.post(`/api/tribes/${y.tribeId}/apply`, { message: 'again' }), 409, 'already_in_tribe');

  // Decline: gone, and the player may apply again.
  const b = await newPlayer(app, 'bapplicant');
  ok(await b.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'hello' }), 201);
  const bApp = (await myTribe(x)).applications[0];
  assert.equal(bApp?.username, 'bapplicant');
  const declined = await x.c.post(`/api/tribe/applications/${bApp?.id}/decline`);
  ok(declined);
  assert.deepEqual(declined.json<MyTribeResponse>().applications, []);
  assert.deepEqual((await myTribe(b)).applications, []);
  ok(await b.c.post(`/api/tribes/${x.tribeId}/apply`, { message: 'hello again' }), 201);
  await app.close();
});

/** The tribe is application-only: switch it open for a moment, let `name` join, switch back. */
async function addMemberViaOpen(app: App, leader: P & { tribeId: number }, name: string): Promise<P> {
  ok(await leader.c.post('/api/tribe/settings', { recruitment: 'open' }));
  const m = await newPlayer(app, name);
  await join(m, leader.tribeId);
  ok(await leader.c.post('/api/tribe/settings', { recruitment: 'application' }));
  return m;
}

// ---- invitations -----------------------------------------------------------------------------------------------

test('invitations: invite, badge, accept, decline, cancel, duplicates and permissions', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Inviters', 'INVT', 'invite');
  const other = await newLeader(app, 'otherlead', 'Others', 'OTH', 'invite');
  const alice = await newPlayer(app, 'alice');
  const member = await newPlayer(app, 'plainmember');
  setHall(app, member.id, 3);
  // plainmember joins via invite so that the tribe stays invite-only
  await inviteAndAccept(lead, member);
  assert.equal((await member.c.state()).player.tribe?.role, 'member');

  // Permissions and input.
  errorOf(await member.c.post('/api/tribe/invites', { username: 'alice' }), 403, 'forbidden');
  errorOf(await alice.c.post('/api/tribe/invites', { username: 'lead' }), 409, 'not_in_tribe');
  errorOf(await lead.c.post('/api/tribe/invites', { username: 'nobody_here' }), 404, 'not_found');
  errorOf(await lead.c.post('/api/tribe/invites', { username: 'plainmember' }), 409, 'already_in_tribe');
  errorOf(await lead.c.post('/api/tribe/invites', { username: '' }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/invites', {}), 400, 'invalid_input');

  // Invite (case-insensitive, surrounding spaces ignored).
  const sent = await lead.c.post('/api/tribe/invites', { username: '  ALICE ' });
  ok(sent, 201);
  const out = sent.json<MyTribeResponse>().invites;
  assert.equal(out.length, 1);
  assert.deepEqual(
    [out[0]?.username, out[0]?.invitedBy, out[0]?.tribe.tag, out[0]?.createdAt, out[0]?.expiresAt],
    ['alice', 'lead', 'INVT', clock.now(), clock.now() + TRIBE_INVITE_TTL_HOURS * HOUR],
  );
  assert.equal(TRIBE_INVITE_TTL_HOURS, 7 * 24);
  errorOf(await lead.c.post('/api/tribe/invites', { username: 'alice' }), 409, 'requirements_not_met');
  assert.deepEqual((await myTribe(member)).invites, [], 'plain members do not see the invitation list');

  // Alice: badge + tribeless view.
  assert.equal((await alice.c.state()).tribeInvites, 1);
  const aView = await myTribe(alice);
  assert.deepEqual([aView.tribe, aView.invites.length, aView.invites[0]?.tribe.name], [null, 1, 'Inviters']);
  const inviteId = aView.invites[0]?.id ?? 0;

  // Not hers: nobody else can accept, decline or cancel through the wrong door.
  errorOf(await member.c.post(`/api/invites/${inviteId}/accept`), 404, 'not_found');
  errorOf(await member.c.post(`/api/invites/${inviteId}/decline`), 404, 'not_found');
  errorOf(await other.c.post(`/api/tribe/invites/${inviteId}/cancel`), 404, 'not_found');
  errorOf(await member.c.post(`/api/tribe/invites/${inviteId}/cancel`), 403, 'forbidden');
  errorOf(await alice.c.post('/api/invites/99999/accept'), 404, 'not_found');

  // Cancel: the invitation disappears for both sides.
  const cancelled = await lead.c.post(`/api/tribe/invites/${inviteId}/cancel`);
  ok(cancelled);
  assert.deepEqual(cancelled.json<MyTribeResponse>().invites, []);
  assert.equal((await alice.c.state()).tribeInvites, 0);
  errorOf(await alice.c.post(`/api/invites/${inviteId}/accept`), 404, 'not_found');

  // Decline.
  ok(await lead.c.post('/api/tribe/invites', { username: 'alice' }), 201);
  const second = (await myTribe(alice)).invites[0];
  assert.ok(second && second.id !== inviteId);
  const declined = await alice.c.post(`/api/invites/${second.id}/decline`);
  ok(declined);
  assert.deepEqual(declined.json<MyTribeResponse>().invites, []);
  assert.deepEqual((await myTribe(lead)).invites, []);

  // Accept: joins, and her other applications are withdrawn.
  const appTribe = await newLeader(app, 'applead', 'Apply Here', 'APPLY', 'application');
  ok(await alice.c.post(`/api/tribes/${appTribe.tribeId}/apply`, { message: 'hi' }), 201);
  ok(await lead.c.post('/api/tribe/invites', { username: 'alice' }), 201);
  ok(await other.c.post('/api/tribe/invites', { username: 'alice' }), 201);
  assert.equal((await alice.c.state()).tribeInvites, 2);
  const mineInv = (await myTribe(alice)).invites.find((i) => i.tribe.tag === 'INVT');
  const accepted = await alice.c.post(`/api/invites/${mineInv?.id}/accept`);
  ok(accepted);
  const after = accepted.json<MyTribeResponse>();
  assert.deepEqual([after.role, after.tribe?.tag, after.tribe?.members], ['member', 'INVT', 3]);
  assert.equal(count(app, 'tribe_applications', 'player_id = ?', alice.id), 0);
  assert.equal((await myTribe(appTribe)).applications.length, 0);
  assert.deepEqual((await alice.c.state()).player.tribe?.tag, 'INVT');
  // In a tribe the leftover invitation cannot be used and does not nag.
  assert.equal((await alice.c.state()).tribeInvites, 0);
  const leftover = app.ctx.store.tribes.invitesForPlayer(alice.id, clock.now())[0];
  assert.equal(leftover?.tribeName, 'Others');
  errorOf(await alice.c.post(`/api/invites/${leftover?.id}/accept`), 409, 'already_in_tribe');

  // ...but after leaving, it is there again and can be accepted.
  ok(await alice.c.post('/api/tribe/leave'));
  assert.equal((await alice.c.state()).tribeInvites, 1);
  const rejoined = await alice.c.post(`/api/invites/${leftover?.id}/accept`);
  ok(rejoined);
  assert.equal(rejoined.json<MyTribeResponse>().tribe?.tag, 'OTH');
  await app.close();
});

test('invitations expire after the real-time TTL and are cleaned up lazily; the open-invite cap is per tribe', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Expirers', 'EXP', 'invite');
  const alice = await newPlayer(app, 'alice');
  ok(await lead.c.post('/api/tribe/invites', { username: 'alice' }), 201);
  const inv = (await myTribe(alice)).invites[0];
  assert.ok(inv);
  const ttl = TRIBE_INVITE_TTL_HOURS * HOUR;
  assert.equal(inv.expiresAt - inv.createdAt, ttl);

  clock.set(inv.expiresAt - 1);
  assert.equal((await alice.c.state()).tribeInvites, 1, 'still open one millisecond before');
  clock.set(inv.expiresAt);
  assert.equal((await alice.c.state()).tribeInvites, 0, 'expired at expiresAt');
  assert.equal(count(app, 'tribe_invites'), 1, 'reads only ignore it; the row is still there');
  errorOf(await alice.c.post(`/api/invites/${inv.id}/accept`), 404, 'not_found');
  errorOf(await alice.c.post(`/api/invites/${inv.id}/decline`), 404, 'not_found');
  assert.deepEqual((await myTribe(lead)).invites, [], 'the leader no longer sees it either');
  assert.equal(count(app, 'tribe_invites'), 0, 'GET /api/tribe cleaned it up');
  assert.deepEqual((await myTribe(alice)).invites, []);

  // A fresh invitation after expiry works (and a stale row never blocks it).
  ok(await lead.c.post('/api/tribe/invites', { username: 'alice' }), 201);
  assert.equal((await alice.c.state()).tribeInvites, 1);

  // Cap: TRIBE_MAX_OPEN_INVITES open invitations at once; expired ones do not count.
  assert.equal(TRIBE_MAX_OPEN_INVITES, 20);
  const names: string[] = [];
  for (let i = 0; i < TRIBE_MAX_OPEN_INVITES; i++) {
    const name = `filler${i}`;
    names.push(name);
    fillerPlayer(app, name, clock.now());
  }
  for (const name of names.slice(0, TRIBE_MAX_OPEN_INVITES - 1)) ok(await lead.c.post('/api/tribe/invites', { username: name }), 201);
  assert.equal((await myTribe(lead)).invites.length, TRIBE_MAX_OPEN_INVITES);
  errorOf(await lead.c.post('/api/tribe/invites', { username: names[TRIBE_MAX_OPEN_INVITES - 1] }), 409, 'requirements_not_met');
  clock.advance(ttl + 1);
  ok(await lead.c.post('/api/tribe/invites', { username: names[TRIBE_MAX_OPEN_INVITES - 1] }), 201);
  assert.equal((await myTribe(lead)).invites.length, 1);
  await app.close();
});

// ---- member cap ------------------------------------------------------------------------------------------------

test('the member cap is checked on join, apply, invitation acceptance and application acceptance', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Crowded House', 'FULL', 'open');
  const t = clock.now();
  const invited = await newPlayer(app, 'invited');
  const applicant = await newPlayer(app, 'applicant');

  // Room for exactly one more, then reserve invitation + application.
  for (let i = 0; i < TRIBE_MAX_MEMBERS - 2; i++) {
    app.ctx.store.tribes.insertMember(fillerPlayer(app, `fill${i}`, t), lead.tribeId, 'member', t);
  }
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), TRIBE_MAX_MEMBERS - 1);
  ok(await lead.c.post('/api/tribe/invites', { username: 'invited' }), 201);
  ok(await lead.c.post('/api/tribe/settings', { recruitment: 'application' }));
  ok(await applicant.c.post(`/api/tribes/${lead.tribeId}/apply`, { message: 'me too' }), 201);

  // The last seat goes to someone else.
  app.ctx.store.tribes.insertMember(fillerPlayer(app, 'lastseat', t), lead.tribeId, 'member', t);
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), TRIBE_MAX_MEMBERS);

  const inviteId = (await myTribe(invited)).invites[0]?.id;
  errorOf(await invited.c.post(`/api/invites/${inviteId}/accept`), 409, 'tribe_full');
  const appId = (await myTribe(lead)).applications[0]?.id;
  errorOf(await lead.c.post(`/api/tribe/applications/${appId}/accept`), 409, 'tribe_full');
  assert.equal(count(app, 'tribe_applications'), 1, 'a refused accept changes nothing');
  assert.equal(count(app, 'tribe_invites'), 1);

  ok(await lead.c.post('/api/tribe/settings', { recruitment: 'open' }));
  errorOf(await applicant.c.post(`/api/tribes/${lead.tribeId}/join`), 409, 'tribe_full');
  ok(await lead.c.post('/api/tribe/settings', { recruitment: 'application' }));
  const another = await newPlayer(app, 'another');
  errorOf(await another.c.post(`/api/tribes/${lead.tribeId}/apply`, { message: 'x' }), 409, 'tribe_full');

  // Somebody leaves: the seat is free again for the waiting invitation.
  const gone = app.ctx.store.tribes.members(lead.tribeId).find((m) => m.username === 'lastseat');
  assert.ok(gone);
  ok(await lead.c.post(`/api/tribe/members/${gone.playerId}/kick`));
  const joined = await invited.c.post(`/api/invites/${inviteId}/accept`);
  ok(joined);
  assert.equal(joined.json<MyTribeResponse>().tribe?.members, TRIBE_MAX_MEMBERS);
  await app.close();
});

// ---- roles, kicking, leadership, leaving, disbanding -------------------------------------------------------------

test('roles and kicking: officers remove members, only the leader removes officers, nobody removes the leader', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Hierarchy', 'HIER', 'open');
  const off = await addMember(app, lead, 'officer1');
  const off2 = await addMember(app, lead, 'officer2');
  const m1 = await addMember(app, lead, 'member1');
  const m2 = await addMember(app, lead, 'member2');
  const role = (p: { id: number }, r: string) => lead.c.post(`/api/tribe/members/${p.id}/role`, { role: r });

  // Only the leader sets roles; the leader's own role is not set here.
  errorOf(await off.c.post(`/api/tribe/members/${m1.id}/role`, { role: 'officer' }), 403, 'forbidden');
  errorOf(await m1.c.post(`/api/tribe/members/${m2.id}/role`, { role: 'officer' }), 403, 'forbidden');
  errorOf(await role(lead, 'member'), 400, 'invalid_target');
  errorOf(await role(m1, 'leader'), 400, 'invalid_input');
  errorOf(await role(m1, 'boss'), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/members/99999/role', { role: 'officer' }), 404, 'not_found');
  const stranger = await newPlayer(app, 'stranger');
  errorOf(await lead.c.post(`/api/tribe/members/${stranger.id}/role`, { role: 'officer' }), 404, 'not_found');

  const promoted = await role(off, 'officer');
  ok(promoted);
  ok(await role(off2, 'officer'));
  assert.deepEqual(promoted.json<MyTribeResponse>().tribe?.memberList.map((m) => [m.username, m.role]), [
    ['lead', 'leader'],
    ['officer1', 'officer'],
    ['officer2', 'member'],
    ['member1', 'member'],
    ['member2', 'member'],
  ]);
  assert.equal(promoted.json<MyTribeResponse>().events[0]?.text, 'lead promoted officer1 to officer.');
  assert.deepEqual((await off.c.state()).player.tribe?.role, 'officer');
  const before = (await myTribe(lead)).events.length;
  ok(await role(off, 'officer'));
  assert.equal((await myTribe(lead)).events.length, before, 'setting the same role again is a no-op');

  // Officers: remove members only.
  errorOf(await off.c.post(`/api/tribe/members/${lead.id}/kick`), 403, 'forbidden');
  errorOf(await off.c.post(`/api/tribe/members/${off2.id}/kick`), 403, 'forbidden');
  errorOf(await off.c.post(`/api/tribe/members/${off.id}/kick`), 400, 'invalid_target');
  errorOf(await off.c.post(`/api/tribe/members/${stranger.id}/kick`), 404, 'not_found');
  errorOf(await m1.c.post(`/api/tribe/members/${m2.id}/kick`), 403, 'forbidden');
  errorOf(await lead.c.post(`/api/tribe/members/${lead.id}/kick`), 400, 'invalid_target');
  const kicked = await off.c.post(`/api/tribe/members/${m2.id}/kick`);
  ok(kicked);
  assert.equal(kicked.json<MyTribeResponse>().events[0]?.text, 'member2 was removed from the tribe by officer1.');
  assert.equal((await m2.c.state()).player.tribe, null);
  errorOf(await m2.c.get('/api/tribe/chat'), 409, 'not_in_tribe');

  // The leader removes an officer; the removed player can join an open tribe again.
  ok(await lead.c.post(`/api/tribe/members/${off2.id}/kick`));
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), 3);
  assert.equal((await join(m2, lead.tribeId)).role, 'member');
  await app.close();
});

test('leadership: transfer, leaving rules, disbanding', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Succession', 'SUCC', 'open');
  const off = await addMember(app, lead, 'heir');
  const mem = await addMember(app, lead, 'plain');
  ok(await lead.c.post(`/api/tribe/members/${off.id}/role`, { role: 'officer' }));

  // Transfer rules.
  errorOf(await off.c.post('/api/tribe/transfer', { playerId: mem.id }), 403, 'forbidden');
  errorOf(await mem.c.post('/api/tribe/transfer', { playerId: mem.id }), 403, 'forbidden');
  errorOf(await lead.c.post('/api/tribe/transfer', { playerId: lead.id }), 400, 'invalid_target');
  const stranger = await newPlayer(app, 'stranger');
  errorOf(await lead.c.post('/api/tribe/transfer', { playerId: stranger.id }), 404, 'not_found');
  errorOf(await lead.c.post('/api/tribe/transfer', { playerId: 0 }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/transfer', { playerId: 'x' }), 400, 'invalid_input');

  // The leader cannot just walk away while others remain.
  const refused = await lead.c.post('/api/tribe/leave');
  errorOf(refused, 409, 'requirements_not_met');
  assert.match(refused.json<{ message: string }>().message, /leadership/i);
  assert.equal((await myTribe(lead)).role, 'leader');

  // Hand over to the heir: the old leader becomes an officer.
  const res = await lead.c.post('/api/tribe/transfer', { playerId: off.id });
  ok(res);
  const view = res.json<MyTribeResponse>();
  assert.equal(view.role, 'officer');
  assert.deepEqual(view.tribe?.memberList.map((m) => [m.username, m.role]), [['heir', 'leader'], ['lead', 'officer'], ['plain', 'member']]);
  assert.equal(view.events[0]?.text, 'lead handed leadership to heir.');
  assert.equal((await off.c.state()).player.tribe?.role, 'leader');
  assert.equal(count(app, 'tribe_members', "tribe_id = ? AND role = 'leader'", lead.tribeId), 1);
  errorOf(await lead.c.post('/api/tribe/disband'), 403, 'forbidden');

  // The former leader can leave now; a plain member can leave too.
  const left = await lead.c.post('/api/tribe/leave');
  ok(left);
  assert.deepEqual([left.json<MyTribeResponse>().tribe, left.json<MyTribeResponse>().role], [null, null]);
  assert.equal((await lead.c.state()).player.tribe, null);
  errorOf(await lead.c.post('/api/tribe/leave'), 409, 'not_in_tribe');
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), 2);
  assert.match((await myTribe(off)).events[0]?.text ?? '', /^lead left the tribe\.$/);

  // Last member leaves: the tribe is disbanded and everything hanging off it is gone.
  ok(await off.c.post('/api/tribe/invites', { username: 'stranger' }), 201);
  ok(await mem.c.post('/api/tribe/leave'));
  const gone = await off.c.post('/api/tribe/leave');
  ok(gone);
  assert.equal(gone.json<MyTribeResponse>().tribe, null);
  errorOf(await stranger.c.get(`/api/tribes/${lead.tribeId}`), 404, 'not_found');
  for (const table of ['tribes', 'tribe_members', 'tribe_invites', 'tribe_applications', 'tribe_proposals', 'tribe_relations', 'tribe_events', 'tribe_messages']) {
    assert.equal(count(app, table), 0, table);
  }
  assert.equal((await stranger.c.state()).tribeInvites, 0);

  // The leader disbands a tribe with several members; all of them are released.
  const l2 = await newLeader(app, 'lead2', 'Doomed', 'DOOM', 'open');
  const a = await addMember(app, l2, 'doomed1');
  const b = await addMember(app, l2, 'doomed2');
  errorOf(await a.c.post('/api/tribe/disband'), 403, 'forbidden');
  const disbanded = await l2.c.post('/api/tribe/disband');
  ok(disbanded);
  assert.equal(disbanded.json<MyTribeResponse>().tribe, null);
  for (const p of [l2, a, b]) {
    assert.equal((await p.c.state()).player.tribe, null);
    assert.equal((await myTribe(p)).tribe, null);
  }
  assert.equal(count(app, 'tribe_members'), 0);
  errorOf(await l2.c.post('/api/tribe/disband'), 409, 'not_in_tribe');
  await app.close();
});

test('permissions: members are refused leader/officer actions, outsiders get not_in_tribe', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Rules', 'RULE', 'open');
  const mem = await addMember(app, lead, 'plain');
  const out = await newPlayer(app, 'outsider');

  const calls: Array<[string, unknown?]> = [
    ['/api/tribe/settings', { description: 'x' }],
    ['/api/tribe/invites', { username: 'outsider' }],
    ['/api/tribe/invites/1/cancel'],
    ['/api/tribe/applications/1/accept'],
    ['/api/tribe/applications/1/decline'],
    [`/api/tribe/members/${lead.id}/kick`],
    [`/api/tribe/members/${lead.id}/role`, { role: 'officer' }],
    ['/api/tribe/transfer', { playerId: lead.id }],
    ['/api/tribe/disband'],
    ['/api/tribe/diplomacy', { tag: 'RULE', kind: 'nap' }],
    ['/api/tribe/diplomacy/proposals/1/accept'],
    ['/api/tribe/diplomacy/proposals/1/decline'],
    ['/api/tribe/diplomacy/proposals/1/withdraw'],
    ['/api/tribe/diplomacy/relations/1/cancel'],
  ];
  for (const [url, body] of calls) {
    errorOf(await mem.c.post(url, body), 403, 'forbidden');
    errorOf(await out.c.post(url, body), 409, 'not_in_tribe');
  }
  errorOf(await out.c.post('/api/tribe/leave'), 409, 'not_in_tribe');
  errorOf(await out.c.get('/api/tribe/chat'), 409, 'not_in_tribe');
  errorOf(await out.c.post('/api/tribe/chat', { text: 'hi' }), 409, 'not_in_tribe');

  // Signed-out callers get 401 everywhere, including the read routes.
  for (const url of ['/api/tribes', '/api/tribes/1', '/api/tribe', '/api/tribe/chat']) {
    const res = await app.inject({ method: 'GET', url, headers: { host: 'tribewars.test' } });
    assert.equal(res.statusCode, 401, url);
  }
  // Malformed ids never reach the database.
  errorOf(await lead.c.get('/api/tribes/abc'), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/invites/-1/cancel'), 400, 'invalid_input');
  errorOf(await lead.c.get('/api/tribe/chat?after=x'), 400, 'invalid_input');
  await app.close();
});

test('settings: leader and officers edit description and recruitment; changes are logged', async () => {
  const { app } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Settings Tribe', 'SET', 'open');
  const off = await addMember(app, lead, 'officer');
  const mem = await addMember(app, lead, 'plain');
  ok(await lead.c.post(`/api/tribe/members/${off.id}/role`, { role: 'officer' }));

  errorOf(await mem.c.post('/api/tribe/settings', { description: 'hacked' }), 403, 'forbidden');
  errorOf(await lead.c.post('/api/tribe/settings', {}), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/settings', { name: 'Renamed' }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/settings', { tag: 'NEW' }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/settings', { recruitment: 'closed' }), 400, 'invalid_input');
  errorOf(await lead.c.post('/api/tribe/settings', { description: 'x'.repeat(TRIBE_DESCRIPTION_MAX + 1) }), 400, 'invalid_input');

  const res = await off.c.post('/api/tribe/settings', { description: ' <i>Welcome</i> & \n line two ', recruitment: 'application' });
  ok(res);
  const tribe = res.json<MyTribeResponse>().tribe;
  assert.deepEqual([tribe?.description, tribe?.recruitment], ['<i>Welcome</i> & \n line two', 'application']);
  assert.deepEqual(res.json<MyTribeResponse>().events.slice(0, 2).map((e) => e.text), [
    'officer set recruitment to applications.',
    'officer updated the tribe description.',
  ]);
  // Anyone signed in sees the public view, with the text exactly as stored (clients render it as text).
  const outsider = await newPlayer(app, 'outsider');
  const pub = (await outsider.c.get(`/api/tribes/${lead.tribeId}`)).json<TribeDto>();
  assert.deepEqual([pub.description, pub.recruitment, pub.members], ['<i>Welcome</i> & \n line two', 'application', 3]);

  // Only one change at a time is fine, and an unchanged value logs nothing.
  const n = (await myTribe(lead)).events.length;
  ok(await lead.c.post('/api/tribe/settings', { recruitment: 'application' }));
  assert.equal((await myTribe(lead)).events.length, n);
  const cleared = await lead.c.post('/api/tribe/settings', { description: '' });
  ok(cleared);
  assert.equal(cleared.json<MyTribeResponse>().tribe?.description, '');
  await app.close();
});

test('the event log keeps the newest TRIBE_EVENTS_KEEP entries and the API shows the newest 50', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Chatty Log', 'LOG', 'open');
  const ts = app.ctx.store.tribes;
  for (let i = 0; i < TRIBE_EVENTS_KEEP + 50; i++) ts.insertEvent(lead.tribeId, clock.now(), `event ${i}`, TRIBE_EVENTS_KEEP);
  assert.equal(count(app, 'tribe_events', 'tribe_id = ?', lead.tribeId), TRIBE_EVENTS_KEEP);
  const events = (await myTribe(lead)).events;
  assert.equal(events.length, 50);
  assert.equal(events[0]?.text, `event ${TRIBE_EVENTS_KEEP + 49}`);
  assert.equal(events[49]?.text, `event ${TRIBE_EVENTS_KEEP}`);
  assert.ok(events.every((e, i) => i === 0 || e.id < (events[i - 1]?.id ?? 0)), 'newest first');
  // The founding line was pruned long ago; new ones still arrive.
  await addMember(app, lead, 'newcomer');
  assert.equal((await myTribe(lead)).events[0]?.text, 'newcomer joined the tribe.');
  assert.equal(count(app, 'tribe_events', 'tribe_id = ?', lead.tribeId), TRIBE_EVENTS_KEEP);
  await app.close();
});

// ---- points, ranking, search ---------------------------------------------------------------------------------------

test('tribe list ranks by members\' points (ties: older tribe first), searches by name or tag', async () => {
  const { app, clock } = await makeApp();
  const t1 = await newLeader(app, 'one', 'First Founded', 'FIRST');
  clock.advance(HOUR);
  const t2 = await newLeader(app, 'two', 'Second Founded', 'SECOND');
  clock.advance(HOUR);
  const t3 = await newLeader(app, 'three', 'Third Wolves', 'WOLF3');
  const viewer = await newPlayer(app, 'viewer');

  const ranking = async (q?: string) => {
    const res = await viewer.c.get(q === undefined ? '/api/tribes' : `/api/tribes?q=${encodeURIComponent(q)}`);
    ok(res);
    return res.json<{ tribes: Array<{ id: number; tag: string; rank: number; points: number; members: number; recruitment: string; name: string }> }>().tribes;
  };

  // Equal points: the older tribe ranks first.
  let list = await ranking();
  assert.deepEqual(list.map((t) => [t.tag, t.rank]), [['FIRST', 1], ['SECOND', 2], ['WOLF3', 3]]);
  assert.equal(new Set(list.map((t) => t.points)).size, 1);
  assert.deepEqual([list[0]?.members, list[0]?.recruitment, list[0]?.name], [1, 'open', 'First Founded']);

  // More points move a tribe up; a member's points count for the tribe.
  setHall(app, t3.id, 10);
  list = await ranking();
  assert.deepEqual(list.map((t) => t.tag), ['WOLF3', 'FIRST', 'SECOND']);
  const base = list[1]?.points ?? 0;
  assert.equal((list[0]?.points ?? 0) - base, 7);
  const joiner = await newPlayer(app, 'joiner');
  setHall(app, joiner.id, 12);
  await join(joiner, t2.tribeId);
  list = await ranking();
  assert.deepEqual(list.map((t) => [t.tag, t.rank]), [['SECOND', 1], ['WOLF3', 2], ['FIRST', 3]]);
  assert.equal(list[0]?.points, 2 * base + 9, 'two members: leader + joiner');
  assert.equal(list[0]?.members, 2);

  // The view of a single tribe carries the same rank and the member list.
  const one = (await viewer.c.get(`/api/tribes/${t2.tribeId}`)).json<TribeDto>();
  assert.deepEqual([one.rank, one.points, one.members, one.memberList.map((m) => m.username)], [1, list[0]?.points, 2, ['two', 'joiner']]);
  errorOf(await viewer.c.get('/api/tribes/424242'), 404, 'not_found');

  // Search: name or tag, case-insensitive, global ranks preserved.
  assert.deepEqual((await ranking('wolf')).map((t) => [t.tag, t.rank]), [['WOLF3', 2]]);
  assert.deepEqual((await ranking('FOUNDED')).map((t) => [t.tag, t.rank]), [['SECOND', 1], ['FIRST', 3]]);
  assert.deepEqual((await ranking('  second ')).map((t) => t.tag), ['SECOND']);
  assert.deepEqual(await ranking('nothing like this'), []);
  assert.equal((await ranking('')).length, 3);
  // LIKE wildcards are plain characters.
  assert.deepEqual(await ranking('%'), []);
  errorOf(await viewer.c.get(`/api/tribes?q=${'x'.repeat(65)}`), 400, 'invalid_input');
  errorOf(await viewer.c.get('/api/tribes?other=1'), 400, 'invalid_input');
  await app.close();
});

test('member points follow the village: completed builds show up once the player looks', async () => {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Builders', 'BLD');
  const vid = (await lead.c.village()).id;
  const before = (await myTribe(lead)).tribe?.points ?? 0;
  ok(await lead.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  clock.advance(HOUR);
  const after = (await myTribe(lead)).tribe;
  assert.equal(after?.points, before + 1);
  assert.equal(after?.memberList[0]?.points, before + 1);
  await app.close();
});

// ---- persistence ---------------------------------------------------------------------------------------------------

test('an older database without tribe tables is upgraded in place on start', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'tw-tribes-'));
  const path = pathJoin(dir, 'game.sqlite');
  try {
    const clockNow = Date.UTC(2026, 5, 1, 12, 0, 0);
    let app = await buildApp({ dbPath: path, now: () => clockNow, settings: TEST_WORLD, webDistDir: '/nonexistent', secureCookies: false });
    const c = await register(app, 'veteran');
    const id = (await c.state()).player.id;
    await app.close();

    // Make it look like a database from before tribes existed.
    const db = new DatabaseSync(path);
    for (const table of ['tribe_messages', 'tribe_events', 'tribe_relations', 'tribe_proposals', 'tribe_applications', 'tribe_invites', 'tribe_members', 'tribes']) {
      db.exec(`DROP TABLE ${table}`);
    }
    db.close();

    app = await buildApp({ dbPath: path, now: () => clockNow, settings: TEST_WORLD, webDistDir: '/nonexistent', secureCookies: false });
    const again = await register(app, 'newcomer');
    const mine = await again.get('/api/tribe');
    ok(mine);
    assert.equal(mine.json<MyTribeResponse>().tribe, null);
    // The old player survived with his village and can use tribes.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: 'tribewars.test', origin: 'http://tribewars.test', 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'veteran', password: 'correct horse battery' }),
    });
    assert.equal(login.statusCode, 200);
    const player = login.json<MeResponse>().player;
    assert.equal(player?.id, id);
    assert.equal(player?.tribe, null);
    await app.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
