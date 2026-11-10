// Per-world rules through HTTP: two worlds (two apps, each with its own clock), one on the defaults and one with a custom config,
// must behave differently for the same actions. The rules themselves have engine tests; these are about the server wiring.
// Nothing waits on real time: every clock is the test clock, and walking times are either read back or fixed (sandbox accounts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILDING_IDS,
  DEFAULT_WORLD_CONFIG,
  RENOWN_VILLAGE_BASE,
  STRIKE_CHAIN_WINDOW_HOURS,
  HOLD_HOURS_ABANDONED,
  chieftainsNeeded,
  generateSites,
  shipmentTravelMs,
  travelTimeMs,
  villagePoints,
  type Mission,
  type OwnVillageDto,
  type SendResponse,
  type SendShipmentResponse,
  type SitesResponse,
  type Units,
  type VillageState,
} from '@clanfire/engine';
import { Client, HOUR, errorOf, makeApp, ok, type Clock } from './helpers.ts';
import { addMember, newLeader, newPlayer } from './tribe-helpers.ts';
import { giveTroops, send, sendFails, sendOk, units } from './warfare-helpers.ts';
import { clearedTarget, homeOf, player, reserveFor, runTo, strongHome, type App, type P } from './village-helpers.ts';

const SPEED = 10; // TEST_WORLD

type Config = Record<string, Record<string, number | boolean>>;

/** The same world twice: on the defaults, and with `custom` (plus the same test options for both). */
async function twin(custom: Config, opts: { sandboxUsers?: string[] } = {}) {
  const def = await makeApp({ ...opts });
  const cus = await makeApp({ ...opts, worldConfig: custom });
  return { def, cus };
}

/** Give a player's first village every building the tests need and plenty of stock (written straight into the database). */
function rich(app: App, p: P, levels: Partial<VillageState['buildings']> = {}, researched?: string[]): number {
  const v = app.ctx.store.villagesOfPlayer(p.id)[0]!;
  Object.assign(v.state.buildings, { hall: 10, farm: 15, storehouse: 15, barracks: 5, drillyard: 3, ...levels });
  if (researched) v.state.researched = researched as never;
  Object.assign(v.state.resources, { wood: 50000, food: 50000, iron: 50000, gold: 5000 });
  app.ctx.store.saveVillage(v.id, v.state, villagePoints(v.state));
  return v.id;
}

/** Post the same order until the server refuses; returns how many were accepted (the refusal must be `queue_full`). */
async function fillQueue(c: Client, url: string, body: object): Promise<number> {
  for (let n = 0; n < 25; n++) {
    const res = await c.post(url, body);
    if (res.statusCode !== 200) {
      errorOf(res, 409, 'queue_full');
      return n;
    }
  }
  assert.fail('the queue never filled up');
}

// ---- (1) tribe size ------------------------------------------------------------------------------------------------------

test('tribe.maxMembers: the third member is refused in a world with a limit of 2, accepted in the default world', async () => {
  const { def, cus } = await twin({ tribe: { maxMembers: 2 } });
  assert.ok(DEFAULT_WORLD_CONFIG.tribe.maxMembers > 3);
  for (const [w, limit] of [[def, DEFAULT_WORLD_CONFIG.tribe.maxMembers], [cus, 2]] as const) {
    const lead = await newLeader(w.app, 'lead', 'Lead Pack', 'LEAD', 'open');
    await addMember(w.app, lead, 'second');
    const third = await newPlayer(w.app, 'third');
    const res = await third.c.post(`/api/tribes/${lead.tribeId}/join`);
    if (limit === 2) {
      errorOf(res, 409, 'tribe_full');
      assert.match(res.json<{ message: string }>().message, /2 members/);
    } else {
      ok(res);
    }
  }
  await def.app.close();
  await cus.app.close();
});

// ---- (2) queues ----------------------------------------------------------------------------------------------------------

test('queues.build and queues.train: the queue holds exactly the world\'s number of jobs', async () => {
  const { def, cus } = await twin({ queues: { build: 3, train: 7 } });
  const counts: Array<{ build: number; train: number }> = [];
  for (const w of [def, cus]) {
    const p = await newPlayer(w.app, 'queuer');
    const vid = rich(w.app, p);
    const build = await fillQueue(p.c, `/api/villages/${vid}/build`, { building: 'lumber' });
    const train = await fillQueue(p.c, `/api/villages/${vid}/train`, { unit: 'pikeman', count: 1 });
    counts.push({ build, train });
  }
  assert.deepEqual(counts[0], { build: DEFAULT_WORLD_CONFIG.queues.build, train: DEFAULT_WORLD_CONFIG.queues.train });
  assert.deepEqual(counts[1], { build: 3, train: 7 });
  await def.app.close();
  await cus.app.close();
});

test('a cancel index above the default queue length is valid in a world with a longer queue', async () => {
  const { cus } = await twin({ queues: { build: 4 } });
  const p = await newPlayer(cus.app, 'queuer');
  const vid = rich(cus.app, p);
  for (let i = 0; i < 4; i++) ok(await p.c.post(`/api/villages/${vid}/build`, { building: 'lumber' }));
  ok(await p.c.post(`/api/villages/${vid}/cancel-build`, { index: 3 })); // the schema does not cap the index at the default queue length
  assert.equal((await p.c.village()).state.buildQueue.length, 3);
  await cus.app.close();
});

// ---- (3) unit speed ------------------------------------------------------------------------------------------------------

test('pace.unitSpeed: attacks and shipments take half the walking time at unit speed 2, exactly as the engine says', async () => {
  const { def, cus } = await twin({ pace: { unitSpeed: 2 } });
  const walk: Array<{ attack: number; ship: number; slowAttack: number; slowShip: number }> = [];
  for (const w of [def, cus]) {
    const alice = await newLeader(w.app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
    const amy = await addMember(w.app, alice, 'amy');
    const homeId = strongHome(w.app, w.clock, alice, { raider: 50 });
    const target = clearedTarget(w.app, homeOf(w.app, alice));
    const s = w.app.ctx.settings;
    const slow = { ...s, config: undefined }; // the same world with unit speed 1

    const army = units({ raider: 20 });
    const a = await sendOk(alice, target, 'attack', { raider: 20 });
    const from = homeOf(w.app, alice);
    assert.equal(a.movement.arriveAt - a.movement.departAt, travelTimeMs(from, target, army, s), 'attack time = the engine with this world\'s settings');

    const amyHome = homeOf(w.app, amy);
    const res = await alice.c.post(`/api/villages/${homeId}/ship`, { x: amyHome.x, y: amyHome.y, resources: { wood: 100 } });
    ok(res, 201);
    const sh = res.json<SendShipmentResponse>().movement;
    assert.equal(sh.arriveAt - sh.departAt, shipmentTravelMs(from, amyHome, s), 'shipment time = the engine with this world\'s settings');
    walk.push({
      attack: a.movement.arriveAt - a.movement.departAt,
      ship: sh.arriveAt - sh.departAt,
      slowAttack: travelTimeMs(from, target, army, slow),
      slowShip: shipmentTravelMs(from, amyHome, slow),
    });
  }
  const [d, c] = walk as [(typeof walk)[number], (typeof walk)[number]];
  assert.equal(d.attack, d.slowAttack, 'default world: unit speed 1 changes nothing');
  assert.equal(d.ship, d.slowShip);
  for (const [fast, slowMs] of [[c.attack, c.slowAttack], [c.ship, c.slowShip]] as const) {
    assert.ok(Math.abs(fast * 2 - slowMs) <= 10, `${fast} ms is half of ${slowMs} ms (rounding aside)`);
  }
  await def.app.close();
  await cus.app.close();
});

// ---- (4) conquest ---------------------------------------------------------------------------------------------------------

const train = (c: Client, vid: number, count: number) => c.post(`/api/villages/${vid}/train`, { unit: 'chieftain', count });

test('conquest.renownBase: the price of the 2nd village, the Chieftain reservation and the next price follow the world', async () => {
  const { def, cus } = await twin({ conquest: { renownBase: 200 } });
  const seen: Array<{ next: number; price: number; reserved: number; priceAfter: number }> = [];
  for (const w of [def, cus]) {
    const p = await player(w.app, 'alice');
    const vid = strongHome(w.app, w.clock, p, {});
    w.app.ctx.store.addRenown(p.id, 2000);
    w.app.ctx.store.depositChest(p.id, 100_000);
    const before = (await p.c.state()).renown;
    ok(await train(p.c, vid, 1));
    const after = (await p.c.state()).renown;
    seen.push({ next: before.nextVillageCost, price: before.chieftainPrice ?? -1, reserved: after.reserved ?? -1, priceAfter: after.chieftainPrice ?? -1 });
  }
  assert.deepEqual(seen[0], { next: RENOWN_VILLAGE_BASE, price: RENOWN_VILLAGE_BASE, reserved: RENOWN_VILLAGE_BASE, priceAfter: Math.round(RENOWN_VILLAGE_BASE * DEFAULT_WORLD_CONFIG.conquest.renownGrowth) });
  assert.deepEqual(seen[1], { next: 200, price: 200, reserved: 200, priceAfter: Math.round(200 * DEFAULT_WORLD_CONFIG.conquest.renownGrowth) });
  await def.app.close();
  await cus.app.close();
});

/** Send with a fixed walk (sandbox account) so the arrival time is exact. */
async function go(p: P, vid: number, to: { x: number; y: number }, mission: Mission, u: Partial<Units>, travelSeconds = 60, returnSeconds?: number) {
  const res = await p.c.post(`/api/villages/${vid}/send`, { x: to.x, y: to.y, units: u, mission, travelSeconds, returnSeconds });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

test('conquest.holdHoursAbandoned: the hold clock after a Strike lasts as long as the world says', async () => {
  const { def, cus } = await twin({ conquest: { holdHoursAbandoned: 1 } }, { sandboxUsers: ['claimer'] });
  const due: number[] = [];
  for (const [w, hours] of [[def, HOLD_HOURS_ABANDONED], [cus, 1]] as const) {
    const p = await player(w.app, 'claimer');
    const homeId = strongHome(w.app, w.clock, p, { raider: 300, chieftain: 2 });
    reserveFor(w.app, p, 2, 500);
    const target = clearedTarget(w.app, homeOf(w.app, p));
    const m = await go(p, homeId, target, 'attack', { raider: 300, chieftain: 1 });
    runTo(w.app, w.clock, m.arriveAt);
    const cold = w.app.ctx.store.getVillage(target.id);
    assert.ok(cold?.state.hearth, 'the hearth is out');
    assert.equal(cold.holdDueAt! - m.arriveAt, (hours * HOUR) / SPEED);
    due.push(cold.holdDueAt! - m.arriveAt);
  }
  assert.equal(due[0], 2 * due[1]!, 'one hour against two');
  await def.app.close();
  await cus.app.close();
});

/** A village of exactly `need` Chieftains' size (all buildings scaled down from the maximum, no troops). */
function sizedVictim(app: App, p: P, clock: Clock, need: number) {
  const store = app.ctx.store;
  const id = strongHome(app, clock, p, {});
  const full = store.getVillage(id)!.state;
  for (let f = 1; f > 0; f -= 0.02) {
    const st: VillageState = structuredClone(full);
    for (const b of BUILDING_IDS) st.buildings[b] = Math.floor(full.buildings[b] * f);
    if (chieftainsNeeded(false, villagePoints(st)) === need) {
      store.saveVillage(id, st, villagePoints(st));
      return store.getVillage(id)!;
    }
  }
  throw new Error(`no size with need ${need}`);
}

test('conquest.chainWindowHours: two Chieftains arriving 300 s apart chain in the default world only', async () => {
  // Default window 2 h / 10 = 720 s; the custom world has 0.5 h / 10 = 180 s.
  assert.equal((STRIKE_CHAIN_WINDOW_HOURS * 3600) / SPEED, 720);
  const { def, cus } = await twin({ conquest: { chainWindowHours: 0.5 } }, { sandboxUsers: ['claimer'] });
  const struck: boolean[] = [];
  for (const w of [def, cus]) {
    const claimer = await player(w.app, 'claimer');
    const victim = await player(w.app, 'victim');
    const target = sizedVictim(w.app, victim, w.clock, 2);
    const home = strongHome(w.app, w.clock, claimer, { raider: 9000, chieftain: 2 });
    reserveFor(w.app, claimer, 2, 500);
    const army = { raider: 3000, chieftain: 1 };
    // The way home is fixed (1000 s, longer than the 300 s gap) so the first Chieftain is still on the road when the second
    // arrives whatever the random distance between the two villages; otherwise it is home and no longer chains.
    const m1 = await go(claimer, home, target, 'attack', army, 60, 1000);
    const m2 = await go(claimer, home, target, 'attack', army, 360, 1000);
    runTo(w.app, w.clock, m1.arriveAt);
    runTo(w.app, w.clock, m2.arriveAt);
    struck.push(Boolean(w.app.ctx.store.getVillage(target.id)?.state.hearth));
  }
  assert.deepEqual(struck, [true, false]);
  await def.app.close();
  await cus.app.close();
});

// ---- (5) beginner protection ---------------------------------------------------------------------------------------------

test('protection.beginnerHours: a new village is protected in the default world and attackable at once with 0 hours', async () => {
  const { def, cus } = await twin({ protection: { beginnerHours: 0 } });
  for (const [w, protectedHere] of [[def, true], [cus, false]] as const) {
    const attacker = await player(w.app, 'attacker');
    giveTroops(w.app, attacker, { raider: 10 });
    const victim = await newPlayer(w.app, 'victim');
    const res = await send(attacker, victim, 'attack', { raider: 5 });
    if (protectedHere) {
      errorOf(res, 409, 'target_protected');
      assert.ok((await victim.c.state()).player.protectedUntil > w.clock.now());
    } else {
      ok(res, 201);
      assert.ok((await victim.c.state()).player.protectedUntil <= w.clock.now());
    }
  }
  await def.app.close();
  await cus.app.close();
});

// ---- (6) siege -------------------------------------------------------------------------------------------------------------

test('features.siege off: a Log Ram can be neither researched nor trained; on by default', async () => {
  const { def, cus } = await twin({ features: { siege: false } });
  for (const [w, on] of [[def, true], [cus, false]] as const) {
    const p = await newPlayer(w.app, 'smith');
    const vid = rich(w.app, p, { barracks: 5, drillyard: 3 });
    const research = await p.c.post(`/api/villages/${vid}/research`, { unit: 'logram' });
    if (on) ok(research);
    else errorOf(research, 409, 'requirements_not_met');
    // Researched at once (as if done) so the training gate is what is checked.
    rich(w.app, p, { barracks: 5, drillyard: 3 }, ['logram']);
    const trained = await p.c.post(`/api/villages/${vid}/train`, { unit: 'logram', count: 1 });
    if (on) ok(trained);
    else errorOf(trained, 409, 'requirements_not_met');
    const v = (await p.c.village()) as OwnVillageDto;
    assert.equal(v.state.trainQueues.barracks.length, on ? 1 : 0);
  }
  await def.app.close();
  await cus.app.close();
});

// ---- (7) sites -------------------------------------------------------------------------------------------------------------

test('features.sites off: no sites in the list, no site to attack or recall from; present by default', async () => {
  const { def, cus } = await twin({ features: { sites: false } });
  for (const [w, on] of [[def, true], [cus, false]] as const) {
    const p = await player(w.app, 'scout');
    const res = await p.c.get('/api/sites');
    ok(res);
    const list = res.json<SitesResponse>();
    const s = w.app.ctx.settings;
    const real = generateSites(s.seed, s.radius);
    assert.ok(real.length > 0);
    assert.equal(list.sites.length, on ? real.length : 0);
    if (!on) {
      // The tile where the Great Fire would stand is an empty tile (unless an abandoned village happens to stand there): no site.
      giveTroops(w.app, p, { raider: 5 });
      const at = real[0]!;
      if (!w.app.ctx.store.getVillageAt(at.x, at.y)) await sendFails(p, at, 'attack', { raider: 1 }, 400, 'invalid_target');
      errorOf(await p.c.post(`/api/sites/1/recall`, { villageId: homeOf(w.app, p).id }), 404, 'not_found');
    }
  }
  await def.app.close();
  await cus.app.close();
});

// ---- (8) abandoned villages ------------------------------------------------------------------------------------------------

test('npc.maxLevel, startStockShare and startGoldPerTier: abandoned villages are created with the world\'s values', async () => {
  const { def, cus } = await twin({ npc: { maxLevel: 2, startStockShare: 0.1, startGoldPerTier: 0 } });
  const read = (app: App) => {
    const store = app.ctx.store;
    const states = store.abandonedVillageIds().map((id) => store.getVillage(id)!.state);
    assert.ok(states.length > 0);
    return {
      top: Math.max(...states.flatMap((st) => BUILDING_IDS.map((b) => st.buildings[b]))),
      wood: states.reduce((n, st) => n + st.resources.wood, 0),
      gold: states.reduce((n, st) => n + st.resources.gold, 0),
    };
  };
  const d = read(def.app);
  const c = read(cus.app);
  assert.ok(d.top > 2, `default villages grow past level 2 (${d.top})`);
  assert.ok(c.top <= 2, `custom villages stop at level 2 (${c.top})`);
  assert.ok(c.wood < d.wood, 'a start stock of 10% of the cap against 50%');
  assert.ok(d.gold > 0);
  assert.equal(c.gold, 0);
  await def.app.close();
  await cus.app.close();
});

// ---- (9) conquering players -------------------------------------------------------------------------------------------------

test('conquest.playersCanBeConquered off: a Chieftain cannot be sent against a player village; it can by default', async () => {
  const { def, cus } = await twin({ conquest: { playersCanBeConquered: false } });
  for (const [w, on] of [[def, true], [cus, false]] as const) {
    const claimer = await player(w.app, 'claimer');
    const victim = await player(w.app, 'victim');
    const homeId = strongHome(w.app, w.clock, claimer, { raider: 300, chieftain: 2 });
    reserveFor(w.app, claimer, 2, 500);
    const target = homeOf(w.app, victim);
    const res = await claimer.c.post(`/api/villages/${homeId}/send`, { x: target.x, y: target.y, units: { raider: 200, chieftain: 1 }, mission: 'attack' });
    if (on) ok(res, 201);
    else errorOf(res, 400, 'invalid_target');
    // An abandoned village can always be struck.
    const npc = clearedTarget(w.app, homeOf(w.app, claimer));
    ok(await claimer.c.post(`/api/villages/${homeId}/send`, { x: npc.x, y: npc.y, units: { raider: 100, chieftain: 1 }, mission: 'attack' }), 201);
  }
  await def.app.close();
  await cus.app.close();
});
