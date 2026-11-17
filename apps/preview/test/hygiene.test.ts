// Preview upkeep: sessions that never expire, pace-dependent saving, trimming of the computer players' old reports, rpc after death.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldSettings } from '@clanfire/engine';
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
import { BOT_REPORTS_KEEP, botTick, resetBotState, seedBots } from '../src/bots.ts';
import { saveDebounceMs } from '../src/host.ts';
import { createRpcClient } from '../src/rpc.ts';
import { neverExpireSessions } from '../src/sessions.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

test('preview sessions survive 200 game days; the real rule would have expired them', async () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  const grant = await ctx.auth.register('sessionguy', 'a-long-enough-pass');
  assert.ok(ctx.auth.authenticate(grant.token));
  clock.t += 200 * DAY;
  assert.equal(ctx.auth.authenticate(grant.token), null, 'without the override the session is gone');
  neverExpireSessions(ctx.auth, ctx.store);
  assert.equal(ctx.auth.authenticate(grant.token)?.username, 'sessionguy');
  assert.equal(ctx.auth.authenticate('nonsense'), null);
  ctx.auth.logout(grant.token);
  assert.equal(ctx.auth.authenticate(grant.token), null, 'sign-out still ends the session');
});

test('saveDebounceMs: 5 s at 1x, 15 s at 10x, 30 s from 100x, never shrinking', () => {
  assert.equal(saveDebounceMs(1), 5000);
  assert.equal(saveDebounceMs(10), 15_000);
  assert.equal(saveDebounceMs(100), 30_000);
  assert.equal(saveDebounceMs(1000), 30_000);
  let prev = 0;
  for (const r of [1, 2, 5, 10, 25, 50, 100, 500]) {
    const v = saveDebounceMs(r);
    assert.ok(v >= prev);
    prev = v;
  }
});

test('bot reports are trimmed to the newest 20 once per game hour; the human keeps everything', async () => {
  const { ctx, clock } = makeCtx(Date.UTC(2026, 10, 10, 8, 0, 0));
  resetBotState();
  const human = (await ctx.auth.register('humanguy', 'a-long-enough-pass')).player.id;
  seedBots(ctx);
  const meta = JSON.parse(ctx.store.getMeta('preview_bots') as string) as { bots: Record<string, string> };
  const botId = Number(Object.keys(meta.bots)[0]);
  assert.ok(!(String(human) in meta.bots));
  const ins = ctx.store.db.prepare('INSERT INTO reports (player_id, side, won, title, created_at, read, battle_json) VALUES (?, ?, ?, ?, ?, 0, ?)');
  const count = (id: number): number => Number((ctx.store.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE player_id = ?').get(id) as { n: number }).n);
  const before = count(botId);
  for (let i = 0; i < 60; i++) {
    ins.run(botId, 'attack', 1, `r${i}`, clock.t - i * 1000, '{}');
    ins.run(human, 'attack', 1, `h${i}`, clock.t - i * 1000, '{}');
  }
  const humanBefore = count(human);
  assert.equal(count(botId), before + 60);
  botTick(ctx);
  assert.equal(count(botId), BOT_REPORTS_KEEP);
  assert.ok(ctx.store.db.prepare('SELECT 1 AS ok').get(), 'database still works after compaction');
  const newest = ctx.store.db.prepare('SELECT title FROM reports WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(botId) as { title: string };
  assert.equal(newest.title, 'r0');
  assert.equal(count(human), humanBefore);
  // Throttled: new rows within the same hour stay until the next hour.
  for (let i = 0; i < 10; i++) ins.run(botId, 'attack', 1, `x${i}`, clock.t + i, '{}');
  clock.t += 10 * 60_000;
  botTick(ctx);
  assert.equal(count(botId), BOT_REPORTS_KEEP + 10);
  clock.t += HOUR;
  botTick(ctx);
  assert.equal(count(botId), BOT_REPORTS_KEEP);
  assert.equal(count(human), humanBefore);
});

test('rpc: after failAll every later call fails at once', async () => {
  const posted: unknown[] = [];
  const rpc = createRpcClient((m) => posted.push(m), () => {});
  rpc.failAll('The game stopped.');
  await assert.rejects(rpc.call('flush', {}), /The game stopped/);
  assert.equal(posted.length, 0);
  assert.equal(rpc.pending(), 0);
});
