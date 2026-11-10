// Entry of the single-file preview. Boots the in-browser backend (the real server code on sql.js), installs the fetch
// shim for /api/*, then renders the unchanged web client.

import { clock } from './clock.ts'; // first: it replaces Date with the game clock before anything reads the time
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../web/src/App.tsx';
import '../../web/src/styles.css';
import '../../web/src/hud.css';
import '../../web/src/pages.css';
import './preview.css';
import { createBackend, type Backend } from './backend.ts';
import { botTick, seedBots } from './bots.ts';
import { installFetchShim } from './fetch-shim.ts';
import { loadSave, wipeSave, writeSave } from './persist.ts';
import { mountPill } from './pill.ts';
import { mountSpeed } from './speed.ts';
import { applyShowcase } from './showcase-apply.ts';
import { STAGE_TOPS } from '../../web/src/art/buildings.ts';
import { allowDesignPreviewForEveryone, setDesignPreview, setPreviewBuilding, setPreviewLook } from '../../web/src/views/village/designPreviewState.ts';

const SAVE_DEBOUNCE_MS = 2000;

function showFatal(message: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'splash';
  box.setAttribute('role', 'alert');
  const p = document.createElement('p');
  p.textContent = message;
  box.append(p);
  root.append(box);
}

async function openBackend(): Promise<Backend> {
  const saved = await loadSave();
  if (saved) {
    // Game time first (the world's start-up reads it). Old saves without a clock run on real time at 1x.
    if (saved.clock) clock.restore(saved.clock);
    try {
      return await createBackend(saved.db, saved.token);
    } catch (err) {
      // A damaged or incompatible save must not lock the player out: start a fresh world.
      console.warn('The saved world could not be opened; starting a new one.', err);
      await wipeSave();
      clock.reset();
    }
  }
  return createBackend(null, null);
}

async function boot(): Promise<void> {
  const backend = await openBackend();
  seedBots(backend.ctx);

  // ---- saving ----
  let storageOk = true;
  let resetting = false;
  let timer: number | undefined;
  let dirty = true;
  // The preview has no test-mode accounts: let its "Try look animations" button open the village's design preview bar.
  allowDesignPreviewForEveryone();
  const pill = mountPill({
    storage: { ok: true },
    onLookTester: () => {
      setPreviewBuilding(null);
      setPreviewLook(1);
      setDesignPreview(true);
      window.location.hash = 'village';
    },
    onShowcase: (stage) => {
      try {
        applyShowcase(backend.ctx, backend.getToken(), stage, STAGE_TOPS);
      } catch (err) {
        console.error('building showcase failed', err);
        return;
      }
      // Save right away, then reload so the village view redraws from the changed state.
      dirty = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void flush().finally(() => window.location.reload());
    },
    onSampleData: async () => {
      // The route is the real sandbox one (this preview allows every account); it fills the signed-in player only.
      const res = await fetch('/api/sandbox/sample-data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(res.status === 401 ? 'sign in first' : `server said ${res.status}`);
      const out = (await res.json()) as { created: boolean; refreshed?: boolean };
      dirty = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void flush().finally(() => window.location.reload());
      return out.created ? 'Done. Reloading\u2026' : 'Sample reports refreshed';
    },
    onReset: () => {
      resetting = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void wipeSave().finally(() => window.location.reload());
    },
  });
  const flush = async (): Promise<void> => {
    timer = undefined;
    if (resetting || !dirty) return;
    const bytes = backend.exportDatabase();
    if (!bytes) {
      timer = window.setTimeout(() => void flush(), 500); // a transaction was open: try again in a moment
      return;
    }
    dirty = false;
    storageOk = await writeSave({ db: bytes, token: backend.getToken(), clock: clock.snapshot() });
    pill.setStorageOk(storageOk);
  };
  const markDirty = (): void => {
    dirty = true;
    if (timer === undefined && !resetting) timer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };
  backend.onTokenChange = markDirty;
  markDirty(); // first save: the seeded world

  // ---- clock: real time; arrivals are processed on every request and once a second ----
  window.setInterval(() => {
    const handled = backend.processDue();
    let botsActed = false;
    try {
      botsActed = botTick(backend.ctx);
    } catch (err) {
      console.error('bot step failed', err);
    }
    if (handled > 0 || botsActed) markDirty();
  }, 1000);
  const flushNow = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    dirty = true; // the clock moves even when the world did not: always store where it stands
    void flush();
  };

  // ---- game speed: chip on the left edge; skipping runs the world (and the computer players) forward in chunks ----
  const CHUNK_MS = 10 * 60_000;
  const YIELD_EVERY = 12;
  let skipping = false;
  const skipAhead = async (ms: number): Promise<void> => {
    if (skipping || resetting) return;
    skipping = true;
    try {
      let left = ms;
      let n = 0;
      while (left > 0) {
        const step = Math.min(CHUNK_MS, left);
        clock.skip(step);
        left -= step;
        backend.processDue();
        try {
          botTick(backend.ctx);
        } catch (err) {
          console.error('bot step failed', err);
        }
        if (++n % YIELD_EVERY === 0) await new Promise<void>((r) => window.setTimeout(r, 0));
      }
    } finally {
      skipping = false;
      markDirty();
      flushNow();
    }
  };
  const bootGameTime = clock.gameNow();
  const worldStart = (): number => {
    const t = Number(backend.ctx.store.getMeta('world_created_at'));
    return Number.isFinite(t) && t > 0 ? t : bootGameTime;
  };
  const speed = mountSpeed({
    getRate: clock.getRate,
    setRate: (r) => clock.setRate(r),
    getWorldSpeed: () => backend.ctx.settings.speed,
    gameNow: clock.gameNow,
    worldStart,
    skip: skipAhead,
  });
  clock.onChange(() => {
    speed.refresh();
    if (!skipping) flushNow(); // a skip saves once when it ends
  });

  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });

  installFetchShim(backend, markDirty);
  // Debug handle for poking at the in-page server from the console (e.g. clanfirePreview.ctx.store).
  (window as unknown as { clanfirePreview?: unknown }).clanfirePreview = { ctx: backend.ctx };

  // The web client's live-update socket stays off here (no network); polling carries the preview as before.
  (window as unknown as { __CLANFIRE_PREVIEW__?: boolean }).__CLANFIRE_PREVIEW__ = true;

  // Test shortcut (preview build only; this world lives in the page): opening the page with ?demo signs straight into a fresh
  // account, so a phone or simulator can be checked without typing a name and password.
  if (new URLSearchParams(window.location.search).has('demo') && !backend.getToken()) {
    const name = `demo${Math.floor(Math.random() * 1e6)}`;
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'preview-demo-pass' }) }).catch(
      (err: unknown) => {
        console.warn('demo sign-in failed', err);
        return null;
      },
    );
    if (res?.ok) backend.grantStarterPack(name); // the demo shortcut keeps the starter stores; real accounts start from zero
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot().catch((err: unknown) => {
  console.error(err);
  showFatal('The preview could not start in this browser. Try reloading the page.');
});
