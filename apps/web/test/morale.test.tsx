// Morale in the client (GAME_DESIGN battle section): the send-form preview line, the report line and the simulator checkbox state.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyUnits } from '@clanfire/engine';
import type { BattleReportData, ReportDto, Units } from '@clanfire/engine';
import { battleInput, draftFromReport, draftFromSend, simulate } from '../src/simulator.ts';
import type { SimSetup } from '../src/simulator.ts';
import { MORALE_HELP, moraleLabel, moraleNow } from '../src/villages.ts';

const units = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });
const player = (ownerPoints: number) => ({ kind: 'player' as const, ownerPoints });
const base = { mission: 'attack' as const, relief: false, chosen: { raider: 10 }, ownPoints: 3000, enabled: true };

test('send form: "Morale 75%" when the owner has under a third of my points, not at exactly a third', () => {
  assert.equal(moraleLabel(moraleNow({ ...base, target: player(999) })), 'Morale 75%');
  assert.equal(moraleLabel(moraleNow({ ...base, target: player(1000) })), null);
  assert.equal(moraleLabel(moraleNow({ ...base, target: player(5000) })), null);
});

test('send form: no morale for abandoned villages, relief, support, scouting-only armies, missing points or a world with the switch off', () => {
  assert.equal(moraleNow({ ...base, target: { kind: 'abandoned', ownerPoints: null } }), 1);
  assert.equal(moraleNow({ ...base, target: { kind: 'own', ownerPoints: 10 } }), 1);
  assert.equal(moraleNow({ ...base, target: player(10), relief: true }), 1);
  assert.equal(moraleNow({ ...base, target: player(10), mission: 'support' }), 1);
  assert.equal(moraleNow({ ...base, target: player(10), chosen: { pathfinder: 5 } }), 1, 'a scouting march');
  assert.equal(moraleNow({ ...base, target: player(10), chosen: { pathfinder: 5, raider: 2 } }), 0.75, 'Pathfinders scout, the rest fights');
  assert.equal(moraleNow({ ...base, target: { kind: 'player' } }), 1, 'owner points unknown');
  assert.equal(moraleNow({ ...base, target: null }), 1);
  assert.equal(moraleNow({ ...base, target: player(10), enabled: false }), 1);
});

test('report line: "Morale 75%" only when the report has it', () => {
  assert.equal(moraleLabel(0.75), 'Morale 75%');
  assert.equal(moraleLabel(null), null);
  assert.equal(moraleLabel(undefined), null);
  assert.equal(moraleLabel(1), null);
  assert.match(MORALE_HELP, /third/);
  assert.ok(renderToStaticMarkup(createElement('p', null, moraleLabel(0.75))).includes('Morale 75%'));
});

const setup = (over: Partial<SimSetup> = {}): SimSetup => ({
  attacker: units({ raider: 100 }),
  defender: units({ pikeman: 10 }),
  support: units({}),
  wall: 0,
  defenderBulwark: 0,
  supportBulwark: 0,
  siegeTarget: null,
  targetLevel: 0,
  ...over,
});

test('simulator: the Morale checkbox makes the attack 75% of the plain one', () => {
  const plain = simulate(setup(), 0).result.attackPower;
  const weak = simulate(setup({ morale: true }), 0).result.attackPower;
  assert.ok(Math.abs(weak - plain * 0.75) < 1e-9);
  assert.equal(battleInput(setup(), 0).moraleFactor, undefined);
  assert.equal(battleInput(setup({ morale: true }), 0).moraleFactor, 0.75);
});

test('simulator draft: the send form and a battle report carry morale over', () => {
  assert.equal(draftFromSend({ raider: 3 }, true).morale, true);
  assert.equal(draftFromSend({ raider: 3 }).morale, undefined);
  const b = { outcome: 'battle', attackerUnits: units({ raider: 5 }), defenderUnits: null, supportUnits: null, wallLevel: 2, morale: 0.75 } as unknown as BattleReportData;
  const r = { type: 'battle', side: 'attack', battle: b } as unknown as ReportDto;
  assert.equal(draftFromReport(r)?.morale, true);
  const plain = { type: 'battle', side: 'attack', battle: { ...b, morale: undefined } } as unknown as ReportDto;
  assert.equal(draftFromReport(plain)?.morale, undefined);
});
