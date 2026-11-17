// The page's handle on the game: either the game worker (default) or, with ?inpage or when workers are unavailable,
// the same game run right in the page (the old way; design tooling that reads clanfirePreview.ctx needs it).

import type { ApiResult } from './backend.ts';
import { clock } from './clock.ts';
import { startHost, type SlowStep, type WorldInfo } from './host.ts';
import { writeSave, type Save } from './persist.ts';
import { createRpcClient, type PageToWorker, type WorkerToPage } from './rpc.ts';
import type { ShowcaseStage, StageTops } from './showcase.ts';
import GameWorker from './worker.ts?worker&inline';

export interface LinkEvents {
  onStorage(ok: boolean): void;
  onSlow(step: SlowStep): void;
  /** The game worker died after it had started: the page shows a plain message. */
  onFatal(message: string): void;
}

export const WORKER_DEAD_MESSAGE = 'The game stopped. Reload the page — your world is saved.';

export interface GameLink {
  mode: 'worker' | 'inpage';
  discardedSave: boolean;
  info(): WorldInfo;
  request(method: string, path: string, body: string | undefined): Promise<ApiResult>;
  skip(ms: number): Promise<void>;
  showcase(stage: ShowcaseStage, tops: StageTops): Promise<void>;
  flush(): Promise<void>;
  flushSoon(): void;
  stop(): Promise<void>;
  grant(name: string): Promise<void>;
  /** The speed chip changed this page's clock rate: tell the game. */
  clockChanged(): void;
  setHidden(hidden: boolean): void;
  /** window.clanfirePreview */
  debug: Record<string, unknown>;
}

const fnSource = (fn: string | ((...a: never[]) => unknown)): string => (typeof fn === 'function' ? fn.toString() : fn);

export async function connectInPage(saved: Save | null, ev: LinkEvents): Promise<GameLink> {
  const { host, discardedSave } = await startHost(saved, {
    isHidden: () => document.hidden,
    async writeSave(save) {
      ev.onStorage(await writeSave(save));
    },
    onSlow: ev.onSlow,
  });
  const ctx = host.backend.ctx;
  return {
    mode: 'inpage',
    discardedSave,
    info: () => host.info(),
    request: (m, p, b) => host.request(m, p, b),
    skip: (ms) => host.skip(ms),
    showcase: (stage, tops) => host.showcase(stage, tops),
    flush: () => host.flush(),
    flushSoon: () => host.flushSoon(),
    stop: () => host.stop(),
    grant: async (name) => host.grantStarterPack(name),
    clockChanged: () => {}, // one clock for both
    setHidden: () => {},
    // Debug handle for poking at the in-page server from the console (e.g. clanfirePreview.ctx.store).
    debug: {
      mode: 'inpage',
      ctx,
      run: async (fn: string | ((c: typeof ctx, k: typeof clock) => unknown)) =>
        (new Function(`return (${fnSource(fn as string)});`)() as (c: typeof ctx, k: typeof clock) => unknown)(ctx, clock),
    },
  };
}

/** No sign of life from the worker script within this time: it is blocked (e.g. a page policy), run in the page. */
const ALIVE_TIMEOUT_MS = 15_000;

export function connectWorker(saved: Save | null, ev: LinkEvents): Promise<GameLink> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new GameWorker();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let started = false;
    let settled = false;
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(why));
    };
    const post = (msg: PageToWorker, transfer: Transferable[] = []): void => worker.postMessage(msg, transfer);
    const rpc = createRpcClient(post, (snap) => clock.sync(snap));
    const workerDied = (): void => {
      rpc.failAll(WORKER_DEAD_MESSAGE);
      ev.onFatal(WORKER_DEAD_MESSAGE);
    };
    const aliveTimer = setTimeout(() => fail('the game worker did not start'), ALIVE_TIMEOUT_MS);

    worker.addEventListener('error', (e) => {
      // Before it is ready a worker error means it cannot run here (the page falls back); later it is a logged bug.
      if (!started) fail(`game worker error: ${e.message || 'unknown'}`);
      else {
        console.error('game worker error', e.message, e);
        workerDied();
      }
    });
    worker.addEventListener('messageerror', (e) => {
      console.error('game worker message error', e);
      if (started) workerDied();
    });
    worker.addEventListener('message', (e: MessageEvent<WorkerToPage>) => {
      const msg = e.data;
      if (rpc.handle(msg)) return;
      switch (msg.kind) {
        case 'alive':
          clearTimeout(aliveTimer);
          return;
        case 'failed':
          clearTimeout(aliveTimer);
          fail(msg.error);
          return;
        case 'ready': {
          clearTimeout(aliveTimer);
          started = true;
          settled = true;
          clock.sync(msg.clock);
          resolve(makeLink(msg.info, msg.discardedSave));
          return;
        }
        case 'clock':
          clock.sync(msg.snap);
          return;
        case 'storage':
          ev.onStorage(msg.ok);
          return;
        case 'save-fallback':
          void writeSave(msg.save).then(ev.onStorage);
          return;
        case 'slow':
          ev.onSlow(msg.step);
          return;
      }
    });
    // A copy, not a transfer: the page keeps the bytes in case it has to run the game itself.
    post({ kind: 'init', save: saved, hidden: document.hidden });

    const makeLink = (info: WorldInfo, discardedSave: boolean): GameLink => ({
      mode: 'worker',
      discardedSave,
      info: () => info,
      request: (method, path, body) => rpc.call('api', { method, path, body }),
      skip: (ms) => rpc.call('skip', { ms }),
      showcase: (stage, tops) => rpc.call('showcase', { stage, tops }),
      flush: () => rpc.call('flush', {}),
      flushSoon: () => void rpc.call('flush', {}).catch(() => {}),
      stop: () => rpc.call('stop', {}),
      grant: (name) => rpc.call('grant', { name }),
      clockChanged: () => post({ kind: 'clock', snap: clock.snapshot() }),
      setHidden: (hidden) => post({ kind: 'hidden', hidden }),
      // The world lives in the game worker; ask it with e.g. await clanfirePreview.run((ctx) => ctx.store.getMeta('world_created_at')).
      debug: {
        mode: 'worker',
        worker,
        run: (fn: string | ((ctx: never, c: never) => unknown)) => rpc.call('run', { src: fnSource(fn) }),
      },
    });
  });
}
