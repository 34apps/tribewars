import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOLD_FAIL_HOURS,
  HOLD_HOURS,
  HOLD_HOURS_ABANDONED,
  HOLD_MIN_POPULATION,
  STRIKE_CHAIN_WINDOW_HOURS,
  STRIKE_LOCK_HOURS,
  TAKE_KEEP_RESOURCE_SHARE,
  applyBuild,
  applyOwnerChange,
  applyStrike,
  applyTrain,
  chainedChieftains,
  checkBuild,
  checkStrike,
  checkTrain,
  chieftainsNeeded,
  cloneVillage,
  createNpcVillage,
  holdDueAt,
  isStrikeBlocked,
  normalizeVillage,
  occupierPopulation,
  populationCap,
  populationUsage,
  settleVillage,
  storageCap,
  strikeChainWindowMs,
  updateHold,
} from '../src/index.ts';
import type { HearthState, VillageState } from '../src/index.ts';
import { HOUR, S1, S10, deepFreeze, units, village } from './helpers.ts';

const T = 1_000_000;
const WON = { attackerWon: true };
const abandonedTarget = { abandoned: true, points: 0, now: T };
const struck = (occupiers = units({ chieftain: 1 }), s = S1): VillageState =>
  applyStrike(createNpcVillage(2, 0, 99), { claimBy: 7, now: T, settings: s, occupiers });
const out = (over: Partial<HearthState> = {}): HearthState => ({
  status: 'out',
  claimBy: 7,
  outAt: T,
  holdMs: 6 * HOUR,
  runningSince: T,
  underSince: null,
  ...over,
});

describe('checkStrike', () => {
  it('abandoned village: one surviving Chieftain after a won battle', () => {
    const c = checkStrike(WON, units({ chieftain: 1, raider: 5 }), abandonedTarget);
    assert.deepEqual(c, { ok: true, need: 1, chieftains: 1, banked: 0 });
  });

  it('no Strike after a lost battle, or without a surviving Chieftain', () => {
    const lost = checkStrike({ attackerWon: false }, units({ chieftain: 1 }), abandonedTarget);
    assert.ok(!lost.ok && lost.reason === 'lost');
    const none = checkStrike(WON, units({ raider: 30 }), abandonedTarget);
    assert.ok(!none.ok && none.reason === 'too_few_chieftains' && none.need === 1 && none.chieftains === 0);
  });

  it('a lock blocks the Strike until its exact end (a tie at lockUntil is allowed); protection too', () => {
    const t = { ...abandonedTarget, lockUntil: T + 5 };
    const s = units({ chieftain: 1 });
    assert.ok(!checkStrike(WON, s, { ...t, now: T + 4 }).ok);
    assert.equal((checkStrike(WON, s, { ...t, now: T + 4 }) as { reason: string }).reason, 'locked');
    assert.ok(checkStrike(WON, s, { ...t, now: T + 5 }).ok);
    const p = checkStrike(WON, s, { ...abandonedTarget, protectedUntil: T + 1 });
    assert.ok(!p.ok && p.reason === 'protected');
    assert.ok(isStrikeBlocked({ lockUntil: T + 5 }, T + 4));
    assert.ok(!isStrikeBlocked({ lockUntil: T + 5 }, T + 5));
    assert.ok(!isStrikeBlocked({}, T));
  });

  it('players: need = 1 + floor(points / 4000), at most 3 (on by default since step 4, can be switched off)', () => {
    assert.deepEqual([0, 3999, 4000, 7999, 8000, 12000, 30000].map((p) => chieftainsNeeded(false, p)), [1, 1, 2, 2, 3, 3, 3]);
    assert.equal(chieftainsNeeded(true, 50000), 1);
    const target = { abandoned: false, points: 4000, now: T };
    assert.ok(checkStrike(WON, units({ chieftain: 3 }), target).ok, 'player villages can be struck by default');
    const off = checkStrike(WON, units({ chieftain: 3 }), target, { playersEnabled: false });
    assert.ok(!off.ok && off.reason === 'players_disabled');
    const opts = { playersEnabled: true };
    const one = checkStrike(WON, units({ chieftain: 1 }), target, opts);
    assert.ok(!one.ok && one.reason === 'too_few_chieftains' && one.need === 2);
    assert.deepEqual(checkStrike(WON, units({ chieftain: 2 }), target, opts), { ok: true, need: 2, chieftains: 2, banked: 0 });
    const big = { ...target, points: 9000 };
    assert.ok(!checkStrike(WON, units({ chieftain: 2 }), big, opts).ok);
    assert.ok(checkStrike(WON, units({ chieftain: 3 }), big, opts).ok);
  });
});

describe('applyStrike', () => {
  it('puts the hearth out with the abandoned hold time; a lone Chieftain is under the minimum', () => {
    const v = struck();
    assert.deepEqual(v.hearth, { status: 'out', claimBy: 7, outAt: T, holdMs: HOLD_HOURS_ABANDONED * HOUR, runningSince: null, underSince: T });
    assert.equal(v.lastUpdate, T);
  });

  it('starts the clock at once with 150 population of occupiers; speed divides the hold', () => {
    const v = struck(units({ chieftain: 1, raider: HOLD_MIN_POPULATION }), S10);
    assert.equal(v.hearth?.holdMs, (HOLD_HOURS_ABANDONED * HOUR) / 10);
    assert.equal(v.hearth?.runningSince, T);
    assert.equal(v.hearth?.underSince, null);
  });

  it('149 population is not enough, 150 is; units count by their population', () => {
    assert.equal(occupierPopulation(units({ raider: 149 })), 149);
    assert.equal(occupierPopulation(units({ knight: 2, outrider: 1, chieftain: 1 })), 8 + 2 + 8);
    assert.equal(struck(units({ raider: 149 })).hearth?.runningSince, null);
    assert.equal(struck(units({ raider: 150 })).hearth?.runningSince, T);
  });

  it('player villages hold 8 h (abandoned 2 h); a second claimant replaces the first; the input is not changed', () => {
    const p = deepFreeze(village());
    const v = applyStrike(p, { claimBy: 3, now: 5, settings: S1 });
    assert.equal(v.hearth?.holdMs, HOLD_HOURS * HOUR);
    assert.equal([HOLD_HOURS, HOLD_HOURS_ABANDONED].join('/'), '8/2');
    const again = applyStrike(v, { claimBy: 8, now: 10, settings: S1 });
    assert.equal(again.hearth?.claimBy, 8);
    assert.equal(v.hearth?.claimBy, 3);
  });
});

describe('hold clock', () => {
  it('runs only while occupiers stay at the minimum and keeps the exact remaining time', () => {
    const a = updateHold(out(), 200, T + 2 * HOUR, S1);
    assert.equal(a.outcome, 'running');
    assert.deepEqual(a.hearth, out({ holdMs: 4 * HOUR, runningSince: T + 2 * HOUR }));
    // occupiers fall under 150: pause with 4 h left
    const b = updateHold(a.hearth!, 100, T + 2 * HOUR + 1000, S1);
    assert.equal(b.outcome, 'paused');
    assert.deepEqual([b.hearth?.holdMs, b.hearth?.runningSince, b.hearth?.underSince], [4 * HOUR - 1000, null, T + 2 * HOUR + 1000]);
    // 90 minutes later reinforcements arrive: runs again, nothing was lost while paused
    const at = T + 2 * HOUR + 1000 + 1.5 * HOUR;
    const c = updateHold(b.hearth!, 160, at, S1);
    assert.equal(c.outcome, 'running');
    assert.deepEqual([c.hearth?.holdMs, c.hearth?.runningSince, c.hearth?.underSince], [4 * HOUR - 1000, at, null]);
    assert.equal(holdDueAt(c.hearth!, S1), at + 4 * HOUR - 1000);
  });

  it('ends exactly when the clock reaches zero; one ms earlier it is still running', () => {
    const h = out();
    const early = updateHold(h, 200, T + 6 * HOUR - 1, S1);
    assert.equal(early.outcome, 'running');
    assert.equal(early.hearth?.holdMs, 1);
    assert.deepEqual(updateHold(h, 200, T + 6 * HOUR, S1), { hearth: null, outcome: 'taken', at: T + 6 * HOUR });
    assert.equal(holdDueAt(h, S1), T + 6 * HOUR);
    // late call: the end time is still the exact one
    assert.deepEqual(updateHold(h, 200, T + 9 * HOUR, S1), { hearth: null, outcome: 'taken', at: T + 6 * HOUR });
  });

  it('a drop at the very moment the clock ends does not save the defender (the end wins the tie)', () => {
    assert.equal(updateHold(out(), 10, T + 6 * HOUR, S1).outcome, 'taken');
  });

  it('claim fails after HOLD_FAIL_HOURS under the minimum, exactly; reinforcements before that save it', () => {
    const h = out({ runningSince: null, underSince: T });
    assert.equal(holdDueAt(h, S1), T + HOLD_FAIL_HOURS * HOUR);
    const near = updateHold(h, 100, T + HOLD_FAIL_HOURS * HOUR - 1, S1);
    assert.equal(near.outcome, 'paused');
    assert.deepEqual(updateHold(h, 100, T + HOLD_FAIL_HOURS * HOUR, S1), { hearth: null, outcome: 'failed', at: T + HOLD_FAIL_HOURS * HOUR });
    // reinforcements exactly at the deadline are too late (tie goes to the end), one ms earlier they save it
    assert.equal(updateHold(h, 300, T + HOLD_FAIL_HOURS * HOUR, S1).outcome, 'failed');
    assert.equal(updateHold(h, 300, T + HOLD_FAIL_HOURS * HOUR - 1, S1).outcome, 'running');
    // faster world, shorter wait
    assert.equal(holdDueAt(h, S10), T + (HOLD_FAIL_HOURS * HOUR) / 10);
  });

  it('the under-minimum timer restarts each time the clock stops', () => {
    const running = out();
    const p1 = updateHold(running, 100, T + HOUR, S1).hearth!;
    const r = updateHold(p1, 200, T + 1.5 * HOUR, S1).hearth!;
    assert.equal(r.underSince, null);
    const p2 = updateHold(r, 100, T + 2 * HOUR, S1).hearth!;
    assert.equal(p2.underSince, T + 2 * HOUR);
    // total paused time was over 2 h in two pieces, but never 2 h in a row: still alive
    assert.equal(updateHold(p2, 100, T + 3.9 * HOUR, S1).outcome, 'paused');
  });

  it('relights at once when the occupiers are all dead (running or paused)', () => {
    assert.deepEqual(updateHold(out(), 0, T + 10, S1), { hearth: null, outcome: 'relit', at: T + 10 });
    assert.equal(updateHold(out({ runningSince: null, underSince: T }), 0, T + 10, S1).outcome, 'relit');
  });

  it('does not mutate its input and survives a clock that went backwards', () => {
    const h = deepFreeze(out());
    const r = updateHold(h, 200, T - 5, S1);
    assert.equal(r.outcome, 'running');
    assert.equal(r.hearth?.holdMs, 6 * HOUR);
  });
});

describe('applyOwnerChange', () => {
  const taken = (occupiers = units({ pikeman: 20, raider: 10, chieftain: 2 }), s = S1): ReturnType<typeof applyOwnerChange> => {
    const base = createNpcVillage(3, 0, 5);
    base.buildings.wall = 5;
    base.buildings.bannerhall = 2;
    base.buildings.hall = 6;
    base.lastUpdate = T; // no production before the strike, so the stock below is exact
    base.resources = { wood: 1000, food: 801, iron: 5, gold: 99 };
    base.buildQueue = [{ building: 'lumber', targetLevel: 4, startAt: 0, finishAt: 10 * HOUR }];
    base.ranks = { raider: { might: 2, bulwark: 0, keen: 0 } };
    const hearthed = applyStrike(base, { claimBy: 7, now: T, settings: s, occupiers });
    return applyOwnerChange(hearthed, { newOwnerOccupiers: occupiers, now: T + 6 * HOUR, settings: s });
  };

  it('keeps ALL buildings (no level loss), halves the stock, clears troops, queues, ranks and the hearth', () => {
    const base = createNpcVillage(3, 0, 5);
    const r = taken();
    const v = r.state;
    assert.equal(v.buildings.wall, 5);
    assert.equal(v.buildings.bannerhall, 2);
    assert.equal(v.buildings.hall, 6);
    assert.equal(v.buildings.lumber, base.buildings.lumber + 0, 'the queued level was frozen with the village and is gone with the queue');
    const keep = TAKE_KEEP_RESOURCE_SHARE;
    assert.deepEqual(v.resources, { wood: Math.floor(1000 * keep), food: Math.floor(801 * keep), iron: Math.floor(5 * keep), gold: Math.floor(99 * keep) });
    assert.equal(v.hearth, undefined);
    assert.equal(v.npc, undefined);
    assert.deepEqual([v.buildQueue, v.trainQueues, v.researchQueue, v.ranks, v.researched], [[], { barracks: [], stables: [], bannerhall: [] }, undefined, undefined, undefined]);
    assert.equal(v.lastUpdate, T + 6 * HOUR);
  });

  it('the occupiers become the garrison; one Chieftain is used up, the other goes home', () => {
    const r = taken();
    assert.deepEqual([r.state.troops.pikeman, r.state.troops.raider, r.state.troops.chieftain], [20, 10, 0]);
    assert.deepEqual(r.state.away, units({}));
    assert.equal(r.chieftainUsed, 1);
    assert.equal(r.overflow.chieftain, 1);
    assert.equal(r.overflow.pikeman, 0);
  });

  it('only up to the population cap; the rest is returned', () => {
    const v = createNpcVillage(1, 0, 1);
    const hearthed = applyStrike(v, { claimBy: 1, now: T, settings: S1 });
    const r = applyOwnerChange(hearthed, { newOwnerOccupiers: units({ pikeman: 500 }), now: T, settings: S1 });
    const usage = populationUsage(r.state);
    assert.ok(usage.total <= populationCap(r.state));
    assert.ok(r.state.troops.pikeman > 0 && r.state.troops.pikeman < 500);
    assert.equal(r.state.troops.pikeman + r.overflow.pikeman, 500);
    assert.equal(populationUsage(r.state).total, populationCap(r.state), 'filled to the cap');
  });

  it('locks Strikes for 24 h (÷ speed) but not raids, and keeps the Renown already paid', () => {
    const r = taken();
    assert.equal(r.state.lockUntil, T + 6 * HOUR + STRIKE_LOCK_HOURS * HOUR);
    assert.ok(isStrikeBlocked(r.state, T + 6 * HOUR + 1));
    assert.ok(!isStrikeBlocked(r.state, T + 6 * HOUR + STRIKE_LOCK_HOURS * HOUR));
    const fast = taken(units({ pikeman: 1 }), S10);
    assert.equal(fast.state.lockUntil, T + 6 * HOUR + (STRIKE_LOCK_HOURS * HOUR) / 10);
    for (const b of Object.keys(r.state.buildings) as Array<keyof VillageState['buildings']>) {
      assert.ok((r.state.renownPaid?.[b] ?? 0) >= r.state.buildings[b], b);
    }
    assert.ok(r.state.defenceMark);
  });

  it('stock never exceeds the new storehouse; the village is a player village (can train, grows no more)', () => {
    const r = taken();
    for (const x of Object.values(r.state.resources)) assert.ok(x <= storageCap(r.state));
    const later = settleVillage(r.state, T + 50 * HOUR, S1);
    assert.deepEqual(later.buildings, r.state.buildings);
  });

  it('survives a round trip through normalizeVillage (lock kept, hearth copy not shared)', () => {
    const r = taken();
    assert.equal(cloneVillage(r.state).lockUntil, r.state.lockUntil);
    const s = struck();
    const c = normalizeVillage(s);
    assert.deepEqual(c.hearth, s.hearth);
    assert.notEqual(c.hearth, s.hearth);
  });
});

describe('a cold village (hearth out)', () => {
  it('produces nothing, eats nothing, and its growth clock stands still', () => {
    const v = struck();
    const later = settleVillage(v, T + 10 * HOUR, S1);
    assert.deepEqual(later.resources, v.resources);
    assert.deepEqual(later.buildings, v.buildings);
    assert.deepEqual(later.troops, v.troops);
    assert.equal(later.npc?.growthSteps, v.npc?.growthSteps);
    assert.equal(later.npc?.createdAt, (v.npc?.createdAt ?? 0) + 10 * HOUR);
    assert.equal(later.lastUpdate, T + 10 * HOUR);
  });

  it('after the hearth is relit the growth clock continues from where it stood', () => {
    const v = struck();
    const relit = { ...settleVillage(v, T + 10 * HOUR, S1) };
    delete relit.hearth;
    // npc growth is 6 h per step at speed 1, counted from the shifted origin: 5 h later is still no step
    const soon = settleVillage(relit, T + 15 * HOUR, S1);
    const base = v.npc?.growthSteps ?? 0;
    assert.ok((soon.npc?.growthSteps ?? 0) <= base + Math.floor((T + 15 * HOUR - (relit.npc?.createdAt ?? 0)) / (6 * HOUR)));
    assert.ok((soon.npc?.growthSteps ?? 0) < base + 3, 'the 10 cold hours did not count');
  });

  it('build jobs already running carry on; training batches already queued carry on; nothing new can be trained', () => {
    let p = village({ buildings: { barracks: 3 }, resources: { wood: 5000, food: 5000, iron: 5000, gold: 0 } });
    p = applyTrain(p, 'pikeman', 5, 0, S1);
    p.buildQueue = [{ building: 'lumber', targetLevel: 2, startAt: 0, finishAt: 2 * HOUR }];
    const cold = applyStrike(p, { claimBy: 2, now: HOUR / 2, settings: S1 });
    const later = settleVillage(cold, 3 * HOUR, S1);
    assert.equal(later.buildings.lumber, 2);
    assert.equal(later.troops.pikeman, 5);
    assert.equal(later.resources.wood, cold.resources.wood, 'no production');
    const t = checkTrain(cold, 'pikeman', 1, HOUR, S1);
    assert.ok(!t.ok && t.reason === 'requirements_not_met');
    assert.ok(checkTrain(p, 'pikeman', 1, HOUR, S1).ok, 'a lit village still can');
  });

  it('a cold village can build ONLY its Wall (2026-11-05); a lit one builds anything', () => {
    const p = village({ buildings: { barracks: 1 }, resources: { wood: 5000, food: 5000, iron: 5000, gold: 0 } });
    const cold = applyStrike(p, { claimBy: 2, now: HOUR / 2, settings: S1 });
    const refused = checkBuild(cold, 'lumber', HOUR, S1);
    assert.ok(!refused.ok && refused.reason === 'requirements_not_met');
    const wall = checkBuild(cold, 'wall', HOUR, S1);
    assert.ok(wall.ok, 'the wall can be queued');
    const queued = applyBuild(cold, 'wall', HOUR, S1);
    assert.equal(queued.buildQueue.at(-1)?.building, 'wall');
    const upgrade = checkBuild(queued, 'wall', HOUR, S1);
    assert.ok(upgrade.ok, 'and upgraded again');
    assert.ok(checkBuild(p, 'lumber', HOUR, S1).ok);
  });
});

describe('Chieftain chain', () => {
  const entry = (chieftains: number, at: number) => ({ chieftains, at });
  const WINDOW = STRIKE_CHAIN_WINDOW_HOURS * HOUR;

  it('the window is STRIKE_CHAIN_WINDOW_HOURS divided by world speed', () => {
    assert.equal(strikeChainWindowMs(S1), WINDOW);
    assert.equal(strikeChainWindowMs(S10), WINDOW / 10);
  });

  it('an entry exactly one window old still counts, one millisecond more does not', () => {
    assert.equal(chainedChieftains([entry(1, T)], T + WINDOW, S1), 1);
    assert.equal(chainedChieftains([entry(1, T)], T + WINDOW + 1, S1), 0);
    assert.equal(chainedChieftains([entry(1, T)], T, S1), 1, 'same instant');
    const w10 = WINDOW / 10;
    assert.equal(chainedChieftains([entry(2, T)], T + w10, S10), 2, 'speed 10 scales the window');
    assert.equal(chainedChieftains([entry(2, T)], T + w10 + 1, S10), 0);
    assert.equal(chainedChieftains([entry(2, T)], T + WINDOW, S10), 0, 'a speed 1 window is far too long at speed 10');
  });

  it('adds up the entries in the window; never negative, never NaN', () => {
    const list = [entry(1, T), entry(2, T + HOUR), entry(1, T - 5 * HOUR)];
    assert.equal(chainedChieftains(list, T + HOUR, S1), 3);
    assert.equal(chainedChieftains([], T, S1), 0);
    assert.equal(chainedChieftains([entry(1, T + 10)], T, S1), 0, 'an entry from the future counts nothing');
    assert.equal(chainedChieftains([entry(-3, T), entry(NaN, T), entry(1, NaN)], T, S1), 0);
    assert.equal(chainedChieftains([entry(1, T)], NaN, S1), 0);
  });

  it('checkStrike: survivors plus banked Chieftains reach need, but at least one must survive this attack', () => {
    const target = { abandoned: false, points: 4000, now: T }; // need 2
    const one = units({ chieftain: 1 });
    assert.deepEqual(checkStrike(WON, one, target, {}, 1), { ok: true, need: 2, chieftains: 1, banked: 1 });
    const few = checkStrike(WON, one, target, {}, 0);
    assert.ok(!few.ok && few.reason === 'too_few_chieftains' && few.banked === 0);
    const none = checkStrike(WON, units({ raider: 10 }), target, {}, 5);
    assert.ok(!none.ok && none.reason === 'too_few_chieftains' && none.chieftains === 0 && none.banked === 5, 'banked alone is never enough');
    const big = { ...target, points: 9000 }; // need 3
    assert.ok(!checkStrike(WON, one, big, {}, 1).ok);
    assert.ok(checkStrike(WON, one, big, {}, 2).ok);
    assert.ok(checkStrike(WON, units({ chieftain: 2 }), big, {}, 1).ok);
    const lost = checkStrike({ attackerWon: false }, one, target, {}, 3);
    assert.ok(!lost.ok && lost.reason === 'lost', 'a lost battle never strikes');
    assert.ok(!checkStrike(WON, one, { ...target, lockUntil: T + 1 }, {}, 3).ok, 'a lock still blocks');
    assert.ok(checkStrike(WON, one, target, {}, NaN).ok === false, 'bad banked count counts as 0');
  });
});
