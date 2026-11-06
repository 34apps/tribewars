// Troop groups for the send form: the built-in pickers (All troops, Decoy, Chieftain escort) and filling from a group.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEARTH_MAX_CHIEFTAINS, HOLD_MIN_POPULATION, checkMission, emptyUnits, occupierPopulation } from '@clanfire/engine';
import type { Units, UnitId } from '@clanfire/engine';
import { selectableUnits } from '../src/villages.ts';
import { builtinGroups, fillFromGroup, pickAll, pickDecoy, pickEscort, shortNote } from '../src/troopGroups.ts';

const home = (over: Partial<Units>): Units => ({ ...emptyUnits(), ...over });
const vis = (h: Units, mission: 'attack' | 'support' | 'scout' | 'found' | 'occupy' = 'attack'): UnitId[] => selectableUnits(mission, h, true);
const target = { kind: 'player' as const, points: 100, protected: false };

test('All troops: everything visible at home; support leaves Chieftains and siege out; an attack takes at most 3 Chieftains', () => {
  const h = home({ pikeman: 30, raider: 10, chieftain: 5, logram: 2 });
  assert.deepEqual(pickAll(vis(h, 'attack'), h, 'attack'), { pikeman: 30, raider: 10, chieftain: HEARTH_MAX_CHIEFTAINS, logram: 2 });
  assert.deepEqual(pickAll(vis(h, 'support'), h, 'support'), { pikeman: 30, raider: 10 });
  assert.deepEqual(pickAll(vis(home({ pathfinder: 4 }), 'scout'), home({ pathfinder: 4 }), 'scout'), { pathfinder: 4 });
});

test('Decoy: exactly one of the slowest fighting unit; siege first; never a Chieftain or Pathfinder; passes the send checks', () => {
  let h = home({ pikeman: 30, raider: 10, outrider: 5 });
  assert.deepEqual(pickDecoy(vis(h), h), { pikeman: 1 });
  h = home({ raider: 10, outrider: 5 });
  assert.deepEqual(pickDecoy(vis(h), h), { raider: 1 });
  h = home({ pikeman: 30, logram: 1, boulder: 4 });
  assert.deepEqual(pickDecoy(vis(h), h), { logram: 1 }, 'slowest siege unit first');
  h = home({ pikeman: 3, boulder: 4 });
  assert.deepEqual(pickDecoy(vis(h), h), { boulder: 1 }, 'siege unit before any foot soldier');
  h = home({ chieftain: 2, pathfinder: 9 });
  assert.equal(pickDecoy(vis(h), h), null);
  assert.equal(pickDecoy([], home({}), 'attack'), null);
  h = home({ guard: 1 });
  const d = pickDecoy(vis(h), h)!;
  assert.deepEqual(d, { guard: 1 });
  assert.equal(checkMission('attack', { ...emptyUnits(), ...d }).ok, true);
});

test('Chieftain escort: the Chieftains needed, then the strongest fighters up to the hold minimum', () => {
  const h = home({ chieftain: 2, pikeman: 500, raider: 60, knight: 20, outrider: 10 });
  const e = pickEscort(vis(h), h, 1)!;
  assert.equal(e.chieftain, 1);
  // Knights (attack 110, 4 pop) first: 8 for the Chieftain + 20 knights = 88, then Outriders (60, 2 pop): 10 = 108, then Raiders for the rest.
  assert.equal(e.knight, 20);
  assert.equal(e.outrider, 10);
  assert.equal(e.raider, 42);
  assert.equal(e.pikeman, undefined);
  assert.equal(occupierPopulation(e), HOLD_MIN_POPULATION);
  // Two Chieftains needed: 16 pop of Chieftains already.
  const e2 = pickEscort(vis(h), h, 2)!;
  assert.equal(e2.chieftain, 2);
  assert.ok(occupierPopulation(e2) >= HOLD_MIN_POPULATION);
  assert.equal(checkMission('attack', { ...emptyUnits(), ...e2 }).ok, true);
});

test('Chieftain escort: takes all it has when short, fewer Chieftains than needed, none at home gives null', () => {
  const h = home({ chieftain: 1, pikeman: 20 });
  assert.deepEqual(pickEscort(vis(h), h, 3), { chieftain: 1, pikeman: 20 });
  assert.equal(pickEscort(vis(home({ pikeman: 20 })), home({ pikeman: 20 }), 1), null);
  const lone = home({ chieftain: 1 });
  assert.deepEqual(pickEscort(vis(lone), lone, 1), { chieftain: 1 });
  const big = home({ chieftain: 9, knight: 100 });
  assert.equal(pickEscort(vis(big), big, 9)!.chieftain, HEARTH_MAX_CHIEFTAINS);
});

test('builtinGroups: which chips apply', () => {
  const h = home({ pikeman: 30, raider: 10, chieftain: 1 });
  const ctx = { visible: vis(h), home: h, mission: 'attack' as const, relief: false, target };
  assert.deepEqual(builtinGroups(ctx).map((g) => g.id), ['all', 'decoy', 'escort']);
  assert.deepEqual(builtinGroups({ ...ctx, target: { kind: 'tribemate' as never, points: 5, protected: false } }).map((g) => g.id), ['all', 'decoy']);
  assert.deepEqual(builtinGroups({ ...ctx, target: { ...target, protected: true } }).map((g) => g.id), ['all', 'decoy']);
  assert.deepEqual(builtinGroups({ ...ctx, relief: true }).map((g) => g.id), ['all', 'decoy']);
  assert.deepEqual(builtinGroups({ ...ctx, target: null }).map((g) => g.id), ['all', 'decoy']);
  const noChief = home({ pikeman: 30 });
  assert.deepEqual(builtinGroups({ ...ctx, home: noChief, visible: vis(noChief) }).map((g) => g.id), ['all', 'decoy']);
  assert.deepEqual(builtinGroups({ ...ctx, mission: 'support', visible: vis(h, 'support') }).map((g) => g.id), ['all']);
  assert.deepEqual(builtinGroups({ ...ctx, mission: 'found', visible: vis(h, 'found') }), []);
  const empty = home({});
  assert.deepEqual(builtinGroups({ ...ctx, home: empty, visible: vis(empty) }), []);
});

test('fillFromGroup: min(group, home) for visible units, others empty, short note per unit', () => {
  const h = home({ raider: 40, pikeman: 100 });
  const fill = fillFromGroup({ raider: 60, pikeman: 20, knight: 5, chieftain: 1 }, vis(h, 'attack'), h);
  assert.deepEqual(fill.counts, { raider: '40', pikeman: '20' });
  // Knights and Chieftains are not at home, so the attack form does not show them and they are not reported.
  assert.deepEqual(fill.short, ['Only 40 of 60 Raiders at home']);
  const h2 = home({ raider: 40, knight: 2 });
  assert.deepEqual(fillFromGroup({ knight: 5 }, vis(h2), h2).short, ['Only 2 of 5 Knights at home']);
  assert.equal(shortNote(['Only 40 of 60 Raiders at home']), 'Only 40 of 60 Raiders at home.');
  assert.equal(shortNote([]), null);
  // A unit the mission does not take is ignored, not reported.
  const sup = fillFromGroup({ raider: 5, chieftain: 1 }, vis(h, 'support'), h);
  assert.deepEqual(sup, { counts: { raider: '5' }, short: [] });
});

test('TroopGroupBar renders the built-in chips, saved chips and the tools (touch-sized buttons come from CSS)', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { TroopGroupBar, groupSummary } = await import('../src/components/TroopGroups.tsx');
  const h = home({ pikeman: 30, raider: 10 });
  const store = {
    groups: [{ id: 7, name: 'Raid party', units: { raider: 40, pikeman: 1 } }],
    loaded: true,
    create: async () => {},
    update: async () => {},
    remove: async () => {},
  };
  const html = renderToString(
    createElement(TroopGroupBar, {
      builtins: builtinGroups({ visible: vis(h), home: h, mission: 'attack', relief: false, target: null }),
      store,
      chosen: { raider: 5 },
      total: 5,
      onApply: () => {},
    }),
  );
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  for (const s of ['All troops', 'Decoy', 'Raid party', 'Save as group', 'Manage']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('Chieftain escort'));
  assert.equal(groupSummary({ pikeman: 1, raider: 40 }), '1 Pikeman, 40 Raiders');
});
