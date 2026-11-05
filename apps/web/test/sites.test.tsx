// Pure helpers behind map sites (src/sites.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SiteDto } from '@clanfire/engine';
import {
  bonusPercent,
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
  bonus: 0.01,
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

test('bonus texts', () => {
  assert.equal(bonusPercent(0.04), '+4%');
  assert.equal(bonusPercent(0.025), '+2.5%');
  assert.equal(bonusPercent(0.1), '+10%');
  assert.equal(bonusPercent(Number.NaN), '+0%');
  assert.match(siteBonusText(site({ bonus: 0.04, holder: holder(1) })), /^\+4% Renown for every member of the holding tribe$/);
  assert.match(siteBonusText(site({ bonus: 0.04 })), /whoever holds it/);
  assert.equal(tribeBonusLine(0), null);
  assert.equal(tribeBonusLine(0.14), 'Fire sites your tribe holds: +14% Renown for every member');
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
