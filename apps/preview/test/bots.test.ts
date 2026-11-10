// The computer players of the preview play through the real services and grow on their own (no restocking). This test builds a
// speed-1 world (real pace) on node:sqlite, replaces the clock, and advances game time in chunks the way the preview's virtual
// clock does: processDue + botTick after each chunk.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { villagePoints, type WorldSettings } from '@clanfire/engine';
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
import { botTick, resetBotState, seedBots } from '../src/bots.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** At the real pace (speed 1) the builder leader has the Renown and War Chest gold for a Chieftain after about two weeks, then he founds. */
const HORIZON_DAYS = 22;

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
      if (day.feast < 0 && villages.some((v) => (v.state.feast?.count ?? 0) > 0)) day.feast = d;
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
  assert.ok(ms < 8_000, `the run stays fast (${ms.toFixed(0)} ms)`);

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
  assert.equal(after.v, 3);
  assert.equal(Object.keys(after.bots).length, 10);
  for (const name of ['hedda_stone', 'pip_newleaf']) assert.ok(ctx.store.getPlayerByLowerName(name), name);
  for (let i = 0; i < 20; i++) {
    clock.t += 20 * MINUTE;
    ctx.game.processDue(clock.t);
    botTick(ctx);
  }
});
