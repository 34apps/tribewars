// Production/dev entry point: listen, and tick the movement processor once a second.

import { analyticsFromEnv } from '@clanfire/analytics';
import { BOT_PASS_INTERVAL_MS } from '@clanfire/engine';
import { createAnthropicClient } from './advisor.ts';
import { buildApp } from './app.ts';
import { loadDotEnv, loadEnv } from './env.ts';
import { DUE_BUDGET } from './game.ts';
import pkg from '../package.json' with { type: 'json' };

loadDotEnv();
const env = loadEnv();
// Server-side analytics (docs/ANALYTICS.md): a no-op unless ANALYTICS=1 and ANALYTICS_SALT are set (never in dev).
const analytics = analyticsFromEnv(process.env, { version: pkg.version, log: { warn: (m) => console.warn(m) } });
const app = await buildApp({
  dbPath: env.databasePath,
  worldId: env.worldId,
  worldName: env.worldName,
  settings: env.worldOverrides,
  worldConfig: env.worldConfig,
  secureCookies: env.isProduction,
  trustProxy: env.trustProxy,
  allowedOrigins: env.allowedOrigins,
  maxAccountsPerIp: env.maxAccountsPerIp,
  sandboxUsers: env.sandboxUsers,
  lobbyPublicKey: env.lobbyPublicKeys ?? undefined,
  analytics,
  logger: true,
  advisorClient: env.anthropicApiKey ? createAnthropicClient(env.anthropicApiKey) : null,
});
if (env.lobbyPublicKeys) app.log.info('Lobby entry is on (LOBBY_PUBLIC_KEY set): this world only accepts entry passes from the lobby');
if (analytics.enabled) app.log.info('Analytics is on (ANALYTICS=1): anonymous play stats go to the owner\'s analytics service');
if (!env.anthropicApiKey) app.log.info('Advisor (Ask Mags) is off (needs ADVISOR_ENABLED=true and ANTHROPIC_API_KEY)');

// Catch up on everything that came due while the server was down (oldest first) before taking requests.
try {
  const resolved = app.ctx.game.processDue(Date.now());
  app.log.info(`startup catch-up: ${resolved} movement(s) resolved`);
} catch (err) {
  app.log.error({ err }, 'startup catch-up failed; the tick will retry');
}

// Arrivals are also processed at the start of every API request; the tick covers idle periods.
const tick = setInterval(() => {
  try {
    app.ctx.refreshSettings?.();
    // One budgeted slice; a backlog (a burst, or more than a slice of arrivals) is drained in further slices between requests.
    app.ctx.game.processDue(Date.now(), DUE_BUDGET);
    if (app.ctx.game.dueBacklog) void app.ctx.game.catchUp();
  } catch (err) {
    app.log.error({ err }, 'tick failed');
  }
}, 1000);

// Caretaker bot: builds for villages whose owner has been away for days (docs/GAME_DESIGN.md section 17).
const caretaker = setInterval(() => {
  try {
    app.ctx.game.runCaretaker(Date.now());
  } catch (err) {
    app.log.error({ err }, 'caretaker pass failed');
  }
}, BOT_PASS_INTERVAL_MS);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  clearInterval(tick);
  clearInterval(caretaker);
  try {
    await app.close();
    await analytics.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.port, host: env.host });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  clearInterval(tick);
  clearInterval(caretaker);
  process.exit(1);
}
