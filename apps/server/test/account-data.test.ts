// Account deletion and data export (docs/PRIVACY.md; contract at the end of packages/engine/src/api.ts).
// Fast tests only: every timed step is an injected clock.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import {
  ACCOUNT_DELETE_CONFIRM,
  DEFAULT_CHIEFTAIN,
  DELETED_PLAYER_NAME,
  LOBBY_COMMAND_TTL_MS,
  emptyUnits,
  type MapResponse,
  type MeResponse,
  type PlayerProfileDto,
  type PlayerRankingResponse,
  type WorldExportDto,
} from '@clanfire/engine';
import { Client, MINUTE, PASSWORD, errorOf, makeApp, ok } from './helpers.ts';
import { LobbySigner, commandClaims, passClaims, postLobby } from './lobby-command-helpers.ts';
import { newLeader, newMember, join, type P } from './tribe-helpers.ts';

const closers: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of closers.splice(0)) await a.close();
});
async function world(over: Parameters<typeof makeApp>[0] = {}) {
  const made = await makeApp(over);
  closers.push(made.app);
  return made;
}

const db = (app: FastifyInstance) => app.ctx.store.db;
const n = (app: FastifyInstance, sql: string, ...p: Array<string | number>): number => Number((db(app).prepare(sql).get(...p) as { n: number }).n);
const tomb = (id: number): string => `${DELETED_PLAYER_NAME} ${id}`;

/** Every table with a per-player private column, as [table, column]. All of it must be empty for a deleted player. */
const PRIVATE: Array<[string, string]> = [
  ['sessions', 'player_id'],
  ['notes', 'player_id'],
  ['troop_groups', 'player_id'],
  ['raid_lists', 'player_id'],
  ['raid_list_rows', 'player_id'],
  ['notifications', 'player_id'],
  ['first_steps', 'player_id'],
  ['first_steps_card', 'player_id'],
  ['analytics_sent', 'player_id'],
  ['analytics_optout', 'player_id'],
  ['advisor_log', 'player_id'],
  ['forum_reads', 'player_id'],
  ['tribe_invites', 'player_id'],
  ['tribe_applications', 'player_id'],
  ['player_ips', 'player_id'],
  ['player_devices', 'player_id'],
  ['player_activity', 'player_id'],
  ['pair_events', 'a_player'],
  ['player_stats', 'player_id'],
  ['fighter_totals', 'player_id'],
  ['renown_pairs', 'earner_id'],
  ['strike_chain', 'player_id'],
  ['chieftain_claims', 'player_id'],
  ['reports', 'player_id'],
  ['tribe_store_sends', 'player_id'],
];

interface Setup {
  app: FastifyInstance;
  clock: Awaited<ReturnType<typeof world>>['clock'];
  alice: P & { tribeId: number };
  bob: P;
  carol: P;
  bobVillage: number;
  aliceVillage: number;
  threadId: number;
  deviceHash: string;
}

/** alice leads a tribe with bob; carol is on her own. Bob has something in every private table, sent mail, a forum post and a chat line. */
async function populate(over: Parameters<typeof makeApp>[0] = {}): Promise<Setup> {
  const { app, clock } = await world(over);
  const alice = await newLeader(app, 'alice', 'Ashen Pact', 'ASH');
  const bob = await newMember(app, 'bob');
  const carol = await newMember(app, 'carol');
  await join(bob, alice.tribeId);
  const store = app.ctx.store;
  const bobVillage = store.villagesOfPlayer(bob.id)[0]!.id;
  const aliceVillage = store.villagesOfPlayer(alice.id)[0]!.id;
  const t = clock.now();

  // public-API content
  ok(await bob.c.post('/api/mail', { to: 'carol', subject: 'Hello Carol', body: 'bob wrote this to carol' }), 201);
  ok(await carol.c.post('/api/mail', { to: 'bob', subject: 'Hello Bob', body: 'carol wrote this to bob' }), 201);
  clock.advance(MINUTE);
  ok(await alice.c.post('/api/mail', { to: 'bob', subject: 'From alice', body: 'alice wrote this to bob' }), 201);
  const board = await alice.c.post('/api/tribe/forum/boards', { name: 'General' });
  ok(board, 201);
  const thread = await bob.c.post(`/api/tribe/forum/boards/${board.json<{ id: number }>().id}/threads`, { title: 'Bob thread', body: 'bob forum text' });
  ok(thread, 201);
  const threadId = thread.json<{ thread: { id: number } }>().thread.id;
  ok(await bob.c.post('/api/tribe/chat', { text: 'bob chat line' }), 201);
  ok(await bob.c.post('/api/notes', { kind: 'village', targetId: aliceVillage, text: 'bob private note', tags: [] }), 200);

  // direct rows for the tables the API cannot fill cheaply
  const deviceHash = 'ab12cd34'.repeat(8);
  const run = (sql: string, ...p: Array<string | number | null>): void => void db(app).prepare(sql).run(...p);
  run("INSERT INTO troop_groups (player_id, name, units, created_at) VALUES (?, 'Raiders', '{}', ?)", bob.id, t);
  run("INSERT INTO raid_lists (id, player_id, name, created_at) VALUES (900, ?, 'List', ?)", bob.id, t);
  run("INSERT INTO raid_list_rows (list_id, player_id, village_id, from_village_id, units_json, created_at) VALUES (900, ?, ?, ?, '{}', ?)", bob.id, aliceVillage, bobVillage, t);
  run("INSERT INTO notifications (player_id, kind, movement_id, origin_village_id, target_village_id, depart_at, arrive_at, created_at) VALUES (?, 'incoming_attack', 1, ?, ?, ?, ?, ?)", bob.id, aliceVillage, bobVillage, t, t + 1000, t);
  run("INSERT OR IGNORE INTO first_steps (player_id, step_id, done_at) VALUES (?, 'build_first', ?)", bob.id, t);
  run('INSERT OR IGNORE INTO first_steps_card (player_id, hidden) VALUES (?, 1)', bob.id);
  run("INSERT OR IGNORE INTO analytics_sent (player_id, key, at) VALUES (?, 'ftue:world_joined', ?)", bob.id, t);
  run('INSERT OR IGNORE INTO analytics_optout (player_id) VALUES (?)', bob.id);
  run("INSERT INTO advisor_log (player_id, asked_at, model) VALUES (?, ?, 'm')", bob.id, t);
  run('INSERT OR IGNORE INTO forum_reads (player_id, thread_id, last_read_at) VALUES (?, ?, ?)', bob.id, threadId, t);
  run('INSERT INTO tribe_invites (tribe_id, player_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', alice.tribeId, bob.id, alice.id, t, t + 1000);
  run("INSERT INTO tribe_applications (tribe_id, player_id, message, created_at) VALUES (?, ?, 'let me in', ?)", alice.tribeId, bob.id, t);
  run('INSERT OR IGNORE INTO player_ips (player_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)', bob.id, '203.0.113.9', t, t);
  run('INSERT OR IGNORE INTO player_devices (player_id, device_hash, first_seen, last_seen) VALUES (?, ?, ?, ?)', bob.id, deviceHash, t, t);
  run('INSERT OR IGNORE INTO player_activity (player_id, slot) VALUES (?, 5)', bob.id);
  run("INSERT INTO pair_events (at, kind, a_player, b_player) VALUES (?, 'ship', ?, ?)", t, bob.id, carol.id);
  run('INSERT OR IGNORE INTO player_stats (player_id) VALUES (?)', bob.id);
  run('INSERT OR REPLACE INTO fighter_totals (player_id, attack, defence) VALUES (?, 5, 5)', bob.id);
  run("INSERT INTO renown_pairs (earner_id, opponent, window_start, value) VALUES (?, ?, ?, 1)", bob.id, `p:${carol.id}`, t);
  run("INSERT INTO renown_pairs (earner_id, opponent, window_start, value) VALUES (?, ?, ?, 1)", carol.id, `p:${bob.id}`, t);
  run('INSERT INTO strike_chain (village_id, player_id, chieftains, at, return_movement_id) VALUES (?, ?, 1, ?, 1)', aliceVillage, bob.id, t);
  run('INSERT INTO chieftain_claims (player_id, village_id, renown, gold, created_at) VALUES (?, ?, 1, 1, ?)', bob.id, aliceVillage, t);
  run("INSERT INTO reports (player_id, side, won, title, created_at, battle_json) VALUES (?, 'attack', 1, 'Bob report', ?, '{}')", bob.id, t);
  run("INSERT INTO reports (player_id, side, won, title, created_at, battle_json) VALUES (?, 'attack', 1, 'Alice report', ?, '{}')", alice.id, t);
  run("INSERT INTO tribe_store_sends (movement_id, tribe_id, player_id, sent_at, total) VALUES (7, ?, ?, ?, 10)", alice.tribeId, bob.id, t);
  run("INSERT INTO tribe_store_ledger (tribe_id, player_id, player_name, wood, food, iron, gold, at) VALUES (?, ?, 'bob', 1, 1, 1, 1, ?)", alice.tribeId, bob.id, t);
  run("UPDATE players SET staff_role = 'support', premium = 1, household_shared = 1, muted_until = ?, mute_reason = 'x', badges_json = '[]', chieftain = 'hild', renown_total = 50 WHERE id = ?", t + 5 * MINUTE, bob.id);
  // support troops both ways, a site garrison and a march of bob's
  store.addStationed(bob.id, bobVillage, aliceVillage, { ...emptyUnits(), raider: 2 }, t);
  store.addStationed(alice.id, aliceVillage, bobVillage, { ...emptyUnits(), raider: 3 }, t);
  store.sites.addGarrison(1, bob.id, bobVillage, { ...emptyUnits(), raider: 4 }, t, null);
  store.insertMovement({ kind: 'attack', originVillageId: bobVillage, targetVillageId: aliceVillage, units: { ...emptyUnits(), raider: 1 }, loot: null, departAt: t, arriveAt: t + 100 * 3_600_000 });
  return { app, clock, alice, bob, carol, bobVillage, aliceVillage, threadId, deviceHash };
}

// ---- deletion ---------------------------------------------------------------------------------------------------------------

test('deleting a player abandons the villages at once and erases every private row; the tombstone keeps the id', async () => {
  const s = await populate();
  const { app, bob, alice, carol } = s;
  for (const [table, col] of PRIVATE) assert.ok(n(app, `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, bob.id) > 0, `seeded ${table}`);
  assert.ok(app.ctx.store.getPlayer(bob.id)!.passwordHash.startsWith('scrypt$'));
  const before = await (async () => {
    const res = await alice.c.get('/api/rankings/players');
    return res.json<PlayerRankingResponse>().players.some((p) => p.playerId === bob.id);
  })();
  assert.equal(before, true, 'bob is ranked before');

  const done = app.ctx.accountData!.deletePlayer(bob.id, s.clock.now(), { via: 'cli', actorId: null, actorIp: 'cli' });
  assert.equal(done, true);

  // villages are abandoned map villages now, every troop of his is gone, others' support went home
  const v = app.ctx.store.getVillage(s.bobVillage)!;
  assert.equal(v.ownerId, null);
  assert.equal(app.ctx.store.villagesOfPlayer(bob.id).length, 0);
  const mapRes = await alice.c.get(`/api/map?x=${v.x}&y=${v.y}&w=1&h=1`);
  ok(mapRes);
  assert.equal(mapRes.json<MapResponse>().villages.find((m) => m.x === v.x && m.y === v.y)?.kind, 'abandoned');
  assert.equal(app.ctx.store.stationedHomedAt(s.bobVillage).length, 0, 'bob\'s support elsewhere is gone');
  assert.equal(app.ctx.store.movementsFrom(s.bobVillage).filter((m) => m.kind === 'attack').length, 0, 'his march is gone');
  assert.equal(app.ctx.store.stationedAt(s.bobVillage).length, 0, 'alice\'s support in his village was sent home');
  assert.ok(app.ctx.store.movementsFrom(s.aliceVillage).some((m) => m.kind === 'return'), 'and walks home');
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM site_garrison WHERE owner_player_id = ?', bob.id), 0, 'site garrison disbanded');

  // every private table is empty for him (renown_pairs also for rows that name him as opponent)
  for (const [table, col] of PRIVATE) assert.equal(n(app, `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, bob.id), 0, `${table} erased`);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM tribe_invites WHERE invited_by = ?', bob.id), 0);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM pair_events WHERE b_player = ?', bob.id), 0);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM renown_pairs WHERE opponent = ?', `p:${bob.id}`), 0);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM tribe_members WHERE player_id = ?', bob.id), 0, 'left the tribe');
  assert.ok(n(app, 'SELECT COUNT(*) AS n FROM tribe_members WHERE tribe_id = ?', alice.tribeId) === 1, 'alice still leads the tribe');
  assert.equal(n(app, "SELECT COUNT(*) AS n FROM tribe_store_ledger WHERE player_name = 'bob'"), 0, 'ledger shows the tombstone name');

  // the row: tombstone
  const row = app.ctx.store.getPlayer(bob.id)!;
  assert.equal(row.username, tomb(bob.id));
  assert.equal(row.passwordHash, '');
  assert.equal(row.accountId, null);
  assert.equal(row.deletedAt, s.clock.now());
  assert.equal(row.chieftain, DEFAULT_CHIEFTAIN);
  assert.equal(row.staffRole, null);
  assert.equal(row.premium, 0);
  assert.equal(row.householdShared, false);
  assert.equal(row.mutedUntil, null);
  assert.equal(row.renownTotal, 0);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM players WHERE badges_json IS NOT NULL AND id = ?', bob.id), 0);

  // others see the tombstone name only: sent mail stays in carol's inbox, forum post, chat, profile; rankings exclude
  const inbox = await carol.c.get('/api/mail?box=inbox');
  ok(inbox);
  const mails = inbox.json<{ mails: Array<{ from: string; subject: string }> }>().mails;
  assert.equal(mails.find((m) => m.subject === 'Hello Carol')?.from, tomb(bob.id), 'recipient keeps the mail sent by him');
  assert.equal(n(app, "SELECT COUNT(*) AS n FROM mail WHERE subject = 'Hello Bob'"), 1, 'carol still has her sent copy of the mail to him');
  assert.equal(n(app, "SELECT deleted_by_recipient AS n FROM mail WHERE subject = 'Hello Bob'"), 1);
  const thread = await alice.c.get(`/api/tribe/forum/threads/${s.threadId}`);
  ok(thread);
  assert.ok(thread.body.includes(tomb(bob.id)), 'forum post shows the tombstone name');
  assert.ok(!thread.body.includes('"bob"'));
  const chat = await alice.c.get('/api/tribe/chat');
  ok(chat);
  assert.ok(chat.body.includes(tomb(bob.id)) && chat.body.includes('bob chat line'), 'chat stays under the tombstone name');
  const profile = await alice.c.get(`/api/players/${bob.id}`);
  ok(profile);
  const prof = profile.json<PlayerProfileDto>();
  assert.equal(prof.username, tomb(bob.id));
  assert.equal(prof.villageCount, 0);
  assert.equal(prof.tribe, null);
  const ranking = await alice.c.get('/api/rankings/players');
  assert.ok(!ranking.json<PlayerRankingResponse>().players.some((p) => p.playerId === bob.id || p.username.startsWith(DELETED_PLAYER_NAME)));
  for (const kind of ['/api/rankings/renown', '/api/rankings/fighters']) assert.ok(!(await alice.c.get(kind)).body.includes(DELETED_PLAYER_NAME));
  const members = await alice.c.get('/api/tribe');
  assert.ok(!members.body.includes('"username":"'+tomb(bob.id)), 'not in the member list (the tribe log only says he left)');
  assert.ok(members.body.includes(`${tomb(bob.id)} left the tribe.`));

  // nobody can mail him (same answer as for an unknown name), cannot sign in, old session is dead
  const unknown = await carol.c.post('/api/mail', { to: 'nobody_here', subject: 's', body: 'b' });
  errorOf(unknown, 404, 'not_found');
  const toTomb = await carol.c.post('/api/mail', { to: tomb(bob.id), subject: 's', body: 'b' });
  errorOf(toTomb, 404, 'not_found');
  assert.equal(toTomb.json<{ message: string }>().message.replace(tomb(bob.id), 'X'), unknown.json<{ message: string }>().message.replace('nobody_here', 'X'));
  const login = await new Client(app, '10.8.0.1').post('/api/auth/login', { username: 'bob', password: PASSWORD });
  errorOf(login, 401, 'unauthorized');
  assert.equal((await bob.c.get('/api/auth/me')).json<MeResponse>().player, null);

  // audit: target is the id, no name in the detail
  const audit = db(app).prepare("SELECT target_player AS t, detail AS d FROM audit_log WHERE action = 'account_deleted'").all() as Array<{ t: number; d: string }>;
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.t, bob.id);
  assert.ok(!/bob/i.test(audit[0]!.d));

  // idempotent
  assert.equal(app.ctx.accountData!.deletePlayer(bob.id, s.clock.now() + 1000, { via: 'cli', actorId: null, actorIp: null }), false);
  assert.equal(n(app, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account_deleted'"), 1);
});

test('a leader who deletes the account hands the tribe over; the last member who deletes disbands it', async () => {
  const s = await populate();
  const { app, alice, bob, carol } = s;
  await join(carol, alice.tribeId);
  const del = (id: number): boolean => app.ctx.accountData!.deletePlayer(id, s.clock.now(), { via: 'cli', actorId: null, actorIp: null });
  assert.equal(del(alice.id), true);
  const rows = db(app).prepare('SELECT player_id AS id, role FROM tribe_members ORDER BY player_id').all() as Array<{ id: number; role: string }>;
  assert.deepEqual(rows.map((r) => [r.id, r.role]), [[bob.id, 'leader'], [carol.id, 'member']], 'longest-serving member leads now');
  assert.equal(del(bob.id), true);
  assert.equal((db(app).prepare('SELECT role FROM tribe_members WHERE player_id = ?').get(carol.id) as { role: string }).role, 'leader');
  assert.equal(del(carol.id), true);
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM tribes'), 0, 'the last member out disbands the tribe');
});

test('a hold the deleted player runs on someone else\'s village ends instead of handing the village to the tombstone', async () => {
  const s = await populate();
  const { app, bob, aliceVillage } = s;
  const v = app.ctx.store.getVillage(aliceVillage)!;
  v.state.hearth = { status: 'out', claimBy: bob.id, outAt: s.clock.now(), holdMs: 1000, runningSince: null, underSince: null };
  app.ctx.store.saveVillage(v.id, v.state, v.points);
  app.ctx.accountData!.deletePlayer(bob.id, s.clock.now(), { via: 'cli', actorId: null, actorIp: null });
  const after = app.ctx.store.getVillage(aliceVillage)!;
  assert.equal(after.state.hearth, undefined);
  assert.equal(after.ownerId, s.alice.id);
});

// ---- the player's own deletion route (world without a lobby) -------------------------------------------------------------

test('POST /api/account/delete: password and confirm are checked, then the account is deleted and the cookie cleared', async () => {
  const s = await populate();
  const { app, bob } = s;
  errorOf(await bob.c.post('/api/account/delete', { password: 'wrong password', confirm: ACCOUNT_DELETE_CONFIRM }), 401, 'unauthorized');
  errorOf(await bob.c.post('/api/account/delete', { password: PASSWORD }), 400, 'invalid_input');
  errorOf(await bob.c.post('/api/account/delete', { password: PASSWORD, confirm: 'delete' }), 400, 'invalid_input');
  errorOf(await bob.c.post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM, extra: 1 }), 400, 'invalid_input');
  errorOf(await new Client(app, '10.8.1.1').post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }), 401, 'unauthorized');
  assert.equal(app.ctx.store.getPlayer(bob.id)!.deletedAt, null, 'nothing happened yet');
  // Origin check as on every write
  errorOf(await bob.c.post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }, { origin: 'http://evil.test' }), 403, 'forbidden');
  assert.equal(app.ctx.store.getPlayer(bob.id)!.deletedAt, null);

  const res = await bob.c.post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM });
  assert.equal(res.statusCode, 204, res.body);
  assert.ok(res.cookies.some((c) => c.name === 'tw_session' && c.value === ''), 'cookie cleared');
  assert.equal(app.ctx.store.getPlayer(bob.id)!.username, tomb(bob.id));
  assert.equal(n(app, 'SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?', bob.id), 0);
  errorOf(await new Client(app, '10.8.1.2').post('/api/auth/login', { username: 'bob', password: PASSWORD }), 401, 'unauthorized');
  // a new account may use the name again
  ok(await new Client(app, '10.8.1.3').post('/api/auth/register', { username: 'bob', password: PASSWORD }), 201);
});

test('POST /api/account/delete in a lobby world is forbidden (delete in the lobby)', async () => {
  const signer = new LobbySigner();
  const { app, clock } = await world({ lobbyPublicKey: signer.spkiB64 });
  const c = new Client(app, '10.8.2.1');
  ok(await c.post('/api/auth/enter', { pass: signer.pass(passClaims(signer, clock, 5, 'Lobbyist')) }), 201);
  errorOf(await c.post('/api/account/delete', { password: PASSWORD, confirm: ACCOUNT_DELETE_CONFIRM }), 403, 'forbidden');
  assert.equal(app.ctx.store.getPlayerByAccountId(5)!.deletedAt, null);
  ok(await c.get('/api/account/export'), 200); // export works in every mode
});

// ---- export -------------------------------------------------------------------------------------------------------------

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) (out.push(k), keysOf(v, out));
  return out;
}

test('GET /api/account/export: a download with the player\'s own data and no secrets, limited to 2 per 10 minutes', async () => {
  const s = await populate();
  const { app, bob, clock } = s;
  const res = await bob.c.get('/api/account/export');
  ok(res);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="clanflame-w1-bob.json"');
  assert.equal(res.headers['cache-control'], 'no-store');
  const dto = res.json<WorldExportDto>();
  assert.equal(dto.format, 'clanflame-world-export-v1');
  assert.equal(dto.worldId, 'w1');
  assert.equal(dto.player?.username, 'bob');
  assert.deepEqual(dto.player?.tribe, { name: 'Ashen Pact', tag: 'ASH' });
  assert.equal(dto.villages.length, 1);
  assert.equal(dto.notes.length, 1);
  assert.equal(dto.troopGroups.length, 1);
  assert.equal(dto.raidLists.length, 1);
  assert.deepEqual(dto.mail.map((m) => m.subject).sort(), ['From alice', 'Hello Bob', 'Hello Carol']);
  const sent = dto.mail.find((m) => m.subject === 'Hello Carol')!;
  assert.equal(sent.from, 'bob');
  assert.equal(sent.to, 'carol');
  assert.deepEqual(dto.forumPosts.map((p) => p.body), ['bob forum text']);
  assert.deepEqual(dto.tribeChat.map((p) => p.body), ['bob chat line']);
  assert.deepEqual(dto.reports.map((r) => r.title), ['Bob report'], 'only his own report headlines');
  assert.ok(dto.ips.some((i) => i.ip === '203.0.113.9'));
  assert.deepEqual(dto.devices.map((d) => d.label), [s.deviceHash.slice(0, 8)]);
  assert.ok(!res.body.includes(s.deviceHash), 'only the first 8 hex of the device hash');
  assert.ok(!res.body.includes(app.ctx.store.getPlayer(bob.id)!.passwordHash), 'no password hash');
  assert.ok(!res.body.includes('alice report') && !res.body.includes('Alice report'));
  const bad = keysOf(dto).filter((k) => /password|hash|token|secret|session/i.test(k));
  assert.deepEqual(bad, [], 'no secret-looking field');

  ok(await bob.c.get('/api/account/export'));
  const third = await bob.c.get('/api/account/export');
  errorOf(third, 429, 'rate_limited');
  assert.equal(third.headers['retry-after'], '600');
  ok(await s.carol.c.get('/api/account/export'), 200); // another account has its own allowance
  clock.advance(10 * MINUTE + 1);
  ok(await bob.c.get('/api/account/export'));
  errorOf(await new Client(app, '10.8.3.1').get('/api/account/export'), 401, 'unauthorized');
});

// ---- lobby commands ---------------------------------------------------------------------------------------------------

async function lobbyWorld(over: Parameters<typeof makeApp>[0] = {}) {
  const signer = new LobbySigner();
  const made = await world({ lobbyPublicKey: signer.spkiB64, ...over });
  const c = new Client(made.app, '10.8.4.1');
  ok(await c.post('/api/auth/enter', { pass: signer.pass(passClaims(signer, made.clock, 7, 'Lobbyist')) }), 201);
  const row = made.app.ctx.store.getPlayerByAccountId(7)!;
  return { ...made, signer, c, row };
}
const DEL = '/api/lobby/account/delete';
const EXP = '/api/lobby/account/export';

test('lobby command: a valid delete works, is idempotent, and needs no cookie or Origin', async () => {
  const { app, clock, signer, row, c } = await lobbyWorld();
  const cmd = signer.command(commandClaims(signer, clock, 'account_delete', 7));
  const res = await postLobby(app, DEL, cmd);
  ok(res);
  assert.deepEqual(res.json(), { done: true });
  const gone = app.ctx.store.getPlayer(row.id)!;
  assert.equal(gone.deletedAt, clock.now());
  assert.equal(gone.accountId, null);
  assert.equal(gone.username, tomb(row.id));
  assert.equal(app.ctx.store.getPlayerByAccountId(7), null);
  assert.equal(app.ctx.store.villagesOfPlayer(row.id).length, 0);
  assert.equal((await c.get('/api/auth/me')).json<MeResponse>().player, null, 'his session ended');
  // idempotent: a fresh command for the same account, and one for an account that never played here
  assert.deepEqual((await postLobby(app, DEL, signer.command(commandClaims(signer, clock, 'account_delete', 7)))).json(), { done: true });
  assert.deepEqual((await postLobby(app, DEL, signer.command(commandClaims(signer, clock, 'account_delete', 4242)))).json(), { done: true });
  assert.equal(n(app, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account_deleted'"), 1);
});

test('lobby command: the browser Origin guard still applies to a cross-site Origin', async () => {
  const { app, clock, signer, row } = await lobbyWorld();
  const res = await postLobby(app, DEL, signer.command(commandClaims(signer, clock, 'account_delete', 7)), { origin: 'http://evil.test' });
  errorOf(res, 403, 'forbidden');
  assert.equal(app.ctx.store.getPlayer(row.id)!.deletedAt, null);
});

test('lobby command: reused nonce, other world, expired, wrong type, unknown key and bad signature are all refused (401)', async () => {
  const { app, clock, signer, row } = await lobbyWorld();
  const alive = (): boolean => app.ctx.store.getPlayer(row.id)!.deletedAt === null;
  // wrong world, wrong type for the route, expired, long-lived, from the future, unknown kid, other key
  const refused = async (cmd: string, url = DEL): Promise<void> => {
    errorOf(await postLobby(app, url, cmd), 401, 'unauthorized');
    assert.ok(alive());
  };
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { wid: 'w2' })));
  await refused(signer.command(commandClaims(signer, clock, 'account_export', 7)));
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { iat: clock.t - 2 * LOBBY_COMMAND_TTL_MS, exp: clock.t - LOBBY_COMMAND_TTL_MS })));
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { exp: clock.t + LOBBY_COMMAND_TTL_MS + 1 })));
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { iat: clock.t + 10 * MINUTE, exp: clock.t + 10 * MINUTE + 1000 })));
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { kid: '0000000000000000' })));
  await refused(signer.command(commandClaims(signer, clock, 'account_delete', 7, { nonce: 'short' })));
  await refused(new LobbySigner().command(commandClaims(signer, clock, 'account_delete', 7)));
  await refused('not.a.command');
  await refused(signer.command(commandClaims(signer, clock, 'account_export', 7)), EXP.replace('export', 'delete'));
  // one good command works once; the same text again is a reused nonce
  const good = signer.command(commandClaims(signer, clock, 'account_delete', 7));
  ok(await postLobby(app, DEL, good));
  errorOf(await postLobby(app, DEL, good), 401, 'unauthorized');
  // expiry is also judged against the server clock
  const late = signer.command(commandClaims(signer, clock, 'account_delete', 9));
  clock.advance(LOBBY_COMMAND_TTL_MS + 1);
  errorOf(await postLobby(app, DEL, late), 401, 'unauthorized');
});

test('an entry pass is not a command and a command is not an entry pass', async () => {
  const { app, clock, signer, row } = await lobbyWorld();
  const pass = signer.pass(passClaims(signer, clock, 7, 'Lobbyist'));
  errorOf(await postLobby(app, DEL, pass), 401, 'unauthorized');
  errorOf(await postLobby(app, EXP, pass), 401, 'unauthorized');
  // a command whose claims even look like a pass is still refused by the pass endpoint
  const asCommand = signer.command(passClaims(signer, clock, 7, 'Lobbyist'));
  errorOf(await new Client(app, '10.8.5.1').post('/api/auth/enter', { pass: asCommand }), 401, 'unauthorized');
  errorOf(await new Client(app, '10.8.5.2').post('/api/auth/enter', { pass: signer.command(commandClaims(signer, clock, 'account_delete', 7)) }), 401, 'unauthorized');
  assert.equal(app.ctx.store.getPlayer(row.id)!.deletedAt, null);
});

test('lobby command: export returns the world export for a known account and an empty one for an unknown account', async () => {
  const { app, clock, signer } = await lobbyWorld();
  const res = await postLobby(app, EXP, signer.command(commandClaims(signer, clock, 'account_export', 7)));
  ok(res);
  const dto = res.json<WorldExportDto>();
  assert.equal(dto.player?.username, 'Lobbyist');
  assert.equal(dto.villages.length, 1);
  assert.deepEqual(keysOf(dto).filter((k) => /password|hash|token|session/i.test(k)), []);
  const none = (await postLobby(app, EXP, signer.command(commandClaims(signer, clock, 'account_export', 999)))).json<WorldExportDto>();
  assert.equal(none.player, null);
  assert.deepEqual(none.villages, []);
  assert.equal(none.format, 'clanflame-world-export-v1');
});

test('the lobby command routes are 404 in a world without LOBBY_PUBLIC_KEY', async () => {
  const signer = new LobbySigner();
  const { app, clock } = await world();
  errorOf(await postLobby(app, DEL, signer.command(commandClaims(signer, clock, 'account_delete', 1))), 404, 'not_found');
  errorOf(await postLobby(app, EXP, signer.command(commandClaims(signer, clock, 'account_export', 1))), 404, 'not_found');
});

test('names in other players\' reports and tribe event lines become the tombstone name; village names stay', async () => {
  const s = await populate();
  const { app, bob, carol, alice } = s;
  const t = s.clock.now();
  const ref = (name: string, owner: string | null) => ({ villageId: 1, name, x: 1, y: 1, ownerName: owner });
  const body = JSON.stringify({ outcome: 'battle', attacker: ref('bob', 'bob'), defender: ref('Far Farm', 'carol'), claimBy: 'bob', note: 'bob' });
  const other = JSON.stringify({ outcome: 'battle', attacker: ref('Hill', 'carol'), defender: ref('bob', 'carol') });
  const ins = (pid: number, json: string): void =>
    void db(app).prepare("INSERT INTO reports (player_id, side, won, title, created_at, battle_json) VALUES (?, 'defense', 1, 'x', ?, ?)").run(pid, t, json);
  ins(carol.id, body);
  ins(carol.id, other);
  db(app).prepare('INSERT INTO tribe_events (tribe_id, created_at, text) VALUES (?, ?, ?)').run(alice.tribeId, t, 'bob joined the tribe. bobby stayed, bob.');
  app.ctx.accountData!.deletePlayer(bob.id, t, { via: 'cli', actorId: null, actorIp: 'cli' });
  const all = (db(app).prepare('SELECT battle_json FROM reports WHERE player_id = ? ORDER BY id').all(carol.id) as Array<{ battle_json: string }>).map((r) => JSON.parse(r.battle_json));
  const a = all.find((r) => r.defender?.name === 'Far Farm')!;
  assert.equal(a.attacker.ownerName, tomb(bob.id));
  assert.equal(a.claimBy, tomb(bob.id));
  assert.equal(a.attacker.name, 'bob', 'a village named like the player keeps its name');
  assert.equal(a.note, 'bob', 'only player-name fields change');
  const b = all.find((r) => r.attacker?.name === 'Hill')!;
  assert.equal(b.defender.name, 'bob');
  assert.equal(b.defender.ownerName, 'carol');
  const ev = db(app).prepare('SELECT text FROM tribe_events WHERE text LIKE ?').get('%bobby%') as { text: string };
  assert.equal(ev.text, `${tomb(bob.id)} joined the tribe. bobby stayed, ${tomb(bob.id)}.`);
});
