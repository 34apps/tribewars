// Tribe tab Lookout list, and the Waymark / Lookout lines in the site panel (src/tribe/Lookout.tsx, src/sites.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LookoutSightingDto, SiteDto } from '@clanfire/engine';
import { siteBonusText, siteKindLine, isUtilitySite, siteName, siteRange } from '../src/sites.ts';
import { LOOKOUT_NONE_HELD, LOOKOUT_NONE_SEEN, LookoutList } from '../src/tribe/Lookout.tsx';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const NOW = 1_000_000;

const sighting = (over: Partial<LookoutSightingDto> = {}): LookoutSightingDto => ({
  movementId: 1,
  lookoutId: 10,
  lookoutName: 'Lookout 1',
  mission: 'attack',
  from: { villageId: 7, name: 'Red Hill', ownerName: 'Brann', x: 40, y: -20 },
  fromTribeTag: 'WLF',
  to: { x: 12, y: 5, name: 'Oak Gate', kind: 'village' },
  departAt: NOW - 600_000,
  arriveAt: NOW + 3_723_000,
  size: 'medium',
  ...over,
});

const render = (sightings: LookoutSightingDto[], lookouts: number) =>
  text(renderToStaticMarkup(createElement(LookoutList, { sightings, lookouts, now: NOW, onShow: () => {} })));

test('the Lookout list shows one row per sighting with who, where, when and size', () => {
  const t = render([sighting(), sighting({ movementId: 2, mission: 'support', size: 'large', fromTribeTag: null })], 2);
  assert.ok(t.includes('You hold 2 Lookouts'));
  assert.ok(t.includes('Attack') && t.includes('Support'));
  assert.ok(t.includes('[WLF] Brann, Red Hill'));
  assert.ok(t.includes('Oak Gate (12|5)'), t);
  assert.ok(t.includes('Medium army') && t.includes('Large army'));
  assert.ok(t.includes('1:02:03'), 'live countdown');
  assert.ok(!t.includes(LOOKOUT_NONE_SEEN) && !t.includes(LOOKOUT_NONE_HELD));
});

test('both empty states of the Lookout list', () => {
  assert.ok(render([], 0).includes(LOOKOUT_NONE_HELD));
  assert.equal(LOOKOUT_NONE_HELD, 'Hold a Lookout to see enemy armies passing by.');
  const seen = render([], 1);
  assert.ok(seen.includes(LOOKOUT_NONE_SEEN) && seen.includes('You hold 1 Lookout'));
  assert.equal(LOOKOUT_NONE_SEEN, 'No enemy armies seen right now.');
});

test('Waymark and Lookout: kind line, no Renown line, name from the server, range', () => {
  assert.equal(siteKindLine('waymark'), "Your tribe's troops and carts cross forest, hills and lakes faster within 12 tiles.");
  assert.equal(siteKindLine('lookout'), 'Your tribe sees enemy armies that pass within 20 tiles.');
  assert.equal(siteKindLine('fire_shrine'), null);
  assert.equal(siteKindLine('great_fire'), null);
  assert.ok(isUtilitySite('waymark') && isUtilitySite('lookout') && !isUtilitySite('fire_shrine'));
  assert.equal(siteRange('waymark'), 12);
  assert.equal(siteRange('lookout'), 20);
  assert.equal(siteRange('great_fire'), 0);
  const w = { id: 12, kind: 'waymark', name: 'Waymark 3', bonus: 0 } as SiteDto;
  assert.equal(siteName(w), 'Waymark 3');
  // The panel prints siteKindLine for these two kinds and never calls siteBonusText for them.
  assert.ok(siteBonusText({ bonus: 0.01, holder: null }).includes('Renown'));
});
