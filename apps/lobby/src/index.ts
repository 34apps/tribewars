// Production/dev entry point: listen.

import { buildApp } from './app.ts';
import { loadDotEnv, loadEnv } from './env.ts';

loadDotEnv();
const env = loadEnv(); // fails fast (without printing the key) when LOBBY_SIGNING_KEY is missing or not an Ed25519 key
const app = await buildApp({
  dbPath: env.databasePath,
  signingKey: env.signingKey,
  secureCookies: env.isProduction,
  hsts: env.isProduction,
  trustProxy: env.trustProxy,
  allowedOrigins: env.allowedOrigins,
  maxAccountsPerIp: env.maxAccountsPerIp,
  requirePasswordUpgrade: env.requirePasswordUpgrade,
  logger: true,
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
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
  process.exit(1);
}
