// POST /api/stripe/webhook (served as /lobby/api/stripe/webhook). Only Stripe calls it: the signature of the RAW body is the credential.
// Registered as an encapsulated plugin so its JSON parser can keep the raw string without touching the other routes.

import type { FastifyInstance } from 'fastify';
import { GameError } from '@clanfire/engine';
import { RateLimiter } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { verifyWebhook } from '../shop/webhook-signature.ts';

export const WEBHOOK_PATH = '/api/stripe/webhook';
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
/** Per IP and minute: its own limiter (the global per-IP limits skip this path so a burst of Stripe retries is not refused). */
export const RATE_WEBHOOK_PER_IP = 600;

export async function stripeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const limiter = new RateLimiter(RATE_WEBHOOK_PER_IP, 60_000);
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => {
      done(null, typeof body === 'string' ? body : body.toString('utf8'));
    });
    scope.post<{ Body: string }>(WEBHOOK_PATH, { bodyLimit: WEBHOOK_BODY_LIMIT }, async (req, reply) => {
      if (!limiter.allow(req.ip, req.nowMs)) {
        void reply.header('Retry-After', '60');
        throw new GameError('rate_limited', 'Too many requests.');
      }
      const secret = ctx.webhookSecret;
      if (!secret || !ctx.shop.paymentsEnabled) throw new GameError('not_found', 'Not found.');
      const raw = typeof req.body === 'string' ? req.body : '';
      const header = req.headers['stripe-signature'];
      if (!verifyWebhook(raw, typeof header === 'string' ? header : undefined, secret, req.nowMs)) {
        throw new GameError('invalid_input', 'Invalid signature.');
      }
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        throw new GameError('invalid_input', 'The request body is not valid JSON.');
      }
      if (typeof event !== 'object' || event === null || Array.isArray(event)) throw new GameError('invalid_input', 'Malformed event.');
      const result = ctx.shop.applyEvent(event as Record<string, unknown>);
      // Provider calls that follow the commit (dispute evidence, fee refunds). Each one catches its own errors.
      for (const job of result.after) await job();
      return { received: true };
    });
  });
}
