import type { WorldSettings } from '@clanfire/engine';
import type { AuthService, RateLimiter } from './auth.ts';
import type { DominationService } from './domination-service.ts';
import type { EntryKey } from './entry-pass.ts';
import type { ForumService } from './forum-service.ts';
import type { GameService } from './game.ts';
import type { LiveHub } from './live.ts';
import type { MailService } from './mail-service.ts';
import type { MultiService } from './multi-service.ts';
import type { RaidListService } from './raid-list-service.ts';
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
  /** Shared connections / multi-account tooling for staff (multi-service.ts). */
  multi: MultiService;
  msgReports: ReportService;
  /** Raid lists, a paid extra (raid-list-service.ts). */
  raidLists: RaidListService;
  /**
   * Count one hit of the account's `send` rate limit (the same bucket the normal send route uses); false when it is used up. The raid-list
   * send charges it once per row so a list press never exceeds what manual sends would be allowed. Absent in the preview (it has no limits).
   */
  chargeSend?: (playerId: number, nowMs: number) => boolean;
  /** Domination win condition and world end (domination-service.ts). */
  domination: DominationService;
  settings: WorldSettings;
  /**
   * Copy an operator change of the stored world config into `settings` in place (cheap when nothing changed). Run at the start of every
   * API request and on the 1 s tick. Absent in the in-browser preview (nobody changes its config).
   */
  refreshSettings?: () => void;
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
  /** How long a ranked list is reused (ms, server clock). Absent = RANKINGS_CACHE_MS; 0 = always fresh (tests). */
  rankingsCacheMs?: number;
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
    /** Hashes of the device ids this request carried (device.ts); empty when none. */
    deviceHashes: string[];
  }
}
