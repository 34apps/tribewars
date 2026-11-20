// Production/dev entry point: listen.

import { analyticsFromEnv } from '@clanfire/analytics';
import { startMaintenance } from './account-data.ts';
import { buildApp } from './app.ts';
import { loadDotEnv, loadEnv } from './env.ts';
import { lobbyHooks } from './hooks-config.ts';
import { StripeGateway } from './shop/gateway.ts';
import pkg from '../package.json' with { type: 'json' };

/** Owner alerts: POST {text} as JSON. A failing endpoint never breaks the lobby (the caller catches). */
function postAlert(url: string): (text: string) => Promise<void> {
  return async (text) => {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
  };
}

loadDotEnv();
const env = loadEnv(); // fails fast (without printing the key) when LOBBY_SIGNING_KEY is missing or not an Ed25519 key
// Server-side analytics (docs/ANALYTICS.md): a no-op unless ANALYTICS=1 and ANALYTICS_SALT are set (never in dev).
const analytics = analyticsFromEnv(process.env, { version: pkg.version, log: { warn: (m) => console.warn(m) } });
const app = await buildApp({
  dbPath: env.databasePath,
  signingKey: env.signingKey,
  secureCookies: env.isProduction,
  hsts: env.isProduction,
  trustProxy: env.trustProxy,
  allowedOrigins: env.allowedOrigins,
  maxAccountsPerIp: env.maxAccountsPerIp,
  requirePasswordUpgrade: env.requirePasswordUpgrade,
  hooks: lobbyHooks,
  worldApiUrl: env.worldApiUrl,
  payments: env.paymentsEnabled && env.stripeSecretKey ? new StripeGateway({ secretKey: env.stripeSecretKey, tax: env.stripeTax }) : undefined,
  stripeTax: env.stripeTax,
  webhookSecret: env.stripeWebhookSecret ?? undefined,
  publicUrl: env.publicUrl ?? undefined,
  notify: env.alertWebhookUrl ? postAlert(env.alertWebhookUrl) : undefined,
  analytics,
  logger: true,
});

let stopMaintenance: () => void = () => {};
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  try {
    stopMaintenance();
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
  // Queued account deletions are sent every minute; finished queue rows are pruned at most once an hour.
  stopMaintenance = startMaintenance({ service: app.ctx.accountData, dispatcher: app.ctx.dispatcher, now: Date.now, log: { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) } });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
