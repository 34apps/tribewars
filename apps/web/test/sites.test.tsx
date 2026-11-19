// Pure helpers behind map sites (src/sites.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SiteDto } from '@clanfire/engine';
import {
  calmLeftMs,
  hitsSiteBox,
  holderText,
  siteAt,
  siteStatus,
  siteGivesTile,
  siteDefendersTile,
  siteWallTile,
  siteSendCopy,
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

test('holderText and stateText', () => {
  assert.equal(holderText(site()), 'Nobody holds it');
  assert.equal(holderText(site({ holder: holder(4) })), '[T4] Tribe 4');
  assert.equal(stateText(site({ awake: true }), 0, 10), 'Awake');
  assert.equal(stateText(site(), 10 * HOUR + 1000, 0), 'Dormant: wakes in 10h 0m');
  assert.equal(stateText(site(), 5, 10), 'Dormant');
});

test('calmLeftMs is 0 without a calm or after it ended', () => {
  assert.equal(calmLeftMs(site(), 100), 0);
  assert.equal(calmLeftMs(site({ calmUntil: 50 }), 100), 0);
  assert.equal(calmLeftMs(site({ calmUntil: 2 * HOUR }), HOUR), HOUR);
});

test('siteStatus: free, ours, theirs and calm', () => {
  const free = siteStatus(site(), 7, 0);
  assert.deepEqual([free.tone, free.title, free.tribe], ['free', 'Nobody holds it', null]);
  assert.match(free.sub, /^Free to take/);
  const ours = siteStatus(site({ holder: holder(7) }), 7, 0);
  assert.deepEqual([ours.tone, ours.title, ours.sub], ['ours', 'Your tribe holds it', 'Keep troops here or it turns free']);
  assert.equal(ours.tribe?.tag, 'T7');
  const theirs = siteStatus(site({ holder: holder(8) }), 7, 0);
  assert.deepEqual([theirs.tone, theirs.title, theirs.sub], ['theirs', 'Held by Tribe 8', 'Beat their troops to take it']);
  assert.equal(siteStatus(site({ holder: holder(8) }), null, 0).tone, 'theirs');
  assert.equal(siteStatus(site({ holder: holder(8), calmUntil: 2 * HOUR }), 7, HOUR).sub, 'Calm: nobody can attack it for 1h 0m');
  assert.equal(siteStatus(site({ holder: holder(8), calmUntil: HOUR }), 7, 2 * HOUR).sub, 'Beat their troops to take it');
});

test('siteGivesTile: dormant vs awake shrine, world speed, Waymark and Lookout', () => {
  const dormant = siteGivesTile(site());
  assert.deepEqual([dormant.value, dormant.unit], ['+15', undefined]);
  assert.equal(dormant.sub, 'Renown a day to every member of your tribe · 30 once it wakes');
  const awake = siteGivesTile(site({ awake: true }));
  assert.equal(awake.value, '+30');
  assert.equal(awake.sub, 'Renown a day to every member of your tribe');
  assert.equal(siteGivesTile(site(), 10).value, '+150', 'world speed multiplies it');
  assert.match(siteGivesTile(site(), 10).sub, /300 once it wakes/);
  const way = siteGivesTile(site({ kind: 'waymark' }));
  assert.deepEqual([way.icon, way.value, way.unit], ['road', '12', ' tiles']);
  assert.match(way.sub, /half the slowdown/);
  const look = siteGivesTile(site({ kind: 'lookout' }));
  assert.deepEqual([look.icon, look.value, look.unit], ['lookout', '20', ' tiles']);
  assert.match(look.sub, /enemy armies/);
});

test('siteDefendersTile: keepers regrowing, keepers full, troops of a holder', () => {
  const back = siteDefendersTile(site({ keepers: 0.5, garrison: 470 }), 24 * HOUR);
  assert.deepEqual([back.label, back.value, back.fill, back.sub], ['Keepers', '470', 0.5, '50% back · full in 12h 0m']);
  const full = siteDefendersTile(site(), 24 * HOUR);
  assert.deepEqual([full.value, full.fill, full.sub], ['600', 1, 'at full strength']);
  const held = siteDefendersTile(site({ holder: holder(1), garrison: 1500 }), 24 * HOUR);
  assert.deepEqual([held.label, held.value, held.fill, held.sub], ['Troops', '1,500', 0.5, 'of 3,000 room']);
});

test('siteWallTile: level of max, next level, top level', () => {
  const w = siteWallTile(site());
  assert.deepEqual([w.value, w.unit, w.sub], ['7', ' of 22', '+1 level in 7h 12m']);
  assert.ok(Math.abs((w.fill ?? 0) - 7 / 22) < 1e-9);
  const top = siteWallTile(site({ wallLevel: 22, wallNextMs: null }));
  assert.deepEqual([top.value, top.fill, top.sub], ['22', 1, 'top level']);
});

test('siteSendCopy: headings per mission', () => {
  assert.equal(siteSendCopy('free').titles.attack, 'Attack to take it');
  assert.equal(siteSendCopy('ours').titles.support, 'Support to keep it');
  assert.equal(siteSendCopy('theirs').titles.support, 'Support the holders');
  assert.equal(siteSendCopy('ours').hints.support, 'More troops here make it harder to take.');
});

test('tribeBonusLine', () => {
  assert.equal(tribeBonusLine(0), null);
  assert.equal(tribeBonusLine(45), 'Fire sites your tribe holds: you earn 45 Renown a day from them');
});

test('siteMissions: neutral = attack, mine = support, others = attack unless calm', () => {
  assert.deepEqual(siteMissions(site(), 7, 0).missions, ['attack']);
  assert.deepEqual(siteMissions(site(), null, 0).missions, ['attack']);
  assert.deepEqual(siteMissions(site({ holder: holder(7) }), 7, 0).missions, ['support']);
  assert.deepEqual(siteMissions(site({ holder: holder(8) }), 7, 0).missions, ['attack', 'support']);
  assert.deepEqual(siteMissions(site({ holder: holder(8) }), null, 0).missions, ['attack', 'support']);
  const calm = siteMissions(site({ holder: holder(8), calmUntil: 2 * HOUR }), 7, HOUR);
  assert.deepEqual(calm.missions, ['support']);
  assert.match(calm.note ?? '', /Only the holders and their allies/);
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
