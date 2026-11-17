// Attack form hint ("You need N troops"): the verdict and the Raiders needed come from the REAL battle (`simulate`), at the unlucky end.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BATTLE_LUCK, emptyUnits, normalizeUnits } from '@clanfire/engine';
import type { Units, VillageIntelDto } from '@clanfire/engine';
import { formatInt } from '../src/format.ts';
import { HINT_CAVEAT, MORE_RAIDERS_CAP, attackHint, attackHintText, raidersToWin, reportAge } from '../src/attackHint.ts';
import type { AttackHintInput } from '../src/attackHint.ts';
import { AttackHintView, hintTarget } from '../src/components/hintViews.tsx';
import { simulate } from '../src/simulator.ts';
import type { SimSetup } from '../src/simulator.ts';

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;
const units = (u: Partial<Units>): Units => normalizeUnits(u);
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const intel = (over: Partial<VillageIntelDto> = {}): VillageIntelDto => ({
  at: NOW - 3 * HOUR,
  source: 'scout',
  troops: units({ pikeman: 1000 }),
  troopsApprox: false,
  wallLevel: 5,
  ...over,
});
const input = (over: Partial<AttackHintInput> = {}): AttackHintInput => ({ intel: intel(), attacker: units({ raider: 100 }), now: NOW, abandoned: false, ...over });

/** The same fight as the hint builds, by hand, with `n` Raiders. */
const setupFor = (i: VillageIntelDto, n: number, abandoned = false): SimSetup => ({
  attacker: units({ raider: n }),
  defender: i.troops ?? emptyUnits(),
  support: emptyUnits(),
  wall: i.wallLevel ?? 0,
  defenderBulwark: 0,
  supportBulwark: 0,
  siegeTarget: null,
  targetLevel: 0,
  morale: false,
  abandoned,
});
const winsAt = (i: VillageIntelDto, n: number, luck: number, abandoned = false) => simulate(setupFor(i, n, abandoned), luck).result.attackerWon;
/** Independent search (plain linear-then-binary, not the code under test): fewest Raiders that win at this luck. */
function minRaiders(i: VillageIntelDto, luck: number, abandoned = false): number {
  let hi = 1;
  while (!winsAt(i, hi, luck, abandoned)) hi *= 2;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (winsAt(i, mid, luck, abandoned)) hi = mid;
    else lo = mid;
  }
  return hi;
}
/** A defender (pikemen behind a Wall) that needs about `target` Raiders at bad luck. */
function defenderNeeding(target: number): VillageIntelDto {
  let pikes = 1000;
  for (let k = 0; k < 6; k++) {
    pikes = Math.max(1, Math.round((pikes * target) / minRaiders(intel({ troops: units({ pikeman: pikes }) }), -BATTLE_LUCK)));
  }
  return intel({ troops: units({ pikeman: pikes }) });
}

test('regression: 2,667 Raiders against a village that needs about 3,955 would lose and the hint says how many more', () => {
  const i = defenderNeeding(3955);
  const need = minRaiders(i, -BATTLE_LUCK);
  assert.ok(Math.abs(need - 3955) <= 40, `scenario needs about 3,955 Raiders at bad luck, got ${need}`);
  assert.equal(winsAt(i, need, -BATTLE_LUCK), true);
  assert.equal(winsAt(i, need - 1, -BATTLE_LUCK), false, 'one fewer does not win');
  const h = attackHint(input({ intel: i, attacker: units({ raider: 2667 }) }));
  assert.equal(h.kind, 'estimate');
  assert.equal(h.verdict, 'lose');
  assert.ok(h.moreRaiders !== null && Math.abs(h.moreRaiders - (need - 2667)) <= 1, `more Raiders ${h.moreRaiders} vs ${need - 2667}`);
  assert.equal(winsAt(i, 2667 + (h.moreRaiders ?? 0), -BATTLE_LUCK), true, 'the answer really wins at bad luck');
  const t = attackHintText(h, NOW);
  assert.equal(t.tag?.label, 'Would lose');
  assert.equal(t.tag?.tone, 'bad');
  const all = t.lines.join(' ');
  assert.ok(all.includes(`About ${formatInt(h.moreRaiders!)} more Raiders needed.`), all);
  assert.ok(all.includes(HINT_CAVEAT));
});

test('verdicts: wins at the unlucky end = Should win; wins only at even or better = Close; loses at even = Would lose', () => {
  const i = intel();
  const bad = minRaiders(i, -BATTLE_LUCK);
  const even = minRaiders(i, 0);
  assert.ok(even < bad, 'bad luck needs more Raiders than even luck');
  const at = (n: number) => attackHint(input({ attacker: units({ raider: n }) }));
  assert.equal(at(bad).verdict, 'win');
  assert.equal(at(bad).moreRaiders, null, 'a safe win needs nothing more');
  assert.equal(at(bad - 1).verdict, 'close');
  assert.equal(at(bad - 1).moreRaiders, 1);
  assert.equal(at(even).verdict, 'close');
  assert.equal(at(even - 1).verdict, 'lose');
  assert.equal(at(even - 1).moreRaiders, bad - (even - 1));
  assert.equal(attackHintText(at(bad), NOW).tag?.tone, 'ok');
  assert.equal(attackHintText(at(bad - 1), NOW).tag?.label, 'Close: could go either way');
});

test('own losses: "about N%" rounded to 5, from the even-luck fight', () => {
  const i = intel();
  const n = minRaiders(i, -BATTLE_LUCK) * 2;
  const h = attackHint(input({ attacker: units({ raider: n }) }));
  assert.equal(h.verdict, 'win');
  const out = simulate(setupFor(i, n), 0).result;
  const share = (out.attackerLosses.raider / n) * 100;
  assert.equal(h.lossesPct, Math.round(share / 5) * 5);
  assert.equal(h.lossesPct! % 5, 0);
  assert.ok(attackHintText(h, NOW).lines[0]!.startsWith('About '), 'a win says "About N% of your troops lost."');
  const lost = attackHint(input({ attacker: units({ raider: 3 }) }));
  assert.equal(lost.verdict, 'lose');
  assert.ok(attackHintText(lost, NOW).lines[0]!.startsWith('You would lose about '));
});

test('no army picked yet: the Raiders needed from zero, no verdict', () => {
  const i = intel();
  const h = attackHint(input({ attacker: emptyUnits() }));
  assert.equal(h.verdict, null);
  assert.equal(h.lossesPct, null);
  assert.equal(h.moreRaiders, minRaiders(i, -BATTLE_LUCK));
  const t = attackHintText(h, NOW);
  assert.equal(t.tag, null);
  assert.ok(t.lines.join(' ').includes('Raiders needed.') && !t.lines.join(' ').includes('more Raiders'));
});

test('abandoned village: no militia (the simulator\'s abandoned switch), so an empty one with a Wall falls to a single Raider', () => {
  const empty = intel({ troops: emptyUnits(), wallLevel: 10 });
  const town = attackHint(input({ intel: empty, attacker: units({ raider: 1 }), abandoned: false }));
  assert.equal(town.verdict, 'lose', 'a player village defends with its Wall militia');
  const ruin = attackHint(input({ intel: empty, attacker: units({ raider: 1 }), abandoned: true }));
  assert.equal(ruin.verdict, 'win');
  assert.equal(ruin.moreRaiders, null);
  // With troops left in it the Wall bonus still counts, and the number matches the engine fight with the abandoned flag.
  const left = intel({ troops: units({ pikeman: 400 }), wallLevel: 6 });
  const h = attackHint(input({ intel: left, attacker: units({ raider: 10 }), abandoned: true }));
  assert.equal(h.moreRaiders, minRaiders(left, -BATTLE_LUCK, true) - 10);
});

test('morale goes into the same fight', () => {
  const i = intel();
  const plain = attackHint(input({ attacker: units({ raider: 10 }) })).moreRaiders!;
  const morale = attackHint(input({ attacker: units({ raider: 10 }), morale: 0.75 })).moreRaiders!;
  assert.ok(morale > plain, 'morale weakens the attacker, so more Raiders are needed');
  const direct = simulate({ ...setupFor(i, 10 + morale), morale: true }, -BATTLE_LUCK).result.attackerWon;
  assert.equal(direct, true);
});

test('Raiders beyond what is at home are still named, with how many are at home; an impossible gap says "more than the cap"', () => {
  const i = defenderNeeding(500);
  const small = attackHint(input({ intel: i, attacker: units({ raider: 10 }), spareRaiders: 20 }));
  assert.equal(small.verdict, 'lose');
  assert.ok(small.moreRaiders !== null && small.moreRaiders > 20, 'asks for hundreds although only 20 are spare: the gap is still the useful number');
  assert.equal(small.raidersAtHome, 20);
  assert.ok(attackHintText(small, NOW).lines.join(' ').includes('(20 more at home)'));
  assert.equal(small.moreRaidersOver, false);
  const huge = attackHint(input({ intel: intel({ troops: units({ pikeman: 1_000_000 }) }), attacker: units({ raider: 10 }) }));
  assert.equal(huge.moreRaiders, null);
  assert.equal(huge.moreRaidersOver, true);
  assert.ok(attackHintText(huge, NOW).lines.join(' ').includes(`More than ${MORE_RAIDERS_CAP.toLocaleString('en-US')} more Raiders needed.`));
});

test('raidersToWin: 0 when the army already wins at bad luck, otherwise the exact smallest number', () => {
  const i = intel();
  const need = minRaiders(i, -BATTLE_LUCK);
  assert.equal(raidersToWin(setupFor(i, need)), 0);
  assert.equal(raidersToWin(setupFor(i, 0)), need);
  assert.equal(raidersToWin(setupFor(i, 5)), need - 5);
  assert.equal(raidersToWin(setupFor(intel({ troops: units({ pikeman: 5000 }) }), 0), undefined, 100), null, 'a low cap gives up');
});

test('no report: "Scout first"; a scout without a troop count says to scout again with a higher Keen rank', () => {
  const none = attackHint(input({ intel: { at: null, source: null, troops: null, troopsApprox: false, wallLevel: null } }));
  assert.equal(none.kind, 'none');
  assert.deepEqual(attackHintText(none, NOW).lines, ['Scout first to see what you need.']);
  const blind = attackHint(input({ intel: intel({ troops: null }) }));
  assert.equal(blind.kind, 'blind');
  const t = attackHintText(blind, NOW);
  assert.ok(t.lines[0]!.includes('could not count the troops') && t.lines[0]!.includes('higher Keen rank'));
  assert.ok(t.lines.join(' ').includes('Scouted 3h ago'));
  assert.equal(attackHint(input({ intel: null })).kind, 'none');
});

test('the report is dated, flagged as an estimate, and says when counts were rounded or the Wall is unknown', () => {
  const t = attackHintText(attackHint(input({ intel: intel({ troopsApprox: true, wallLevel: null }) })), NOW);
  const all = t.lines.join(' ');
  assert.ok(all.includes('Scouted 3h ago'));
  assert.ok(all.includes('troops were rounded'));
  assert.ok(all.includes('Wall level unknown'));
  assert.ok(all.includes('Estimate from old information'));
  assert.ok(all.includes('The real battle may go differently.'));
  const battle = attackHint(input({ intel: intel({ source: 'battle', at: NOW - 2 * 86_400_000 }) }));
  assert.equal(reportAge(battle, NOW), 'from a battle 2 days ago');
  assert.equal(reportAge(attackHint(input({ intel: intel() })), NOW), 'scouted 3h ago');
  assert.ok(t.lines.length <= 4, 'three or four short lines at most');
});

test('a wall level over the maximum or an unknown one does not break the fight', () => {
  const h = attackHint(input({ intel: intel({ wallLevel: 9999 }) }));
  assert.equal(h.kind, 'estimate');
  assert.ok(h.verdict !== null);
});

test('hintTarget: players that can be hit and abandoned villages with defenders only', () => {
  assert.equal(hintTarget({ id: 5, kind: 'player', protected: false }), true);
  assert.equal(hintTarget({ id: 5, kind: 'player', protected: true }), false);
  assert.equal(hintTarget({ id: 5, kind: 'own', protected: false }), false);
  assert.equal(hintTarget({ id: 5, kind: 'abandoned', protected: false }), false, 'an empty abandoned village needs no troop count');
  assert.equal(hintTarget({ id: 5, kind: 'abandoned', protected: false, defended: true }), true);
  assert.equal(hintTarget({ id: 0, kind: 'player', protected: false }), false);
  assert.equal(hintTarget(null), false);
});

test('the hint renders as a filled tag and short lines', () => {
  const h = attackHint(input({ attacker: units({ raider: 3 }) }));
  const html = renderToStaticMarkup(createElement(AttackHintView, { hint: h, now: NOW }));
  assert.ok(html.includes('tag-bad'));
  const s = text(html);
  assert.ok(s.includes('Would lose') && s.includes('more Raiders needed') && s.includes('Estimate from old information'));
});
