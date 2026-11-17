// Siege in the web client (docs/GAME_DESIGN.md 18.9): which units an attack form offers, the Firecart building picker
// (names only, no levels), the request field and the report lines.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BUILDINGS, BUILDING_IDS, UNIT_IDS, emptyUnits } from '@clanfire/engine';
import type { SiegeHit, Units } from '@clanfire/engine';
import { SiegePicker, SiegeResult } from '../src/components/Siege.tsx';
import { knownUnit } from '../src/views/reports/frame-reports-logic.ts';
import { UNIT_ICON } from '../src/icons.ts';
import { selectableUnits, showsSiegePicker, siegeHitText, siegeTargetFor, siegeTargetOptions } from '../src/villages.ts';

const units = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('every unit has an icon, the siege unit too', () => {
  for (const u of UNIT_IDS) assert.ok(UNIT_ICON[u], u);
  assert.equal(UNIT_ICON.firecart, 'firecart');
  assert.ok(!('logram' in UNIT_ICON) && !('boulder' in UNIT_ICON));
});

test('the Firecart can only be picked for an attack', () => {
  const home = units({ pikeman: 5, pathfinder: 2, chieftain: 1, firecart: 3 });
  assert.deepEqual(selectableUnits('attack', home), ['pikeman', 'pathfinder', 'chieftain', 'firecart']);
  assert.deepEqual(selectableUnits('scout', home), ['pathfinder']);
  for (const mode of ['support', 'occupy', 'found'] as const) assert.ok(!selectableUnits(mode, home).includes('firecart'), mode);
  assert.deepEqual(selectableUnits('found', units({ firecart: 2 })), []);
  assert.deepEqual(selectableUnits('attack', units({ pikeman: 5 })), ['pikeman', 'firecart'], 'the siege row shows at 0 beside a real army');
  assert.deepEqual(selectableUnits('attack', units({})), [], 'nothing at home: the empty message shows');
});

test('the building picker shows only for an attack with Firecarts', () => {
  const carts = units({ firecart: 2, pikeman: 3 });
  assert.equal(showsSiegePicker('attack', carts), true);
  assert.equal(showsSiegePicker('attack', units({ pikeman: 3 })), false);
  for (const m of ['scout', 'support', 'found', 'occupy'] as const) assert.equal(showsSiegePicker(m, carts), false, m);
});

test('the picker lists building names (the Wall first), no levels', () => {
  const html = renderToString(createElement(SiegePicker, { value: '', onChange: () => {} }));
  const plain = text(html);
  assert.match(plain, /Firecarts hit:/);
  assert.match(plain, /The Wall/);
  assert.match(plain, /No scout report/);
  assert.ok(html.indexOf('The Wall') < html.indexOf(BUILDINGS.hall.name));
  for (const id of BUILDING_IDS) assert.ok(html.includes(`value="${id}"`), id);
  for (const o of siegeTargetOptions()) assert.ok(plain.includes(o.name), o.name);
  assert.equal(siegeTargetOptions().length, BUILDING_IDS.length);
  assert.ok(plain.includes('Longhouse') && plain.includes('Wrightyard') && plain.includes('Vault') && !plain.includes('Hidden Vault'));
  // Names only: no digit anywhere in the option texts.
  assert.ok(!/<option[^>]*>[^<]*\d[^<]*<\/option>/.test(html), 'no level numbers in the options');
});

test('targetBuilding is sent only for a picked building on an attack with Firecarts', () => {
  const carts = units({ firecart: 1 });
  assert.equal(siegeTargetFor('attack', carts, 'market'), 'market');
  assert.equal(siegeTargetFor('attack', carts, ''), undefined, 'no pick: the field is left out (the Wall)');
  assert.equal(siegeTargetFor('attack', carts, 'not-a-building'), undefined);
  assert.equal(siegeTargetFor('attack', units({ pikeman: 4 }), 'market'), undefined, 'Firecarts deselected');
  assert.equal(siegeTargetFor('scout', carts, 'market'), undefined, 'mission changed');
});

test('report lines: levels before and after, nothing to hit', () => {
  const wall: SiegeHit = { unit: 'firecart', building: 'wall', from: 8, to: 6 };
  const market: SiegeHit = { unit: 'firecart', building: 'market', from: 4, to: 3 };
  const none: SiegeHit = { unit: 'firecart', building: 'market', from: 0, to: 0 };
  assert.equal(siegeHitText(wall), 'Firecart: Wall 8 → 6');
  assert.equal(siegeHitText(market), 'Firecart: Market 4 → 3');
  assert.equal(siegeHitText(none), 'Firecart found nothing to hit at Market.');

  const plain = text(renderToString(createElement(SiegeResult, { hits: [wall, market, none] })));
  assert.match(plain, /Siege/);
  assert.match(plain, /Firecart: Wall 8 → 6/);
  assert.match(plain, /Firecart: Market 4 → 3/);
  assert.match(plain, /Firecart found nothing to hit at Market\./);
});

test('the siege section is left out when there is nothing to show', () => {
  assert.equal(renderToString(createElement(SiegeResult, { hits: undefined })), '');
  assert.equal(renderToString(createElement(SiegeResult, { hits: [] })), '');
});

test('a report naming a removed unit (an older saved report) falls back to the Firecart and a neutral plural, never throws', () => {
  assert.equal(knownUnit('logram'), 'firecart');
  assert.equal(knownUnit('boulder'), 'firecart');
  assert.equal(knownUnit('pikeman'), 'pikeman');
  assert.equal(siegeHitText({ unit: 'logram', building: 'wall', from: 20, to: 17 } as unknown as SiegeHit), 'logram: Wall 20 → 17');
});
