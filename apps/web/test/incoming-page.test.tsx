// The Incoming attacks page: the shared data helper (knownAttacks), grouping and paging, the tribe-help line, the "other village" pick,
// and a render of the page with no attacks and with two attacked villages (no troop counts anywhere).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRIBE_CHAT_MESSAGE_MAX } from '@clanfire/engine';
import type { MovementDto, TribeAlertDto, VillageRefDto } from '@clanfire/engine';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { knownAttacks } from '../src/incoming.ts';
import type { KnownAttack } from '../src/incoming.ts';
import { IncomingBody } from '../src/views/incoming/FrameIncoming.tsx';
import {
  INCOMING_LINES_PER_PAGE,
  SIZE_UNKNOWN,
  groupByVillage,
  groupLine,
  ownAttacks,
  pageChunks,
  pickOtherVillage,
  sizeText,
  tribeHelpText,
} from '../src/views/incoming/incoming-logic.ts';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const MIN = 60_000;

const ref = (villageId: number, name: string, x: number, y: number, ownerName: string | null = null): VillageRefDto => ({ villageId, name, x, y, ownerName });
const ME = (id: number, name: string, x: number, y: number) => ref(id, name, x, y, 'me');

function movement(id: number, target: VillageRefDto, origin: VillageRefDto, arriveIn: number, over: Partial<MovementDto> = {}): MovementDto {
  return { id, kind: 'attack', direction: 'incoming', origin, target, departAt: NOW - MIN, arriveAt: NOW + arriveIn, units: null, loot: null, resources: null, cancellableUntil: null, ...over };
}

function alert(id: number, target: VillageRefDto, attacker: VillageRefDto, arriveIn: number, over: Partial<TribeAlertDto> = {}): TribeAlertDto {
  return { movementId: id, target, attacker, attackerTribeTag: null, departAt: NOW - MIN, arriveAt: NOW + arriveIn, ...over };
}

const HOME = ME(1, 'Home', 10, 10);
const FARM = ME(2, 'Farm', 14, 12);
const RAIDER = ref(90, 'Ash Hold', 40, 40, 'Brakka');
const OTHER = ref(91, 'Cinder Gate', 50, 20, 'Orin');
const MATE = ref(70, 'Mate Keep', 20, 20, 'Tess');

test('knownAttacks: own incoming attacks only from movements, units hidden, soonest first, own flag set', () => {
  const list = knownAttacks(
    [
      movement(5, HOME, OTHER, 20 * MIN),
      movement(3, FARM, RAIDER, 10 * MIN),
      movement(4, HOME, RAIDER, 10 * MIN, { kind: 'support' }),
      movement(6, HOME, RAIDER, 5 * MIN, { direction: 'outgoing' }),
    ],
    null,
    new Set([1, 2]),
  );
  assert.deepEqual(list.map((a) => a.movementId), [3, 5]);
  assert.ok(list.every((a) => a.own));
  assert.equal(list[0]?.sizeBand, undefined);
  assert.ok(!('units' in (list[0] ?? {})), 'no troop field');
});

test('knownAttacks: the tribe feed adds tag and Watchtower fields to the same movement, and brings in mates\' attacks as not own', () => {
  const list = knownAttacks(
    [movement(3, FARM, RAIDER, 10 * MIN)],
    [
      alert(3, FARM, RAIDER, 10 * MIN, { attackerTribeTag: 'ASH', sizeBand: 'medium', slowestUnit: 'raider', sizeAbout: 120 }),
      alert(8, MATE, OTHER, 3 * MIN, { sizeBand: 'small' }),
    ],
    new Set([1, 2]),
  );
  assert.deepEqual(list.map((a) => [a.movementId, a.own]), [[8, false], [3, true]]);
  const mine = list.find((a) => a.movementId === 3);
  assert.equal(mine?.attackerTribeTag, 'ASH');
  assert.equal(mine?.sizeBand, 'medium');
  assert.equal(mine?.slowestUnit, 'raider');
  assert.equal(mine?.sizeAbout, 120);
  // The page lists mine only.
  assert.deepEqual(ownAttacks(list, NOW).map((a) => a.movementId), [3]);
});

test('knownAttacks: an alert on my village I have no movement for (feed first) still counts as own', () => {
  const list = knownAttacks([], [alert(9, HOME, RAIDER, MIN)], new Set([1]));
  assert.equal(list[0]?.own, true);
});

test('ownAttacks drops landed attacks after a second of grace', () => {
  const list = knownAttacks([movement(1, HOME, RAIDER, -2000), movement(2, HOME, RAIDER, -500), movement(3, HOME, RAIDER, MIN)], null, new Set([1]));
  assert.deepEqual(ownAttacks(list, NOW).map((a) => a.movementId), [2, 3]);
});

function many(target: VillageRefDto, n: number, firstId: number, firstIn = MIN): KnownAttack[] {
  return Array.from({ length: n }, (_, i) => ({ movementId: firstId + i, target, attacker: RAIDER, attackerTribeTag: null, departAt: NOW - MIN, arriveAt: NOW + firstIn + i * MIN, own: true }));
}

test('groupByVillage: one group per village, soonest village first, attacks soonest first', () => {
  const a = [...many(FARM, 2, 10, 5 * MIN), ...many(HOME, 3, 20, 2 * MIN)];
  const groups = groupByVillage(a);
  assert.deepEqual(groups.map((g) => g.village.villageId), [1, 2]);
  assert.deepEqual(groups[0]?.attacks.map((x) => x.movementId), [20, 21, 22]);
  assert.equal(groups[0]?.soonestAt, NOW + 2 * MIN);
  assert.equal(groups[1]?.attacks.length, 2);
});

test('pageChunks: few attacks fit one page; every page stays within the line budget', () => {
  const small = groupByVillage([...many(HOME, 2, 1), ...many(FARM, 1, 5, 9 * MIN)]);
  assert.equal(pageChunks(small).length, 1);
  const big = groupByVillage([...many(HOME, 12, 100), ...many(FARM, 5, 200, 3 * MIN), ...many(ref(3, 'Third', 1, 1, 'me'), 2, 300, 7 * MIN)]);
  const pages = pageChunks(big);
  assert.ok(pages.length > 1);
  for (const p of pages) assert.ok(p.reduce((n, c) => n + 1 + c.attacks.length, 0) <= INCOMING_LINES_PER_PAGE);
  // Nothing is lost or repeated.
  assert.equal(pages.flat().reduce((n, c) => n + c.attacks.length, 0), 19);
  // A village that goes on over a page break is marked "continued" and keeps its total.
  const continued = pages.flat().filter((c) => c.continued);
  assert.ok(continued.length > 0);
  assert.ok(continued.every((c) => c.total >= c.attacks.length));
  // A heading never sits alone at the end of a page.
  for (const p of pages) assert.ok(p.every((c) => c.attacks.length > 0));
});

test('pageChunks: no attacks, no pages', () => {
  assert.deepEqual(pageChunks([]), []);
});

test('sizeText: Watchtower band and rounded number, else the unknown line', () => {
  assert.equal(sizeText({}), SIZE_UNKNOWN);
  assert.equal(sizeText({ sizeBand: 'small' }), 'Small army');
  assert.equal(sizeText({ sizeBand: 'huge', sizeAbout: 1200 }), 'Huge army ~1,200');
  assert.equal(SIZE_UNKNOWN, 'Size unknown (a tribe Watchtower shows it)');
});

test('tribeHelpText: village, coordinates, landing clock time and time left; one line within the chat limit', () => {
  const one = tribeHelpText(HOME, many(HOME, 1, 1, 12 * MIN + 5000), NOW);
  assert.match(one, /^Help needed at Home \(10\|10\): an attack lands .*\d.* \(in 12m 05s\)\. Please send support\.$/);
  assert.ok(!one.includes('\n'));
  const three = tribeHelpText(HOME, many(HOME, 3, 1, 5 * MIN), NOW);
  assert.match(three, /3 attacks are on the way, the first lands .* \(in 5m 00s\)/);
  const long = tribeHelpText({ name: 'x'.repeat(2000), x: 1, y: 2 }, many(HOME, 1, 1), NOW);
  assert.ok(long.length <= TRIBE_CHAT_MESSAGE_MAX);
  assert.doesNotMatch(one, /troop|unit|army/i, 'never says what the attackers bring');
});

test('groupLine: count, first landing and time left', () => {
  assert.match(groupLine(1, NOW + 90_000, NOW), /^1 attack · lands .* \(in 1m 30s\)$/);
  assert.match(groupLine(4, NOW + 90_000, NOW), /^4 attacks · first lands /);
  assert.match(groupLine(2, NOW - 100, NOW), /landing now/);
});

test('pickOtherVillage: nearest other village, calm ones first, null when alone', () => {
  const mine = [
    { id: 1, x: 10, y: 10 },
    { id: 2, x: 12, y: 10 },
    { id: 3, x: 30, y: 30 },
  ];
  assert.equal(pickOtherVillage(mine, { villageId: 1, x: 10, y: 10 }, new Set([1])), 2);
  assert.equal(pickOtherVillage(mine, { villageId: 1, x: 10, y: 10 }, new Set([1, 2])), 3, 'the attacked neighbour is skipped');
  assert.equal(pickOtherVillage(mine, { villageId: 1, x: 10, y: 10 }, new Set([1, 2, 3])), 2, 'all attacked: the nearest');
  assert.equal(pickOtherVillage([{ id: 1, x: 10, y: 10 }], { villageId: 1, x: 10, y: 10 }, new Set()), null);
});

// ---- Render ----

function page(movements: MovementDto[], villageRefs: VillageRefDto[], tribe: { id: number; tag: string } | null = null, alerts: TribeAlertDto[] | null = null) {
  const game = {
    now: NOW,
    movements,
    villages: villageRefs.map((v) => ({ id: v.villageId, name: v.name, x: v.x, y: v.y })),
    player: { id: 7, username: 'me', tribe },
    navigate: () => {},
    selectVillage: () => {},
    openBuilding: () => {},
    showOnMap: () => {},
    toast: () => {},
  } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(IncomingBody, { alerts, feedError: null })));
}

test('page with no attacks: an empty state, no village blocks', () => {
  const html = page([], [HOME]);
  assert.match(html, /No attacks on the way/);
  assert.doesNotMatch(html, /fin-vg/);
});

test('page with two attacked villages lists both with the attackers, landing and no troop counts', () => {
  const html = page(
    [
      movement(3, FARM, RAIDER, 10 * MIN, { units: { raider: 400 } as never }),
      movement(5, HOME, OTHER, 20 * MIN),
    ],
    [HOME, FARM],
    { id: 1, tag: 'ASH' },
    [alert(6, MATE, OTHER, 5 * MIN, { sizeBand: 'small' })],
  );
  assert.match(html, /Home/);
  assert.match(html, /Farm/);
  assert.doesNotMatch(html, /Mate Keep/, 'tribe-mates\' villages stay in Tribe > Alerts');
  assert.match(html, /Brakka/);
  assert.match(html, /Orin/);
  assert.match(html, /Ash Hold \(40\|40\)/);
  assert.match(html, /Size unknown \(a tribe Watchtower shows it\)/);
  assert.match(html, /Recruit defenders/);
  assert.match(html, /Send support/);
  assert.match(html, /Ship resources away/);
  assert.doesNotMatch(html, /400/, 'the units of an attack are never shown');
  // The village with the soonest attack (Farm, 10 min) comes first.
  assert.ok(html.indexOf('Farm') < html.indexOf('Home'));
});

test('page without a tribe: no help button, no Tribe alerts link', () => {
  const html = page([movement(3, HOME, RAIDER, 10 * MIN)], [HOME, FARM]);
  assert.doesNotMatch(html, /Ask the tribe for help/);
  assert.doesNotMatch(html, /Tribe alerts/);
});

test('page in a tribe: the help button and the Tribe alerts link; the Watchtower size shows', () => {
  const html = page(
    [movement(3, HOME, RAIDER, 10 * MIN)],
    [HOME, FARM],
    { id: 1, tag: 'ASH' },
    [alert(3, HOME, RAIDER, 10 * MIN, { attackerTribeTag: 'THN', sizeBand: 'large', sizeAbout: 300, slowestUnit: 'raider' })],
  );
  assert.match(html, /Ask the tribe for help/);
  assert.match(html, /Tribe alerts/);
  assert.match(html, /Large army ~300/);
  assert.match(html, /\[THN\]/);
  assert.doesNotMatch(html, /Size unknown/);
});

test('page with one village: support and shipping are disabled with the reason', () => {
  const html = page([movement(3, HOME, RAIDER, 10 * MIN)], [HOME]);
  assert.match(html, /No other village to send from/);
  assert.match(html, /disabled/);
});
