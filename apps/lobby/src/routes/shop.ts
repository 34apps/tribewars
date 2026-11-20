// Flames shop HTTP API (contract: packages/engine/src/api.ts "Flames shop"). Signed in, own data only, strict schemas.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GameError, type ShopAgeRequest, type ShopBalanceResponse, type ShopCheckoutRequest, type ShopCheckoutResponse, type ShopResponse, type ShopSpendRequest } from '@clanfire/engine';
import { RateLimiter } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { accountOf, requireAccount } from './auth.ts';

/** Per account and minute. */
export const RATE_CHECKOUT_PER_ACCOUNT = 10;
export const RATE_SPEND_PER_ACCOUNT = 30;
export const RATE_REFUND_PER_ACCOUNT = 5;
export const RATE_AGE_PER_ACCOUNT = 10;

function limitBy(limiter: RateLimiter) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!limiter.allow(String(req.account?.id ?? req.ip), req.nowMs)) {
      void reply.header('Retry-After', '60');
      throw new GameError('rate_limited', 'Too many requests. Please wait a minute and try again.');
    }
  };
}

/** The body must be empty or `{}`. */
function emptyBody(body: unknown): void {
  if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length > 0)) {
    throw new GameError('invalid_input', 'The request body must be empty.');
  }
}

export function shopRoutes(app: FastifyInstance, ctx: AppContext): void {
  const shop = ctx.shop;
  const auth = requireAccount(ctx);
  const checkoutLimit = limitBy(new RateLimiter(RATE_CHECKOUT_PER_ACCOUNT, 60_000));
  const spendLimit = limitBy(new RateLimiter(RATE_SPEND_PER_ACCOUNT, 60_000));
  const refundLimit = limitBy(new RateLimiter(RATE_REFUND_PER_ACCOUNT, 60_000));
  const ageLimit = limitBy(new RateLimiter(RATE_AGE_PER_ACCOUNT, 60_000));

  app.get('/api/shop', { onRequest: auth }, async (req): Promise<ShopResponse> => shop.response(accountOf(req)));
  app.get('/api/shop/balance', { onRequest: auth }, async (req): Promise<ShopBalanceResponse> => shop.balance(accountOf(req)));

  app.post<{ Body: ShopAgeRequest }>(
    '/api/shop/age',
    {
      onRequest: [auth, ageLimit],
      schema: { body: { type: 'object', required: ['ageGroup'], additionalProperties: false, properties: { ageGroup: { type: 'string', enum: ['adult', 'minor'] } } } },
    },
    async (req): Promise<ShopResponse> => shop.setAge(accountOf(req), req.body, req.ip),
  );

  app.post<{ Body: ShopCheckoutRequest }>(
    '/api/shop/checkout',
    {
      onRequest: [auth, checkoutLimit],
      schema: {
        body: {
          type: 'object',
          required: ['packId', 'consent', 'termsVersion'],
          additionalProperties: false,
          properties: {
            packId: { type: 'string', minLength: 1, maxLength: 32 },
            consent: { type: 'boolean' },
            parentConsent: { type: 'boolean' },
            termsVersion: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (req): Promise<ShopCheckoutResponse> => shop.checkout(accountOf(req), req.body, req.ip, String(req.headers['user-agent'] ?? '')),
  );

  app.post<{ Body: unknown }>('/api/shop/settle', { onRequest: [auth, checkoutLimit] }, async (req): Promise<ShopCheckoutResponse> => {
    emptyBody(req.body);
    return shop.settle(accountOf(req), req.ip, String(req.headers['user-agent'] ?? ''));
  });

  app.post<{ Body: ShopSpendRequest }>(
    '/api/shop/spend',
    {
      onRequest: [auth, spendLimit],
      schema: {
        body: {
          type: 'object',
          required: ['itemId', 'requestId'],
          additionalProperties: false,
          properties: {
            itemId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_.-]+$' },
            worldId: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9-]+$' },
            requestId: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,64}$' },
          },
        },
      },
    },
    async (req): Promise<ShopResponse> => shop.spend(accountOf(req), req.body, req.ip),
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/shop/purchases/:id/refund',
    { onRequest: [auth, refundLimit], schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]{1,9}$' } } } } },
    async (req): Promise<ShopResponse> => {
      emptyBody(req.body);
      return shop.refund(accountOf(req), Number(req.params.id), req.ip);
    },
  );
}
