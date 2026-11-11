// The game worker: runs the whole in-browser game (sql.js backend, 1 s tick, computer players, skipping ahead, saving)
// off the page's main thread, so the page only draws the client. main.tsx starts it; rpc.ts has the messages.

import { clock } from './clock.ts'; // first: game time for everything below, the same as the page's (synced by snapshots)
import { startHost, type Host } from './host.ts';
import { writeSaveToIdb } from './persist.ts';
import { transferableSave, type Op, type Ops, type PageToWorker, type WorkerToPage } from './rpc.ts';

interface WorkerScope {
  postMessage(msg: WorkerToPage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<PageToWorker>) => void): void;
}
const scope = self as unknown as WorkerScope;
const post = (msg: WorkerToPage, transfer: Transferable[] = []): void => scope.postMessage(msg, transfer);

const SLOW_MS = 30;
let hidden = false;
let host: Host | null = null;
let ready: Promise<Host> | null = null;

// Tell the page about every clock change (a skip changes it many times between two yields: send once per batch).
let clockQueued = false;
clock.onChange(() => {
  if (clockQueued) return;
  clockQueued = true;
  queueMicrotask(() => {
    clockQueued = false;
    post({ kind: 'clock', snap: clock.snapshot() });
  });
});

async function runOp(h: Host, op: Op, args: unknown): Promise<unknown> {
  switch (op) {
    case 'api': {
      const a = args as Ops['api']['args'];
      const t = performance.now();
      const res = await h.request(a.method, a.path, a.body);
      const ms = performance.now() - t;
      if (ms > SLOW_MS) post({ kind: 'slow', step: { what: `api ${a.method} ${a.path.split('?')[0]}`, ms: Math.round(ms), at: Math.round(performance.timeOrigin + t) } });
      return res;
    }
    case 'skip':
      return h.skip((args as Ops['skip']['args']).ms);
    case 'showcase': {
      const a = args as Ops['showcase']['args'];
      return h.showcase(a.stage, a.tops);
    }
    case 'flush':
      return h.flush();
    case 'stop':
      return h.stop();
    case 'grant':
      return h.grantStarterPack((args as Ops['grant']['args']).name);
    case 'run': {
      // Console debugging only (window.clanfirePreview.run); this world lives in the player's own browser.
      const fn = new Function(`return (${(args as Ops['run']['args']).src});`)() as (ctx: unknown, c: typeof clock) => unknown;
      return await fn(h.backend.ctx, clock);
    }
    default:
      throw new Error(`unknown call ${String(op)}`);
  }
}

async function call(id: number, op: Op, args: unknown): Promise<void> {
  try {
    const h = host ?? (await ready);
    if (!h) throw new Error('the game is not started');
    const value = await runOp(h, op, args);
    try {
      post({ kind: 'reply', id, ok: true, value, clock: clock.snapshot() });
    } catch (err) {
      post({ kind: 'reply', id, ok: false, error: `result could not be sent: ${String(err)}`, clock: clock.snapshot() });
    }
  } catch (err) {
    post({ kind: 'reply', id, ok: false, error: err instanceof Error ? err.message : String(err), clock: clock.snapshot() });
  }
}

async function init(msg: Extract<PageToWorker, { kind: 'init' }>): Promise<Host> {
  hidden = msg.hidden;
  const started = await startHost(msg.save, {
    isHidden: () => hidden,
    async writeSave(save) {
      if (await writeSaveToIdb(save)) {
        post({ kind: 'storage', ok: true });
        return;
      }
      const t = transferableSave(save);
      post({ kind: 'save-fallback', save: t.save }, t.transfer);
    },
    onSlow: (step) => post({ kind: 'slow', step }),
  });
  host = started.host;
  post({ kind: 'ready', info: host.info(), discardedSave: started.discardedSave, clock: clock.snapshot() });
  return host;
}

scope.addEventListener('message', (e) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'init':
      if (ready) return;
      ready = init(msg);
      ready.catch((err: unknown) => {
        console.error(err);
        post({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
      });
      return;
    case 'call':
      void call(msg.id, msg.op, msg.args);
      return;
    case 'clock':
      clock.sync(msg.snap); // a rate change on the speed chip; the change listener echoes the result back
      return;
    case 'hidden':
      hidden = msg.hidden;
      return;
  }
});

post({ kind: 'alive' });
