// The game side of the preview: the in-browser backend plus everything that runs it — the 1 s tick (arrivals and the
// computer players), skipping ahead, saving, the showcase and the demo starter pack. It runs in the game worker
// (worker.ts) by default, or in the page itself with ?inpage. No DOM here: the caller passes what it needs in `env`.

import { clock } from './clock.ts';
import { createBackend, type ApiResult, type Backend } from './backend.ts';
import { botTick, seedBots } from './bots.ts';
import type { Save } from './persist.ts';
import { applyShowcase } from './showcase-apply.ts';
import type { ShowcaseStage, StageTops } from './showcase.ts';

const SAVE_DEBOUNCE_MS = 5000; // the page also asks for a save when it is hidden or closed
/** Real time the computer players may use per second of the live timer; at high game speeds the rest waits for the next tick. */
const TICK_BOT_BUDGET_MS = 12;
/** Skipping ahead runs the world in chunks of this much game time, and lets requests in every few chunks. */
const CHUNK_MS = 10 * 60_000;
const YIELD_EVERY = 12;
/** Steps slower than this go to the slow-step log (window.__pvSlow). */
const SLOW_MS = 30;

/** One slow step. `at` is wall-clock ms (performance.timeOrigin + performance.now()), comparable across page and worker. */
export interface SlowStep {
  what: string;
  ms: number;
  at: number;
}

export interface HostEnv {
  /** The page is hidden (computer players then play only every 10th second). */
  isHidden(): boolean;
  /** Store a save; the env also reports whether storage works (the Preview pill's warning). */
  writeSave(save: Save): Promise<void>;
  onSlow(step: SlowStep): void;
}

export interface WorldInfo {
  hasToken: boolean;
  /** The world's own speed setting (speed chip). */
  worldSpeed: number;
  /** When the world started, game ms (speed chip "Day N"). */
  worldStart: number;
}

export interface Host {
  backend: Backend;
  info(): WorldInfo;
  /** One API request, as the fetch shim sends it. Writes schedule a save. */
  request(method: string, path: string, bodyText: string | undefined): Promise<ApiResult>;
  /** Run the world (and the computer players) forward by `ms` of game time, then save. */
  skip(ms: number): Promise<void>;
  /** "Show all buildings": apply, then save and resolve (the page reloads after). */
  showcase(stage: ShowcaseStage, tops: StageTops): Promise<void>;
  /** Save now and resolve when it is stored. */
  flush(): Promise<void>;
  /** Save soon (page hidden or closing); does not wait. */
  flushSoon(): void;
  /** Reset world: stop saving and resolve once no save is in flight (the page then wipes the save). */
  stop(): Promise<void>;
  /** Demo only: starter stores for a just-registered account. */
  grantStarterPack(username: string): void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Open the saved world (or a new one) and start running it. `discardedSave` is true when a damaged save was dropped. */
export async function startHost(saved: Save | null, env: HostEnv): Promise<{ host: Host; discardedSave: boolean }> {
  let backend: Backend | null = null;
  let discardedSave = false;
  if (saved) {
    // Game time first (the world's start-up reads it). Old saves without a clock run on real time at 1x.
    if (saved.clock) clock.restore(saved.clock);
    try {
      backend = await createBackend(saved.db, saved.token);
    } catch (err) {
      // A damaged or incompatible save must not lock the player out: start a fresh world.
      console.warn('The saved world could not be opened; starting a new one.', err);
      discardedSave = true;
      clock.reset();
    }
  }
  if (!backend) backend = await createBackend(null, null);
  const b = backend;
  seedBots(b.ctx);

  const timed = <T>(what: string, fn: () => T): T => {
    const t = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - t;
      if (ms > SLOW_MS) env.onSlow({ what, ms: Math.round(ms), at: Math.round(performance.timeOrigin + t) });
    }
  };

  // ---- saving: one save at a time, in order ----
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = true;
  let chain: Promise<void> = Promise.resolve();
  /** `wait`: retry a moment later inside this call when a transaction is open (the caller waits for the save). */
  const save = async (wait: boolean): Promise<void> => {
    if (stopped || !dirty) return;
    let bytes = timed('save: export', () => b.exportDatabase());
    for (let i = 0; !bytes && wait && i < 20; i++) {
      await sleep(50);
      bytes = timed('save: export', () => b.exportDatabase());
    }
    if (!bytes) {
      if (timer === undefined) timer = setTimeout(flushTimer, 500); // a transaction was open: try again in a moment
      return;
    }
    dirty = false;
    // Dev only (npm run dev:preview): mirror the world to apps/preview/data/preview-world.sqlite (vite.config.ts) so
    // sessions can read it. Not in the built file; a failure (dev server down) stays silent. fetch copies the bytes.
    if (import.meta.env.DEV) {
      void fetch('/__clanfire/preview-world', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-clanfire-mirror': '1' }, body: bytes as Uint8Array<ArrayBuffer> }).catch(() => {});
    }
    const w0 = performance.now();
    await env.writeSave({ db: bytes, token: b.getToken(), clock: clock.snapshot() });
    const wms = performance.now() - w0;
    if (wms > SLOW_MS) env.onSlow({ what: `save: write ${Math.round(bytes.length / 1024)} KB (async)`, ms: Math.round(wms), at: Math.round(performance.timeOrigin + w0) });
  };
  const queueSave = (wait: boolean): Promise<void> => {
    const run = chain.then(() => save(wait));
    chain = run.catch((err: unknown) => console.error('save failed', err));
    return chain;
  };
  function flushTimer(): void {
    timer = undefined;
    void queueSave(false);
  }
  const markDirty = (): void => {
    dirty = true;
    if (timer === undefined && !stopped) timer = setTimeout(flushTimer, SAVE_DEBOUNCE_MS);
  };
  const flushNow = (wait: boolean): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    dirty = true; // the clock moves even when the world did not: always store where it stands
    return queueSave(wait);
  };
  b.onTokenChange = markDirty;
  markDirty(); // first save: the seeded world

  // ---- clock: arrivals are processed on every request and once a second ----
  let tickNo = 0;
  setInterval(() => {
    if (stopped) return;
    const handled = timed('tick: processDue', () => b.processDue());
    let botsActed = false;
    // In a hidden tab the computer players only play every 10th second (nobody is watching; they catch up when it is shown).
    if (env.isHidden() && ++tickNo % 10 !== 0) {
      if (handled > 0) markDirty();
      return;
    }
    try {
      botsActed = timed('tick: bots', () => botTick(b.ctx, TICK_BOT_BUDGET_MS));
    } catch (err) {
      console.error('bot step failed', err);
    }
    if (handled > 0 || botsActed) markDirty();
  }, 1000);

  // ---- skipping ahead runs the world (and the computer players) forward in chunks ----
  let skipping = false;
  const skip = async (ms: number): Promise<void> => {
    if (skipping || stopped) return;
    skipping = true;
    try {
      let left = ms;
      let n = 0;
      while (left > 0) {
        const step = Math.min(CHUNK_MS, left);
        clock.skip(step);
        left -= step;
        b.processDue();
        try {
          botTick(b.ctx);
        } catch (err) {
          console.error('bot step failed', err);
        }
        if (++n % YIELD_EVERY === 0) await sleep(0);
      }
    } finally {
      skipping = false;
      markDirty();
      void flushNow(false); // the speed chip is free again right away; the save follows
    }
  };
  clock.onChange(() => {
    if (!skipping) void flushNow(false); // a skip saves once when it ends
  });

  const bootGameTime = clock.gameNow();
  const host: Host = {
    backend: b,
    info() {
      const t = Number(b.ctx.store.getMeta('world_created_at'));
      return { hasToken: b.getToken() !== null, worldSpeed: b.ctx.settings.speed, worldStart: Number.isFinite(t) && t > 0 ? t : bootGameTime };
    },
    async request(method, path, bodyText) {
      const res = await b.request(method, path, bodyText);
      if (method !== 'GET') markDirty();
      return res;
    },
    skip,
    async showcase(stage, tops) {
      applyShowcase(b.ctx, b.getToken(), stage, tops);
      await flushNow(true);
    },
    flush: () => flushNow(true),
    flushSoon: () => void flushNow(false),
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await chain;
    },
    grantStarterPack: (username) => b.grantStarterPack(username),
  };
  return { host, discardedSave };
}
