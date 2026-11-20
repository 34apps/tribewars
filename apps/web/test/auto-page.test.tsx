// The Auto mode page: the plain-words pieces (Next line, slider text, queued line), the tab rule and the greyed state without the tools.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AutoNextDto } from '@clanfire/engine';
import { AUTO_NOT_ENTITLED, autoTabOn, chipDisabled, controlsOff, nextLine, queuedLine, shareText, snapShare, toggleUnit, unitPlural, whyNotTrainable } from '../src/auto.ts';
import { navTabs } from '../src/game.ts';

const NOW = 1_000_000;
const next = (o: Partial<AutoNextDto>): AutoNextDto => ({ kind: 'build', building: 'storehouse', level: 10, waiting: 'resources', readyAt: NOW + 40 * 60_000, ...o });

test('slider text: percentages add up to 100 and snap to steps of 10', () => {
  assert.equal(shareText(70), '70% buildings · 30% troops');
  assert.equal(shareText(0), '0% buildings · 100% troops');
  assert.equal(shareText(100), '100% buildings · 0% troops');
  assert.equal(snapShare(33), 30);
  assert.equal(snapShare(-5), 0);
  assert.equal(snapShare(250), 100);
});

test('Next line words each waiting state', () => {
  assert.equal(nextLine({ on: false, next: next({}) }, NOW), 'Off');
  assert.equal(nextLine({ on: true, next: null }, NOW), 'Nothing left to do');
  assert.equal(nextLine({ on: true, next: next({}) }, NOW), 'Next: Storehouse 10 · waiting for resources, about 40m');
  assert.equal(nextLine({ on: true, next: next({ readyAt: null }) }, NOW), 'Next: Storehouse 10 · waiting for resources');
  assert.equal(nextLine({ on: true, next: next({ kind: 'troops', building: undefined, unit: 'pikeman', count: 10, waiting: 'slot', readyAt: NOW + 5000 }) }, NOW), 'Next: 10 Pikemen · waiting for a free slot, about 5s');
  assert.equal(nextLine({ on: true, next: next({ building: 'longhouse', level: 14, waiting: 'room', readyAt: null }) }, NOW), 'Next: Longhouse 14 · needs people room');
  assert.equal(nextLine({ on: true, next: next({ kind: 'troops', building: undefined, unit: 'pikeman', count: 10, waiting: 'now', readyAt: NOW }) }, NOW), 'Next: 10 Pikemen · now');
  assert.match(nextLine({ on: true, next: next({ readyAt: NOW - 10 }) }, NOW), /any moment/);
});

test('count down: the wait shrinks as the clock moves', () => {
  const v = { on: true, next: next({ readyAt: NOW + 2 * 3600_000 + 5 * 60_000 }) };
  assert.match(nextLine(v, NOW), /about 2h 5m/);
  assert.match(nextLine(v, NOW + 3600_000), /about 1h 5m/);
});

test('queued line and unit helpers', () => {
  assert.equal(queuedLine({ queuedBuilds: 2, queuedTroops: 1 }), 'Queued by auto: 2 builds · 1 troop batch');
  assert.equal(queuedLine({ queuedBuilds: 1, queuedTroops: 3 }), 'Queued by auto: 1 build · 3 troop batches');
  assert.equal(queuedLine({ queuedBuilds: 0, queuedTroops: 0 }), 'Nothing queued by auto');
  assert.equal(unitPlural('pikeman'), 'Pikemen');
  assert.equal(unitPlural('pikeman', 1), 'Pikeman');
  assert.deepEqual(toggleUnit(['guard'], 'pikeman', ['pikeman', 'guard', 'raider']), ['pikeman', 'guard']);
  assert.deepEqual(toggleUnit(['pikeman', 'guard'], 'pikeman', ['pikeman', 'guard', 'raider']), ['guard']);
  assert.match(whyNotTrainable('raider'), /./);
});

test('the Auto tab sits right after Army (and after Raid lists) only while the world has the premium tools', () => {
  assert.equal(autoTabOn({ features: { premium: true } }), true);
  assert.equal(autoTabOn({ features: { premium: false } }), false);
  assert.equal(autoTabOn(undefined), false);
  const t = navTabs(2, false, true);
  assert.equal(t[t.indexOf('army') + 1], 'auto');
  const both = navTabs(2, true, true);
  assert.deepEqual(both.slice(both.indexOf('army'), both.indexOf('army') + 3), ['army', 'raids', 'auto']);
  assert.ok(!navTabs(2).includes('auto'));
});

test('without the tools every control is off, whatever is picked; a picked unavailable unit can still be un-picked', () => {
  assert.equal(controlsOff(true, false), true);
  assert.equal(controlsOff(false, true), true, 'saving');
  assert.equal(controlsOff(false, false), false);
  assert.equal(chipDisabled(true, false, true, true), true, 'locked: even a trainable picked chip');
  assert.equal(chipDisabled(false, false, false, false), true, 'cannot train, not picked');
  assert.equal(chipDisabled(false, false, false, true), false, 'cannot train but picked: can be removed');
  assert.equal(chipDisabled(false, false, true, false), false);
  assert.match(AUTO_NOT_ENTITLED, /part of Premium\. There is nothing to buy yet\./);
});
