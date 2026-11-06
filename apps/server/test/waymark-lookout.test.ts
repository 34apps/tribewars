// Waymarks and Lookouts (docs/GAME_DESIGN.md 18.4b "Neutral sites tribes can hold"): capture like shrines, the road effect of a held Waymark
// for the holder tribe's members (and only them, decided when each movement is created) and the Lookout sightings route.
// Everything is put into the database directly and the test clock moves; nothing waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOOKOUT_LIST_LIMIT,
  LOOKOUT_RADIUS,
  emptyUnits,
  generateSites,
  lookoutSees,
  shipmentTravelMs,
  siteCalmMs,
  siteMilitiaPopulation,
  travelTimeMs,
  type Coords,
  type LookoutSightingsResponse,
  type SendResponse,
  type SiteDef,
  type SitesResponse,
  type Units,
} from '@clanfire/engine';
import { routeBucket } from '../src/security.ts';
import type { VillageRecord } from '../src/store.ts';
import { errorOf, makeApp, ok, register } from './helpers.ts';
import { addMember, formPact, newLeader, newPlayer, type App, type P } from './tribe-helpers.ts';
import { homeOf, runTo, strongHome } from './village-helpers.ts';
import { sendFails, unprotect } from './warfare-helpers.ts';
import type { Clock } from './helpers.ts';

// A big world: the sites need room (the default test world is too small to hold more than a corner of them).
const BIG_WORLD = { radius: 100 };
const BIG = { raider: 3000 } as const; // beats a 300 population militia

async function world() {
  const { app, clock } = await makeApp({ world: BIG_WORLD });
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  const bea = await addMember(app, bob, 'bea');
  const cara = await newLeader(app, 'cara', 'Cara Clan', 'CARA', 'open');
  const lou = await newPlayer(app, 'lou');
  unprotect(app, alice, amy, bob, bea, cara, lou);
  const sites = generateSites(app.ctx.settings.seed, app.ctx.settings.radius);
  const waymarks = sites.filter((s) => s.kind === 'waymark');
  const lookouts = sites.filter((s) => s.kind === 'lookout');
  assert.equal(waymarks.length, 6);
  assert.equal(lookouts.length, 6);
  return { app, clock, alice, amy, bob, bea, cara, lou, sites, waymarks, lookouts };
}
type W = Awaited<ReturnType<typeof world>>;

const tribeOf = (app: App, p: P): number => {
  const m = app.ctx.store.tribes.membership(p.id);
  assert.ok(m, `${p.name} is in a tribe`);
  return m.tribeId;
};

/** The player's tribe holds the site (a few of its troops stand there, as after a capture). */
function hold(w: W, siteId: number, p: P): void {
  const home = homeOf(w.app, p);
  w.app.ctx.store.sites.setHolder(siteId, tribeOf(w.app, p));
  w.app.ctx.store.sites.addGarrison(siteId, p.id, home.id, { ...emptyUnits(), pikeman: 10 }, w.clock.now(), null);
}

/** Nobody holds the site any more. */
function release(w: W, siteId: number): void {
  for (const c of w.app.ctx.store.sites.garrisonAt(siteId)) w.app.ctx.store.sites.deleteGarrison(c.id);
  w.app.ctx.store.sites.setHolder(siteId, null);
}

const sitesOf = async (p: P): Promise<SitesResponse> => {
  const res = await p.c.get('/api/sites');
  ok(res);
  return res.json<SitesResponse>();
};
const sightingsOf = async (p: P): Promise<LookoutSightingsResponse> => {
  const res = await p.c.get('/api/tribe/sightings');
  ok(res);
  return res.json<LookoutSightingsResponse>();
};

// ---- capture, hold, names -----------------------------------------------------------------------------------------------

test('a Waymark and a Lookout are taken by attack, held by support, calm afterwards, and give no Renown bonus', async () => {
  const w = await world();
  const before = await sitesOf(w.lou);
  assert.equal(before.sites.length, 21);
  const names = before.sites.filter((s) => s.kind === 'waymark' || s.kind === 'lookout').map((s) => s.name);
  assert.deepEqual(names, ['Waymark 1', 'Lookout 1', 'Waymark 2', 'Lookout 2', 'Waymark 3', 'Lookout 3', 'Waymark 4', 'Lookout 4', 'Waymark 5', 'Lookout 5', 'Waymark 6', 'Lookout 6']);
  assert.deepEqual([before.sites[0]?.name, before.sites[1]?.name, before.sites[8]?.name], ['Great Fire', 'Fire Shrine 1', 'Fire Shrine 8']);
  for (const s of before.sites.filter((x) => x.kind === 'waymark' || x.kind === 'lookout')) {
    assert.equal(s.holder, null);
    assert.equal(s.garrison, siteMilitiaPopulation(s.kind, false));
    assert.equal(s.garrison, 300);
    assert.equal(s.maxPopulation, 3000);
    assert.equal(s.awake, false);
    assert.equal(s.bonus, 0);
  }

  for (const [site, army] of [[w.waymarks[0] as SiteDef, w.alice] as const, [w.lookouts[0] as SiteDef, w.amy] as const]) {
    strongHome(w.app, w.clock, army, BIG);
    const home = homeOf(w.app, army);
    const res = await army.c.post(`/api/villages/${home.id}/send`, { x: site.x, y: site.y, units: BIG, mission: 'attack' });
    ok(res, 201);
    const m = res.json<SendResponse>().movement;
    assert.equal(m.target.villageId, 0);
    runTo(w.app, w.clock, m.arriveAt);
    const row = (await sitesOf(army)).sites.find((s) => s.id === site.id);
    assert.ok(row);
    assert.equal(row.holder?.tag, 'ALPHA', `${row.name} taken`);
    assert.equal(row.calmUntil, m.arriveAt + siteCalmMs(w.app.ctx.settings));
    assert.equal(row.bonus, 0, 'no Renown bonus');
    assert.ok(row.garrison > 0 && row.garrison <= 3000);
    // Calm: another tribe cannot attack it right away.
    strongHome(w.app, w.clock, w.bob, { raider: 50 });
    await sendFails(w.bob, site, 'attack', { raider: 50 }, 409, 'target_protected');
  }
  assert.equal((await sitesOf(w.alice)).myBonus, 0, 'a tribe holding only Waymarks and Lookouts gets no Renown bonus');
  assert.equal((await sitesOf(w.amy)).myBonus, 0);

  // Support from a tribe-mate fills the Lookout up (held sites take support).
  const lo = w.lookouts[0] as SiteDef;
  const heldBefore = (await sitesOf(w.alice)).sites.find((s) => s.id === lo.id)?.garrison ?? 0;
  strongHome(w.app, w.clock, w.alice, { pikeman: 40 });
  const home = homeOf(w.app, w.alice);
  const sup = await w.alice.c.post(`/api/villages/${home.id}/send`, { x: lo.x, y: lo.y, units: { pikeman: 40 }, mission: 'support' });
  ok(sup, 201);
  runTo(w.app, w.clock, sup.json<SendResponse>().movement.arriveAt);
  assert.ok(((await sitesOf(w.alice)).sites.find((s) => s.id === lo.id)?.garrison ?? 0) > heldBefore);
});

// ---- Waymark: the road effect -------------------------------------------------------------------------------------------

const ARMY: Partial<Units> = { raider: 20 };

/** An abandoned village with its garrison removed, so an army wins there at once. */
function cleared(app: App, v: VillageRecord): VillageRecord {
  v.state.troops = emptyUnits();
  app.ctx.store.saveVillage(v.id, v.state, 0);
  return app.ctx.store.getVillage(v.id) as VillageRecord;
}

/**
 * The (Waymark, abandoned village) pair whose road from every one of `homes` crosses slow ground within the Waymark's reach for both
 * raiders and the shipment carrier, most helped first (the weakest of the homes counts).
 */
function bestRoad(app: App, homes: Coords[], waymarks: readonly SiteDef[]): { waymark: SiteDef; target: VillageRecord; gain: number } {
  const s = app.ctx.settings;
  let best: { waymark: SiteDef; target: VillageRecord; gain: number } | null = null;
  for (const id of app.ctx.store.abandonedVillageIds()) {
    const target = app.ctx.store.getVillage(id);
    if (!target) continue;
    for (const waymark of waymarks) {
      if (Math.hypot(target.x - waymark.x, target.y - waymark.y) > 14) continue;
      const gains = homes.flatMap((h) => {
        const army = { ...emptyUnits(), ...ARMY };
        return [
          travelTimeMs(h, target, army, s) - travelTimeMs(h, target, army, s, [waymark]),
          shipmentTravelMs(h, target, s) - shipmentTravelMs(h, target, s, [waymark]),
        ];
      });
      const gain = Math.min(...gains);
      if (gain > 0 && (!best || gain > best.gain)) best = { waymark, target, gain };
    }
  }
  assert.ok(best, 'a slow road past a Waymark exists in the test world');
  return best;
}

async function marchTo(app: App, clock: Clock, p: P, target: Coords, mission: 'attack' | 'support' = 'attack'): Promise<SendResponse['movement']> {
  strongHome(app, clock, p, ARMY);
  const home = homeOf(app, p);
  const res = await p.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: ARMY, mission });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

const duration = (m: { departAt: number; arriveAt: number }): number => m.arriveAt - m.departAt;

test('a held Waymark speeds up its tribe members only: not allies, not enemies, not the tribeless; sent-before keeps its time', async () => {
  const w = await world();
  await formPact(w.alice, 'CARA', w.cara, 'ally');
  const s = w.app.ctx.settings;
  const army = { ...emptyUnits(), ...ARMY };
  const homes = [w.amy, w.bea, w.cara, w.lou].map((p) => homeOf(w.app, p));
  const { waymark, target: t } = bestRoad(w.app, homes, w.waymarks);
  const target = cleared(w.app, t);

  // Before the capture nobody is helped.
  const early = await marchTo(w.app, w.clock, w.amy, target);
  const amyHome = homeOf(w.app, w.amy);
  assert.equal(duration(early), travelTimeMs(amyHome, target, army, s));

  hold(w, waymark.id, w.alice);
  // The march in flight keeps its time.
  const listed = (await w.amy.c.state()).movements.find((m) => m.id === early.id);
  assert.equal(listed?.arriveAt, early.arriveAt);
  assert.equal(w.app.ctx.store.getMovement(early.id)?.arriveAt, early.arriveAt);

  // A member sending now is helped, by exactly the engine's halved penalty.
  const helped = await marchTo(w.app, w.clock, w.amy, target);
  assert.equal(duration(helped), travelTimeMs(amyHome, target, army, s, [waymark]));
  assert.ok(duration(helped) < duration(early), 'the same road is faster');

  // The leader too (own village, own road); a tribe-mate of any rank.
  const aliceHome = homeOf(w.app, w.alice);
  assert.equal(duration(await marchTo(w.app, w.clock, w.alice, target)), travelTimeMs(aliceHome, target, army, s, [waymark]));

  // An enemy tribe member, an ally, and a player without a tribe get the plain time.
  for (const p of [w.bea, w.cara, w.lou]) {
    const home = homeOf(w.app, p);
    const m = await marchTo(w.app, w.clock, p, target);
    assert.equal(duration(m), travelTimeMs(home, target, army, s), `${p.name} is not helped`);
    assert.ok(travelTimeMs(home, target, army, s, [waymark]) < duration(m), `${p.name}'s road would have been helped`);
  }

  // The tribe loses the Waymark: back to the plain time.
  release(w, waymark.id);
  assert.equal(duration(await marchTo(w.app, w.clock, w.amy, target)), travelTimeMs(amyHome, target, army, s));
});

test('a held Waymark also speeds up shipments and the way home (decided when the return starts)', async () => {
  const w = await world();
  const s = w.app.ctx.settings;
  const homes = [w.amy, w.bea].map((p) => homeOf(w.app, p));
  const { waymark, target: t } = bestRoad(w.app, homes, w.waymarks);
  const target = cleared(w.app, t);
  const amyHome = homeOf(w.app, w.amy);
  const beaHome = homeOf(w.app, w.bea);
  hold(w, waymark.id, w.alice);

  // Shipments.
  strongHome(w.app, w.clock, w.amy, {});
  strongHome(w.app, w.clock, w.bea, {});
  const shipOf = async (p: P) => {
    const home = homeOf(w.app, p);
    const res = await p.c.post(`/api/villages/${home.id}/ship`, { x: target.x, y: target.y, resources: { wood: 10 } });
    ok(res, 201);
    return res.json<{ movement: { departAt: number; arriveAt: number } }>().movement;
  };
  assert.equal(duration(await shipOf(w.amy)), shipmentTravelMs(amyHome, target, s, [waymark]));
  assert.equal(duration(await shipOf(w.bea)), shipmentTravelMs(beaHome, target, s));
  assert.ok(shipmentTravelMs(amyHome, target, s, [waymark]) < shipmentTravelMs(amyHome, target, s));

  // The way home: the tribe still holds the Waymark when the army turns round at the target.
  const out = await marchTo(w.app, w.clock, w.amy, target);
  runTo(w.app, w.clock, out.arriveAt);
  const back = w.app.ctx.store.movementsFrom(amyHome.id).find((m) => m.kind === 'return' && m.departAt === out.arriveAt);
  assert.ok(back, 'the survivors walk home');
  assert.equal(back.arriveAt - back.departAt, travelTimeMs(target, amyHome, back.units, s, [waymark]));
  assert.ok(back.arriveAt - back.departAt < travelTimeMs(target, amyHome, back.units, s));

  // Lost before the army turns round: the return takes the plain time (nothing in flight is changed, a new movement looks at now).
  const out2 = await marchTo(w.app, w.clock, w.amy, target);
  release(w, waymark.id);
  runTo(w.app, w.clock, out2.arriveAt);
  const back2 = w.app.ctx.store.movementsFrom(amyHome.id).find((m) => m.kind === 'return' && m.departAt === out2.arriveAt);
  assert.ok(back2);
  assert.equal(back2.arriveAt - back2.departAt, travelTimeMs(target, amyHome, back2.units, s));
});

// ---- Lookout: sightings -------------------------------------------------------------------------------------------------

/** Move a village to a tile near (x, y) (the nearest free one along y), for tests that need exact geometry. */
function moveVillage(app: App, v: VillageRecord, x: number, y: number): Coords {
  const st = app.ctx.store.db.prepare('UPDATE villages SET x = ?, y = ? WHERE id = ?');
  for (let dy = 0; dy < 30; dy++) {
    try {
      st.run(x, y + dy, v.id);
      return { x, y: y + dy };
    } catch {
      /* tile taken: try the next one */
    }
  }
  throw new Error('no free tile near the wanted one');
}

/** The march of `p` (their home) to an abandoned village, both placed by hand, put on the road directly. */
function march(w: W, p: P, from: Coords, to: Coords, over: { kind?: 'attack' | 'support' | 'return' | 'shipment' | 'scout'; units?: Partial<Units>; spare?: number; arriveIn?: number } = {}): number {
  const store = w.app.ctx.store;
  const home = homeOf(w.app, p);
  const spare = store.getVillage(store.abandonedVillageIds()[over.spare ?? 0] as number) as VillageRecord;
  moveVillage(w.app, home, from.x, from.y);
  const placed = moveVillage(w.app, spare, to.x, to.y);
  assert.ok(placed.x === to.x);
  const t = w.clock.now();
  return store.insertMovement({
    kind: over.kind ?? 'attack',
    originVillageId: home.id,
    targetVillageId: spare.id,
    units: { ...emptyUnits(), raider: 5, ...(over.units ?? {}) },
    loot: null,
    departAt: t,
    arriveAt: t + (over.arriveIn ?? 60_000),
  });
}

test('the holder tribe sees an enemy attack passing a held Lookout: sender, target, times, size band and no unit counts', async () => {
  const w = await world();
  const lo = w.lookouts[0] as SiteDef;
  hold(w, lo.id, w.alice);
  const from = { x: lo.x - 30, y: lo.y + 5 };
  const to = { x: lo.x + 30, y: lo.y + 10 };
  const id = march(w, w.bob, from, to, { units: { raider: 5 } });
  const bobHome = homeOf(w.app, w.bob);
  const target = w.app.ctx.store.getMovement(id);
  assert.ok(target);
  const arrive = target.arriveAt;

  for (const viewer of [w.alice, w.amy]) {
    const res = await viewer.c.get('/api/tribe/sightings');
    ok(res);
    const body = res.json<LookoutSightingsResponse>();
    assert.equal(body.lookouts, 1);
    assert.equal(body.sightings.length, 1, `${viewer.name} sees the march`);
    const [s] = body.sightings;
    assert.ok(s);
    assert.deepEqual(
      { id: s.movementId, lo: s.lookoutId, name: s.lookoutName, mission: s.mission, size: s.size, tag: s.fromTribeTag, dep: s.departAt, arr: s.arriveAt },
      { id, lo: lo.id, name: 'Lookout 1', mission: 'attack', size: 'small', tag: 'BRAVO', dep: w.clock.now(), arr: arrive },
    );
    assert.deepEqual([s.from.villageId, s.from.x, s.from.y], [bobHome.id, from.x, from.y]);
    assert.deepEqual([s.to.x, s.to.y, s.to.kind], [to.x, to.y, 'village']);
    // Never the army's numbers.
    assert.equal('units' in s, false);
    assert.doesNotMatch(res.body, /raider|units|pikeman/);
  }

  // The window is the whole march: gone once it has arrived.
  w.clock.set(arrive + 1);
  assert.deepEqual((await sightingsOf(w.alice)).sightings, []);
  assert.equal((await sightingsOf(w.alice)).lookouts, 1);
});

test('sightings: size bands, supports, and marches to a site are shown; returns, shipments and other kinds are not', async () => {
  const w = await world();
  const lo = w.lookouts[1] as SiteDef;
  hold(w, lo.id, w.alice);
  const from = { x: lo.x - 30, y: lo.y };
  const to = { x: lo.x + 30, y: lo.y + 4 };
  march(w, w.bob, from, to, { units: { raider: 400 } }); // 400 population: medium (100 <= pop < 1000)
  let seen = await sightingsOf(w.alice);
  assert.deepEqual(seen.sightings.map((s) => s.size), ['medium']);
  w.app.ctx.store.deleteMovement(seen.sightings[0]?.movementId as number);
  march(w, w.bob, from, to, { units: { raider: 2500 } });
  seen = await sightingsOf(w.alice);
  assert.deepEqual(seen.sightings.map((s) => s.size), ['large']);
  w.app.ctx.store.deleteMovement(seen.sightings[0]?.movementId as number);

  march(w, w.bob, from, to, { kind: 'support', units: { pikeman: 5 } });
  seen = await sightingsOf(w.alice);
  assert.deepEqual(seen.sightings.map((s) => [s.mission, s.size]), [['support', 'small']]);
  w.app.ctx.store.deleteMovement(seen.sightings[0]?.movementId as number);

  // Not listed: a return, a shipment, a scouting march, an attack of Pathfinders only.
  march(w, w.bob, from, to, { kind: 'return' });
  march(w, w.bob, from, to, { kind: 'shipment', units: { raider: 0 } });
  march(w, w.bob, from, to, { kind: 'scout', units: { raider: 0, pathfinder: 5 } });
  march(w, w.bob, from, to, { kind: 'attack', units: { raider: 0, pathfinder: 5 } });
  assert.deepEqual((await sightingsOf(w.alice)).sightings, []);
  // ...but Pathfinders in a mixed army do not hide it.
  march(w, w.bob, from, to, { kind: 'attack', units: { raider: 5, pathfinder: 5 } });
  assert.equal((await sightingsOf(w.alice)).sightings.length, 1);
});

test('sightings: not the tribe\'s own marches, not an ally\'s, not a march outside the radius, nothing after the Lookout is lost', async () => {
  const w = await world();
  await formPact(w.alice, 'CARA', w.cara, 'ally');
  const lo = w.lookouts[2] as SiteDef;
  hold(w, lo.id, w.alice);
  const from = { x: lo.x - 30, y: lo.y + 2 };
  const to = { x: lo.x + 30, y: lo.y + 6 };
  march(w, w.amy, from, to); // own tribe
  march(w, w.cara, from, to); // ally
  assert.deepEqual((await sightingsOf(w.alice)).sightings, []);
  // An enemy without a tribe is an enemy too.
  const loner = march(w, w.lou, from, to);
  assert.deepEqual((await sightingsOf(w.alice)).sightings.map((s) => [s.movementId, s.fromTribeTag]), [[loner, null]]);
  w.app.ctx.store.deleteMovement(loner);

  // Outside the radius: a line that passes just beyond LOOKOUT_RADIUS is invisible.
  const miss = { x: lo.x - 40, y: lo.y + LOOKOUT_RADIUS + 3 };
  const missTo = { x: lo.x + 40, y: lo.y + LOOKOUT_RADIUS + 3 };
  const far = march(w, w.bob, miss, missTo);
  const rec = w.app.ctx.store.getMovementView(far);
  assert.ok(rec);
  assert.equal(lookoutSees(lo, { x: rec.origin.x, y: rec.origin.y }, { x: rec.target.x, y: rec.target.y }), false, 'the test line really is out of reach');
  assert.deepEqual((await sightingsOf(w.alice)).sightings, []);
  w.app.ctx.store.deleteMovement(far);

  const near = march(w, w.bob, from, to);
  assert.equal((await sightingsOf(w.alice)).sightings.length, 1);
  release(w, lo.id);
  const lost = await sightingsOf(w.alice);
  assert.deepEqual([lost.sightings.length, lost.lookouts], [0, 0]);
  assert.ok(w.app.ctx.store.getMovement(near), 'the march itself is untouched');
});

test('sightings: a player without a tribe gets nothing, and a tribe that holds no Lookout sees nothing', async () => {
  const w = await world();
  const lo = w.lookouts[0] as SiteDef;
  hold(w, lo.id, w.alice);
  march(w, w.bob, { x: lo.x - 30, y: lo.y }, { x: lo.x + 30, y: lo.y + 3 });
  assert.equal((await sightingsOf(w.alice)).sightings.length, 1);
  assert.deepEqual(await sightingsOf(w.lou), { sightings: [], lookouts: 0 });
  assert.deepEqual(await sightingsOf(w.bob), { sightings: [], lookouts: 0 }, 'the sender\'s own tribe holds none');
  assert.deepEqual(await sightingsOf(w.cara), { sightings: [], lookouts: 0 });
  assert.equal((await sightingsOf(w.amy)).lookouts, 1, 'every member of the holding tribe');
  // A Waymark is not a Lookout.
  const wm = w.waymarks[0] as SiteDef;
  hold(w, wm.id, w.bob);
  assert.deepEqual(await sightingsOf(w.bob), { sightings: [], lookouts: 0 });
});

test('sightings: a march two Lookouts see is listed once under the lower id; soonest arrival first; at most LOOKOUT_LIST_LIMIT', async () => {
  const w = await world();
  const [l1, l2] = [w.lookouts[0] as SiteDef, w.lookouts[1] as SiteDef];
  hold(w, l1.id, w.alice);
  hold(w, l2.id, w.amy);
  // Held through one tribe, two Lookouts.
  const from = { x: l1.x - 8, y: l1.y + 1 };
  const to = { x: l2.x + 8, y: l2.y + 1 };
  const id = march(w, w.bob, from, to);
  assert.ok(lookoutSees(l1, from, to) && lookoutSees(l2, from, to), 'both Lookouts see this line');
  const both = await sightingsOf(w.alice);
  assert.equal(both.lookouts, 2);
  assert.deepEqual(both.sightings.map((s) => [s.movementId, s.lookoutId, s.lookoutName]), [[id, Math.min(l1.id, l2.id), 'Lookout 1']]);
  w.app.ctx.store.deleteMovement(id);

  // Limit and order: more marches than the list holds, inserted latest first.
  const store = w.app.ctx.store;
  const bobHome = homeOf(w.app, w.bob);
  const spare = store.getVillage(store.abandonedVillageIds()[0] as number) as VillageRecord;
  moveVillage(w.app, bobHome, l1.x - 30, l1.y);
  moveVillage(w.app, spare, l1.x + 30, l1.y + 2);
  const t = w.clock.now();
  const total = LOOKOUT_LIST_LIMIT + 7;
  for (let i = 0; i < total; i++) {
    store.insertMovement({ kind: 'attack', originVillageId: bobHome.id, targetVillageId: spare.id, units: { ...emptyUnits(), raider: 5 }, loot: null, departAt: t, arriveAt: t + (total - i) * 1000 });
  }
  const list = (await sightingsOf(w.alice)).sightings;
  assert.equal(list.length, LOOKOUT_LIST_LIMIT);
  const arrivals = list.map((s) => s.arriveAt);
  assert.deepEqual(arrivals, [...arrivals].sort((a, b) => a - b));
  assert.equal(arrivals[0], t + 1000, 'the soonest march is first');
  assert.equal(arrivals[arrivals.length - 1], t + LOOKOUT_LIST_LIMIT * 1000);
});

test('GET /api/tribe/sightings needs a session, takes no query keys, and sits in the world rate bucket', async () => {
  const w = await world();
  const { Client } = await import('./helpers.ts');
  errorOf(await new Client(w.app).get('/api/tribe/sightings'), 401, 'unauthorized');
  errorOf(await w.alice.c.get('/api/tribe/sightings?x=1'), 400, 'invalid_input');
  errorOf(await w.alice.c.get('/api/tribe/sightings?after=1'), 400, 'invalid_input');
  ok(await w.alice.c.get('/api/tribe/sightings'));
  assert.equal(routeBucket('GET', '/api/tribe/sightings'), 'world');
  // The bucket limit (30 a minute per account, shared with the other world reads) is enforced.
  const { app } = await makeApp();
  const c = await register(app, 'rate', '10.1.2.3');
  let blocked = 0;
  for (let i = 0; i < 40; i++) if ((await c.get('/api/tribe/sightings')).statusCode === 429) blocked++;
  assert.ok(blocked >= 1, 'refused past the per-minute limit');
});
