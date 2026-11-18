// Pure helpers behind map sites (src/sites.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SiteDto } from '@clanfire/engine';
import {
  calmLeftMs,
  garrisonText,
  hitsSiteBox,
  holderText,
  siteAt,
  siteBonusText,
  siteMissions,
  siteName,
  sortSites,
  stateText,
  siteEarnLines,
  siteWallText,
  keepersText,
  tribeBonusLine,
} from '../src/sites.ts';

const HOUR = 3_600_000;
const site = (over: Partial<SiteDto> = {}): SiteDto => ({
  id: 2,
  kind: 'fire_shrine',
  x: 35,
  y: -4,
  awake: false,
  holder: null,
  garrison: 600,
  maxPopulation: 3000,
  calmUntil: null,
  bonus: 0,
  renownPerDay: 0,
  renownPerDayDormant: 15,
  renownPerDayAwake: 30,
  wallLevel: 7,
  wallMax: 22,
  wallNextMs: 7 * HOUR + 12 * 60_000,
  keepers: 1,
  mine: 0,
  ...over,
});
const holder = (tribeId: number) => ({ tribeId, name: `Tribe ${tribeId}`, tag: `T${tribeId}` });

test('siteName numbers the shrines from 1', () => {
  assert.equal(siteName(site({ id: 1, kind: 'great_fire' })), 'Great Fire');
  assert.equal(siteName(site({ id: 2 })), 'Fire Shrine 1');
  assert.equal(siteName(site({ id: 9 })), 'Fire Shrine 8');
});

test('siteAt finds the site on a tile', () => {
  const list = [site(), site({ id: 3, x: 0, y: 0 })];
  assert.equal(siteAt(list, 0, 0)?.id, 3);
  assert.equal(siteAt(list, 1, 1), undefined);
});

test('holderText, garrisonText and stateText', () => {
  assert.equal(holderText(site()), 'Nobody holds it');
  assert.equal(holderText(site({ holder: holder(4) })), '[T4] Tribe 4');
  assert.equal(garrisonText(site()), '600 of 3,000 (militia)');
  assert.equal(garrisonText(site({ holder: holder(4), garrison: 1200 })), '1,200 of 3,000');
  assert.equal(stateText(site({ awake: true }), 0, 10), 'Awake');
  assert.equal(stateText(site(), 10 * HOUR + 1000, 0), 'Dormant: wakes in 10h 0m');
  assert.equal(stateText(site(), 5, 10), 'Dormant');
});

test('calmLeftMs is 0 without a calm or after it ended', () => {
  assert.equal(calmLeftMs(site(), 100), 0);
  assert.equal(calmLeftMs(site({ calmUntil: 50 }), 100), 0);
  assert.equal(calmLeftMs(site({ calmUntil: 2 * HOUR }), HOUR), HOUR);
});

test('the site panel says plainly what every member earns, and what the viewer earns', () => {
  assert.equal(
    siteBonusText(site()),
    'While your tribe holds this shrine, every member earns 15 Renown a day (30 once it wakes on day 120)',
  );
  assert.equal(siteBonusText(site({ awake: true })), 'While your tribe holds this shrine, every member earns 30 Renown a day');
  assert.match(siteBonusText(site({ kind: 'great_fire', renownPerDayDormant: 40, renownPerDayAwake: 100 })), /^While your tribe holds the Great Fire, every member earns 40 Renown a day \(100 once/);
  assert.match(siteBonusText(site(), 10), /earns 150 Renown a day \(300 once/, 'world speed multiplies it');
  assert.deepEqual(siteEarnLines(site({ renownPerDay: 15 }), true), ['You earn 15 a day from it']);
  assert.deepEqual(siteEarnLines(site({ renownPerDay: 15 }), false), []);
  assert.deepEqual(siteEarnLines(site({ renownPerDay: 0 }), true), []);
  assert.equal(tribeBonusLine(0), null);
  assert.equal(tribeBonusLine(45), 'Fire sites your tribe holds: you earn 45 Renown a day from them');
});

test('the Wall and keepers lines', () => {
  assert.equal(siteWallText(site()), 'Wall 7 of 22 · next level in 7h 12m');
  assert.equal(siteWallText(site({ wallLevel: 22, wallNextMs: null })), 'Wall 22 of 22 · top level');
  assert.equal(keepersText(site({ keepers: 0.5 }), 24 * HOUR), 'Keepers 50% back, full in 12h 0m');
  assert.equal(keepersText(site(), 24 * HOUR), 'Keepers at full strength');
  assert.equal(keepersText(site({ holder: holder(1) }), 24 * HOUR), '');
});

test('siteMissions: neutral = attack, mine = support, others = attack unless calm', () => {
  assert.deepEqual(siteMissions(site(), 7, 0).missions, ['attack']);
  assert.deepEqual(siteMissions(site(), null, 0).missions, ['attack']);
  assert.deepEqual(siteMissions(site({ holder: holder(7) }), 7, 0).missions, ['support']);
  assert.deepEqual(siteMissions(site({ holder: holder(8) }), 7, 0).missions, ['attack', 'support']);
  assert.deepEqual(siteMissions(site({ holder: holder(8) }), null, 0).missions, ['attack', 'support']);
  const calm = siteMissions(site({ holder: holder(8), calmUntil: 2 * HOUR }), 7, HOUR);
  assert.deepEqual(calm.missions, ['support']);
  assert.match(calm.note ?? '', /cannot be attacked for 1h 0m/);
  // Calm already over: attackable again.
  assert.deepEqual(siteMissions(site({ holder: holder(8), calmUntil: HOUR }), 7, 2 * HOUR).missions, ['attack', 'support']);
});

test('hitsSiteBox covers the tile and the flame above it, not far away', () => {
  const d = { x: 100, y: 100, scale: 1 };
  assert.equal(hitsSiteBox(100, 100, d), true);
  assert.equal(hitsSiteBox(100, 30, d), true);
  assert.equal(hitsSiteBox(100, -40, d), false);
  assert.equal(hitsSiteBox(200, 100, d), false);
  assert.equal(hitsSiteBox(100, 140, d), false);
});

test('sortSites puts the Great Fire first, shrines by id', () => {
  const list = [site({ id: 5 }), site({ id: 1, kind: 'great_fire' }), site({ id: 3 })];
  assert.deepEqual(sortSites(list).map((s) => s.id), [1, 3, 5]);
});
