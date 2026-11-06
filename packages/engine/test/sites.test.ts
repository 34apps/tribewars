import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_WORLD,
  SHRINE_AWAKE_MILITIA_FACTOR,
  SIDE_SITE_COUNT,
  SIDE_SITE_RING_RADIUS,
  SHRINE_COUNT_PER_RING,
  SHRINE_RING_RADII,
  SHRINE_WAKE_DAYS,
  SITE_CALM_HOURS,
  SITE_MAX_POPULATION,
  SITE_MILITIA,
  SITE_MIN_SPACING,
  SITE_NO_VILLAGE_RADIUS,
  SITE_RENOWN_BONUS_CAP,
  generateSites,
  isNearSite,
  LOOKOUT_LIST_LIMIT,
  LOOKOUT_RADIUS,
  LOOKOUT_SIZE_BANDS,
  isShrineAwake,
  lookoutSees,
  sightingSize,
  tribeWaymarks,
  occupierPopulation,
  resolveSiteBattle,
  shrineWakeMs,
  siteBonus,
  siteCalmMs,
  siteMaxPopulation,
  siteMilitia,
  terrainAt,
  tribeRenownBonus,
} from '../src/index.ts';
import { HOUR, units } from './helpers.ts';

const RADIUS = DEFAULT_WORLD.radius;
const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const DAY = 24 * HOUR;
/** The Great Fire and eight shrines of the default world as generated before Waymarks and Lookouts were added: [id, x, y]. */
const EXPECTED_FIRST_NINE: Array<[number, number, number]> = [[1, 0, 0], [2, 8, 34], [3, -34, 8], [4, -8, -34], [5, 34, -8], [6, 65, 55], [7, -55, 65], [8, -65, -55], [9, 55, -65]];

describe('generateSites', () => {
  it('places all 21 sites (Great Fire, 8 shrines, 6 Waymarks, 6 Lookouts), legal and fair, for 40 seeds', () => {
    for (const seed of SEEDS) {
      const sites = generateSites(seed, RADIUS);
      assert.equal(sites.length, 1 + SHRINE_RING_RADII.length * SHRINE_COUNT_PER_RING + SIDE_SITE_COUNT, `seed ${seed}`);
      assert.deepEqual(sites.map((s) => s.id), Array.from({ length: 21 }, (_, i) => i + 1));
      assert.equal(sites[0]?.kind, 'great_fire');
      assert.ok(sites.slice(1, 9).every((s) => s.kind === 'fire_shrine'));
      assert.deepEqual(sites.slice(9).map((s) => s.kind), Array.from({ length: SIDE_SITE_COUNT }, (_, k) => (k % 2 === 0 ? 'waymark' : 'lookout')));
      assert.equal(sites.filter((s) => s.kind === 'waymark').length, 6);
      assert.equal(sites.filter((s) => s.kind === 'lookout').length, 6);
      for (const s of sites) {
        const t = terrainAt(s.x, s.y, seed);
        assert.ok(t !== 'mountain' && t !== 'lake', `seed ${seed} site ${s.id} on ${t}`);
        assert.ok(Math.abs(s.x) <= RADIUS && Math.abs(s.y) <= RADIUS, `seed ${seed} site ${s.id} outside`);
      }
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const a = sites[i]!;
          const b = sites[j]!;
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= SITE_MIN_SPACING, `seed ${seed}: sites ${a.id} and ${b.id} too close`);
        }
      }
    }
  });

  it('keeps every ring site within 12 tiles of its ring radius, rings are fair across seeds', () => {
    for (const seed of SEEDS) {
      const sites = generateSites(seed, RADIUS);
      SHRINE_RING_RADII.forEach((ringRadius, ring) => {
        const ringSites = sites.slice(1 + ring * SHRINE_COUNT_PER_RING, 1 + (ring + 1) * SHRINE_COUNT_PER_RING);
        assert.equal(ringSites.length, SHRINE_COUNT_PER_RING);
        const dists = ringSites.map((s) => Math.hypot(s.x, s.y));
        for (const d of dists) assert.ok(Math.abs(d - ringRadius) <= 12, `seed ${seed} ring ${ring}: distance ${d.toFixed(1)}`);
        // Roughly equal distance from the centre within a ring: no shrine is much closer to the middle than its twins.
        assert.ok(Math.max(...dists) - Math.min(...dists) <= 24, `seed ${seed} ring ${ring} spread`);
      });
      const gf = sites[0]!;
      assert.ok(Math.hypot(gf.x, gf.y) <= 12, `seed ${seed}: Great Fire far from centre`);
    }
  });

  it('rings sit near their ideal points on the average: most sites do not move far', () => {
    let moved = 0;
    for (const seed of SEEDS) {
      const sites = generateSites(seed, RADIUS);
      for (const s of sites.slice(1, 9)) {
        const ring = s.id <= 5 ? 0 : 1;
        if (Math.abs(Math.hypot(s.x, s.y) - (SHRINE_RING_RADII[ring] ?? 0)) > 3) moved++;
      }
    }
    assert.ok(moved < SEEDS.length * 8 * 0.5, `${moved} shrines moved more than 3 tiles`);
  });

  it('keeps the first 9 sites exactly where they were before Waymarks and Lookouts existed', () => {
    const first = generateSites(DEFAULT_WORLD.seed, RADIUS).slice(0, 9).map((s) => [s.id, s.x, s.y]);
    assert.deepEqual(first, EXPECTED_FIRST_NINE);
  });

  it('puts the Waymarks and Lookouts on one ring of SIDE_SITE_RING_RADIUS, 30 degrees apart', () => {
    for (const seed of SEEDS) {
      const side = generateSites(seed, RADIUS).slice(9);
      assert.equal(side.length, SIDE_SITE_COUNT);
      for (const s of side) assert.ok(Math.abs(Math.hypot(s.x, s.y) - SIDE_SITE_RING_RADIUS) <= 12, `seed ${seed} site ${s.id}`);
      // Neighbours on the ring are about 2 * R * sin(15 deg) = 31 tiles apart (a moved site shifts that a little).
      for (let k = 0; k < side.length; k++) {
        const a = side[k]!;
        const b = side[(k + 1) % side.length]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(d >= SITE_MIN_SPACING && d <= 50, `seed ${seed}: ring neighbours ${a.id}/${b.id} ${d.toFixed(1)} apart`);
      }
    }
  });

  it('is deterministic and depends on the seed', () => {
    for (const seed of SEEDS.slice(0, 10)) assert.deepEqual(generateSites(seed, RADIUS), generateSites(seed, RADIUS));
    const a = JSON.stringify(generateSites(SEEDS[0]!, RADIUS));
    const b = JSON.stringify(generateSites(SEEDS[1]!, RADIUS));
    assert.notEqual(a, b);
  });

  it('keeps integer tiles inside a smaller world and leaves out what cannot fit', () => {
    const small = generateSites(SEEDS[0]!, 60);
    assert.ok(small.length >= 1);
    for (const s of small) {
      assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y));
      assert.ok(Math.abs(s.x) <= 60 && Math.abs(s.y) <= 60);
    }
    const tiny = generateSites(SEEDS[0]!, 3);
    assert.ok(tiny.length <= 1, 'a 7x7 world holds at most the Great Fire');
  });
});

describe('isNearSite', () => {
  const sites = [{ x: 10, y: -5 }];
  it('uses Chebyshev distance below SITE_NO_VILLAGE_RADIUS', () => {
    const r = SITE_NO_VILLAGE_RADIUS;
    assert.equal(isNearSite(10, -5, sites), true);
    assert.equal(isNearSite(10 + r - 1, -5 + r - 1, sites), true, 'corner of the square counts');
    assert.equal(isNearSite(10 + r, -5, sites), false);
    assert.equal(isNearSite(10, -5 - r, sites), false);
    assert.equal(isNearSite(0, 0, []), false);
  });
});

describe('militia, cap, timing', () => {
  it('militia population matches config and is a pikeman/shieldbearer mix', () => {
    for (const kind of ['fire_shrine', 'great_fire'] as const) {
      const dormant = siteMilitia(kind, false);
      const awake = siteMilitia(kind, true);
      assert.equal(occupierPopulation(dormant), SITE_MILITIA[kind]);
      assert.equal(occupierPopulation(awake), SITE_MILITIA[kind] * SHRINE_AWAKE_MILITIA_FACTOR);
      for (const m of [dormant, awake]) {
        assert.ok(m.pikeman > 0 && m.guard > 0);
        for (const [id, n] of Object.entries(m)) if (id !== 'pikeman' && id !== 'guard') assert.equal(n, 0, id);
      }
      assert.ok(occupierPopulation(awake) <= siteMaxPopulation(kind));
    }
    assert.equal(occupierPopulation(siteMilitia('fire_shrine', false)), 600);
    assert.equal(occupierPopulation(siteMilitia('great_fire', false)), 1500);
    assert.equal(siteMaxPopulation('fire_shrine'), SITE_MAX_POPULATION.fire_shrine);
    assert.equal(siteMaxPopulation('great_fire'), 5000);
  });

  it('wake time and calm time scale with world speed', () => {
    assert.equal(shrineWakeMs({ speed: 1 }), SHRINE_WAKE_DAYS * DAY);
    assert.equal(shrineWakeMs({ speed: 10 }), (SHRINE_WAKE_DAYS * DAY) / 10);
    assert.equal(siteCalmMs({ speed: 1 }), SITE_CALM_HOURS * HOUR);
    assert.equal(siteCalmMs({ speed: 4 }), (SITE_CALM_HOURS * HOUR) / 4);
  });

  it('shrines wake exactly when the dormant time has passed', () => {
    const created = 5 * DAY;
    for (const speed of [1, 10]) {
      const wake = shrineWakeMs({ speed });
      assert.equal(isShrineAwake(created, created, { speed }), false);
      assert.equal(isShrineAwake(created, created + wake - 1, { speed }), false);
      assert.equal(isShrineAwake(created, created + wake, { speed }), true);
    }
    // 120 days at speed 1 is still dormant on day 119, awake on day 120; at speed 10 that is 12 days.
    assert.equal(isShrineAwake(0, 119 * DAY, { speed: 1 }), false);
    assert.equal(isShrineAwake(0, 12 * DAY, { speed: 10 }), true);
  });
});

describe('bonus', () => {
  it('awake gives more than dormant, per kind', () => {
    for (const kind of ['fire_shrine', 'great_fire'] as const) assert.ok(siteBonus(kind, true) > siteBonus(kind, false));
    assert.equal(siteBonus('fire_shrine', false), 0.01);
    assert.equal(siteBonus('fire_shrine', true), 0.04);
    assert.equal(siteBonus('great_fire', false), 0.03);
    assert.equal(siteBonus('great_fire', true), 0.1);
  });

  it('sums held sites and caps at SITE_RENOWN_BONUS_CAP', () => {
    assert.equal(tribeRenownBonus([]), 0);
    assert.ok(Math.abs(tribeRenownBonus([{ kind: 'fire_shrine', awake: true }, { kind: 'great_fire', awake: false }]) - 0.07) < 1e-12);
    const all = [
      { kind: 'great_fire' as const, awake: true },
      ...Array.from({ length: 8 }, () => ({ kind: 'fire_shrine' as const, awake: true })),
    ];
    // 0.10 + 8 * 0.04 = 0.42 > cap.
    assert.equal(tribeRenownBonus(all), SITE_RENOWN_BONUS_CAP);
    assert.ok(tribeRenownBonus(all.slice(0, 3)) < SITE_RENOWN_BONUS_CAP);
  });
});

describe('resolveSiteBattle', () => {
  it('a big army beats the militia: militia dies, no loot, no siege, no inputs mutated', () => {
    const militia = siteMilitia('fire_shrine', false);
    const snapshot = structuredClone(militia);
    const attackers = units({ raider: 2000, outrider: 200 });
    const r = resolveSiteBattle({ attackerUnits: attackers, militia, seed: 77 });
    assert.equal(r.attackerWon, true);
    assert.deepEqual(r.defenderLosses, militia);
    assert.deepEqual(r.loot, { wood: 0, food: 0, iron: 0, gold: 0 });
    assert.deepEqual(r.siege, []);
    assert.deepEqual(militia, snapshot);
    assert.deepEqual(resolveSiteBattle({ attackerUnits: attackers, militia, seed: 77 }), r, 'deterministic');
  });

  it('a small army loses and dies; the militia loses only some', () => {
    const militia = siteMilitia('great_fire', false);
    const r = resolveSiteBattle({ attackerUnits: units({ raider: 50 }), militia, seed: 5 });
    assert.equal(r.attackerWon, false);
    assert.equal(r.attackerLosses.raider, 50);
    assert.ok(occupierPopulation(r.defenderLosses) < occupierPopulation(militia));
  });

  it('stationed support defends with the militia and takes losses', () => {
    const militia = siteMilitia('fire_shrine', false);
    const support = [units({ pikeman: 400, guard: 400 })];
    const lone = resolveSiteBattle({ attackerUnits: units({ raider: 1500 }), militia, seed: 9 });
    const backed = resolveSiteBattle({ attackerUnits: units({ raider: 1500 }), militia, support, seed: 9 });
    assert.ok(backed.defensePower > lone.defensePower);
    assert.equal(backed.supportLosses.length, 1);
  });
});

describe('Waymarks and Lookouts', () => {
  it('have a 300 militia, a 3000 cap, never wake and give no Renown bonus', () => {
    for (const kind of ['waymark', 'lookout'] as const) {
      assert.equal(occupierPopulation(siteMilitia(kind, false)), 300);
      assert.equal(occupierPopulation(siteMilitia(kind, true)), 300, 'never awake');
      assert.equal(siteMaxPopulation(kind), 3000);
      assert.equal(siteBonus(kind, false), 0);
      assert.equal(siteBonus(kind, true), 0);
    }
    assert.equal(tribeRenownBonus([{ kind: 'waymark', awake: true }, { kind: 'lookout', awake: true }]), 0);
    assert.equal(tribeRenownBonus([{ kind: 'fire_shrine', awake: false }, { kind: 'waymark', awake: true }, { kind: 'lookout', awake: false }]), siteBonus('fire_shrine', false));
  });

  it('tribeWaymarks lists only Waymarks held by that tribe', () => {
    const sites = [
      { kind: 'waymark' as const, x: 1, y: 2, holder: { tribeId: 7 } },
      { kind: 'waymark' as const, x: 3, y: 4, holder: { tribeId: 8 } },
      { kind: 'waymark' as const, x: 5, y: 6, holder: null },
      { kind: 'lookout' as const, x: 7, y: 8, holder: { tribeId: 7 } },
      { kind: 'fire_shrine' as const, x: 9, y: 10, holder: { tribeId: 7 } },
      { kind: 'waymark' as const, x: 11, y: 12, holder: { tribeId: 7 } },
    ];
    assert.deepEqual(tribeWaymarks(sites, 7), [{ x: 1, y: 2 }, { x: 11, y: 12 }]);
    assert.deepEqual(tribeWaymarks(sites, 8), [{ x: 3, y: 4 }]);
    assert.deepEqual(tribeWaymarks(sites, 99), []);
    assert.deepEqual(tribeWaymarks(sites, null), []);
    assert.deepEqual(tribeWaymarks([], 7), []);
  });

  it('lookoutSees: a line within LOOKOUT_RADIUS of the Lookout (segment distance), edges inclusive', () => {
    const R = LOOKOUT_RADIUS;
    const lo = { x: 0, y: 0 };
    assert.equal(lookoutSees(lo, { x: -50, y: R }, { x: 50, y: R }), true, 'exactly on the radius');
    assert.equal(lookoutSees(lo, { x: -50, y: R + 1 }, { x: 50, y: R + 1 }), false, 'just outside');
    assert.equal(lookoutSees(lo, { x: -50, y: 0 }, { x: 50, y: 0 }), true, 'through the Lookout');
    // The line extended beyond the ends would pass, but the segment stops short: distance is to the end point.
    assert.equal(lookoutSees(lo, { x: 100, y: 0 }, { x: 60, y: 0 }), false);
    assert.equal(lookoutSees(lo, { x: R + 40, y: 0 }, { x: R, y: 0 }), true, 'ends exactly at the radius');
    assert.equal(lookoutSees(lo, { x: R + 40, y: 0 }, { x: R + 1, y: 0 }), false);
    // The ends themselves count: a march that starts or lands inside the radius.
    assert.equal(lookoutSees(lo, { x: 5, y: 5 }, { x: 90, y: 90 }), true);
    assert.equal(lookoutSees(lo, { x: 90, y: 90 }, { x: 5, y: 5 }), true);
    assert.equal(lookoutSees(lo, { x: 5, y: 5 }, { x: 5, y: 5 }), true, 'zero length');
    assert.equal(lookoutSees(lo, { x: 50, y: 50 }, { x: 50, y: 50 }), false, 'zero length, far');
    // Diagonal pass at a Pythagorean distance of exactly 20 (12-16-20 triangle).
    assert.equal(lookoutSees({ x: 0, y: 0 }, { x: 12 + 80 * 4, y: 16 - 80 * 3 }, { x: 12 - 80 * 4, y: 16 + 80 * 3 }), true);
  });

  it('sightingSize bands by population', () => {
    assert.equal(sightingSize(0), 'small');
    assert.equal(sightingSize(LOOKOUT_SIZE_BANDS.smallBelow - 1), 'small');
    assert.equal(sightingSize(LOOKOUT_SIZE_BANDS.smallBelow), 'medium');
    assert.equal(sightingSize(LOOKOUT_SIZE_BANDS.mediumBelow - 1), 'medium');
    assert.equal(sightingSize(LOOKOUT_SIZE_BANDS.mediumBelow), 'large');
    assert.equal(sightingSize(100000), 'large');
    assert.equal(LOOKOUT_LIST_LIMIT, 100);
  });
});
