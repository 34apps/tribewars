// The Auto mode page: the plain-words pieces (status line, progress, goal helpers), the tab rule and the greyed state without the tools.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AutoNextDto } from '@clanfire/engine';
import {
  AUTO_NOT_ENTITLED,
  addableBuildings,
  autoTabOn,
  cleanGoals,
  controlsOff,
  goalCount,
  nextLine,
  parseTroopGoal,
  progressPct,
  progressText,
  queuedLine,
  startGoalLevel,
  stepLevel,
  unitPlural,
} from '../src/auto.ts';
import { navTabs } from '../src/game.ts';

const NOW = 1_000_000;
const next = (o: Partial<AutoNextDto>): AutoNextDto => ({ kind: 'build', building: 'storehouse', level: 10, waiting: 'resources', readyAt: NOW + 40 * 60_000, ...o });
const on = (n: AutoNextDto | null, status: 'working' | 'empty' | 'reached' | 'blocked' = 'working') => ({ on: true, status, next: n });

test('status line words each state; "Off" is only on the switch', () => {
  assert.equal(nextLine({ on: false, status: 'working', next: null }, NOW), 'Switch on to work toward your goals');
  assert.equal(nextLine({ on: false, status: 'empty', next: null }, NOW), 'Add a goal to begin');
  assert.equal(nextLine(on(null, 'empty'), NOW), 'Add a goal to begin');
  assert.equal(nextLine(on(null, 'reached'), NOW), 'All goals reached');
  assert.match(nextLine(on(null, 'blocked'), NOW), /research/);
  assert.equal(nextLine(on(next({})), NOW), 'Next: Storehouse 10 · waiting for resources, about 40m');
  assert.equal(nextLine(on(next({ readyAt: null })), NOW), 'Next: Storehouse 10 · waiting for resources');
  assert.equal(nextLine(on(next({ kind: 'troops', building: undefined, unit: 'pikeman', count: 10, waiting: 'slot', readyAt: NOW + 5000 })), NOW), 'Next: 10 Pikemen · waiting for the queue, about 5s');
  assert.equal(nextLine(on(next({ building: 'longhouse', level: 14, waiting: 'room', readyAt: null })), NOW), 'Next: Longhouse 14 · needs people room');
  assert.equal(nextLine(on(next({ building: 'wall', level: 1, waiting: 'requirement', readyAt: null })), NOW), 'Next: Wall 1 · waiting for a building it needs');
  assert.equal(nextLine(on(next({ kind: 'troops', building: undefined, unit: 'pikeman', count: 10, waiting: 'now', readyAt: NOW })), NOW), 'Next: 10 Pikemen · now');
  assert.match(nextLine(on(next({ readyAt: NOW - 10 })), NOW), /any moment/);
});

test('count down: the wait shrinks as the clock moves', () => {
  const v = on(next({ readyAt: NOW + 2 * 3600_000 + 5 * 60_000 }));
  assert.match(nextLine(v, NOW), /about 2h 5m/);
  assert.match(nextLine(v, NOW + 3600_000), /about 1h 5m/);
});

test('queued line and unit names', () => {
  assert.equal(queuedLine({ queuedBuilds: 2, queuedTroops: 1 }), 'Queued by auto: 2 builds · 1 troop batch');
  assert.equal(queuedLine({ queuedBuilds: 0, queuedTroops: 0 }), 'Nothing queued by auto');
  assert.equal(unitPlural('pikeman'), 'Pikemen');
  assert.equal(unitPlural('pikeman', 1), 'Pikeman');
});

test('progress bar numbers', () => {
  assert.equal(progressPct(50, 100), 50);
  assert.equal(progressPct(150, 100), 100);
  assert.equal(progressPct(0, 100), 0);
  assert.equal(progressPct(3, 0), 100);
  assert.equal(progressText(1200, 3000), '1,200 / 3,000');
});

test('goal helpers: amounts, level steps, the add list, clean-up', () => {
  assert.equal(parseTroopGoal(''), 0);
  assert.equal(parseTroopGoal('3000'), 3000);
  assert.equal(parseTroopGoal('12ab3'), 123);
  assert.equal(parseTroopGoal('999999'), 100000);
  assert.equal(stepLevel('wall', 1, -1), 1);
  assert.equal(stepLevel('wall', 3, 1), 4);
  assert.equal(startGoalLevel('wall', 0), 1);
  assert.equal(startGoalLevel('wall', 4), 5);
  assert.ok(!addableBuildings({ wall: 3 }).includes('wall'));
  assert.ok(addableBuildings({ wall: 3 }).includes('hall'));
  assert.deepEqual(cleanGoals({ pikeman: 0, raider: 4 }), { raider: 4 });
  assert.equal(goalCount({ troopGoals: { pikeman: 5 }, buildingGoals: { wall: 2, hall: 0 } }), 2);
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

test('without the tools every control is off', () => {
  assert.equal(controlsOff(true, false), true);
  assert.equal(controlsOff(false, true), true);
  assert.equal(controlsOff(false, false), false);
  assert.match(AUTO_NOT_ENTITLED, /part of Premium\. There is nothing to buy yet\./);
});
