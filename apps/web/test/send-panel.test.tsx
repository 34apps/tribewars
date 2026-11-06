// Map side panel (design A): only units at home are listed, "Clear" zeroes the form, the header "Send resources" button shows
// where shipments are allowed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyUnits } from '@clanfire/engine';
import type { Units } from '@clanfire/engine';
import { TroopGroupBar } from '../src/components/TroopGroups.tsx';
import { builtinGroups } from '../src/troopGroups.ts';
import { canShipTo, clearedSendForm, homeUnits, selectableUnits } from '../src/villages.ts';

const units = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('the map panel lists only units that are at home (a siege row at 0 is left out)', () => {
  const home = units({ pikeman: 5, raider: 2, logram: 0, boulder: 0 });
  const visible = selectableUnits('attack', home);
  assert.ok(visible.includes('logram'), 'the wide Command post list still shows siege rows at 0');
  assert.deepEqual(homeUnits(visible, home), ['pikeman', 'raider']);
  assert.deepEqual(homeUnits(selectableUnits('attack', units({})), units({})), [], 'nothing at home: the empty-state text shows');
  assert.deepEqual(homeUnits(selectableUnits('attack', units({ pikeman: 1, boulder: 3 })), units({ pikeman: 1, boulder: 3 })), ['pikeman', 'boulder']);
});

test('Clear gives an empty form: no counts, random siege target, no note', () => {
  assert.deepEqual(clearedSendForm(), { counts: {}, siegePick: '', groupNote: null });
});

test('the group row has a Clear chip when the form can be cleared, and not otherwise', () => {
  const h = units({ pikeman: 30, raider: 10 });
  const store = { groups: [], loaded: true, create: async () => {}, update: async () => {}, remove: async () => {} };
  const props = {
    builtins: builtinGroups({ visible: selectableUnits('attack', h), home: h, mission: 'attack' as const, relief: false, target: null }),
    store,
    chosen: { raider: 5 },
    total: 5,
    onApply: () => {},
  };
  const withClear = text(renderToStaticMarkup(createElement(TroopGroupBar, { ...props, onClear: () => {} })));
  for (const s of ['All troops', 'Decoy', 'Save as group', 'Clear']) assert.ok(withClear.includes(s), s);
  assert.ok(!text(renderToStaticMarkup(createElement(TroopGroupBar, props))).includes('Clear'));
});

test('Send resources (header button) shows for another player, an abandoned village and another village of mine only', () => {
  assert.equal(canShipTo({ kind: 'player' }, false, false), true);
  assert.equal(canShipTo({ kind: 'abandoned' }, false, false), true);
  assert.equal(canShipTo({ kind: 'own' }, true, false), true, 'another village of mine');
  assert.equal(canShipTo({ kind: 'own' }, true, true), false, 'the village I am in');
  assert.equal(canShipTo({ kind: 'npc' as never }, false, false), false);
  assert.equal(canShipTo(undefined, false, false), false, 'a free tile');
});
