import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHIPMENT_SPEED,
  TERRAINS,
  TERRAIN_MAX_SLOWDOWN,
  TERRAIN_SPEED,
  UNITS,
  UNIT_TERRAIN_FAMILY,
  WAYMARK_PENALTY_FACTOR,
  WAYMARK_RADIUS,
  armySpeed,
  effectiveDistance,
  flatShipmentTravelMs,
  flatTravelTimeMs,
  isBuildableTerrain,
  mulberry32,
  routeTimeMs,
  shipmentTravelMs,
  terrainAt,
  travelPreview,
  travelRoute,
  travelTimeMs,
} from '../src/index.ts';
import type { Coords, Route, Terrain, WorldSettings } from '../src/index.ts';
import { HOUR, S1, S10, units } from './helpers.ts';

/** First straight route (from `from`, scanning along x) whose terrain tiles satisfy `want`. */
function findRoute(s: WorldSettings, want: (r: Route) => boolean, len = 12): { from: Coords; to: Coords; route: Route } {
  for (let y = -60; y <= 60; y += 3) {
    for (let x = -60; x <= 60; x += 3) {
      const from = { x, y };
      const to = { x: x + len, y: y + 5 };
      const route = travelRoute(from, to, s.seed);
      if (want(route)) return { from, to, route };
    }
  }
  throw new Error('no such route on this seed');
}

const allGrass = (r: Route): boolean => r.tiles.grass === r.length;
const share = (r: Route, t: Terrain): number => r.tiles[t] / r.length;

describe('travel route', () => {
  it('samples the straight line: the tiles add up to its length, and it is the same every time', () => {
    const a = { x: -7, y: 3 };
    const b = { x: 14, y: -9 };
    const r1 = travelRoute(a, b, S1.seed);
    const r2 = travelRoute(a, b, S1.seed);
    assert.deepEqual(r1, r2);
    assert.equal(r1.samples.length, Math.ceil(r1.length));
    const sum = TERRAINS.reduce((t, id) => t + r1.tiles[id], 0);
    assert.ok(Math.abs(sum - r1.length) < 1e-9);
    for (const sample of r1.samples) assert.equal(sample.terrain, terrainAt(Math.round(sample.x), Math.round(sample.y), S1.seed));
  });

  it('a route back is the same stretches in the other order', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const a = { x: Math.floor(rnd() * 160) - 80, y: Math.floor(rnd() * 160) - 80 };
      const b = { x: Math.floor(rnd() * 160) - 80, y: Math.floor(rnd() * 160) - 80 };
      const out = travelRoute(a, b, S1.seed);
      const back = travelRoute(b, a, S1.seed);
      assert.equal(out.length, back.length);
      assert.deepEqual(out.tiles, back.tiles);
      assert.deepEqual(out.samples.map((p) => p.terrain), back.samples.map((p) => p.terrain).reverse());
    }
  });

  it('zero length: no samples, no time', () => {
    const r = travelRoute({ x: 3, y: 3 }, { x: 3, y: 3 }, S1.seed);
    assert.equal(r.length, 0);
    assert.equal(r.samples.length, 0);
    assert.equal(travelTimeMs({ x: 3, y: 3 }, { x: 3, y: 3 }, units({ raider: 1 }), S1), 0);
  });
});

describe('travel time with terrain', () => {
  it('over grass only it equals the flat time exactly', () => {
    const { from, to } = findRoute(S1, allGrass);
    for (const army of [units({ raider: 10 }), units({ outrider: 10 }), units({ pathfinder: 3 }), units({ raider: 1, outrider: 10 })]) {
      assert.equal(travelTimeMs(from, to, army, S1), flatTravelTimeMs(from, to, army, S1));
      assert.equal(travelTimeMs(from, to, army, S10), flatTravelTimeMs(from, to, army, S10));
    }
    assert.equal(shipmentTravelMs(from, to, S1), flatShipmentTravelMs(from, to, S1));
  });

  it('a route over hills and forest is slower, by the factors of the table', () => {
    const { from, to, route } = findRoute(S1, (r) => share(r, 'hills') > 0.3 && share(r, 'forest') + share(r, 'hills') > 0.5 && r.tiles.mountain === 0 && r.tiles.lake === 0);
    const army = units({ pikeman: 10 });
    const speed = armySpeed(army);
    let tiles = 0; // tiles of flat walking time: sum of tile / factor
    for (const t of TERRAINS) tiles += route.tiles[t] / TERRAIN_SPEED.foot[t];
    const expected = Math.ceil((tiles * HOUR) / speed);
    const got = travelTimeMs(from, to, army, S1);
    assert.ok(Math.abs(got - expected) <= 1, `${got} vs ${expected}`);
    assert.ok(got > flatTravelTimeMs(from, to, army, S1));
    // World speed divides the whole thing.
    assert.ok(Math.abs(travelTimeMs(from, to, army, S10) * 10 - got) <= 10);
    const preview = travelPreview(from, to, army, S1);
    assert.equal(preview.ms, got);
    assert.equal(preview.flatMs, flatTravelTimeMs(from, to, army, S1));
    assert.deepEqual(preview.route, route);
  });

  it('mounted units lose more on rough ground than foot units; the army arrives with its slowest unit', () => {
    const { from, to } = findRoute(S1, (r) => share(r, 'hills') + share(r, 'forest') > 0.5 && r.tiles.mountain === 0 && r.tiles.lake === 0);
    const foot = travelTimeMs(from, to, units({ raider: 5 }), S1);
    const horse = travelTimeMs(from, to, units({ outrider: 5 }), S1);
    const flatFoot = flatTravelTimeMs(from, to, units({ raider: 5 }), S1);
    const flatHorse = flatTravelTimeMs(from, to, units({ outrider: 5 }), S1);
    assert.ok(horse / flatHorse > foot / flatFoot, 'horses slow down by a larger share');
    assert.equal(travelTimeMs(from, to, units({ raider: 5, outrider: 5 }), S1), Math.max(foot, horse));
    // Pathfinders are the least affected.
    const scout = travelTimeMs(from, to, units({ pathfinder: 2 }), S1);
    assert.ok(scout / flatTravelTimeMs(from, to, units({ pathfinder: 2 }), S1) < foot / flatFoot);
  });

  it('a trip is the same time there and back', () => {
    const rnd = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const a = { x: Math.floor(rnd() * 200) - 100, y: Math.floor(rnd() * 200) - 100 };
      const b = { x: Math.floor(rnd() * 200) - 100, y: Math.floor(rnd() * 200) - 100 };
      for (const army of [units({ pikeman: 4 }), units({ knight: 2, raider: 1 }), units({ pathfinder: 1 })]) {
        assert.equal(travelTimeMs(a, b, army, S1), travelTimeMs(b, a, army, S1));
      }
      assert.equal(shipmentTravelMs(a, b, S1), shipmentTravelMs(b, a, S1));
    }
  });

  it('never faster than flat, never slower than TERRAIN_MAX_SLOWDOWN times flat', () => {
    const rnd = mulberry32(21);
    for (let i = 0; i < 300; i++) {
      const a = { x: Math.floor(rnd() * 400) - 200, y: Math.floor(rnd() * 400) - 200 };
      const b = { x: a.x + Math.floor(rnd() * 120) - 60, y: a.y + Math.floor(rnd() * 120) - 60 };
      for (const army of [units({ pikeman: 4 }), units({ knight: 2 }), units({ pathfinder: 1 })]) {
        const flat = flatTravelTimeMs(a, b, army, S1);
        const t = travelTimeMs(a, b, army, S1);
        assert.ok(t >= flat, 'not faster than flat');
        assert.ok(t <= Math.ceil(flat * TERRAIN_MAX_SLOWDOWN) + 1, 'within the cap');
      }
    }
  });

  it('the cap: a route of nothing but lake costs TERRAIN_MAX_SLOWDOWN times the distance for every family', () => {
    const lake: Route = { length: 10, step: 1, samples: [], tiles: { grass: 0, forest: 0, hills: 0, mountain: 0, lake: 10 } };
    for (const family of ['foot', 'mounted', 'pathfinder', 'carrier'] as const) {
      const raw = 10 / TERRAIN_SPEED[family].lake;
      assert.equal(effectiveDistance(lake, family), Math.min(10 * TERRAIN_MAX_SLOWDOWN, raw));
    }
    assert.equal(effectiveDistance(lake, 'foot'), 10 * TERRAIN_MAX_SLOWDOWN);
    const grass: Route = { length: 10, step: 1, samples: [], tiles: { grass: 10, forest: 0, hills: 0, mountain: 0, lake: 0 } };
    assert.equal(effectiveDistance(grass, 'mounted'), 10);
    assert.equal(routeTimeMs(grass, 'carrier', SHIPMENT_SPEED, 1), HOUR * 10 / SHIPMENT_SPEED);
    assert.equal(routeTimeMs(lake, 'foot', 0, 1), Infinity);
  });

  it('ranks never change the speed table, and every unit has a family', () => {
    for (const id of Object.keys(UNITS) as Array<keyof typeof UNITS>) assert.ok(UNIT_TERRAIN_FAMILY[id] in TERRAIN_SPEED);
    for (const family of Object.keys(TERRAIN_SPEED) as Array<keyof typeof TERRAIN_SPEED>) {
      assert.equal(TERRAIN_SPEED[family].grass, 1);
      for (const t of TERRAINS) assert.ok(TERRAIN_SPEED[family][t] > 0 && TERRAIN_SPEED[family][t] <= 1);
    }
  });

  it('a different world seed gives different terrain, so the seed (the server\'s) is what decides', () => {
    let differing = 0;
    for (let i = 0; i < 30; i++) {
      const a = { x: i * 5 - 70, y: 4 };
      const b = { x: a.x + 15, y: 16 };
      if (travelTimeMs(a, b, units({ outrider: 3 }), S1) !== travelTimeMs(a, b, units({ outrider: 3 }), { ...S1, seed: S1.seed + 1 })) differing++;
    }
    assert.ok(differing > 5);
  });

  it('on a typical map the average trip is about 12% slower for a mixed army (owner proposal, design 18.4a)', () => {
    // Measured 2026-11-04 on the default seed, villages 5-35 tiles apart: foot 9%, mounted 20%, pathfinders 3.5%;
    // an army of about 70% foot, 25% mounted and 5% scouts therefore loses about 12%.
    const slowdownOf = (army: ReturnType<typeof units>): number => {
      const rnd = mulberry32(99);
      let flat = 0;
      let real = 0;
      let n = 0;
      while (n < 600) {
        const a = { x: Math.floor(rnd() * 160) - 80, y: Math.floor(rnd() * 160) - 80 };
        const b = { x: a.x + Math.floor(rnd() * 50) - 25, y: a.y + Math.floor(rnd() * 50) - 25 };
        if (!isBuildableTerrain(terrainAt(a.x, a.y, S1.seed)) || !isBuildableTerrain(terrainAt(b.x, b.y, S1.seed))) continue;
        if (flatTravelTimeMs(a, b, army, S1) < HOUR / 2) continue;
        flat += flatTravelTimeMs(a, b, army, S1);
        real += travelTimeMs(a, b, army, S1);
        n++;
      }
      return real / flat - 1;
    };
    const foot = slowdownOf(units({ raider: 10 }));
    const mounted = slowdownOf(units({ outrider: 10 }));
    const scouts = slowdownOf(units({ pathfinder: 10 }));
    assert.ok(foot > 0.06 && foot < 0.13, `foot ${(foot * 100).toFixed(1)}%`);
    assert.ok(mounted > 0.14 && mounted < 0.26, `mounted ${(mounted * 100).toFixed(1)}%`);
    assert.ok(scouts > 0.01 && scouts < 0.07, `pathfinders ${(scouts * 100).toFixed(1)}%`);
    const mix = 0.7 * foot + 0.25 * mounted + 0.05 * scouts;
    assert.ok(mix > 0.09 && mix < 0.15, `mixed ${(mix * 100).toFixed(1)}%`);
  });
});

describe('Waymarks (docs/GAME_DESIGN.md 18.4b)', () => {
  const midpoint = (a: Coords, b: Coords): Coords => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const slow = (r: Route): boolean => r.length - r.tiles.grass >= r.length * 0.5;
  const raiders = units({ raider: 10 });

  it('grass is unchanged, with or without a Waymark', () => {
    const { from, to } = findRoute(S1, allGrass);
    const wm = [midpoint(from, to)];
    assert.equal(travelTimeMs(from, to, raiders, S1, wm), travelTimeMs(from, to, raiders, S1));
    assert.equal(travelTimeMs(from, to, raiders, S1, wm), flatTravelTimeMs(from, to, raiders, S1));
    assert.equal(shipmentTravelMs(from, to, S1, wm), flatShipmentTravelMs(from, to, S1));
  });

  it('slow ground near a Waymark costs exactly the halved penalty', () => {
    const { from, to, route } = findRoute(S1, slow);
    const wm = [midpoint(from, to)];
    assert.ok(WAYMARK_RADIUS >= route.length / 2, 'the whole short route lies within the radius');
    const plain = travelTimeMs(from, to, raiders, S1);
    const helped = travelTimeMs(from, to, raiders, S1, wm);
    assert.ok(helped < plain);
    const flat = flatTravelTimeMs(from, to, raiders, S1);
    // The penalty is the time over the flat time: it is multiplied by WAYMARK_PENALTY_FACTOR (ms rounding only).
    assert.ok(Math.abs(helped - flat - (plain - flat) * WAYMARK_PENALTY_FACTOR) <= 2, `${helped} vs ${flat} + (${plain} - ${flat}) / 2`);
    assert.ok(helped > flat);
    const planned = travelPreview(from, to, raiders, S1, wm);
    assert.equal(planned.ms, helped);
    assert.equal(planned.flatMs, flat);
    assert.ok(planned.route.samples.every((p) => p.assisted === true));
  });

  it('outside the radius nothing changes; the route back is helped the same', () => {
    const { from, to } = findRoute(S1, slow);
    const far = [{ x: from.x + WAYMARK_RADIUS + 60, y: from.y + 80 }];
    assert.equal(travelTimeMs(from, to, raiders, S1, far), travelTimeMs(from, to, raiders, S1));
    assert.equal(travelRoute(from, to, S1.seed, 1, far).assistedTiles, undefined);
    const wm = [midpoint(from, to)];
    assert.equal(travelTimeMs(to, from, raiders, S1, wm), travelTimeMs(from, to, raiders, S1, wm));
  });

  it('only the stretch within the radius is helped', () => {
    const from = { x: -50, y: 0 };
    const to = { x: 50, y: 0 };
    const r = travelRoute(from, to, S1.seed, 1, [{ x: 0, y: 6 }]);
    const inside = r.samples.filter((p) => p.assisted);
    assert.ok(inside.length >= 1 && inside.length < r.samples.length);
    for (const p of r.samples) {
      const near = Math.hypot(p.x, p.y - 6) <= WAYMARK_RADIUS;
      assert.equal(p.assisted === true, near);
    }
  });

  it('never beats flat time and never exceeds the slowdown cap', () => {
    const rnd = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const a = { x: Math.floor(rnd() * 160) - 80, y: Math.floor(rnd() * 160) - 80 };
      const b = { x: a.x + Math.floor(rnd() * 70) - 35, y: a.y + Math.floor(rnd() * 70) - 35 };
      const wm = [{ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }];
      for (const army of [raiders, units({ outrider: 5 }), units({ pathfinder: 3 })]) {
        const plain = travelTimeMs(a, b, army, S1);
        const helped = travelTimeMs(a, b, army, S1, wm);
        const flat = flatTravelTimeMs(a, b, army, S1);
        if (!Number.isFinite(flat)) continue;
        assert.ok(helped <= plain && helped >= flat - 1 && helped <= flat * TERRAIN_MAX_SLOWDOWN + 1, `${a.x},${a.y} -> ${b.x},${b.y}`);
      }
    }
  });

  it('the army and the shipment are both helped; with no Waymark the signatures behave as before', () => {
    const { from, to } = findRoute(S1, slow);
    const wm = [midpoint(from, to)];
    assert.ok(shipmentTravelMs(from, to, S1, wm) < shipmentTravelMs(from, to, S1));
    assert.equal(travelTimeMs(from, to, raiders, S1, []), travelTimeMs(from, to, raiders, S1));
    assert.deepEqual(travelRoute(from, to, S1.seed, 1, []), travelRoute(from, to, S1.seed));
  });
});
