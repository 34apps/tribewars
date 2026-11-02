import type { WorldSettings } from '@tribewars/engine';
import type { AuthService, RateLimiter } from './auth.ts';
import type { GameService } from './game.ts';
import type { PlayerRow, Store } from './store.ts';

/** Everything the routes need. Exposed as `app.ctx` (tests use it for white-box checks). */
export interface AppContext {
  store: Store;
  auth: AuthService;
  game: GameService;
  settings: WorldSettings;
  limiter: RateLimiter;
  now: () => number;
  secureCookies: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** The server clock, read once at the start of the request so every step agrees on "now". */
    nowMs: number;
    /** Set by the auth hook on routes that need a signed-in player. */
    player: PlayerRow | null;
  }
}
