// Live updates: GET /api/live upgrades to a WebSocket (docs/SECURITY_ROADMAP.md §1 "Live updates", Phase 2).
//
// Design: one world = one server process, so an in-memory publish/subscribe is enough. The socket is PUSH-ONLY: the
// server sends small "something changed" hints (LiveMessage, no game data) and the client refetches through the normal
// GET endpoints, so the server stays authoritative and nothing new can leak. The client never sends game commands:
// the only accepted frame is "ping".
//
// Security (gate in docs/SECURITY_ROADMAP.md §4):
//  - authenticated on upgrade with the session cookie; refused without a valid session (401);
//  - Origin checked like writes (same host or ALLOWED_ORIGINS), because a cookie-authenticated WebSocket is open to
//    cross-site hijacking otherwise;
//  - caps: sockets per session, per IP and in total; incoming frames max LIVE_MAX_MESSAGE_BYTES and LIVE_MSG_PER_WINDOW
//    per window, anything but ping closes the socket;
//  - a player only ever receives hints addressed to their own player channel or their tribe's channel (plus the one
//    world-wide hint "the world ended", which carries no data);
//  - heartbeat: dead sockets are dropped, the session is re-checked and the tribe channel refreshed every beat;
//  - logout, ban or a vanished session close the sockets at once.
// Hints are published by the Store after the database transaction commits (see Store.tx / live-events.ts).

import websocket from '@fastify/websocket';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  GameError,
  LIVE_CLOSE_BAD_MESSAGE,
  LIVE_CLOSE_SESSION_ENDED,
  LIVE_CLOSE_TOO_MANY,
  type LiveMessage,
  type LiveTopic,
} from '@clanfire/engine';
import { SESSION_COOKIE, sha256Hex } from './auth.ts';
import type { AppContext } from './context.ts';
import type { LiveEvent } from './live-events.ts';
import { originAllowed } from './security.ts';
import { requireAuth } from './routes/auth.ts';
import type { Store } from './store.ts';

export const LIVE_MAX_PER_SESSION = 3;
export const LIVE_MAX_PER_IP = 12;
export const LIVE_MAX_TOTAL = 5000;
/** Largest frame the client may send (a ping is ~15 bytes). Bigger frames are refused by the socket library (close 1009). */
export const LIVE_MAX_MESSAGE_BYTES = 256;
export const LIVE_MSG_PER_WINDOW = 5;
export const LIVE_MSG_WINDOW_MS = 10_000;
export const LIVE_HEARTBEAT_MS = 30_000;

/** The part of a `ws` WebSocket the hub uses (the types for `ws` are not installed). */
export interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'message', cb: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: 'pong' | 'close' | 'error', cb: () => void): unknown;
}
const OPEN = 1;

interface Conn {
  ws: LiveSocket;
  playerId: number;
  tribeId: number | null;
  tokenHash: string;
  ip: string;
  alive: boolean;
  windowStart: number;
  windowCount: number;
}

export interface LiveHubOptions {
  heartbeatMs?: number;
}

function addTo<K>(map: Map<K, Set<Conn>>, key: K, c: Conn): void {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(c);
}
function removeFrom<K>(map: Map<K, Set<Conn>>, key: K, c: Conn): void {
  const s = map.get(key);
  if (!s) return;
  s.delete(c);
  if (s.size === 0) map.delete(key);
}

export class LiveHub {
  private readonly conns = new Set<Conn>();
  private readonly byPlayer = new Map<number, Set<Conn>>();
  private readonly byTribe = new Map<number, Set<Conn>>();
  private readonly bySession = new Map<string, Set<Conn>>();
  private readonly byIp = new Map<string, Set<Conn>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: Store,
    private readonly now: () => number,
    private readonly log: FastifyBaseLogger,
    private readonly opts: LiveHubOptions = {},
  ) {}

  /** Open sockets (tests, diagnostics). */
  get size(): number {
    return this.conns.size;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.heartbeat(), this.opts.heartbeatMs ?? LIVE_HEARTBEAT_MS);
    this.timer.unref();
  }

  /** Stop the heartbeat and close every socket (server shutdown). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of [...this.conns]) this.close(c, 1001, 'server shutting down');
  }

  /** Why a new socket must be refused, or null. Checked before the upgrade (HTTP 429) and again on attach. */
  refusal(tokenHash: string, ip: string): string | null {
    if (this.conns.size >= LIVE_MAX_TOTAL) return 'The live connection is busy. Try again soon.';
    if ((this.bySession.get(tokenHash)?.size ?? 0) >= LIVE_MAX_PER_SESSION) return 'Too many live connections for this session.';
    if ((this.byIp.get(ip)?.size ?? 0) >= LIVE_MAX_PER_IP) return 'Too many live connections from this address.';
    return null;
  }

  /** Register an upgraded socket for an authenticated player. */
  attach(ws: LiveSocket, who: { playerId: number; tokenHash: string; ip: string }): void {
    if (this.refusal(who.tokenHash, who.ip)) {
      ws.close(LIVE_CLOSE_TOO_MANY, 'too many connections');
      return;
    }
    const c: Conn = {
      ws,
      playerId: who.playerId,
      tribeId: this.store.tribes.membership(who.playerId)?.tribeId ?? null,
      tokenHash: who.tokenHash,
      ip: who.ip,
      alive: true,
      windowStart: this.now(),
      windowCount: 0,
    };
    this.conns.add(c);
    addTo(this.byPlayer, c.playerId, c);
    addTo(this.bySession, c.tokenHash, c);
    addTo(this.byIp, c.ip, c);
    if (c.tribeId !== null) addTo(this.byTribe, c.tribeId, c);

    ws.on('pong', () => {
      c.alive = true;
    });
    ws.on('close', () => this.remove(c));
    ws.on('error', () => this.drop(c));
    ws.on('message', (data, isBinary) => this.onMessage(c, data, isBinary));
    this.send(c, { type: 'hello' });
  }

  /** Deliver the events of one committed transaction. Several hints for the same socket are merged into one frame. */
  publish(events: readonly LiveEvent[]): void {
    const out = new Map<Conn, Set<LiveTopic>>();
    const queue = (set: Set<Conn> | undefined, topics: readonly LiveTopic[]): void => {
      if (!set) return;
      for (const c of set) {
        let t = out.get(c);
        if (!t) out.set(c, (t = new Set()));
        for (const x of topics) t.add(x);
      }
    };
    for (const e of events) {
      switch (e.kind) {
        case 'player':
          queue(this.byPlayer.get(e.playerId), e.topics);
          break;
        case 'tribe':
          queue(this.byTribe.get(e.tribeId), e.topics);
          break;
        case 'all':
          queue(this.conns, e.topics);
          break;
        case 'membership':
          for (const c of this.byPlayer.get(e.playerId) ?? []) this.retribe(c);
          break;
        case 'session-ended':
          for (const c of [...(this.bySession.get(e.tokenHash) ?? [])]) this.close(c, LIVE_CLOSE_SESSION_ENDED, 'session ended');
          break;
        case 'player-banned':
          for (const c of [...(this.byPlayer.get(e.playerId) ?? [])]) this.close(c, LIVE_CLOSE_SESSION_ENDED, 'session ended');
          break;
      }
    }
    for (const [c, topics] of out) this.send(c, { type: 'hint', topics: [...topics] });
  }

  /** One heartbeat: drop sockets that never answered the last ping, re-check each session, refresh tribe channels, ping. */
  heartbeat(): void {
    const t = this.now();
    for (const c of [...this.conns]) {
      if (!c.alive) {
        this.drop(c);
        continue;
      }
      try {
        if (!this.store.getSessionPlayer(c.tokenHash, t)) {
          this.close(c, LIVE_CLOSE_SESSION_ENDED, 'session ended');
          continue;
        }
        this.retribe(c);
        c.alive = false;
        c.ws.ping();
      } catch (err) {
        this.log.warn({ err }, 'live heartbeat failed for a socket');
        this.drop(c);
      }
    }
  }

  // ---- internals ---------------------------------------------------------------------------------

  private onMessage(c: Conn, data: unknown, isBinary: boolean): void {
    c.alive = true;
    const t = this.now();
    if (t - c.windowStart >= LIVE_MSG_WINDOW_MS) {
      c.windowStart = t;
      c.windowCount = 0;
    }
    if (++c.windowCount > LIVE_MSG_PER_WINDOW || isBinary || !isPing(data)) {
      this.close(c, LIVE_CLOSE_BAD_MESSAGE, 'only ping is allowed');
      return;
    }
    this.send(c, { type: 'pong' });
  }

  private retribe(c: Conn): void {
    const tribeId = this.store.tribes.membership(c.playerId)?.tribeId ?? null;
    if (tribeId === c.tribeId) return;
    if (c.tribeId !== null) removeFrom(this.byTribe, c.tribeId, c);
    c.tribeId = tribeId;
    if (tribeId !== null) addTo(this.byTribe, tribeId, c);
  }

  private send(c: Conn, msg: LiveMessage): void {
    if (c.ws.readyState !== OPEN) return;
    try {
      c.ws.send(JSON.stringify(msg));
    } catch {
      this.drop(c);
    }
  }

  private close(c: Conn, code: number, reason: string): void {
    this.remove(c);
    try {
      c.ws.close(code, reason);
    } catch {
      this.drop(c);
    }
  }

  private drop(c: Conn): void {
    this.remove(c);
    try {
      c.ws.terminate();
    } catch {
      // already gone
    }
  }

  private remove(c: Conn): void {
    if (!this.conns.delete(c)) return;
    removeFrom(this.byPlayer, c.playerId, c);
    removeFrom(this.bySession, c.tokenHash, c);
    removeFrom(this.byIp, c.ip, c);
    if (c.tribeId !== null) removeFrom(this.byTribe, c.tribeId, c);
  }
}

/** The only frame a client may send: the text `ping` or `{"type":"ping"}`. */
function isPing(data: unknown): boolean {
  let text: string;
  if (typeof data === 'string') text = data;
  else if (Buffer.isBuffer(data)) text = data.toString('utf8');
  else return false;
  if (text === 'ping') return true;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { type?: unknown }).type === 'ping';
  } catch {
    return false;
  }
}

/** Registers the WebSocket plugin and GET /api/live. */
export async function liveRoutes(app: FastifyInstance, ctx: AppContext, hub: LiveHub, allowedOrigins: ReadonlySet<string>): Promise<void> {
  await app.register(websocket, { options: { maxPayload: LIVE_MAX_MESSAGE_BYTES } });
  const authenticate = requireAuth(ctx);
  app.get(
    '/api/live',
    {
      websocket: true,
      // Runs before the upgrade: a refusal is a plain HTTP answer and no socket is ever created.
      onRequest: async (req, reply) => {
        if (!originAllowed(req.headers.origin, req.headers.host, allowedOrigins)) {
          throw new GameError('forbidden', 'Cross-site requests are not allowed.');
        }
        await authenticate(req);
        const refusal = hub.refusal(sha256Hex(req.cookies[SESSION_COOKIE] ?? ''), req.ip);
        if (refusal) {
          void reply.header('Retry-After', '30');
          throw new GameError('rate_limited', refusal);
        }
      },
    },
    (socket, req) => {
      const player = req.player;
      if (!player) return socket.close(LIVE_CLOSE_SESSION_ENDED, 'session ended');
      hub.attach(socket as unknown as LiveSocket, { playerId: player.id, tokenHash: sha256Hex(req.cookies[SESSION_COOKIE] ?? ''), ip: req.ip });
    },
  );
}
