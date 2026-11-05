// What the stores tell the live hub (live.ts). Plain data, no sockets: the stores only say "this changed for them".
// Events are held back until the database transaction has committed (Store.queueLive), so a rolled-back action
// never produces a hint and a client that refetches always sees the committed data.

import type { LiveTopic } from '@clanfire/engine';

export type LiveEvent =
  /** Tell one player's sockets that these topics changed. */
  | { kind: 'player'; playerId: number; topics: readonly LiveTopic[] }
  /** Tell every socket of one tribe (its members) that these topics changed. */
  | { kind: 'tribe'; tribeId: number; topics: readonly LiveTopic[] }
  /** Tell every open socket of the world (the world ended). */
  | { kind: 'all'; topics: readonly LiveTopic[] }
  /** A session ended (logout): close its sockets. */
  | { kind: 'session-ended'; tokenHash: string }
  /** The account was banned: close all its sockets. */
  | { kind: 'player-banned'; playerId: number }
  /** A player's tribe membership changed: re-read which tribe channel their sockets belong to. */
  | { kind: 'membership'; playerId: number };

export type LiveEmit = (event: LiveEvent) => void;
