import type { WorldSettings } from '@clanfire/engine';
import type { AuthService, RateLimiter } from './auth.ts';
import type { ForumService } from './forum-service.ts';
import type { GameService } from './game.ts';
import type { MailService } from './mail-service.ts';
import type { PlayerRow, Store } from './store.ts';
import type { TribeService } from './tribe-service.ts';

/** Everything the routes need. Exposed as `app.ctx` (tests use it for white-box checks). */
export interface AppContext {
  store: Store;
  auth: AuthService;
  game: GameService;
  tribes: TribeService;
  mail: MailService;
  forum: ForumService;
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
