// Production/dev entry point: listen, and tick the movement processor once a second.

import { BOT_PASS_INTERVAL_MS } from '@clanfire/engine';
import { createAnthropicClient } from './advisor.ts';
import { buildApp } from './app.ts';
import { loadDotEnv, loadEnv } from './env.ts';

loadDotEnv();
const env = loadEnv();
const app = await buildApp({
  dbPath: env.databasePath,
  settings: env.worldOverrides,
  secureCookies: env.isProduction,
  trustProxy: env.trustProxy,
  allowedOrigins: env.allowedOrigins,
  maxAccountsPerIp: env.maxAccountsPerIp,
  sandboxUsers: env.sandboxUsers,
  logger: true,
  advisorClient: env.anthropicApiKey ? createAnthropicClient(env.anthropicApiKey) : null,
});
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
    app.ctx.game.processDue(Date.now());
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
