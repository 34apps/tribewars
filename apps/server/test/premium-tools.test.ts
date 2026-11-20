// Premium tools (owner 2026-11-20): 5 build slots and auto mode. Endpoints, entitlement (world switch + player bit), slots, what auto mode
// does on its own while time passes, cancel switches it off, entitlement ends, village lost.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTRA_PREMIUM_TOOLS,
  PREMIUM_BUILD_QUEUE,
  PREMIUM_RESEARCH_QUEUE,
  abandonIdleMs,
  botIdleMs,
  defaultAutoMode,
  villagePoints,
  type AutoOverviewResponse,
  type AutoVillageDto,
  type GameStateResponse,
  type OwnVillageDto,
} from '@clanfire/engine';
import { HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

async function setup(over: { switchOn?: boolean; entitleAlice?: boolean } = {}) {
  const { app, clock } = await makeApp({ worldConfig: { npc: { selfBuild: false }, features: { premium: over.switchOn ?? true } } });
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  if (over.entitleAlice ?? true) app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, true);
  return { app, clock, alice, bob };
}

/** Rich village with a Barracks and a big storehouse so auto mode has something to do. */
function fund(app: App, p: P, over: Record<string, number> = {}): number {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0]!;
  v.state.buildings.storehouse = 25;
  v.state.buildings.barracks = 1;
  v.state.buildings.longhouse = 10;
  v.state.resources = { wood: 40000, food: 40000, iron: 40000, gold: 0, ...over } as typeof v.state.resources;
  store.saveVillage(v.id, v.state, villagePoints(v.state));
  return v.id;
}

const auto = async (p: P): Promise<AutoOverviewResponse> => {
  const res = await p.c.get('/api/auto');
  ok(res);
  return res.json<AutoOverviewResponse>();
};
const setAuto = (p: P, id: number, body: unknown) => p.c.post(`/api/villages/${id}/auto`, body);
const vid = async (p: P): Promise<number> => (await p.c.village()).id;

test('GET /api/auto: 401 signed out; everyone may read; not entitled shows everything off', async () => {
  const { app, alice, bob } = await setup();
  const { Client } = await import('./helpers.ts');
  errorOf(await new Client(app, '10.5.5.5').get('/api/auto'), 401, 'unauthorized');
  const a = await auto(alice);
  assert.equal(a.feature, true);
  assert.equal(a.entitled, true);
  assert.equal(a.villages.length, 1);
  assert.deepEqual([a.villages[0]!.on, a.villages[0]!.buildShare, a.villages[0]!.units], [false, 70, ['pikeman', 'guard']]);
  assert.equal(a.villages[0]!.next, null);
  const b = await auto(bob);
  assert.equal(b.entitled, false);
  assert.equal(b.villages[0]!.on, false);
  errorOf(await alice.c.get('/api/auto?x=1'), 400, 'invalid_input');
});

test('POST /api/villages/:id/auto: 401, 403 not entitled (bit missing, world switch off), 403 stranger, 404 unknown', async () => {
  const { app, alice, bob } = await setup();
  const { Client } = await import('./helpers.ts');
  const va = await vid(alice);
  errorOf(await new Client(app, '10.5.5.6').post(`/api/villages/${va}/auto`, { on: true }), 401, 'unauthorized');
  errorOf(await setAuto(bob, await vid(bob), { on: true }), 403, 'forbidden'); // bit missing
  errorOf(await setAuto(bob, va, { on: true }), 403, 'forbidden');
  errorOf(await setAuto(alice, await vid(bob), { on: true }), 403, 'forbidden'); // entitled, but a stranger's village
  errorOf(await setAuto(alice, 999999, { on: true }), 404, 'not_found');
  // World switch off: even an entitled account is refused and sees feature: false.
  const off = await setup({ switchOn: false });
  const r = await auto(off.alice);
  assert.equal(r.feature, false);
  assert.equal(r.entitled, false);
  errorOf(await setAuto(off.alice, await vid(off.alice), { on: true }), 403, 'forbidden');
  void app;
});

test('POST /api/villages/:id/auto: bad bodies answer 400', async () => {
  const { alice } = await setup();
  const id = await vid(alice);
  const bad: unknown[] = [
    {},
    { on: 'yes' },
    { on: true, buildShare: 35 },
    { on: true, buildShare: 110 },
    { on: true, buildShare: -10 },
    { on: true, buildShare: 7.5 },
    { on: true, units: ['nope'] },
    { on: true, units: ['chieftain'] },
    { on: true, units: ['logram'] },
    { on: true, units: ['pikeman', 'pikeman'] },
    { on: true, units: 'pikeman' },
    { on: true, extra: 1 },
    { on: true, units: ['pikeman', 'guard', 'raider', 'outrider', 'hearthwarden', 'knight', 'pathfinder', 'pikeman'] },
  ];
  for (const body of bad) errorOf(await setAuto(alice, id, body), 400, 'invalid_input');
  assert.equal((await auto(alice)).villages[0]!.on, false, 'nothing changed');
});

test('POST /api/villages/:id/auto: happy path, defaults on first setup, reset of counters when changed', async () => {
  const { app, clock, alice } = await setup();
  const id = fund(app, alice);
  const first = await setAuto(alice, id, { on: true });
  ok(first);
  const dto = first.json<AutoVillageDto>();
  assert.deepEqual([dto.on, dto.buildShare, dto.units], [true, 70, ['pikeman', 'guard']]);
  assert.ok(dto.trainable.includes('pikeman'));
  assert.ok(dto.next, 'it says what it does next');
  clock.advance(HOUR);
  const afterTime = (await alice.c.state()).villages[0]!.state.auto!;
  assert.ok(afterTime.spentBuild + afterTime.spentTroops > 0);
  const again = await setAuto(alice, id, { on: true, buildShare: 40, units: ['pikeman'] });
  ok(again);
  const state = (await alice.c.state()).villages[0]!.state.auto!;
  assert.deepEqual([state.buildShare, state.units, state.spentBuild, state.spentTroops], [40, ['pikeman'], 0, 0]);
  const off = await setAuto(alice, id, { on: false });
  assert.equal(off.json<AutoVillageDto>().on, false);
  assert.equal(off.json<AutoVillageDto>().buildShare, 40, 'settings kept');
  void defaultAutoMode;
});

test('5 build slots for the entitled player, 2 for everyone else', async () => {
  const { app, alice, bob } = await setup();
  fund(app, alice);
  fund(app, bob);
  const st = await alice.c.state();
  assert.equal(st.player.buildQueueLimit, PREMIUM_BUILD_QUEUE);
  assert.equal(st.player.premiumTools, true);
  const sb = await bob.c.state();
  assert.equal(sb.player.buildQueueLimit, 2);
  assert.equal(sb.player.premiumTools, undefined);
  const ids = ['lumber', 'farm', 'mine', 'hall', 'longhouse', 'lumber'];
  const a = await vid(alice);
  const b = await vid(bob);
  for (let i = 0; i < 5; i++) ok(await alice.c.post(`/api/villages/${a}/build`, { building: ids[i] }));
  errorOf(await alice.c.post(`/api/villages/${a}/build`, { building: ids[5] }), 409, 'queue_full');
  for (let i = 0; i < 2; i++) ok(await bob.c.post(`/api/villages/${b}/build`, { building: ids[i] }));
  errorOf(await bob.c.post(`/api/villages/${b}/build`, { building: ids[2] }), 409, 'queue_full');
});

test('5 research slots for the entitled player, 2 for everyone else (server-enforced)', async () => {
  const { app, clock } = await makeApp({ worldConfig: { npc: { selfBuild: false }, features: { premium: true, siege: true } } });
  void clock;
  const alice = await newPlayer(app, 'alice');
  const bob = await newPlayer(app, 'bob');
  app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, true);
  for (const p of [alice, bob]) {
    const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
    v.state.buildings.drillyard = 10;
    v.state.buildings.storehouse = 25;
    v.state.resources = { wood: 40000, food: 40000, iron: 40000, gold: 2000 } as typeof v.state.resources;
    app.ctx.store.saveVillage(v.id, v.state, villagePoints(v.state));
  }
  assert.equal((await alice.c.state()).player.researchQueueLimit, PREMIUM_RESEARCH_QUEUE);
  assert.equal((await bob.c.state()).player.researchQueueLimit, 2);
  const units = ['guard', 'outrider', 'hearthwarden', 'knight', 'logram', 'firecart'];
  const a = await vid(alice);
  const b = await vid(bob);
  for (let i = 0; i < 5; i++) ok(await alice.c.post(`/api/villages/${a}/research`, { unit: units[i] }));
  errorOf(await alice.c.post(`/api/villages/${a}/research`, { unit: units[5] }), 409, 'queue_full');
  for (let i = 0; i < 2; i++) ok(await bob.c.post(`/api/villages/${b}/research`, { unit: units[i] }));
  errorOf(await bob.c.post(`/api/villages/${b}/research`, { unit: units[2] }), 409, 'queue_full');
  // Entitlement ends: the switch or the bit off means the normal limit again.
  app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, false);
  assert.equal((await alice.c.state()).player.researchQueueLimit, 2);
  errorOf(await alice.c.post(`/api/villages/${a}/research`, { unit: units[5] }), 409, 'queue_full');
});

test('auto mode queues a build and a troop order by itself while time passes (a read is all it takes)', async () => {
  const { app, clock, alice } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true, buildShare: 50, units: ['pikeman'] }));
  clock.advance(2 * HOUR);
  const v = (await alice.c.state()).villages[0]!;
  assert.ok(v.state.buildQueue.length > 0 || v.state.buildings.lumber > 1, 'it built');
  assert.ok(v.state.buildQueue.every((j) => j.auto === true) || v.state.buildings.lumber > 1);
  const batches = v.state.trainQueues.barracks;
  const trained = v.state.troops.pikeman;
  assert.ok(batches.some((j) => j.auto) || trained > 0, 'it recruited');
  assert.ok(v.state.auto!.spentBuild > 0 && v.state.auto!.spentTroops > 0);
  const overview = (await auto(alice)).villages[0]!;
  assert.equal(overview.on, true);
  assert.ok(overview.queuedBuilds + overview.queuedTroops > 0 || trained > 0);
  assert.ok(overview.next === null || ['build', 'troops'].includes(overview.next.kind));
});

test('cancel build of an auto job switches it off (through the API)', async () => {
  const { app, clock, alice } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true, buildShare: 100 }));
  clock.advance(MINUTE);
  const before = (await alice.c.state()).villages[0]!.state;
  assert.ok(before.buildQueue.length > 0 && before.buildQueue.at(-1)!.auto, 'auto queued something');
  const res = await alice.c.post(`/api/villages/${id}/cancel-build`, { index: before.buildQueue.length - 1 });
  ok(res);
  assert.equal(res.json<{ village: OwnVillageDto }>().village.state.auto!.on, false);
  assert.equal((await auto(alice)).villages[0]!.on, false);
});

test('cancel train of an auto batch switches it off', async () => {
  const { app, clock, alice } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true, buildShare: 0, units: ['pikeman'] }));
  clock.advance(MINUTE);
  const before = (await alice.c.state()).villages[0]!.state;
  assert.ok(before.trainQueues.barracks.some((j) => j.auto), 'auto queued troops');
  const res = await alice.c.post(`/api/villages/${id}/cancel-train`, { building: 'barracks', index: 0 });
  ok(res);
  assert.equal(res.json<{ village: OwnVillageDto }>().village.state.auto!.on, false);
});

test('entitlement removed: auto mode is off on the next read, settings kept; switching the bit back does not turn it on', async () => {
  const { app, clock, alice } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true, buildShare: 30, units: ['pikeman'] }));
  clock.advance(10 * MINUTE);
  app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, false);
  const st: GameStateResponse = await alice.c.state();
  assert.equal(st.villages[0]!.state.auto!.on, false);
  assert.equal(st.villages[0]!.state.auto!.buildShare, 30);
  assert.equal(st.player.buildQueueLimit, 2);
  assert.equal(app.ctx.store.getVillage(id)!.state.auto!.on, false, 'saved off');
  app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, true);
  clock.advance(HOUR);
  assert.equal((await alice.c.state()).villages[0]!.state.auto!.on, false);
  // The world switch counts too.
  ok(await setAuto(alice, id, { on: true }));
  const cfg = structuredClone(app.ctx.store.effectiveWorldConfig());
  cfg.features.premium = false;
  app.ctx.store.setWorldConfig(cfg);
  Object.assign(app.ctx.settings, (await import('@clanfire/engine')).applyWorldConfig(app.ctx.settings, cfg));
  assert.equal((await auto(alice)).villages[0]!.on, false);
});

test('entitlement removed: the caretaker pass switches it off too, and does not build against it', async () => {
  const { app, clock, alice, bob } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true }));
  app.ctx.store.setPremiumBit(alice.id, EXTRA_PREMIUM_TOOLS, false);
  clock.advance(botIdleMs(app.ctx.settings) + HOUR); // idle long enough for the caretaker to look at it
  await bob.c.state();
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(app.ctx.store.getVillage(id)!.state.auto!.on, false);
});

test('an idle owner\'s village is abandoned: auto mode is gone', async () => {
  const { app, clock, alice, bob } = await setup();
  const id = fund(app, alice);
  ok(await setAuto(alice, id, { on: true }));
  const bobsId = await vid(bob);
  void bobsId;
  clock.advance(abandonIdleMs(app.ctx.settings) + HOUR);
  await bob.c.state();
  app.ctx.game.runCaretaker(clock.now());
  const after = app.ctx.store.getVillage(id)!;
  assert.equal(after.ownerId, null);
  assert.equal(after.state.auto, undefined);
});
