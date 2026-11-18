// Multi-account tooling for staff: the "Shared connections" groups, device ids, the detection rules, review, ban, and the 30-day cleanup.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MULTI_ALT_MIN_SLOTS,
  MULTI_LINK_MAX_ACCOUNTS,
  MULTI_RELAY_WINDOW_MS,
  MULTI_RETENTION_MS,
  type MultiGroupDto,
  type MultiGroupsResponse,
  type Resources,
} from '@clanfire/engine';
import { alternation, isFeeding, isOneWayFlow, summarizePair } from '../src/multi-service.ts';
import { hashDevice } from '../src/device.ts';
import { Client, HOUR, errorOf, makeApp, ok, register } from './helpers.ts';
import { auditRows, newStaff } from './staff-helpers.ts';
import { newPlayer, setBuilding, type App, type P } from './tribe-helpers.ts';
import { giveTroops, sendOk, unprotect, village } from './warfare-helpers.ts';

const DAY = 24 * HOUR;
const DEVICE_A = 'a1'.repeat(16);
const DEVICE_B = 'b2'.repeat(16);

async function setup() {
  const { app, clock } = await makeApp();
  const mod = await newStaff(app, 'mod_one', 'moderator');
  return { app, clock, mod };
}

const share = (app: App, ip: string, t: number, ...players: P[]): void => {
  for (const p of players) app.ctx.store.recordIp(p.id, ip, t);
};

async function groups(mod: P, all = false): Promise<MultiGroupsResponse> {
  const res = await mod.c.get(`/api/staff/multi${all ? '?all=1' : ''}`);
  ok(res);
  return res.json<MultiGroupsResponse>();
}

const groupOf = (r: MultiGroupsResponse, ...names: string[]): MultiGroupDto | undefined =>
  r.groups.find((g) => names.every((n) => g.members.some((m) => m.username === n)));

// ---- access ------------------------------------------------------------------------------------------

test('only staff of moderator rank or more can open or review groups', async () => {
  const { app, mod } = await setup();
  const anon = new Client(app);
  errorOf(await anon.get('/api/staff/multi'), 404, 'not_found');
  const player = await newPlayer(app, 'plain_one');
  errorOf(await player.c.get('/api/staff/multi'), 404, 'not_found');
  errorOf(await player.c.post('/api/staff/multi/review', { key: '1,2' }), 404, 'not_found');
  const support = await newStaff(app, 'supp_one', 'support');
  errorOf(await support.c.get('/api/staff/multi'), 403, 'forbidden');
  errorOf(await support.c.post('/api/staff/multi/review', { key: '1,2' }), 403, 'forbidden');
  ok(await mod.c.get('/api/staff/multi'));
  // The audit log notes who looked.
  assert.ok(auditRows(app, 'staff_view_multi').some((r) => r.actor_id === mod.id));
  // A player's own endpoints never carry IPs or devices.
  assert.doesNotMatch((await player.c.get('/api/auth/me')).body, /device|\bip\b/i);
});

test('bad review keys are refused', async () => {
  const { mod } = await setup();
  errorOf(await mod.c.post('/api/staff/multi/review', { key: "1; DROP TABLE players" }), 400, 'invalid_input');
  errorOf(await mod.c.post('/api/staff/multi/review', { key: '7' }), 400, 'invalid_input');
  errorOf(await mod.c.post('/api/staff/multi/review', { key: '98,99' }), 404, 'not_found');
});

// ---- groups ----------------------------------------------------------------------------------------------

test('accounts on one IP form a group with villages, points, household flag and a risk line', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'twin_a');
  const b = await newPlayer(app, 'twin_b');
  const lone = await newPlayer(app, 'lone_one');
  share(app, '10.50.0.1', clock.t, a, b);
  const g = groupOf(await groups(mod), 'twin_a', 'twin_b');
  assert.ok(g, 'group listed');
  assert.equal(g.kind, 'connection');
  assert.equal(g.members.length, 2);
  assert.ok(g.members.every((m) => m.villages === 1 && m.points > 0 && !m.householdShared));
  assert.ok(g.links.some((l) => l.kind === 'ip' && l.label === '10.50.0.1' && l.seen.length === 2));
  assert.ok(g.flags.some((f) => f.code === 'undeclared'));
  assert.equal(g.risk.level, 'medium');
  assert.match(g.risk.text, /No household declared by twin_a, twin_b/);
  assert.equal(groupOf(await groups(mod), 'lone_one'), undefined);
  void lone;

  // Both declare the household: the flag goes and the group is low risk.
  ok(await a.c.post('/api/me/household', { shared: true }));
  ok(await b.c.post('/api/me/household', { shared: true }));
  const g2 = groupOf(await groups(mod), 'twin_a', 'twin_b');
  assert.ok(g2);
  assert.ok(g2.members.every((m) => m.householdShared));
  assert.equal(g2.risk.level, 'low');
  assert.match(g2.risk.text, /declared the shared household/);
});

test('an address used by more accounts than the cap links nobody', async () => {
  const { app, clock, mod } = await setup();
  const many: P[] = [];
  for (let i = 0; i < MULTI_LINK_MAX_ACCOUNTS + 1; i++) many.push(await newPlayer(app, `crowd_${i}`));
  share(app, '10.50.9.9', clock.t, ...many);
  assert.equal((await groups(mod)).groups.length, 0);
});

test('an address not seen for 30 days no longer links accounts', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'old_a');
  const b = await newPlayer(app, 'old_b');
  share(app, '10.50.0.2', clock.t - MULTI_RETENTION_MS - DAY, a, b);
  assert.equal((await groups(mod)).groups.length, 0);
});

// ---- device ids -------------------------------------------------------------------------------------------

test('the same device id links accounts on different IPs; only a hash is stored and the id is never shown', async () => {
  const { app, mod } = await setup();
  const mk = async (name: string, ip: string, device: string) => {
    const c = new Client(app, ip);
    const res = await c.post('/api/auth/register', { username: name, password: 'correct horse battery' }, { 'x-clanfire-device': device });
    ok(res, 201);
    // The server keeps the id in a first-party cookie too.
    const cookie = res.cookies.find((x) => x.name === 'cf_device');
    assert.equal(cookie?.value, device);
    assert.equal((cookie as { httpOnly?: boolean } | undefined)?.httpOnly, true);
    return c;
  };
  await mk('vpn_a', '10.60.0.1', DEVICE_A);
  await mk('vpn_b', '10.60.0.2', DEVICE_A);
  await mk('other_c', '10.60.0.3', DEVICE_B);
  const res = await mod.c.get('/api/staff/multi');
  ok(res);
  assert.ok(!res.body.includes(DEVICE_A), 'the raw id is never sent to anyone');
  const g = groupOf(res.json<MultiGroupsResponse>(), 'vpn_a', 'vpn_b');
  assert.ok(g);
  assert.equal(g.members.length, 2);
  assert.ok(g.links.some((l) => l.kind === 'device' && l.label === `device ${hashDevice(DEVICE_A).slice(0, 8)}`));
  assert.ok(g.flags.some((f) => f.code === 'device_hidden'));
  assert.equal(g.risk.level, 'high');
  const rows = app.ctx.store.db.prepare('SELECT device_hash FROM player_devices').all() as Array<{ device_hash: string }>;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.device_hash !== DEVICE_A && r.device_hash.length === 64));
});

test('a device id in the cookie alone (storage cleared) still links; junk ids are ignored', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'ck_a');
  const b = await newPlayer(app, 'ck_b');
  clock.advance(10 * 60_000); // the activity stamp is written at most every few minutes
  await a.c.get('/api/state', { 'x-clanfire-device': DEVICE_A });
  clock.advance(10 * 60_000);
  b.c.cookie = `${b.c.cookie}; cf_device=${DEVICE_A}`; // the browser sends the cookie, but no header
  await b.c.get('/api/state');
  await b.c.get('/api/state', { 'x-clanfire-device': 'not-an-id' });
  const g = groupOf(await groups(mod), 'ck_a', 'ck_b');
  assert.ok(g, 'linked through the cookie');
  const n = app.ctx.store.db.prepare('SELECT COUNT(*) AS n FROM player_devices').get() as { n: number };
  assert.equal(n.n, 2);
});

// ---- the rules (constructed data) ----------------------------------------------------------------------

test('feeding: attacks that meet no defence with loot flowing one way', async () => {
  const { app, clock, mod } = await setup();
  const farm = await newPlayer(app, 'farmer_a');
  const prey = await newPlayer(app, 'prey_b');
  share(app, '10.51.0.1', clock.t, farm, prey);
  const log = app.ctx.store.multi;
  for (let i = 0; i < 3; i++) log.logEvent({ at: clock.t - i * HOUR, kind: 'attack', a: farm.id, b: prey.id, amount: 500, lostA: 0, lostB: 4, defenders: 0 });
  const g = groupOf(await groups(mod), 'farmer_a', 'prey_b');
  assert.ok(g);
  const f = g.flags.find((x) => x.code === 'feeding');
  assert.ok(f, 'feeding flagged');
  assert.match(f.text, /farmer_a took 1,500 resources from prey_b in 3 attacks \(3 met no defence/);
  const pair = g.pairs[0];
  assert.ok(pair);
  assert.equal(pair.attacks[0].count, 3);
  assert.equal(pair.attacks[1].count, 0);
  assert.equal(pair.attacks[0].loot, 1500);
  assert.equal(pair.attacks[0].lostDefender, 12);
});

test('feeding thresholds: defended attacks, little loot or two-way loot are not feeding', () => {
  const ev = (a: number, b: number, amount: number, defenders: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, at: 1000 + i, kind: 'attack' as const, a, b, amount, lostA: 0, lostB: 0, defenders }));
  assert.equal(isFeeding(summarizePair(1, 2, ev(1, 2, 500, 0, 3)), 0), true);
  assert.equal(isFeeding(summarizePair(1, 2, ev(1, 2, 500, 0, 2)), 0), false, 'too few');
  assert.equal(isFeeding(summarizePair(1, 2, ev(1, 2, 500, 40, 3)), 0), false, 'defended');
  assert.equal(isFeeding(summarizePair(1, 2, ev(1, 2, 100, 0, 3)), 0), false, 'little loot');
  assert.equal(isFeeding(summarizePair(1, 2, [...ev(1, 2, 500, 0, 3), ...ev(2, 1, 400, 0, 3)]), 0), false, 'loot goes both ways');
});

function shipEvents(app: App, from: P, to: P, t: number, days: number, each: number): void {
  for (let i = 0; i < days; i++) app.ctx.store.multi.logEvent({ at: t - i * DAY, kind: 'ship', a: from.id, b: to.id, amount: each });
}

test('one-way flow: 3+ shipments on 3+ days, 70% of everything one account sent, nothing back', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'giver_a');
  const b = await newPlayer(app, 'taker_b');
  share(app, '10.52.0.1', clock.t, a, b);
  shipEvents(app, a, b, clock.t, 4, 500);
  const g = groupOf(await groups(mod), 'giver_a', 'taker_b');
  assert.ok(g);
  assert.ok(g.flags.some((f) => f.code === 'one_way_flow'));
  assert.equal(g.pairs[0]?.ship[0].days, 4);
  assert.equal(g.pairs[0]?.ship[0].resources, 2000);
});

test('one-way flow is not flagged with returns, few days, small sums or many other receivers', () => {
  const day = 24 * HOUR;
  const mk = (from: number, to: number, days: number, each: number) =>
    Array.from({ length: days }, (_, i) => ({ id: from * 100 + to * 10 + i, at: i * day + 5, kind: 'ship' as const, a: from, b: to, amount: each, lostA: 0, lostB: 0, defenders: 0 }));
  assert.equal(isOneWayFlow(summarizePair(1, 2, mk(1, 2, 4, 500)), 0, 2000), true);
  assert.equal(isOneWayFlow(summarizePair(1, 2, [...mk(1, 2, 4, 500), ...mk(2, 1, 1, 500)]), 0, 2000), false, 'B sent a quarter back');
  assert.equal(isOneWayFlow(summarizePair(1, 2, mk(1, 2, 2, 800)), 0, 1600), false, 'two days only');
  assert.equal(isOneWayFlow(summarizePair(1, 2, mk(1, 2, 4, 100)), 0, 400), false, 'too little');
  assert.equal(isOneWayFlow(summarizePair(1, 2, mk(1, 2, 4, 500)), 0, 5000), false, 'A shipped mostly to others');
});

test('relay: A to a third account to B within 48 hours', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'relay_a');
  const b = await newPlayer(app, 'relay_b');
  const c = await newPlayer(app, 'middle_c');
  share(app, '10.53.0.1', clock.t, a, b);
  const log = app.ctx.store.multi;
  log.logEvent({ at: clock.t - 30 * HOUR, kind: 'ship', a: a.id, b: c.id, amount: 900 });
  log.logEvent({ at: clock.t - 10 * HOUR, kind: 'ship', a: c.id, b: b.id, amount: 700 });
  const g = groupOf(await groups(mod), 'relay_a', 'relay_b');
  assert.ok(g);
  assert.equal(g.relays.length, 1);
  assert.deepEqual([g.relays[0]?.viaName, g.relays[0]?.resources], ['middle_c', 700]);
  assert.ok(g.flags.some((f) => f.code === 'relay'));
  assert.ok(!g.members.some((m) => m.username === 'middle_c'), 'the third account is not made a member');

  // The second leg more than 48 hours later is not a relay.
  const { app: app2, clock: clock2, mod: mod2 } = await setup();
  const a2 = await newPlayer(app2, 'slow_a');
  const b2 = await newPlayer(app2, 'slow_b');
  const c2 = await newPlayer(app2, 'slow_c');
  share(app2, '10.53.0.2', clock2.t, a2, b2);
  app2.ctx.store.multi.logEvent({ at: clock2.t - 80 * HOUR, kind: 'ship', a: a2.id, b: c2.id, amount: 900 });
  app2.ctx.store.multi.logEvent({ at: clock2.t - 80 * HOUR + MULTI_RELAY_WINDOW_MS + 1, kind: 'ship', a: c2.id, b: b2.id, amount: 700 });
  assert.equal(groupOf(await groups(mod2), 'slow_a', 'slow_b')?.relays.length, 0);
});

test('alternating play: never on together, always within minutes of each other (linked accounts only)', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'alt_a');
  const b = await newPlayer(app, 'alt_b');
  const c = await newPlayer(app, 'busy_c');
  const d = await newPlayer(app, 'busy_d');
  share(app, '10.54.0.1', clock.t, a, b);
  share(app, '10.54.0.2', clock.t, c, d);
  const base = clock.t - 12 * HOUR;
  const mem = app.ctx.store.multi;
  // (Both accounts registered in the same slot: one shared slot out of thirty stays under the overlap limit.)
  for (let i = 0; i < 30; i++) {
    mem.recordActivity(a.id, base + i * 20 * 60_000);
    mem.recordActivity(b.id, base + i * 20 * 60_000 + 10 * 60_000);
    // c and d are on at the same time as each other.
    mem.recordActivity(c.id, base + i * 20 * 60_000);
    mem.recordActivity(d.id, base + i * 20 * 60_000);
  }
  const r = await groups(mod);
  const alt = groupOf(r, 'alt_a', 'alt_b');
  assert.ok(alt);
  assert.ok(alt.flags.some((f) => f.code === 'alternating'));
  assert.ok((alt.pairs[0]?.alternating?.handoffs ?? 0) >= MULTI_ALT_MIN_SLOTS);
  assert.match(alt.risk.text, /never on at the same time/);
  assert.equal(groupOf(r, 'busy_c', 'busy_d')?.flags.some((f) => f.code === 'alternating'), false);
});

test('alternation rule: overlap, too few slots and far-apart slots are not flagged', () => {
  const evens = Array.from({ length: 20 }, (_, i) => i * 2);
  const odds = evens.map((s) => s + 1);
  assert.ok(alternation(evens, odds));
  assert.equal(alternation(evens, evens), null, 'always together');
  assert.equal(alternation(evens.slice(0, 5), odds.slice(0, 5)), null, 'too few slots');
  assert.equal(alternation(evens, odds.map((s) => s + 40)), null, 'hours apart, never close');
});

test('two accounts with no shared address or device are caught by behaviour alone', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'far_a');
  const b = await newPlayer(app, 'far_b');
  const bystander = await newPlayer(app, 'bystander');
  for (let i = 0; i < 3; i++) app.ctx.store.multi.logEvent({ at: clock.t - i * HOUR, kind: 'attack', a: a.id, b: b.id, amount: 600, defenders: 0 });
  shipEvents(app, bystander, a, clock.t, 1, 100);
  const r = await groups(mod);
  const g = groupOf(r, 'far_a', 'far_b');
  assert.ok(g);
  assert.equal(g.kind, 'behaviour');
  assert.equal(g.links.length, 0);
  assert.ok(g.flags.some((f) => f.code === 'feeding'));
  assert.equal(r.groups.length, 1);
});

test('blocked attempts, a taken village and a strike are listed and raise the risk', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'rude_a');
  const b = await newPlayer(app, 'rude_b');
  share(app, '10.55.0.1', clock.t, a, b);
  const log = app.ctx.store.multi;
  log.logEvent({ at: clock.t - HOUR, kind: 'ship_blocked', a: a.id, b: b.id });
  log.logEvent({ at: clock.t - HOUR, kind: 'support_blocked', a: b.id, b: a.id });
  log.logEvent({ at: clock.t - HOUR, kind: 'conquest', a: a.id, b: b.id });
  const g = groupOf(await groups(mod), 'rude_a', 'rude_b');
  assert.ok(g);
  const codes = g.flags.map((f) => f.code);
  assert.ok(codes.includes('blocked_attempts') && codes.includes('village_taken') && codes.includes('undeclared'));
  assert.equal(g.risk.level, 'high');
  assert.equal(g.pairs[0]?.conquests[0], 1);
  assert.equal(g.pairs[0]?.shipBlocked, 1);
});

// ---- the pair log written by the game ------------------------------------------------------------------

test('the game logs refused household attempts, real shipments and real attacks', async () => {
  const { app, clock } = await makeApp();
  const a = await newPlayer(app, 'log_a');
  const b = await newPlayer(app, 'log_b');
  const far = await newPlayer(app, 'log_far');
  share(app, '10.56.0.1', clock.t, a, b);
  unprotect(app, a, b, far);
  for (const p of [a, b, far]) setBuilding(app, p.id, 'market', 1);
  giveTroops(app, a, { raider: 20 });
  const stock = (p: P): void => {
    const store = app.ctx.store;
    const v = store.villagesOfPlayer(p.id)[0];
    assert.ok(v);
    Object.assign(v.state.resources, { wood: 400, food: 400, iron: 400, gold: 40 } satisfies Partial<Resources>);
    store.saveVillage(v.id, v.state, v.points);
  };
  stock(a);
  const home = await village(a);
  const dest = await village(b);
  errorOf(await a.c.post(`/api/villages/${home.id}/ship`, { x: dest.x, y: dest.y, resources: { wood: 50 } }), 400, 'invalid_target');
  errorOf(await a.c.post(`/api/villages/${home.id}/send`, { x: dest.x, y: dest.y, units: { raider: 1 }, mission: 'support' }), 400, 'invalid_target');
  errorOf(await a.c.post(`/api/villages/${home.id}/send`, { x: dest.x, y: dest.y, units: { raider: 1 }, mission: 'attack' }), 400, 'invalid_target');
  const kinds = (): string[] => (app.ctx.store.db.prepare('SELECT kind FROM pair_events ORDER BY id').all() as Array<{ kind: string }>).map((r) => r.kind);
  assert.deepEqual(kinds(), ['ship_blocked', 'support_blocked', 'attack_blocked']);

  // A shipment and an attack to someone on another connection are logged with their numbers.
  const farHome = await village(far);
  ok(await a.c.post(`/api/villages/${home.id}/ship`, { x: farHome.x, y: farHome.y, resources: { wood: 100, food: 20 } }), 201);
  const { movement } = await sendOk(a, far, 'attack', { raider: 5 });
  clock.set(movement.arriveAt + 1);
  await far.c.state(); // any request settles what has arrived
  const rows = app.ctx.store.db.prepare('SELECT kind, a_player, b_player, amount, defenders FROM pair_events WHERE kind IN (\'ship\', \'attack\') ORDER BY id').all() as Array<{ kind: string; a_player: number; b_player: number; amount: number; defenders: number }>;
  assert.deepEqual(rows.map((r) => [r.kind, r.a_player, r.b_player]), [
    ['ship', a.id, far.id],
    ['attack', a.id, far.id],
  ]);
  assert.equal(rows[0]?.amount, 120);
  assert.ok((rows[1]?.amount ?? -1) >= 0);
});

// ---- review and ban ----------------------------------------------------------------------------------------

test('review hides a group until something new happens between its members', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'rev_a');
  const b = await newPlayer(app, 'rev_b');
  share(app, '10.57.0.1', clock.t, a, b);
  const first = (await groups(mod)).groups[0];
  assert.ok(first);
  const res = await mod.c.post('/api/staff/multi/review', { key: first.key });
  ok(res);
  assert.equal(res.json<MultiGroupsResponse>().groups.length, 0);
  assert.equal(res.json<MultiGroupsResponse>().reviewedHidden, 1);
  const audit = auditRows(app, 'multi_reviewed');
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actor_id, mod.id);
  assert.match(audit[0]?.detail ?? '', new RegExp(first.key));
  const all = await groups(mod, true);
  assert.equal(all.groups[0]?.reviewed, true);
  assert.equal((await groups(mod)).groups.length, 0, 'still hidden on the next visit');

  app.ctx.store.multi.logEvent({ at: clock.t, kind: 'ship', a: a.id, b: b.id, amount: 10 });
  const back = await groups(mod);
  assert.equal(back.groups.length, 1);
  assert.equal(back.groups[0]?.reviewed, false);
});

test('banning from the page uses the ban service: sessions end, the audit log has the reason, a fully banned group disappears', async () => {
  const { app, clock, mod } = await setup();
  const a = await newPlayer(app, 'ban_a');
  const b = await newPlayer(app, 'ban_b');
  share(app, '10.58.0.1', clock.t, a, b);
  errorOf(await mod.c.post(`/api/staff/players/${a.id}/ban`, {}), 400, 'invalid_input');
  const res = await mod.c.post(`/api/staff/players/${a.id}/ban`, { reason: 'second account of ban_b' });
  ok(res);
  const row = auditRows(app, 'ban').find((r) => r.target_player === a.id);
  assert.ok(row);
  assert.equal(row.actor_id, mod.id);
  assert.match(row.detail, /second account of ban_b/);
  assert.equal((await a.c.get('/api/auth/me')).json<{ player: unknown }>().player, null, 'the banned account was signed out');
  const g = groupOf(await groups(mod), 'ban_a', 'ban_b');
  assert.ok(g, 'a group with one active account is still worth a look');
  assert.equal(g.members.find((m) => m.username === 'ban_a')?.bannedAt !== null, true);
  ok(await mod.c.post(`/api/staff/players/${b.id}/ban`, { reason: 'same person' }));
  assert.equal(groupOf(await groups(mod), 'ban_a', 'ban_b'), undefined, 'all banned: nothing left to judge');
});

// ---- privacy: 30-day cleanup -----------------------------------------------------------------------------

test('the caretaker deletes addresses, devices, activity and the pair log after 30 days', async () => {
  const { app, clock } = await makeApp();
  const a = await register(app, 'gone_a', '10.59.0.1');
  const b = await register(app, 'gone_b', '10.59.0.2');
  const ida = (await a.state()).player.id;
  const idb = (await b.state()).player.id;
  const m = app.ctx.store.multi;
  m.recordDevices(ida, [hashDevice(DEVICE_A)], clock.t);
  m.recordActivity(ida, clock.t);
  m.logEvent({ at: clock.t, kind: 'ship', a: ida, b: idb, amount: 5 });
  const count = (table: string): number => (app.ctx.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const sum = (): number => ['player_ips', 'player_devices', 'player_activity', 'pair_events'].reduce((n, t) => n + count(t), 0);
  assert.ok(sum() >= 5);
  app.ctx.game.runCaretaker(clock.t + 29 * DAY);
  assert.ok(sum() >= 5, 'not yet');
  app.ctx.game.runCaretaker(clock.t + MULTI_RETENTION_MS + 2 * HOUR);
  assert.equal(sum(), 0, 'all gone');
});
