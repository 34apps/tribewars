// Desktop Reports page: chip groups and unread counts, paging, row outcome labels and the carried-of-capacity line.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNITS, emptyUnits } from '@clanfire/engine';
import type { ReportSummaryDto } from '@clanfire/engine';
import {
  attackShare,
  carriedLine,
  carryCapacity,
  filterCounts,
  filterReports,
  pageOf,
  pageSlice,
  paging,
  reportFilterOf,
  rowOutcome,
  tableDensity,
} from '../src/views/reports/frame-reports-logic.ts';

const rep = (id: number, o: Partial<ReportSummaryDto> = {}): ReportSummaryDto => ({
  id,
  createdAt: 1000 - id,
  title: 'Raid on X (1|2)',
  side: 'attack',
  type: 'battle',
  won: true,
  read: true,
  outcome: 'battle',
  ...o,
});

test('every report lands in exactly one chip', () => {
  assert.equal(reportFilterOf(rep(1)), 'battles');
  assert.equal(reportFilterOf(rep(1, { type: 'village' })), 'battles');
  assert.equal(reportFilterOf(rep(1, { type: 'scout' })), 'scouting');
  assert.equal(reportFilterOf(rep(1, { type: 'support', side: 'support' })), 'support');
  assert.equal(reportFilterOf(rep(1, { side: 'support' })), 'support');
  assert.equal(reportFilterOf(rep(1, { type: 'shipment', side: 'shipment' })), 'shipments');
});

test('filter counts: totals and unread per chip, All counts everything', () => {
  const list = [rep(1, { read: false }), rep(2), rep(3, { type: 'scout', read: false }), rep(4, { type: 'shipment', side: 'shipment' }), rep(5, { type: 'scout', read: false })];
  const c = filterCounts(list);
  assert.deepEqual(c.all, { total: 5, unread: 3 });
  assert.deepEqual(c.battles, { total: 2, unread: 1 });
  assert.deepEqual(c.scouting, { total: 2, unread: 2 });
  assert.deepEqual(c.support, { total: 0, unread: 0 });
  assert.deepEqual(c.shipments, { total: 1, unread: 0 });
  assert.deepEqual(filterReports(list, 'scouting').map((r) => r.id), [3, 5]);
  assert.equal(filterReports(list, 'all').length, 5);
});

test('paging: 12 per page, clamped, "1-12 of 47"', () => {
  assert.deepEqual(paging(47, 0), { page: 0, pages: 4, from: 1, to: 12, total: 47 });
  assert.deepEqual(paging(47, 3), { page: 3, pages: 4, from: 37, to: 47, total: 47 });
  assert.equal(paging(47, 99).page, 3);
  assert.equal(paging(47, -2).page, 0);
  assert.deepEqual(paging(0, 0), { page: 0, pages: 1, from: 0, to: 0, total: 0 });
  const list = Array.from({ length: 30 }, (_, i) => rep(i + 1));
  assert.equal(pageSlice(list, 1).length, 12);
  assert.equal(pageSlice(list, 2).length, 6);
  assert.equal(pageSlice(list, 2)[0]?.id, 25);
  assert.equal(pageOf(list, 13), 1);
  assert.equal(pageOf(list, 12), 0);
  assert.equal(pageOf(list, 999), -1);
  assert.equal(pageOf(list, null), -1);
});

test('carried capacity counts only the survivors, with each unit its own carry', () => {
  const sent = { ...emptyUnits(), pikeman: 10, raider: 5 };
  const lost = { ...emptyUnits(), pikeman: 4, raider: 5 };
  assert.equal(carryCapacity(sent, lost), 6 * UNITS.pikeman.carry);
  assert.equal(carryCapacity(sent, emptyUnits()), 10 * UNITS.pikeman.carry + 5 * UNITS.raider.carry);
});

test('carried line: left out without survivors or without loot', () => {
  const sent = { ...emptyUnits(), pikeman: 10 };
  const loot = { wood: 40, food: 30, iron: 20, gold: 10 };
  const cap = 10 * UNITS.pikeman.carry;
  const line = carriedLine({ attackerUnits: sent, attackerLosses: emptyUnits(), loot });
  assert.deepEqual(line, { carried: 100, capacity: cap, ratio: 100 / cap });
  assert.equal(carriedLine({ attackerUnits: sent, attackerLosses: sent, loot }), null);
  assert.equal(carriedLine({ attackerUnits: sent, attackerLosses: emptyUnits(), loot: { wood: 0, food: 0, iron: 0, gold: 0 } }), null);
});

test('attack share of the head-to-head bar', () => {
  assert.ok(Math.abs(attackShare(19860, 11420) - 0.635) < 0.001);
  assert.equal(attackShare(0, 0), 0.5);
  assert.equal(attackShare(5, 0), 1);
});

test('forces table row budget: normal, compact, then "+N more"', () => {
  assert.deepEqual(tableDensity(9), { density: 'normal', shown: 9 });
  assert.deepEqual(tableDensity(13), { density: 'compact', shown: 13 });
  assert.deepEqual(tableDensity(19), { density: 'compact', shown: 14 });
});

test('row outcome labels', () => {
  assert.deepEqual(rowOutcome(rep(1)), { label: 'Won', tone: 'won' });
  assert.deepEqual(rowOutcome(rep(1, { won: false })), { label: 'Lost', tone: 'lost' });
  assert.equal(rowOutcome(rep(1, { type: 'scout' })).label, 'Scouted');
  assert.equal(rowOutcome(rep(1, { type: 'scout', won: false })).label, 'Failed');
  assert.equal(rowOutcome(rep(1, { type: 'scout', side: 'defense' })).label, 'Caught');
  assert.equal(rowOutcome(rep(1, { type: 'shipment', side: 'shipment', title: 'Shipment received from Tolvek (1|2)' })).label, 'Received');
  assert.equal(rowOutcome(rep(1, { type: 'shipment', side: 'shipment', title: 'Shipment delivered to Tolvek (1|2)' })).label, 'Delivered');
  assert.equal(rowOutcome(rep(1, { outcome: 'called_off', won: false })).label, 'Called off');
  assert.equal(rowOutcome(rep(1, { type: 'support', side: 'support' })).label, 'Turned back');
});
