// Command post: coordinate parser, search input checks and the mapping of results to a send target.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEARCH_VILLAGES_LIMIT, createPlayerVillage, emptyUnits } from '@clanfire/engine';
import type { MapVillageDto, OwnVillageDto } from '@clanfire/engine';
import {
  lookupWindow,
  occupiedIn,
  parseCoords,
  resultRows,
  searchHint,
  searchText,
  targetOfOwn,
  targetOfVillage,
  villageAt,
} from '../src/views/army/command-post-logic.ts';
import { missionsFor, unitColumns } from '../src/villages.ts';

const village = (over: Partial<MapVillageDto> = {}): MapVillageDto => ({
  id: 1,
  name: 'Rock Fort',
  x: 5,
  y: -7,
  kind: 'player',
  ownerName: 'Bobby',
  points: 40,
  protected: false,
  tribeTag: null,
  tribeId: null,
  ownerChieftain: null,
  relation: 'neutral',
  ...over,
});

test('parseCoords accepts | , ; space and brackets, negative numbers, blanks around', () => {
  for (const text of ['12|-40', '12,-40', ' 12 | -40 ', '12;-40', '12 -40', '(12|-40)', '( 12 , -40 )', '+12|-40']) {
    assert.deepEqual(parseCoords(text), { ok: true, coords: { x: 12, y: -40 } }, text);
  }
  assert.deepEqual(parseCoords('-3|0'), { ok: true, coords: { x: -3, y: 0 } });
  assert.deepEqual(parseCoords('0|0'), { ok: true, coords: { x: 0, y: 0 } });
});

test('parseCoords refuses everything else with a sentence (empty input: no sentence)', () => {
  assert.deepEqual(parseCoords(''), { ok: false, message: '' });
  assert.deepEqual(parseCoords('   '), { ok: false, message: '' });
  for (const text of ['12', '12|', '|5', '1.5|2', 'a|b', '12|-40|3', '12||5', '1e3|5', '12|-', '--1|2', '0x10|1', '12 | 40 x']) {
    const r = parseCoords(text);
    assert.equal(r.ok, false, text);
    if (!r.ok) assert.match(r.message, /coordinates/i, text);
  }
  for (const text of ['99999999999|1', '1|-99999999999', '10000000|0']) {
    const r = parseCoords(text);
    assert.equal(r.ok, false, text);
    if (!r.ok) assert.match(r.message, /range/i, text);
  }
});

test('searchText and searchHint follow the server bounds (2 to 24 after trimming)', () => {
  assert.equal(searchText('a'), null);
  assert.equal(searchText('  a  '), null);
  assert.equal(searchText('  ab '), 'ab');
  assert.equal(searchText('x'.repeat(24)), 'x'.repeat(24));
  assert.equal(searchText('x'.repeat(25)), null);
  assert.equal(searchHint(''), '');
  assert.match(searchHint('a'), /at least 2/i);
  assert.match(searchHint('x'.repeat(30)), /at most 24/i);
  assert.equal(searchHint('ab'), '');
});

test('a search result becomes a target on its own tile; a map answer finds the village on a tile or free land', () => {
  const v = village();
  assert.deepEqual(targetOfVillage(v), { tile: { x: 5, y: -7 }, village: v });
  const other = village({ id: 2, x: 6, y: -7 });
  assert.equal(villageAt([v, other], { x: 6, y: -7 }), other);
  assert.equal(villageAt([v, other], { x: 7, y: -7 }), null);
  const taken = occupiedIn([v, other]);
  assert.equal(taken(5, -7), true);
  assert.equal(taken(5, -6), false);
  assert.deepEqual(lookupWindow({ x: 10, y: -3 }), { x: 8, y: -5, w: 5, h: 5 });
});

test('results are capped at the server limit and sorted nearest first from the sending village', () => {
  const list = Array.from({ length: 14 }, (_, i) => village({ id: i + 1, x: 14 - i, y: 0 }));
  const rows = resultRows(list, { x: 0, y: 0 });
  assert.equal(rows.length, SEARCH_VILLAGES_LIMIT);
  assert.deepEqual(rows.map((r) => r.village.x), [...rows.map((r) => r.village.x)].sort((a, b) => a - b));
  assert.equal(rows[0]?.distance, rows[0]?.village.x);
  assert.equal(resultRows([village()], null)[0]?.distance, null);
});

test('missions on a picked target: free land = found, other player = attack set, own current village = none', () => {
  const ctx = { playerId: 7, currentVillageId: 100 };
  assert.deepEqual(missionsFor(null, ctx), ['found']);
  assert.ok(missionsFor(village(), ctx).includes('attack'));
  const own = { id: 100, name: 'Home', x: 0, y: 0, state: createPlayerVillage(1_000), feastAllowance: { max: 0, used: 0, left: 0 } } as unknown as OwnVillageDto;
  const mine = targetOfOwn(own, null);
  assert.equal(mine.village?.kind, 'own');
  assert.deepEqual(missionsFor(mine.village, ctx), []);
  assert.deepEqual(missionsFor(targetOfOwn({ ...own, id: 101 }, null).village, ctx), ['support']);
});

test('wide troop picker columns: Foot, Riders, Siege, Special (Chieftain and Pathfinder), empty ones left out', () => {
  const all = Object.keys(emptyUnits()) as Array<keyof ReturnType<typeof emptyUnits>>;
  const cols = unitColumns(all);
  assert.deepEqual(cols.map((c) => c.column), ['foot', 'riders', 'siege', 'special']);
  const special = cols.find((c) => c.column === 'special')?.units ?? [];
  assert.deepEqual([...special].sort(), ['chieftain', 'pathfinder']);
  assert.ok((cols.find((c) => c.column === 'riders')?.units ?? []).includes('outrider'));
  assert.ok((cols.find((c) => c.column === 'siege')?.units ?? []).includes('boulder'));
  assert.deepEqual(unitColumns(['pikeman', 'chieftain']).map((c) => c.column), ['foot', 'special']);
  assert.deepEqual(unitColumns([]), []);
});
