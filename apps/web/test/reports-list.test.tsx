// Reports list helpers: short titles, compact age, Today / Yesterday / Earlier groups.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayGroup, formatShortAgo, groupByDay, reportLine } from '../src/reports.ts';

test('report titles become one short line with the coordinates split off', () => {
  assert.deepEqual(reportLine('Attack from Tolvek (-2|4)'), { text: 'Tolvek attacked', coords: '-2|4' });
  assert.deepEqual(reportLine('Raid on Hillfort (3|-4)'), { text: 'You raided Hillfort', coords: '3|-4' });
  assert.deepEqual(reportLine('Scouting Hillfort (3|-4)'), { text: 'You scouted Hillfort', coords: '3|-4' });
  assert.deepEqual(reportLine('Enemy scouts from Brannoch (1|1)'), { text: 'Scouts from Brannoch', coords: '1|1' });
  assert.equal(reportLine('Your troops at Oak (5|5) were attacked').text, 'Support at Oak attacked');
  assert.equal(reportLine('Support for Oak (5|5) turned back: left the pact').text, 'Support for Oak turned back');
  assert.equal(reportLine('Attack on Oak (5|5) called off: protected').text, 'Attack on Oak called off: protected');
  assert.deepEqual(reportLine('Something else'), { text: 'Something else', coords: null });
});

test("default village names drop the 's village", () => {
  assert.equal(reportLine("Attack from Tolvek's village (1|2)").text, 'Tolvek attacked');
  assert.equal(reportLine("Raid on Abandoned village (1|2)").text, 'You raided Abandoned village');
});

test('compact age', () => {
  const now = 10 * 86_400_000;
  assert.equal(formatShortAgo(now - 10_000, now), 'now');
  assert.equal(formatShortAgo(now - 5 * 60_000, now), '5m');
  assert.equal(formatShortAgo(now - 4 * 3_600_000, now), '4h');
  assert.equal(formatShortAgo(now - 2 * 86_400_000, now), '2d');
});

test('day groups follow the local calendar', () => {
  const now = new Date(2026, 10, 9, 15, 0, 0).getTime();
  assert.equal(dayGroup(new Date(2026, 10, 9, 0, 5).getTime(), now), 'today');
  assert.equal(dayGroup(new Date(2026, 10, 8, 23, 55).getTime(), now), 'yesterday');
  assert.equal(dayGroup(new Date(2026, 10, 8, 0, 0).getTime(), now), 'yesterday');
  assert.equal(dayGroup(new Date(2026, 10, 7, 23, 59).getTime(), now), 'earlier');
  const items = [
    { createdAt: new Date(2026, 10, 7, 10).getTime() },
    { createdAt: new Date(2026, 10, 9, 10).getTime() },
  ];
  assert.deepEqual(groupByDay(items, now).map((g) => [g.group, g.items.length]), [['today', 1], ['earlier', 1]]);
});

// ---- Clear titles: what happened at a glance ----------------------------------------------------------------------------------

import type { ReportSummaryDto } from '@clanfire/engine';
import { reportFigures, reportHeadline, reportResultLine, reportSentence } from '../src/reports.ts';

const summary = (o: Partial<ReportSummaryDto>): ReportSummaryDto => ({
  id: 1,
  createdAt: 1000,
  title: 'Raid on Hillfort (12|-4)',
  side: 'attack',
  type: 'battle',
  won: true,
  read: true,
  outcome: 'battle',
  ...o,
});
const dig = (loot: number, sent: number | null, lost: number | null, again: ReportSummaryDto['digest'] extends infer D ? (D extends { again: infer A } ? A : never) : never = null) => ({ loot, sent, lost, again });
const sentence = (o: Partial<ReportSummaryDto>) => reportSentence(reportHeadline(summary(o)));

test('raid won: loot and losses in the sentence, loot formatted like every number', () => {
  const h = reportHeadline(summary({ digest: dig(1340, 120, 3) }));
  assert.equal(h.title, 'Raided Hillfort');
  assert.equal(h.coords, '12|-4');
  assert.equal(h.loot, 1340);
  assert.equal(reportSentence(h), `Raided Hillfort (12|-4) — won, ${(1340).toLocaleString()} loot, lost 3 of 120`);
  assert.equal(reportFigures(h), `${(1340).toLocaleString()} loot · lost 3 of 120`);
  assert.equal(reportResultLine(h), `Won, ${(1340).toLocaleString()} loot, lost 3 of 120`);
});

test('raid won with nothing to take, and with no losses', () => {
  assert.equal(sentence({ digest: dig(0, 50, 0) }), 'Raided Hillfort (12|-4) — won, nothing taken, no losses');
  assert.equal(sentence({ digest: dig(340, 6, 0) }), 'Raided Hillfort (12|-4) — won, 340 loot, no losses');
});

test('raid lost', () => {
  assert.equal(sentence({ won: false, digest: dig(0, 6, 5) }), 'Raid on Hillfort lost (12|-4) — lost 5 of 6');
});

test('attack called off keeps the reason', () => {
  const t = 'Attack on Oak (5|5) called off: protected';
  assert.equal(sentence({ title: t, outcome: 'called_off', won: false, digest: dig(0, null, null) }), 'Attack on Oak called off (5|5) — protected');
  assert.equal(sentence({ title: 'Attack on Oak (5|5) called off', outcome: 'called_off', won: false, digest: dig(0, null, null) }), 'Attack on Oak called off (5|5) — no losses, no loot');
});

test('defence: held and lost', () => {
  const base = { side: 'defense' as const, title: "Attack from Tolvek's village (1|2)" };
  assert.equal(sentence({ ...base, digest: dig(0, 80, 12) }), 'Tolvek attacked you (1|2) — held, lost 12');
  assert.equal(sentence({ ...base, won: false, digest: dig(340, 80, 80) }), 'Tolvek attacked you (1|2) — lost, they took 340');
  assert.equal(sentence({ ...base, won: false, digest: dig(0, 80, 80) }), 'Tolvek attacked you (1|2) — lost, nothing taken');
});

test('support troops that were attacked, and support that turned back', () => {
  assert.equal(sentence({ side: 'support', title: 'Your troops at Oak (5|5) were attacked', digest: dig(0, 30, 4) }), 'Support at Oak attacked (5|5) — held, lost 4');
  assert.equal(sentence({ side: 'support', won: false, title: 'Your troops at Oak (5|5) were attacked', digest: dig(0, 30, 30) }), 'Support at Oak attacked (5|5) — overrun, lost 30');
  assert.equal(sentence({ type: 'support', side: 'support', won: false, title: 'Support for Oak (5|5) turned back: left the pact', digest: dig(0, null, null) }), 'Support for Oak turned back (5|5) — left the pact');
});

test('scouting: seen, caught, and the other side', () => {
  const scout = { type: 'scout' as const, title: 'Scouting Hillfort (12|-4)' };
  assert.equal(sentence({ ...scout, digest: dig(0, 5, 0) }), 'Scouted Hillfort (12|-4) — seen');
  assert.equal(sentence({ ...scout, digest: dig(0, 5, 1) }), 'Scouted Hillfort (12|-4) — seen, lost 1 of 5');
  assert.equal(sentence({ ...scout, won: false, digest: dig(0, 5, 4) }), 'Scouts caught at Hillfort (12|-4) — lost 4 of 5');
  assert.equal(sentence({ type: 'scout', side: 'defense', title: 'Enemy scouts from Brannoch (1|1)', digest: dig(0, 6, 5) }), 'Scouts from Brannoch (1|1) — caught');
  assert.equal(sentence({ type: 'scout', side: 'defense', won: false, title: 'Enemy scouts from Brannoch (1|1)', digest: dig(0, 6, 0) }), 'Scouts from Brannoch (1|1) — not caught');
});

test('reports without a digest (old server, shipments, village events) keep the old line', () => {
  for (const o of [
    {},
    { won: false },
    { side: 'defense' as const, title: 'Attack from Tolvek (-2|4)' },
    { type: 'scout' as const, title: 'Scouting Hillfort (3|-4)' },
    { type: 'shipment' as const, side: 'shipment' as const, title: 'Shipment received from Tolvek (1|2)' },
  ]) {
    const r = summary(o);
    const line = reportLine(r.title);
    assert.deepEqual(reportHeadline(r), { title: line.text, coords: line.coords, outcome: null, figures: [], loot: null });
  }
  assert.equal(reportSentence(reportHeadline(summary({}))), 'You raided Hillfort (12|-4)');
  // A digest on a shipment or village event is ignored too.
  assert.equal(reportHeadline(summary({ type: 'village', title: 'Strike on Oak (1|2)', digest: dig(0, null, null) })).outcome, null);
});

test('odd titles with a digest fall back instead of breaking', () => {
  assert.equal(reportHeadline(summary({ title: 'Something else', digest: dig(5, 5, 5) })).title, 'Something else');
  assert.equal(reportHeadline(summary({ side: 'defense', title: 'Weird', digest: dig(5, 5, 5) })).title, 'Weird');
});
