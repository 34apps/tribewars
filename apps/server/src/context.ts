import type { WorldSettings } from '@clanfire/engine';
import type { AuthService, RateLimiter } from './auth.ts';
import type { EntryKey } from './entry-pass.ts';
import type { ForumService } from './forum-service.ts';
import type { GameService } from './game.ts';
import type { LiveHub } from './live.ts';
import type { MailService } from './mail-service.ts';
import type { ReportService } from './report-service.ts';
import type { StaffService } from './staff-service.ts';
import type { PlayerRow, Store } from './store.ts';
import type { SupportService } from './support-service.ts';
import type { TribeService } from './tribe-service.ts';

/** Everything the routes need. Exposed as `app.ctx` (tests use it for white-box checks). */
export interface AppContext {
  store: Store;
  auth: AuthService;
  game: GameService;
  tribes: TribeService;
  mail: MailService;
  forum: ForumService;
  support: SupportService;
  staff: StaffService;
  msgReports: ReportService;
  settings: WorldSettings;
  limiter: RateLimiter;
  /** This process's world id and display name (docs/MULTI_WORLD.md). The id also scopes the session cookie path. */
  worldId: string;
  worldName: string;
  /**
   * Lobby public keys (LOBBY_PUBLIC_KEY). null (or absent: the in-browser preview builds its own context) = no lobby:
   * the world's own register/login work and /api/auth/enter is a 404.
   */
  lobby?: { keys: EntryKey[] } | null;
  /** WebSocket hub for live-update hints (live.ts). Absent in the in-browser preview, which has no network. */
  live?: LiveHub;
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
