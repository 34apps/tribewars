// What routes share, plus the Fastify type extensions.

import type { KeyObject } from 'node:crypto';
import type { AccountDataService } from './account-data.ts';
import type { AuthService, RateLimiter } from './auth.ts';
import type { AccountRow, Store } from './store.ts';
import type { DeletionDispatcher, WorldCommandClient } from './world-commands.ts';

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
  /** Data export: 2 per 10 minutes per account. */
  exportLimiter: RateLimiter;
  accountData: AccountDataService;
  worldCommands: WorldCommandClient;
  dispatcher: DeletionDispatcher;
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
