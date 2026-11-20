// The computer players of the preview play through the real services and grow on their own (no restocking). This test builds a
// speed-1 world (real pace) on node:sqlite, replaces the clock, and advances game time in chunks the way the preview's virtual
// clock does: processDue + botTick after each chunk.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNIT_IDS, UNITS, populationCap, populationUsage, settleVillage, storageCap, villagePoints, type BuildingId, type UnitId, type VillageState, type WorldSettings } from '@clanfire/engine';
import { AuthService, RateLimiter } from '../../server/src/auth.ts';
import type { AppContext } from '../../server/src/context.ts';
import { openDatabase } from '../../server/src/db.ts';
import { DominationService } from '../../server/src/domination-service.ts';
import { ForumService } from '../../server/src/forum-service.ts';
import { GameService } from '../../server/src/game.ts';
import { MailService } from '../../server/src/mail-service.ts';
import { ReportService } from '../../server/src/report-service.ts';
import { StaffService } from '../../server/src/staff-service.ts';
import { Store } from '../../server/src/store.ts';
import { SupportService } from '../../server/src/support-service.ts';
import { TribeService } from '../../server/src/tribe-service.ts';
import { initWorld } from '../../server/src/world.ts';
import { botTick, humanRaidSize, resetBotState, seedBots } from '../src/bots.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** At the real pace (speed 1) the builder leader has the Renown and War Chest gold for a Chieftain after about two weeks, then he founds. */
const HORIZON_DAYS = 55; // was 45 until 2026-11-20: the 2nd village came at day 44-45, right at the edge, and the test flaked (also before the Stables change)

/** The world the preview creates for new games: real pace (speed 1), real 72 h beginner protection, no starter pack. */
const WORLD: Partial<WorldSettings> = { speed: 1, radius: 30, npcDensity: 0.025, protectionHours: 72, seed: 4242 };

function makeCtx(startAt: number) {
  const clock = { t: startAt };
  const now = (): number => clock.t;
  const store = new Store(openDatabase(':memory:'));
  store.isSandboxUser = () => true;
  const settings = initWorld(store, WORLD, now(), () => {});
  store.world = settings;
  const forum = new ForumService(store);
  const support = new SupportService(store);
  const game = new GameService(store, settings, { error: () => {} }, now);
  const ctx: AppContext = {
    store,
    settings,
    now,
    secureCookies: false,
    worldId: 'w1',
    worldName: 'Preview',
    limiter: new RateLimiter(30, 60_000),
    auth: new AuthService(store, settings, now),
    game,
    domination: new DominationService(store, settings, game),
    tribes: new TribeService(store, settings),
    mail: new MailService(store),
    forum,
    support,
    staff: new StaffService(store, support),
    msgReports: new ReportService(store, forum),
  };
  return { ctx, clock };
}

function botPlayerIds(ctx: AppContext): number[] {
  const meta = JSON.parse(ctx.store.getMeta('preview_bots') as string) as { bots: Record<string, string> };
  return Object.keys(meta.bots).map(Number);
}

const pointsOf = (ctx: AppContext, id: number): number => ctx.store.villagesOfPlayer(id).reduce((n, v) => n + villagePoints(v.state), 0);

/** Building levels, Town Hall and army (units at home and away) of a player's villages, settled to `t`. */
function snapshot(ctx: AppContext, id: number, t: number): { hall: number; levels: number; army: number; points: number } {
  let hall = 0;
  let levels = 0;
  let army = 0;
  for (const v of ctx.store.villagesOfPlayer(id)) {
    const s = settleVillage(v.state, t, ctx.settings);
    hall = Math.max(hall, s.buildings.hall);
    levels += Object.values(s.buildings).reduce((a, b) => a + b, 0);
    army += UNIT_IDS.reduce((n, u) => n + (u === 'chieftain' ? 0 : s.troops[u] + s.away[u]), 0);
  }
  return { hall, levels, army, points: pointsOf(ctx, id) };
}

/** Wrap game.send to record every march the computer players send (units counted, no Chieftains). */
function recordSends(ctx: AppContext, clock: { t: number }): Array<{ from: number; x: number; y: number; units: number; mission: string; at: number }> {
  const log: Array<{ from: number; x: number; y: number; units: number; mission: string; at: number }> = [];
  const send = ctx.game.send.bind(ctx.game);
  ctx.game.send = (...a: Parameters<typeof send>) => {
    const r = send(...a);
    const units = Object.values(a[4] as Record<string, number>).reduce((n, c) => n + c, 0);
    log.push({ from: a[0].id, x: a[2], y: a[3], units, mission: String(a[5]), at: clock.t });
    return r;
  };
  return log;
}

/** Replace one village's state (a test setup: the bot then plays on from it). */
function setState(ctx: AppContext, villageId: number, edit: (s: VillageState) => void, t: number): void {
  const v = ctx.store.getVillage(villageId);
  assert.ok(v);
  const s = settleVillage(v.state, t, ctx.settings);
  edit(s);
  ctx.store.saveVillage(villageId, s, villagePoints(s));
}

function play(ctx: AppContext, clock: { t: number }, days: number, chunk = 20 * MINUTE): void {
  for (let i = 0; i < (days * DAY) / chunk; i++) {
    clock.t += chunk;
    ctx.game.processDue(clock.t);
    botTick(ctx);
  }
}

test('bots grow alongside a human at speed 1: points, Feast, War Chest, Chieftain, a founded village, chat, invite', async () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  resetBotState();
  seedBots(ctx);
  const ids = botPlayerIds(ctx);
  assert.equal(ids.length, 10);
  const embr = (JSON.parse(ctx.store.getMeta('preview_bots') as string) as { tribes: Record<string, number> }).tribes.EMBR as number;
  assert.equal(ctx.store.tribes.members(embr).length, 5, 'five bots in the home tribe');
  const chatBefore = ctx.store.tribes.lastMessages(embr, 100).length;

  // A human who starts from zero and has no tribe.
  await ctx.auth.register('Wanderer', 'correct horse battery');
  const human = ctx.store.getPlayerByLowerName('wanderer');
  assert.ok(human);
  const startPoints = new Map(ids.map((id) => [id, pointsOf(ctx, id)]));
  const startSnap = new Map(ids.map((id) => [id, snapshot(ctx, id, clock.t)]));
  const sends = recordSends(ctx, clock);
  const humanVillage = ctx.store.villagesOfPlayer(human.id)[0];
  assert.ok(humanVillage);
  const humanProtectedUntil = ctx.store.getPlayer(human.id)?.protectedUntil ?? 0;

  let feastsHeld = 0;
  const gameFeast = ctx.game.feast.bind(ctx.game);
  ctx.game.feast = (...a: Parameters<typeof gameFeast>) => {
    const r = gameFeast(...a);
    feastsHeld += a[2];
    return r;
  };
  const day = { invite: -1, feast: -1, chest: -1, chieftain: -1, found: -1 };
  const CHUNK = 20 * MINUTE; // each bot plays one step per 20 game minutes, so this loses nothing against 10-minute chunks
  const t0 = clock.t;
  const started = performance.now();
  for (let i = 0; i < (HORIZON_DAYS * DAY) / CHUNK; i++) {
    clock.t += CHUNK;
    ctx.game.processDue(clock.t);
    botTick(ctx);
    const d = (clock.t - t0) / DAY;
    if (day.invite < 0 && ctx.store.tribes.invitesForPlayer(human.id, clock.t).length > 0) day.invite = d;
    for (const id of ids) {
      const villages = ctx.store.villagesOfPlayer(id);
      if (day.feast < 0 && feastsHeld > 0) day.feast = d;
      if (day.chest < 0 && (ctx.store.getPlayer(id)?.chestGold ?? 0) > 0) day.chest = d;
      if (day.chieftain < 0 && villages.some((v) => v.state.troops.chieftain + v.state.away.chieftain + v.state.trainQueues.bannerhall.length > 0)) day.chieftain = d;
      if (day.found < 0 && villages.length > 1) day.found = d;
    }
    if (day.found >= 0 && d > day.found + 1) break; // everything seen
  }
  const ms = performance.now() - started;
  console.log(
    `bots test: ${ms.toFixed(0)} ms for ${((clock.t - t0) / DAY).toFixed(1)} game days; first invite ${day.invite.toFixed(3)}, Feast ${day.feast.toFixed(2)}, ` +
      `War Chest ${day.chest.toFixed(2)}, Chieftain ${day.chieftain.toFixed(2)}, 2nd village ${day.found.toFixed(2)} (days)`,
  );

  assert.ok(day.invite >= 0 && day.invite < 0.1, 'the EMBR leader invited the human shortly after registering');
  // Once per human: the invitation has long expired by now and was not sent again.
  assert.ok(ctx.store.getMeta(`preview_invited_${human.id}`) !== null);
  assert.equal(ctx.store.tribes.invitesForPlayer(human.id, clock.t).length, 0);
  const grown = ids.filter((id) => pointsOf(ctx, id) > (startPoints.get(id) ?? 0) * 1.5).length;
  assert.ok(grown >= 8, `most bots grew a lot (${grown} of ${ids.length})`);
  const newcomer = ctx.store.getPlayerByLowerName('pip_newleaf');
  assert.ok(newcomer && pointsOf(ctx, newcomer.id) > 10 * (startPoints.get(newcomer.id) ?? 1), 'the newcomer who started from zero grows too');
  assert.ok(day.feast >= 0, 'a Feast happened');
  assert.ok(day.chest >= 0, 'gold went into a War Chest');
  assert.ok(day.chieftain >= 0, 'a Chieftain was trained');
  assert.ok(day.found >= 0, 'a bot founded a second village');
  assert.ok(ctx.store.tribes.lastMessages(embr, 100).length > chatBefore, 'tribe-mates said something about their progress');
  assert.ok(ms < 35_000, `the run stays fast (${ms.toFixed(0)} ms)`);

  // Every style grows: the Town Hall, the number of building levels, the points and the army all end clearly above the start.
  for (const [name, style] of [['brannoch', 'builder'], ['ysolde_k', 'balanced'], ['ironhart', 'raider'], ['hedda_stone', 'turtle']] as const) {
    const row = ctx.store.getPlayerByLowerName(name);
    assert.ok(row);
    const a = startSnap.get(row.id);
    const b = snapshot(ctx, row.id, clock.t);
    assert.ok(a);
    assert.ok(b.hall > a.hall, `${style}: Town Hall ${a.hall} -> ${b.hall}`);
    assert.ok(b.levels > a.levels * 1.4, `${style}: building levels ${a.levels} -> ${b.levels}`);
    assert.ok(b.points > a.points * 2, `${style}: points ${a.points} -> ${b.points}`);
    assert.ok(b.army > a.army * 2, `${style}: army ${a.army} -> ${b.army}`);
  }

  // Raids on abandoned villages use real armies that grow with the bot (before: a handful of raiders, then a hard cap of 40 + 4 x Town Hall).
  const botIdSet = new Set(ids);
  const raids = sends.filter((s) => s.mission === 'attack' && s.units >= 5 && (s.x !== humanVillage.x || s.y !== humanVillage.y) && botIdSet.has(s.from));
  const halfAt = t0 + (clock.t - t0) / 2;
  const early = raids.filter((r) => r.at < halfAt).map((r) => r.units);
  const late = raids.filter((r) => r.at >= halfAt).map((r) => r.units);
  console.log(`bots test: ${raids.length} real raids/attacks; biggest early ${Math.max(0, ...early)}, biggest late ${Math.max(0, ...late)}`);
  assert.ok(raids.length >= 10, 'the bots keep raiding');
  assert.ok(Math.max(0, ...late) >= 100, `late raids are big (${Math.max(0, ...late)})`);
  // The newcomer who starts from nothing: his first raids are small, his later ones several times bigger.
  const pipId = ctx.store.getPlayerByLowerName('pip_newleaf')?.id;
  const pipRaids = raids.filter((r) => r.from === pipId).map((r) => r.units);
  console.log(`bots test: Pip_Newleaf raids ${pipRaids.length}, first ${pipRaids[0]}, biggest ${Math.max(0, ...pipRaids)}`);
  assert.ok(pipRaids.length >= 3 && Math.max(...pipRaids) >= 3 * (pipRaids[0] ?? 1), 'raids grow with the army');

  // Raids on the human: never inside beginner protection, never more than max(6, points / 20) raiders, at least 6, and rare.
  const onHuman = sends.filter((s) => s.x === humanVillage.x && s.y === humanVillage.y);
  for (const r of onHuman) {
    assert.ok(r.at >= humanProtectedUntil, 'no raid on the human during beginner protection');
    assert.ok(r.units >= 6 && r.units <= Math.max(6, Math.floor(pointsOf(ctx, human.id) / 20)), `raid size ${r.units} stays within the cap`);
  }
  for (let i = 1; i < onHuman.length; i++) assert.ok((onHuman[i]?.at ?? 0) - (onHuman[i - 1]?.at ?? 0) >= 10 * HOUR, 'raids on the human are at least 10 game hours apart');

  // A tick with nothing due is cheap and changes nothing.
  const t = performance.now();
  let changed = false;
  for (let i = 0; i < 200; i++) changed = botTick(ctx) || changed;
  assert.equal(changed, false);
  assert.ok(performance.now() - t < 1_000, 'idle ticks are cheap');
});

test('old saved worlds with the 8 old bots keep working and gain the missing ones', async () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  resetBotState();
  seedBots(ctx);
  // Turn the world back into a version-2 save: no Hedda_Stone / Pip_Newleaf as bots, old version number.
  const meta = JSON.parse(ctx.store.getMeta('preview_bots') as string) as { bots: Record<string, string>; v: number };
  for (const name of ['hedda_stone', 'pip_newleaf']) {
    const row = ctx.store.getPlayerByLowerName(name);
    assert.ok(row);
    delete meta.bots[String(row.id)];
    ctx.store.db.prepare('UPDATE players SET username = ?, username_lower = ? WHERE id = ?').run(`Old${row.id}`, `old${row.id}`, row.id);
  }
  meta.v = 2;
  ctx.store.setMeta('preview_bots', JSON.stringify(meta));
  resetBotState();

  clock.t += 20 * MINUTE;
  botTick(ctx);
  const after = JSON.parse(ctx.store.getMeta('preview_bots') as string) as { bots: Record<string, string>; v: number };
  assert.equal(after.v, 4);
  assert.equal(Object.keys(after.bots).length, 10);
  for (const name of ['hedda_stone', 'pip_newleaf']) assert.ok(ctx.store.getPlayerByLowerName(name), name);
  for (let i = 0; i < 20; i++) {
    clock.t += 20 * MINUTE;
    ctx.game.processDue(clock.t);
    botTick(ctx);
  }
});

test('raid size on a human: a floor by his points, about 60% of his defence, a hard cap by points', () => {
  assert.equal(humanRaidSize(0, 0), 6, 'at least six');
  assert.equal(humanRaidSize(700, 0), 12, 'about points / 60 when he defends nothing');
  assert.equal(humanRaidSize(6000, 0), 100);
  assert.equal(humanRaidSize(1000, 1_000_000), 50, 'never more than points / 20, however strong his defence');
  const mid = humanRaidSize(20_000, 36 * 500); // a defence worth 500 raiders: 60% of it is 300
  assert.equal(mid, 334, 'the larger of the floor (points / 60) and 60% of his defence');
  assert.ok(humanRaidSize(20_000, 36 * 100_000) <= 1000);
});

test('a bot with full storehouses keeps spending, and a village full of troops finds its way out', () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  resetBotState();
  seedBots(ctx);
  const raider = ctx.store.getPlayerByLowerName('ironhart');
  const builder = ctx.store.getPlayerByLowerName('brannoch');
  assert.ok(raider && builder);
  const rv = ctx.store.villagesOfPlayer(raider.id)[0];
  const bv = ctx.store.villagesOfPlayer(builder.id)[0];
  assert.ok(rv && bv);
  clock.t += 3 * DAY; // past the first days: no waiting for "train from day"
  const stateOf = (id: number): VillageState => settleVillage((ctx.store.getVillage(id) as { state: VillageState }).state, clock.t, ctx.settings);
  const levels = (s: VillageState): number => Object.values(s.buildings).reduce((a, b) => a + b, 0) + s.buildQueue.length;
  const troops = (s: VillageState): number => UNIT_IDS.reduce((n, u: UnitId) => n + s.troops[u] + s.away[u] + s.trainQueues[UNITS[u].building].reduce((m, j) => (j.unit === u ? m + j.count : m), 0), 0);

  // 1. Every storehouse full, nothing queued.
  setState(ctx, rv.id, (s) => {
    const cap = storageCap(s);
    s.resources.wood = cap;
    s.resources.food = cap;
    s.resources.iron = cap;
    s.buildQueue = [];
  }, clock.t);
  const before = stateOf(rv.id);
  play(ctx, clock, 1);
  const after = stateOf(rv.id);
  const cap = storageCap(after);
  assert.ok(levels(after) > levels(before), 'it builds');
  assert.ok(troops(after) > troops(before), 'it trains');
  assert.ok(after.resources.food < cap * 0.9 || after.resources.iron < cap * 0.9, 'the full storehouses were spent down');

  // 2. A village whose troops overfill its population room (an old world after the cap was lowered): the Longhouse goes up, building resumes.
  setState(ctx, bv.id, (s) => {
    const room = populationCap(s) - populationUsage(s).total;
    s.troops.pikeman += room + 300;
    for (const id of ['wood', 'food', 'iron'] as const) s.resources[id] = storageCap(s);
    s.buildQueue = [];
  }, clock.t);
  const full = stateOf(bv.id);
  assert.ok(populationUsage(full).total > populationCap(full), 'set up overfull');
  const lhBefore = full.buildings.longhouse;
  const lvBefore = levels(full);
  play(ctx, clock, 3);
  const out = stateOf(bv.id);
  assert.ok(out.buildings.longhouse > lhBefore, `Longhouse ${lhBefore} -> ${out.buildings.longhouse}`);
  assert.ok(levels(out) > lvBefore, 'the village builds again');
});

test('a village that waits for gold but has no Gold Mine builds one', () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  resetBotState();
  seedBots(ctx);
  const raider = ctx.store.getPlayerByLowerName('ironhart');
  assert.ok(raider);
  const v = ctx.store.villagesOfPlayer(raider.id)[0];
  assert.ok(v);
  clock.t += 3 * DAY;
  // The raider's list needs a Stables (gold) at this point; the village has no gold and no mine (a founded village looks like this).
  setState(ctx, v.id, (s) => {
    const set: Array<[BuildingId, number]> = [['hall', 5], ['lumber', 6], ['farm', 9], ['longhouse', 9], ['mine', 7], ['storehouse', 5], ['barracks', 4], ['goldmine', 0], ['stables', 0], ['market', 0], ['drillyard', 0], ['bannerhall', 0], ['wrightyard', 0], ['wall', 0], ['vault', 0]];
    for (const [b, l] of set) s.buildings[b] = l;
    s.resources.gold = 0;
    s.resources.wood = 3000;
    s.resources.food = 3000;
    s.resources.iron = 3000;
    s.buildQueue = [];
  }, clock.t);
  play(ctx, clock, 1);
  const s = settleVillage((ctx.store.getVillage(v.id) as { state: VillageState }).state, clock.t, ctx.settings);
  assert.ok(s.buildings.goldmine >= 1 || s.buildQueue.some((j) => j.building === 'goldmine'), 'a Gold Mine was built');
});
