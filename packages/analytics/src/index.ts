// Server-side analytics sender (docs/ANALYTICS.md). Shared by the world server and the lobby; NOT part of the engine (it does I/O).
//
// Events are sent from OUR servers to the owner's analytics ingest, never from the browser (no cookie, no localStorage, so no consent card).
// Wire format: apps34-analytics WIRE_FORMAT.md v1 (strict: unknown keys give 400, `utc` is .NET ticks, `seq` an integer).
//
// Rules this module keeps:
//  - Off (every call a no-op) unless ANALYTICS=1 AND ANALYTICS_SALT are set. Dev, dev:fast, the preview and tests never set them.
//  - `track` never throws and never waits: it validates, puts the event in memory and returns. Sending is a background job.
//  - A batch per install id, sent at 20 events or after 30 s. `seq` = flush time in ms * 1000 (+ a counter), kept on retry.
//  - Retries only for network errors, 429 and 5xx, with growing waits; any other answer drops the batch (it can never succeed).
//  - The queue is bounded; what does not fit is dropped and counted in `dropped`, reported with the next batch.
//  - Nothing personal is ever an event value: names, chat, e-mails, village names and coordinates are not accepted by design
//    (values are lowercase tokens, a currency code or a number).

import { createHmac } from 'node:crypto';

export const DEFAULT_ANALYTICS_URL = 'https://262eqaset3enys6yazdr5suugy0sogto.lambda-url.us-east-1.on.aws/v1/batch';
/** Write-only project key of project `clanflame` (it can only add events; docs/ANALYTICS.md section 1). */
export const DEFAULT_ANALYTICS_KEY = 'ak_LO_lUWSO7_GedhmWiCI0YSNf';

export const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const TOKEN_RE = /^[a-z0-9_.]{1,40}$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;
export const IID_RE = /^[0-9a-f]{32}$/;
export const APP_RE = /^[A-Za-z0-9.\-]{1,24}$/;
export const MAX_PARAMS = 8;

export const BATCH_EVENTS = 20;
export const BATCH_MAX_AGE_MS = 30_000;
/** Events held in memory (not yet sent plus waiting for a retry). Beyond it new events are dropped and counted. */
export const MAX_QUEUED_EVENTS = 5000;
export const FETCH_TIMEOUT_MS = 8000;
export const MAX_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 5000;
export const BACKOFF_MAX_MS = 5 * 60_000;
/** Batches being sent at the same time. */
const MAX_IN_FLIGHT = 4;
const TICKS_AT_EPOCH = 621_355_968_000_000_000;
const PUMP_MS = 5000;

export type ParamValue = string | number;
export type Params = Record<string, ParamValue>;

export interface Logger {
  warn(msg: string): void;
}

/** What the rest of the code talks to. `enabled: false` means every method does nothing. */
export interface Analytics {
  readonly enabled: boolean;
  /** Queue one event for the person `subject` (a stable string such as the lobby account id). Never throws, never waits. */
  track(subject: string, event: string, params?: Params, lvl?: number): void;
  /** Send everything queued now (used on shutdown and in tests). Never throws. */
  flush(): Promise<void>;
  /** Stop the timer and make a last attempt to send what is queued. */
  close(): Promise<void>;
}

/** The first 32 hex of HMAC-SHA256(salt, subject): same person, same id; the subject cannot be recovered from it. */
export function iidOf(salt: string, subject: string): string {
  return createHmac('sha256', salt).update(subject).digest('hex').slice(0, 32);
}

/** Why `event`/`params`/`lvl` would be refused by the ingest, or null when they are fine. Same rules as WIRE_FORMAT.md. */
export function validateEvent(event: string, params?: Params, lvl?: number): string | null {
  if (typeof event !== 'string' || !NAME_RE.test(event)) return `bad event name "${String(event).slice(0, 50)}"`;
  if (lvl !== undefined && !(Number.isSafeInteger(lvl) && lvl >= 0)) return 'lvl must be an integer >= 0';
  if (params === undefined) return null;
  const keys = Object.keys(params);
  if (keys.length > MAX_PARAMS) return `more than ${MAX_PARAMS} params`;
  for (const k of keys) {
    if (!NAME_RE.test(k)) return `bad param name "${k.slice(0, 50)}"`;
    const v = params[k];
    const ok = typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && (TOKEN_RE.test(v) || CURRENCY_RE.test(v));
    if (!ok) return `bad value for param "${k}"`;
  }
  return null;
}

/** Do-nothing analytics: the default everywhere (dev, tests, the preview). */
export const NO_ANALYTICS: Analytics = {
  enabled: false,
  track: () => {},
  flush: async () => {},
  close: async () => {},
};

interface WireEvent {
  e: string;
  utc: number;
  lvl?: number;
  p?: Params;
}
interface QueuedGroup {
  iid: string;
  events: WireEvent[];
  firstAt: number;
}
interface Batch {
  iid: string;
  seq: number;
  events: WireEvent[];
  attempts: number;
  nextAt: number;
  busy: boolean;
}

export interface SenderOptions {
  salt: string;
  /** App version sent as `app` (APP_RE). */
  app: string;
  url?: string;
  key?: string;
  /** Test hooks. */
  fetch?: typeof fetch;
  now?: () => number;
  log?: Logger;
  /** false = no background timer; call `pump()` yourself (tests). */
  timer?: boolean;
  /** Smaller bound for tests. */
  maxQueued?: number;
}

export class AnalyticsSender implements Analytics {
  readonly enabled = true;
  private readonly salt: string;
  private readonly app: string;
  private readonly url: string;
  private readonly key: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly maxQueued: number;
  private groups = new Map<string, QueuedGroup>();
  private outbox: Batch[] = [];
  private inFlight = 0;
  private queued = 0;
  private lastSeq = 0;
  private droppedUnreported = 0;
  /** Events dropped since start (queue full or a batch that could not be delivered). */
  droppedTotal = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idle: Array<() => void> = [];

  constructor(o: SenderOptions) {
    this.salt = o.salt;
    this.app = APP_RE.test(o.app) ? o.app : '0.0.0';
    this.url = o.url ?? DEFAULT_ANALYTICS_URL;
    this.key = o.key ?? DEFAULT_ANALYTICS_KEY;
    this.doFetch = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.log = o.log ?? { warn: () => {} };
    this.maxQueued = o.maxQueued ?? MAX_QUEUED_EVENTS;
    if (o.timer !== false) {
      this.timer = setInterval(() => this.pump(), PUMP_MS);
      this.timer.unref?.();
    }
  }

  track(subject: string, event: string, params?: Params, lvl?: number): void {
    try {
      const problem = validateEvent(event, params, lvl);
      if (problem) {
        this.log.warn(`analytics: event dropped (${problem})`);
        return;
      }
      if (typeof subject !== 'string' || subject === '') return;
      if (this.queued >= this.maxQueued) {
        this.droppedUnreported++;
        this.droppedTotal++;
        return;
      }
      const t = this.now();
      const iid = iidOf(this.salt, subject);
      const wire: WireEvent = {
        e: event,
        utc: TICKS_AT_EPOCH + t * 10_000,
        ...(lvl !== undefined ? { lvl } : {}),
        ...(params && Object.keys(params).length > 0 ? { p: { ...params } } : {}),
      };
      let g = this.groups.get(iid);
      if (!g) {
        g = { iid, events: [], firstAt: t };
        this.groups.set(iid, g);
      }
      g.events.push(wire);
      this.queued++;
      if (g.events.length >= BATCH_EVENTS) this.seal(g, t);
      this.drain();
    } catch (err) {
      this.log.warn(`analytics: track failed (${err instanceof Error ? err.message : 'unexpected error'})`);
    }
  }

  /** Turn a group into a batch waiting to be sent. The sequence number is fixed here and stays the same on every retry. */
  private seal(g: QueuedGroup, t: number): void {
    this.groups.delete(g.iid);
    const seq = Math.max(t * 1000, this.lastSeq + 1);
    this.lastSeq = seq;
    this.outbox.push({ iid: g.iid, seq, events: g.events, attempts: 0, nextAt: t, busy: false });
  }

  /** One round of the background job: seal groups that waited long enough, send what is due. */
  pump(): void {
    const t = this.now();
    for (const g of [...this.groups.values()]) if (t - g.firstAt >= BATCH_MAX_AGE_MS) this.seal(g, t);
    this.drain();
  }

  private drain(): void {
    const t = this.now();
    for (const b of this.outbox) {
      if (this.inFlight >= MAX_IN_FLIGHT) break;
      if (b.nextAt > t || b.busy) continue;
      b.busy = true;
      this.inFlight++;
      void this.send(b).finally(() => {
        this.inFlight--;
        b.busy = false;
        this.drain();
        this.notifyIdle();
      });
    }
  }

  private done(b: Batch, dropped: boolean): void {
    this.outbox = this.outbox.filter((x) => x !== b);
    this.queued -= b.events.length;
    if (dropped) {
      this.droppedUnreported += b.events.length;
      this.droppedTotal += b.events.length;
    }
  }

  private async send(b: Batch): Promise<void> {
    b.attempts++;
    const reported = this.droppedUnreported;
    const body = {
      v: 1,
      iid: b.iid,
      plat: 'web',
      seq: b.seq,
      app: this.app,
      ...(reported > 0 ? { dropped: reported } : {}),
      events: b.events,
    };
    let status = 0;
    try {
      const res = await this.doFetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-project-key': this.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      status = res.status;
      void res.body?.cancel?.().catch(() => {});
    } catch {
      status = 0; // network error or timeout
    }
    if (status === 200) {
      this.droppedUnreported = Math.max(0, this.droppedUnreported - reported);
      this.done(b, false);
      return;
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    if (retryable && b.attempts < MAX_ATTEMPTS) {
      b.nextAt = this.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (b.attempts - 1));
      return;
    }
    this.log.warn(`analytics: batch of ${b.events.length} dropped (${status === 0 ? 'network' : `status ${status}`}${retryable ? ', too many tries' : ''})`);
    this.done(b, true);
  }

  private notifyIdle(): void {
    if (this.inFlight === 0 && this.idle.length > 0) {
      const waiting = this.idle;
      this.idle = [];
      for (const f of waiting) f();
    }
  }

  /** Send everything queued now, one try each (a flush does not wait for a backoff). Never throws. */
  async flush(): Promise<void> {
    try {
      const t = this.now();
      for (const g of [...this.groups.values()]) this.seal(g, t);
      for (const b of this.outbox) b.nextAt = 0;
      this.drain();
      while (this.inFlight > 0) await new Promise<void>((r) => this.idle.push(r));
    } catch {
      // flush never throws
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.race([this.flush(), new Promise<void>((r) => setTimeout(r, 3000).unref?.())]);
  }

  /** Events still waiting in memory (tests). */
  get pending(): number {
    return this.queued;
  }
}

export interface FromEnvOptions {
  /** Version from package.json. ANALYTICS_APP overrides it (e.g. 0.1.0-dev for a test play). */
  version: string;
  log?: Logger;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Analytics from the environment: a real sender only with ANALYTICS=1 and ANALYTICS_SALT; otherwise NO_ANALYTICS. */
export function analyticsFromEnv(env: Record<string, string | undefined>, o: FromEnvOptions): Analytics {
  if (env.ANALYTICS?.trim() !== '1') return NO_ANALYTICS;
  const salt = env.ANALYTICS_SALT?.trim() ?? '';
  if (salt === '') {
    o.log?.warn('ANALYTICS=1 but ANALYTICS_SALT is not set: analytics stays off');
    return NO_ANALYTICS;
  }
  let app = o.version;
  const override = env.ANALYTICS_APP?.trim();
  if (override) {
    if (APP_RE.test(override)) app = override;
    else o.log?.warn('ANALYTICS_APP is not a valid version label (letters, digits, dots, dashes; 24 at most): ignored');
  }
  const url = env.ANALYTICS_URL?.trim() || undefined;
  const key = env.ANALYTICS_KEY?.trim() || undefined;
  return new AnalyticsSender({ salt, app, url, key, log: o.log, fetch: o.fetch, now: o.now });
}
