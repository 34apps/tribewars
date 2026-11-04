// What routes share, plus the Fastify type extensions.

import type { KeyObject } from 'node:crypto';
import type { AuthService, RateLimiter } from './auth.ts';
import type { AccountRow, Store } from './store.ts';

export interface AppContext {
  store: Store;
  now: () => number;
  auth: AuthService;
  /** Entry passes are signed with this key. Secret. */
  signingKey: KeyObject;
  secureCookies: boolean;
  /** Sign-in and registration attempts per IP. */
  limiter: RateLimiter;
  /** Entering a world: per account and per IP. */
  enterAccountLimiter: RateLimiter;
  enterIpLimiter: RateLimiter;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Server clock at the start of the request (ms). */
    nowMs: number;
    /** Set by the route-level auth hook. */
    account: AccountRow | null;
  }
}
