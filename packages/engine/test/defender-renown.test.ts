import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFENDER_RENOWN_DAILY_CAP,
  DEFENDER_RENOWN_PER_DEFENCE,
  UNITS,
  UNIT_IDS,
  collectDefenderRenown,
  createNpcVillage,
  createPlayerVillage,
  defenderEligibleFrom,
  defenderRenownPerDay,
  markDefenceCollected,
  normalizeVillage,
  protectionEndsAt,
  stationedDefence,
} from '../src/index.ts';
import type { VillageState } from '../src/index.ts';
import { HOUR, S1, S10, near, units, village } from './helpers.ts';

const DAY = 24 * HOUR;

/** A settled village at time `t` with these troops at home and `mark` as the last collection. */
function at(t: number, troops: Parameters<typeof units>[0], mark?: { at: number; strength: number }, away: Parameters<typeof units>[0] = {}): VillageState {
  const v = village({ troops, away });
  v.lastUpdate = t;
  if (mark) v.defenceMark = mark;
  else delete v.defenceMark;
  return v;
}

describe('defender Renown', () => {
  it('strength is the average defence of the troops at home; troops away and nothing at all count as 0', () => {
    for (const u of UNIT_IDS) assert.equal(stationedDefence({ [u]: 3 }), 3 * ((UNITS[u].defenseInfantry + UNITS[u].defenseCavalry) / 2));
    assert.equal(stationedDefence({}), 0);
    const home = at(0, { pikeman: 10 }, undefined, { raider: 100, knight: 50 });
    assert.equal(stationedDefence(home.troops), stationedDefence({ pikeman: 10 }), 'away units are not at home');
  });

  it('pays strength x rate per day, capped, and the cap holds', () => {
    near(defenderRenownPerDay(1000), 1000 * DEFENDER_RENOWN_PER_DEFENCE);
    assert.equal(defenderRenownPerDay(10_000_000), DEFENDER_RENOWN_DAILY_CAP);
    assert.equal(defenderRenownPerDay(0), 0);
    assert.equal(defenderRenownPerDay(-1), 0);
    assert.equal(defenderRenownPerDay(Number.NaN), 0);
  });

  it('collects the span since the mark, then moves the mark (nothing is paid twice)', () => {
    const strength = stationedDefence({ pikeman: 100 });
    const v = at(2 * DAY, { pikeman: 100 }, { at: DAY, strength });
    const first = collectDefenderRenown(v, 0, S1);
    near(first.renown, defenderRenownPerDay(strength));
    assert.deepEqual(first.state.defenceMark, { at: 2 * DAY, strength });
    const again = collectDefenderRenown(first.state, 0, S1);
    assert.equal(again.renown, 0);
    assert.equal(v.defenceMark?.at, DAY, 'the input is not changed');
  });

  it('the rate is per day divided by world speed: a fast world pays the same per world day', () => {
    const strength = stationedDefence({ pikeman: 100 });
    const slow = collectDefenderRenown(at(DAY, { pikeman: 100 }, { at: 0, strength }), 0, S1).renown;
    const fast = collectDefenderRenown(at(DAY / 10, { pikeman: 100 }, { at: 0, strength }), 0, S10).renown;
    near(slow, fast);
    // Two real hours at speed 10 are 20 world hours.
    near(collectDefenderRenown(at(2 * HOUR, { pikeman: 100 }, { at: 0, strength }), 0, S10).renown, defenderRenownPerDay(strength) * (20 / 24));
  });

  it('uses the smaller of the strength at the mark and now', () => {
    const big = stationedDefence({ pikeman: 100 });
    const small = stationedDefence({ pikeman: 10 });
    near(collectDefenderRenown(at(DAY, { pikeman: 10 }, { at: 0, strength: big }), 0, S1).renown, defenderRenownPerDay(small));
    near(collectDefenderRenown(at(DAY, { pikeman: 100 }, { at: 0, strength: small }), 0, S1).renown, defenderRenownPerDay(small));
    assert.equal(collectDefenderRenown(at(DAY, {}, { at: 0, strength: big }), 0, S1).renown, 0);
  });

  it('pays nothing before `eligibleFrom` (protection) and only the time after it', () => {
    const strength = stationedDefence({ pikeman: 100 });
    const v = at(DAY, { pikeman: 100 }, { at: 0, strength });
    assert.equal(collectDefenderRenown(v, DAY, S1).renown, 0);
    assert.equal(collectDefenderRenown(v, 2 * DAY, S1).renown, 0);
    near(collectDefenderRenown(v, DAY / 2, S1).renown, defenderRenownPerDay(strength) / 2);
    // The mark still moves while protected, so the protected time is never paid later.
    assert.equal(collectDefenderRenown(v, 2 * DAY, S1).state.defenceMark?.at, DAY);
    // A nonsense time counts as "now": no payment.
    assert.equal(collectDefenderRenown(v, Number.NaN, S1).renown, 0);
  });

  it('the first collection of a village without a mark only sets it; a mark in the future is replaced, never paid', () => {
    const none = collectDefenderRenown(at(DAY, { pikeman: 100 }), 0, S1);
    assert.equal(none.renown, 0);
    assert.deepEqual(none.state.defenceMark, { at: DAY, strength: stationedDefence({ pikeman: 100 }) });
    const future = collectDefenderRenown(at(DAY, { pikeman: 100 }, { at: 2 * DAY, strength: 1e6 }), 0, S1);
    assert.equal(future.renown, 0);
    assert.equal(future.state.defenceMark?.at, 2 * DAY, 'left alone until the clock catches up');
  });

  it('new villages start with a mark at their creation; abandoned villages never earn and carry no mark', () => {
    const fresh = createPlayerVillage(5 * HOUR);
    assert.deepEqual(fresh.defenceMark, { at: 5 * HOUR, strength: 0 });
    const npc = createNpcVillage(3, 0);
    const out = collectDefenderRenown({ ...npc, defenceMark: { at: 0, strength: 1e6 }, lastUpdate: 10 * DAY }, 0, S1);
    assert.equal(out.renown, 0);
    assert.equal(out.state.defenceMark, undefined);
    assert.equal(normalizeVillage({ ...npc, defenceMark: { at: 0, strength: 5 } }).defenceMark, undefined);
    assert.deepEqual(normalizeVillage(at(DAY, {}, { at: 3, strength: 4 })).defenceMark, { at: 3, strength: 4 });
  });

  it('markDefenceCollected moves the mark to now without paying', () => {
    const v = markDefenceCollected(at(DAY, { pikeman: 10 }, { at: 0, strength: 1e6 }));
    assert.deepEqual(v.defenceMark, { at: DAY, strength: stationedDefence({ pikeman: 10 }) });
  });

  it('eligibility starts at the natural end of protection even when the player ended it early', () => {
    const created = 1_000_000;
    const end = protectionEndsAt(created, S1);
    assert.equal(defenderEligibleFrom(end, created, S1), end);
    assert.equal(defenderEligibleFrom(0, created, S1), end, 'ended early by attacking: the protected time still does not count');
    assert.equal(defenderEligibleFrom(end + 5 * HOUR, created, S1), end + 5 * HOUR, 'a longer protection (staff, event) counts');
  });
});
