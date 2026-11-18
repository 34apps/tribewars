// One report per attack: the Pathfinders' part rides inside the battle report (BattleReportData.scouting).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyUnits, emptyResources } from '@clanfire/engine';
import type { BattleReportData, BattleScouting, ReportSummaryDto } from '@clanfire/engine';
import { filterCounts, reportFilterOf, scoutResultText } from '../src/views/reports/frame-reports-logic.ts';
import { reportHeadline } from '../src/reports.ts';
import { draftFromReport } from '../src/simulator.ts';

const ref = (id: number, name: string) => ({ villageId: id, name, x: 1, y: 2, ownerId: id, ownerName: name });
const battle = (scouting?: BattleScouting): BattleReportData => ({
  outcome: 'battle',
  attacker: ref(1, 'Me'),
  defender: ref(2, 'Sable'),
  attackerWon: true,
  luck: 0,
  attackPower: 10,
  defensePower: 5,
  attackerUnits: { ...emptyUnits(), raider: 100 },
  attackerLosses: { ...emptyUnits(), raider: 4 },
  defenderUnits: { ...emptyUnits(), pikeman: 3 },
  defenderLosses: { ...emptyUnits(), pikeman: 3 },
  supportUnits: null,
  supportLosses: null,
  wallLevel: 0,
  loot: emptyResources(),
  ...(scouting ? { scouting } : {}),
});
const failed: BattleScouting = { sent: 65, lost: 65, success: false, defenderScouts: null, defenderScoutsLost: 0, intel: null };

test('a battle report with scouts is one list row, in the battles chip, and still a plain battle for old reports', () => {
  const row: ReportSummaryDto = { id: 1, createdAt: 5, title: 'Raid on Sable (1|2)', side: 'attack', type: 'battle', won: true, read: false, outcome: 'battle', digest: { loot: 0, sent: 165, lost: 69, again: null } };
  assert.equal(reportFilterOf(row), 'battles');
  assert.deepEqual(filterCounts([row]).all, { total: 1, unread: 1 });
  assert.equal(reportHeadline(row).title, 'Raided Sable');
  assert.ok(reportHeadline(row).figures.includes('lost 69 of 165'), 'the scouts count in sent and lost');
  assert.equal(battle().scouting, undefined);
});

test('the scouts section: the sender sees the failure; the defender sees the caught scouts', () => {
  assert.equal(scoutResultText(true, { success: false, scoutsSent: 65 }), 'Scouting failed: all scouts caught.');
  assert.equal(scoutResultText(true, { success: true, scoutsSent: 65 }), 'Scouting succeeded.');
  assert.equal(scoutResultText(false, { success: false, scoutsSent: 65 }), '65 enemy scouts caught.');
  assert.equal(scoutResultText(false, { success: true, scoutsSent: 65 }), '65 enemy scouts escaped.');
});

test('the simulator draft of a battle with scouts still comes from the battle', () => {
  const draft = draftFromReport({ id: 1, createdAt: 1, title: 'x', side: 'attack', type: 'battle', won: true, read: true, outcome: 'battle', battle: battle(failed), scout: null, support: null, shipment: null, village: null });
  assert.equal(draft?.attacker?.raider, 100);
});
