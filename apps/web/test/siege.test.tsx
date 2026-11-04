// Siege in the web client (docs/GAME_DESIGN.md 18.9): which units an attack form offers, the Boulder Sling building picker
// (names only, no levels), the request field and the report lines.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BUILDINGS, BUILDING_IDS, UNIT_IDS, emptyUnits } from '@clanfire/engine';
import type { SiegeHit, Units } from '@clanfire/engine';
import { SiegePicker, SiegeResult } from '../src/components/Siege.tsx';
import { UNIT_ICON } from '../src/icons.ts';
import { selectableUnits, showsSiegePicker, siegeHitText, siegeTargetFor, siegeTargetOptions } from '../src/villages.ts';

const units = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('every unit has an icon, the siege units too', () => {
  for (const u of UNIT_IDS) assert.ok(UNIT_ICON[u], u);
  assert.equal(UNIT_ICON.logram, 'logram');
  assert.equal(UNIT_ICON.boulder, 'boulder');
});

test('siege units can only be picked for an attack', () => {
  const home = units({ pikeman: 5, pathfinder: 2, chieftain: 1, logram: 3, boulder: 2 });
  assert.deepEqual(selectableUnits('attack', home), ['pikeman', 'pathfinder', 'chieftain', 'logram', 'boulder']);
  assert.deepEqual(selectableUnits('scout', home), ['pathfinder']);
  for (const mode of ['support', 'occupy', 'found'] as const) {
    const list = selectableUnits(mode, home);
    assert.ok(!list.includes('logram') && !list.includes('boulder'), mode);
  }
  assert.deepEqual(selectableUnits('found', units({ logram: 2 })), []);
});

test('the building picker shows only for an attack with Boulder Slings', () => {
  const slings = units({ boulder: 2, pikeman: 3 });
  assert.equal(showsSiegePicker('attack', slings), true);
  assert.equal(showsSiegePicker('attack', units({ pikeman: 3 })), false);
  assert.equal(showsSiegePicker('attack', units({ logram: 4 })), false, 'Log Rams always hit the Wall: nothing to choose');
  for (const m of ['scout', 'support', 'found', 'occupy'] as const) assert.equal(showsSiegePicker(m, slings), false, m);
});

test('the picker lists building names (random first), no levels', () => {
  const html = renderToString(createElement(SiegePicker, { value: '', onChange: () => {} }));
  const plain = text(html);
  assert.match(plain, /Boulder Slings hit:/);
  assert.match(plain, /Random building/);
  assert.match(plain, /Scout first to see building levels\./);
  assert.ok(html.indexOf('Random building') < html.indexOf(BUILDINGS.hall.name));
  for (const id of BUILDING_IDS) assert.ok(html.includes(`value="${id}"`), id);
  for (const o of siegeTargetOptions()) assert.ok(plain.includes(o.name), o.name);
  assert.equal(siegeTargetOptions().length, BUILDING_IDS.length);
  // Names only: no digit anywhere in the option texts.
  assert.ok(!/<option[^>]*>[^<]*\d[^<]*<\/option>/.test(html), 'no level numbers in the options');
});

test('targetBuilding is sent only for a picked building on an attack with Boulder Slings', () => {
  const slings = units({ boulder: 1 });
  assert.equal(siegeTargetFor('attack', slings, 'market'), 'market');
  assert.equal(siegeTargetFor('attack', slings, ''), undefined, 'random: the field is left out');
  assert.equal(siegeTargetFor('attack', slings, 'not-a-building'), undefined);
  assert.equal(siegeTargetFor('attack', units({ pikeman: 4 }), 'market'), undefined, 'slings deselected');
  assert.equal(siegeTargetFor('scout', slings, 'market'), undefined, 'mission changed');
  assert.equal(siegeTargetFor('attack', units({ logram: 2 }), 'market'), undefined);
});

test('report lines: levels before and after, random marker, nothing to hit', () => {
  const ram: SiegeHit = { unit: 'logram', building: 'wall', from: 8, to: 6 };
  const sling: SiegeHit = { unit: 'boulder', building: 'market', from: 4, to: 3, random: true };
  const none: SiegeHit = { unit: 'boulder', building: 'market', from: 0, to: 0 };
  assert.equal(siegeHitText(ram), 'Log Ram: Wall 8 → 6');
  assert.equal(siegeHitText(sling), 'Boulder Sling: Market 4 → 3 (random)');
  assert.equal(siegeHitText(none), 'Boulder Sling found nothing to hit at Market.');

  const plain = text(renderToString(createElement(SiegeResult, { hits: [ram, sling, none] })));
  assert.match(plain, /Siege/);
  assert.match(plain, /Log Ram: Wall 8 → 6/);
  assert.match(plain, /Boulder Sling: Market 4 → 3 \(random\)/);
  assert.match(plain, /Boulder Sling found nothing to hit at Market\./);
});

test('the siege section is left out when there is nothing to show', () => {
  assert.equal(renderToString(createElement(SiegeResult, { hits: undefined })), '');
  assert.equal(renderToString(createElement(SiegeResult, { hits: [] })), '');
});
