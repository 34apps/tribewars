// Production/dev entry point: listen, and tick the movement processor once a second.

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
  logger: true,
  advisorClient: env.anthropicApiKey ? createAnthropicClient(env.anthropicApiKey) : null,
});
if (!env.anthropicApiKey) app.log.info('Advisor (Ask Mags) is off (needs ADVISOR_ENABLED=true and ANTHROPIC_API_KEY)');

// Arrivals are also processed at the start of every API request; the tick covers idle periods.
const tick = setInterval(() => {
  try {
    app.ctx.game.processDue(Date.now());
  } catch (err) {
    app.log.error({ err }, 'tick failed');
  }
}, 1000);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  clearInterval(tick);
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
  process.exit(1);
}
