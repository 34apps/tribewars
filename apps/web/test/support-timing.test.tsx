// Support form: "Will my help arrive in time?" against the attacks the player may know about (own movements + tribe alerts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_WORLD, emptyUnits, travelPreview } from '@clanfire/engine';
import type { MovementDto, TribeAlertDto, VillageRefDto } from '@clanfire/engine';
import { SupportTimingView } from '../src/components/hintViews.tsx';
import { attacksOn, knownAttacks } from '../src/incoming.ts';
import { SUPPORT_TIMING_MAX, supportTimingLines } from '../src/supportTiming.ts';

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const attack = (movementId: number, arriveAt: number) => ({ movementId, arriveAt });
const ref = (villageId: number, ownerName: string | null = 'Me'): VillageRefDto => ({ villageId, name: `V${villageId}`, ownerName, x: villageId, y: 0 });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('one attack: in time says how long before, too late says how long after', () => {
  const early = supportTimingLines(2 * HOUR, NOW, [attack(1, NOW + 2 * HOUR + 12 * MIN)]);
  assert.deepEqual(early, [{ movementId: 1, inTime: true, text: 'Arrives 12m before the attack lands' }]);
  const late = supportTimingLines(10 * HOUR, NOW, [attack(1, NOW + HOUR)]);
  assert.deepEqual(late, [{ movementId: 1, inTime: false, text: 'Arrives 9h 0m too late: the attack lands first' }]);
});

test('landing in the same millisecond counts as too late; a sub-second gap reads "a moment"', () => {
  const same = supportTimingLines(HOUR, NOW, [attack(1, NOW + HOUR)]);
  assert.equal(same[0]!.inTime, false);
  assert.equal(same[0]!.text, 'Arrives as the attack lands: too late');
  const near = supportTimingLines(HOUR, NOW, [attack(1, NOW + HOUR + 500)]);
  assert.equal(near[0]!.inTime, true);
  assert.equal(near[0]!.text, 'Arrives a moment before the attack lands');
});

test('several attacks: soonest first, a verdict for each, at most three, landed ones left out', () => {
  const lines = supportTimingLines(HOUR, NOW, [attack(4, NOW + 5 * HOUR), attack(2, NOW + 30 * MIN), attack(3, NOW + 2 * HOUR), attack(1, NOW + 90 * MIN), attack(9, NOW - MIN)]);
  assert.equal(lines.length, SUPPORT_TIMING_MAX);
  assert.deepEqual(
    lines.map((l) => [l.movementId, l.inTime]),
    [
      [2, false],
      [1, true],
      [3, true],
    ],
  );
  assert.ok(lines[0]!.text.startsWith('First attack: arrives 30m too late'));
  assert.ok(lines[2]!.text.startsWith('Third attack: arrives 1h 0m before it lands'));
});

test('nothing without an attack or without a picked army', () => {
  assert.deepEqual(supportTimingLines(HOUR, NOW, []), []);
  assert.deepEqual(supportTimingLines(0, NOW, [attack(1, NOW + HOUR)]), []);
  assert.deepEqual(supportTimingLines(Number.NaN, NOW, [attack(1, NOW + HOUR)]), []);
});

test('the slowest unit decides: the verdict follows the engine travel time of the picked army', () => {
  const settings = DEFAULT_WORLD;
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const fast = { ...emptyUnits(), outrider: 10 };
  const mixed = { ...emptyUnits(), outrider: 10, pikeman: 10 };
  const tFast = travelPreview(from, to, fast, settings).ms;
  const tMixed = travelPreview(from, to, mixed, settings).ms;
  assert.ok(tMixed > tFast, 'the Pikemen slow the army');
  assert.equal(tMixed, travelPreview(from, to, { ...emptyUnits(), pikeman: 10 }, settings).ms, 'the slowest unit sets the time');
  const lands = NOW + (tFast + tMixed) / 2;
  assert.equal(supportTimingLines(tFast, NOW, [attack(1, lands)])[0]!.inTime, true);
  assert.equal(supportTimingLines(tMixed, NOW, [attack(1, lands)])[0]!.inTime, false);
});

test('known attacks on a village: own movements and a tribe-mate\'s alerts, nothing else', () => {
  const mv = (id: number, target: number, arriveAt: number, kind: MovementDto['kind'] = 'attack', direction: MovementDto['direction'] = 'incoming'): MovementDto => ({
    id,
    kind,
    direction,
    origin: ref(900 + id, 'Foe'),
    target: ref(target),
    departAt: arriveAt - HOUR,
    arriveAt,
    units: null,
    loot: null,
    resources: null,
    cancellableUntil: null,
  });
  const alert = (movementId: number, target: number, arriveAt: number): TribeAlertDto => ({
    movementId,
    target: ref(target, 'Mate'),
    attacker: ref(800 + movementId, 'Foe'),
    attackerTribeTag: 'XYZ',
    departAt: arriveAt - HOUR,
    arriveAt,
  });
  const movements = [mv(1, 10, NOW + 3 * HOUR), mv(2, 10, NOW + HOUR, 'support'), mv(3, 10, NOW + HOUR, 'attack', 'outgoing'), mv(4, 11, NOW + 2 * HOUR)];
  const alerts = [alert(1, 10, NOW + 3 * HOUR), alert(5, 20, NOW + 4 * HOUR), alert(6, 20, NOW + 2 * HOUR)];
  const all = knownAttacks(movements, alerts, new Set([10, 11]));
  assert.deepEqual(
    attacksOn(all, 10).map((a) => a.movementId),
    [1],
    'only the incoming attack on village 10 (support and outgoing movements are not attacks)',
  );
  assert.deepEqual(
    attacksOn(all, 20).map((a) => a.movementId),
    [6, 5],
    'a tribe-mate\'s village: the alerts, soonest first',
  );
  assert.equal(attacksOn(all, 20)[0]!.own, false);
  assert.equal(attacksOn(all, 10)[0]!.own, true);
  assert.deepEqual(attacksOn(knownAttacks(movements, null, new Set([10, 11])), 20), [], 'without the alert feed nothing is known about villages that are not mine');
  const lines = supportTimingLines(2 * HOUR, NOW, attacksOn(all, 20));
  assert.deepEqual(
    lines.map((l) => [l.movementId, l.inTime]),
    [
      [6, false],
      [5, true],
    ],
  );
});

test('the line renders with a green tag when in time and a red one when too late; nothing for no attacks', () => {
  const lines = supportTimingLines(HOUR, NOW, [attack(1, NOW + 2 * HOUR), attack(2, NOW + 30 * MIN)]);
  const html = renderToStaticMarkup(createElement(SupportTimingView, { lines }));
  assert.ok(html.includes('tag-ok') && html.includes('tag-bad'));
  const s = text(html);
  assert.ok(s.includes('In time') && s.includes('Too late') && s.includes('too late: it lands first'));
  assert.equal(renderToStaticMarkup(createElement(SupportTimingView, { lines: [] })), '');
});
