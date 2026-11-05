// Domination win condition (docs/GAME_DESIGN.md, "Winning the world"): minimums, shares, the streak and the lazy evaluation.
// Time is the test clock and direct database writes; the evaluation is forced with ctx.domination.evaluate(t, true).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMINATION_DEFAULTS, TRIBE_MAX_MEMBERS, type DominationStatusDto } from '@clanfire/engine';
import { readStreak } from '../src/domination-service.ts';
import { initWorld } from '../src/world.ts';
import { Client, HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { EVAL_INTERVAL_MS, MIN_AGE_MS, RULE, STREAK_MS, domWorld, ev, fillers, setExact75, setPts, touchAll, worldSettingsJson } from './domination-helpers.ts';
import { fillerPlayer, formPact, newLeader, newPlayer } from './tribe-helpers.ts';

test('the rule is stored with the world at creation; an old database without it uses the defaults', async () => {
  const { app, clock } = await makeApp();
  assert.deepEqual(worldSettingsJson(app).domination, DOMINATION_DEFAULTS);
  assert.deepEqual(app.ctx.settings.domination, DOMINATION_DEFAULTS);

  const custom = await domWorld({ winShare: 0.6 });
  assert.deepEqual(worldSettingsJson(custom.app).domination, { ...RULE, winShare: 0.6 });

  // A database from before the rule: no `domination` key at all.
  const stored = worldSettingsJson(app);
  delete stored.domination;
  app.ctx.store.setMeta('world_settings', JSON.stringify(stored));
  assert.deepEqual(app.ctx.domination.settings(), DOMINATION_DEFAULTS);
  assert.deepEqual(initWorld(app.ctx.store, {}, clock.now(), () => {}).domination, DOMINATION_DEFAULTS);
  const status = app.ctx.domination.status(clock.now());
  // Speed 10: durations are divided by it in what players see.
  assert.deepEqual(status.settings, { minAgeDays: 18, winShare: 0.75, streakDays: 1.4, activeDays: 0.7, minActivePlayers: 50 });
  assert.equal(status.minAgeDays, 18);
  assert.equal(status.streakDaysNeeded, 1.4);
  await app.close();
  await custom.app.close();
});

test('age minimum: one ms before fails, exactly the minimum holds, and the streak starts there', async () => {
  const w = await domWorld();
  setExact75(w);
  const before = ev(w, w.t0 + MIN_AGE_MS - 1);
  assert.equal(before.ageOk, false);
  assert.equal(before.qualifies, false);
  assert.equal(readStreak(w.app.ctx.store), null);
  assert.match(before.reasons[0] ?? '', /^The world is 1 day old; domination counts from day 1\./); // 23.99.. h shown as 1 (one decimal)
  const at = ev(w, w.t0 + MIN_AGE_MS);
  assert.equal(at.ageOk, true);
  assert.equal(at.qualifies, true);
  assert.deepEqual(readStreak(w.app.ctx.store), { tribeId: w.alice.tribeId, startedAt: w.t0 + MIN_AGE_MS });
  await w.app.close();
});

test('player minimum: at least 30% of the peak, so peak 200 needs 60 and peak 100 needs 50', async () => {
  const big = await domWorld({ minActivePlayers: 50 });
  const ids = fillers(big.app, 196, big.t0); // + alice, amy, bob, lou = 200 active
  const first = ev(big, big.t0 + MIN_AGE_MS);
  assert.equal(first.activePlayers, 200);
  assert.equal(first.peakActivePlayers, 200);
  assert.equal(first.minActivePlayers, 60);
  assert.equal(big.app.ctx.store.getMeta('domination_peak_active'), '200');
  const fewer = ev(big, big.t0 + MIN_AGE_MS + 1000, ids.slice(0, 141)); // 59 left
  assert.equal(fewer.activePlayers, 59);
  assert.equal(fewer.peakActivePlayers, 200, 'the peak only grows');
  assert.equal(fewer.minActivePlayers, 60);
  assert.equal(fewer.playersOk, false);
  // the window is shown in real days at speed 10 (7 days / 10)
  assert.ok(fewer.reasons.some((r) => /^Only 59 players were active in the last 0\.7 days; at least 60 are needed\.$/.test(r)), fewer.reasons.join(' | '));
  const enough = ev(big, big.t0 + MIN_AGE_MS + 2000, ids.slice(0, 140)); // 60 left
  assert.equal(enough.activePlayers, 60);
  assert.equal(enough.playersOk, true);
  await big.app.close();

  const mid = await domWorld({ minActivePlayers: 50 });
  const midIds = fillers(mid.app, 96, mid.t0); // 100 active
  const m1 = ev(mid, mid.t0 + MIN_AGE_MS);
  assert.equal(m1.peakActivePlayers, 100);
  assert.equal(m1.minActivePlayers, 50);
  assert.equal(ev(mid, mid.t0 + MIN_AGE_MS + 1000, midIds.slice(0, 51)).playersOk, false); // 49
  assert.equal(ev(mid, mid.t0 + MIN_AGE_MS + 2000, midIds.slice(0, 50)).playersOk, true); // 50
  await mid.app.close();
});

test('banned and test accounts are not active; accounts that share an IP count once (also through a chain of IPs)', async () => {
  const w = await domWorld({}, { sandboxUsers: ['tester'] });
  await newPlayer(w.app, 'tester');
  const t = w.t0 + 1000;
  assert.equal(ev(w, t).activePlayers, 4, 'alice, amy, bob, lou; the test account does not count');

  w.app.ctx.store.banPlayer(w.lou.id, 'test', t);
  assert.equal(ev(w, t + 1).activePlayers, 3, 'a banned account does not count');

  const store = w.app.ctx.store;
  const [f1, f2] = fillers(w.app, 2, t, 'one');
  store.recordIp(f1 as number, '9.9.9.1', t);
  store.recordIp(f2 as number, '9.9.9.1', t);
  assert.equal(ev(w, t + 2).activePlayers, 4, 'alice, amy, bob + the two accounts on one IP as one player');
  const [f3] = fillers(w.app, 1, t, 'two');
  store.recordIp(f3 as number, '9.9.9.2', t);
  store.recordIp(f2 as number, '9.9.9.2', t);
  assert.equal(ev(w, t + 3).activePlayers, 4, 'a chain of shared IPs is still one player');
  fillers(w.app, 1, t, 'alone');
  assert.equal(ev(w, t + 4).activePlayers, 5, 'an account on its own IP is another player');
  // f5 and f6 are linked only through an account that is not active, which does not join them.
  const [bridge] = fillers(w.app, 1, t, 'bridge');
  const [f5] = fillers(w.app, 1, t, 'five');
  const [f6] = fillers(w.app, 1, t, 'six');
  store.recordIp(bridge as number, '9.9.9.3', t);
  store.recordIp(bridge as number, '9.9.9.4', t);
  store.recordIp(f5 as number, '9.9.9.3', t);
  store.recordIp(f6 as number, '9.9.9.4', t);
  assert.equal(ev(w, t + 5, [bridge as number]).activePlayers, 7);
  assert.equal(ev(w, t + 6).activePlayers, 6, 'with the bridge active too, the three are one player');
  await w.app.close();
});

test('the streak starts at the first qualifying evaluation, is kept, and resets when the share drops, players drop, age fails or the tribe changes', async () => {
  const w = await domWorld();
  const store = w.app.ctx.store;
  setExact75(w); // 75.00% exactly: qualifies
  const T1 = w.t0 + MIN_AGE_MS;
  const first = ev(w, T1);
  assert.equal(first.shareOk, true, 'exactly 75% qualifies');
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: T1 });

  ev(w, T1 + STREAK_MS / 4);
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: T1 }, 'kept');
  assert.equal(store.isWorldEnded(), false);

  // 74.99%: not enough, the streak is gone and the reason says so
  setPts(w, { alice: 7499, lou: 2501 });
  const near = ev(w, T1 + STREAK_MS / 2);
  assert.equal(near.shareOk, false);
  assert.equal(readStreak(store), null);
  assert.deepEqual(near.reasons, ['Alpha Pack holds 74.9% of village points; 75% is needed.']);

  // back to exactly 75%: a NEW streak starts now, not at T1
  setExact75(w);
  const T2 = T1 + STREAK_MS * 0.6;
  ev(w, T2);
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: T2 });

  // active players drop below the minimum (2): only alice is active
  const drop = ev(w, T2 + 1000, [w.amy.id, w.bob.id, w.lou.id]);
  assert.equal(drop.playersOk, false);
  assert.equal(readStreak(store), null);
  const T3 = T2 + 2000;
  ev(w, T3);
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: T3 });

  // age condition: the world becomes "too young" again (a longer minimum written straight into the settings, streak untouched)
  // (the rule lives in world_config; written straight there so the streak stays untouched)
  const raw = JSON.parse(store.getMeta('world_config') ?? '{}') as { domination: Record<string, number> };
  raw.domination.minAgeDays = 1000;
  store.setMeta('world_config', JSON.stringify(raw));
  assert.equal(ev(w, T3 + 1000).ageOk, false);
  assert.equal(readStreak(store), null);
  raw.domination.minAgeDays = RULE.minAgeDays;
  store.setMeta('world_config', JSON.stringify(raw));
  const T4 = T3 + 2000;
  ev(w, T4);
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: T4 });

  // another tribe takes the lead with 75%+: a streak of its own starts
  setPts(w, { alice: 2000, lou: 0, bob: 8000 });
  const T5 = T4 + 1000;
  ev(w, T5);
  assert.deepEqual(readStreak(store), { tribeId: w.bob.tribeId, startedAt: T5 });
  await w.app.close();
});

test('allies do not add up and abandoned villages are not in the total', async () => {
  const w = await domWorld();
  const store = w.app.ctx.store;
  await formPact(w.alice, 'BRAVO', w.bob, 'ally');
  setPts(w, { alice: 4000, amy: 0, bob: 4000, lou: 2000 });
  const npcPoints = Number((store.db.prepare('SELECT COALESCE(SUM(points), 0) AS n FROM villages WHERE owner_id IS NULL').get() as { n: number }).n);
  assert.ok(npcPoints > 0, `the world has abandoned-village points (${npcPoints}) that must not count`);
  const e = ev(w, w.t0 + MIN_AGE_MS);
  assert.equal(e.totalPoints, 10_000, 'only player-owned villages count');
  assert.equal(e.leader?.share, 0.4);
  assert.equal(e.shareOk, false, 'the allies hold 80% together, but each tribe counts alone');
  assert.deepEqual(e.topTribes.map((t) => [t.tag, t.points]), [['ALPHA', 4000], ['BRAVO', 4000]]);
  assert.equal(readStreak(store), null);
  const status = w.app.ctx.domination.status(w.t0 + MIN_AGE_MS);
  assert.equal(status.totalPoints, 10_000);
  await w.app.close();
});

test('a tribe wins at exactly the streak length (not one ms before), at the exact end time even when evaluated late', async () => {
  const w = await domWorld();
  const store = w.app.ctx.store;
  setExact75(w);
  const T1 = w.t0 + MIN_AGE_MS;
  ev(w, T1);
  ev(w, T1 + STREAK_MS - 1);
  assert.equal(store.isWorldEnded(), false, 'one ms before: no win');
  assert.equal(w.app.ctx.domination.ended(), null);

  const win = ev(w, T1 + STREAK_MS);
  assert.equal(win.won, true);
  const end = w.app.ctx.domination.ended();
  assert.ok(end);
  assert.equal(end.endedAt, T1 + STREAK_MS);
  assert.equal(end.kind, 'domination');
  assert.deepEqual(end.winner, { tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA' });
  assert.match(end.reason, /^Alpha Pack \[ALPHA\] held 75% of all village points for 0\.5 days \(needed 75%\)\.$/);
  assert.deepEqual(end.finalTribes[0], { rank: 1, tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA', points: 7500, members: 2, villages: 2 });
  assert.equal(w.app.ctx.domination.evaluate(T1 + STREAK_MS + 1, true), null, 'nothing more to evaluate once the world ended');

  // A server that was down: evaluated hours after the streak ran out, the recorded time is still the exact end of the streak.
  const late = await domWorld();
  setExact75(late);
  ev(late, late.t0 + MIN_AGE_MS);
  const e = ev(late, late.t0 + MIN_AGE_MS + STREAK_MS + 5 * HOUR);
  assert.equal(e.wonAt, late.t0 + MIN_AGE_MS + STREAK_MS);
  assert.equal(late.app.ctx.domination.ended()?.endedAt, late.t0 + MIN_AGE_MS + STREAK_MS);
  await w.app.close();
  await late.app.close();
});

test('lazy evaluation: runs from processDue (every API request), at most once per interval, and settles the win', async () => {
  const w = await domWorld({ minAgeDays: 0 });
  const store = w.app.ctx.store;
  setExact75(w);
  const lastEval = (): number => Number(store.getMeta('domination_last_eval'));
  const first = lastEval();
  assert.ok(first >= w.t0, 'the first request already evaluated once');

  // GET /api/state re-computes the owner's village points from the real buildings (the cached value is kept current),
  // which would undo the points written straight into the database. So the 75% position is written again right before
  // every request: the evaluation runs in the request hook, before the handler.
  const request = async (t: number): Promise<void> => {
    w.clock.set(t);
    touchAll(w.app, t);
    setExact75(w);
    ok(await w.alice.c.get('/api/state'));
  };
  await request(w.t0 + EVAL_INTERVAL_MS / 3);
  assert.equal(lastEval(), first, 'inside the interval: nothing runs');
  assert.equal(readStreak(store), null);

  const t1 = first + EVAL_INTERVAL_MS;
  await request(t1);
  assert.equal(lastEval(), t1, 'a full interval later: it runs');
  assert.deepEqual(readStreak(store), { tribeId: w.alice.tribeId, startedAt: t1 });

  await request(t1 + 10_000);
  assert.equal(lastEval(), t1, 'throttled again');

  // The streak is complete: the next request after an interval settles the win, without any timer.
  const tEnd = t1 + STREAK_MS;
  await request(tEnd);
  assert.equal(store.isWorldEnded(), true);
  assert.equal(w.app.ctx.domination.ended()?.endedAt, tEnd);
  await w.app.close();
});

test('GET /api/domination and GET /api/world-end: signed in only; the documented shape', async () => {
  const w = await domWorld();
  const anon = new Client(w.app);
  errorOf(await anon.get('/api/domination'), 401, 'unauthorized');
  errorOf(await anon.get('/api/world-end'), 401, 'unauthorized');

  setPts(w, { alice: 6100, amy: 0, bob: 3900, lou: 0 });
  w.clock.set(w.t0 + 40 * MINUTE);
  touchAll(w.app, w.clock.now());
  const res = await w.alice.c.get('/api/domination');
  ok(res);
  const d = res.json<DominationStatusDto>();
  assert.deepEqual(Object.keys(d).sort(), [
    'activePlayers', 'ageOk', 'ended', 'leader', 'minActivePlayers', 'minAgeDays', 'now', 'peakActivePlayers', 'playersOk', 'qualifies',
    'reasons', 'settings', 'streakDays', 'streakDaysNeeded', 'streakStartedAt', 'topTribes', 'totalPoints', 'winShare', 'worldAgeDays',
  ]);
  assert.deepEqual(Object.keys(d.settings).sort(), ['activeDays', 'minActivePlayers', 'minAgeDays', 'streakDays', 'winShare']);
  assert.deepEqual(d.settings, { minAgeDays: 1, winShare: 0.75, streakDays: 0.5, activeDays: 0.7, minActivePlayers: 2 });
  assert.equal(d.now, w.clock.now());
  assert.equal(d.worldAgeDays, 0.03);
  assert.equal(d.ageOk, false);
  assert.equal(d.activePlayers, 4);
  assert.equal(d.minActivePlayers, 2);
  assert.equal(d.playersOk, true);
  assert.equal(d.totalPoints, 10_000);
  assert.deepEqual(d.leader, { tribeId: w.alice.tribeId, name: 'Alpha Pack', tag: 'ALPHA', points: 6100, share: 0.61 });
  assert.deepEqual(d.topTribes.map((t) => t.tag), ['ALPHA', 'BRAVO']);
  assert.equal(d.winShare, 0.75);
  assert.equal(d.qualifies, false);
  assert.equal(d.streakStartedAt, null);
  assert.equal(d.streakDays, 0);
  assert.equal(d.streakDaysNeeded, 0.5);
  assert.equal(d.ended, null);
  assert.deepEqual(d.reasons.map((r) => r.replace(/[0-9.]+ days old/, 'N days old')), [
    'The world is N days old; domination counts from day 1.',
    'Alpha Pack holds 61% of village points; 75% is needed.',
  ]);

  const end = await w.alice.c.get('/api/world-end');
  ok(end);
  assert.deepEqual(end.json(), { ended: null });
  await w.app.close();
});

test('the tribe member limit is 30 and a full tribe refuses one more', async () => {
  assert.equal(TRIBE_MAX_MEMBERS, 30);
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lead', 'Crowded House', 'FULL', 'open');
  for (let i = 0; i < TRIBE_MAX_MEMBERS - 1; i++) app.ctx.store.tribes.insertMember(fillerPlayer(app, `seat${i}`, clock.now()), lead.tribeId, 'member', clock.now());
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), TRIBE_MAX_MEMBERS);
  const extra = await newPlayer(app, 'extra');
  errorOf(await extra.c.post(`/api/tribes/${lead.tribeId}/join`), 409, 'tribe_full');
  assert.equal(app.ctx.store.tribes.memberCount(lead.tribeId), TRIBE_MAX_MEMBERS);
  await app.close();
});
