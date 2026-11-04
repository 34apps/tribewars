// Entry of the single-file preview. Boots the in-browser backend (the real server code on sql.js), installs the fetch
// shim for /api/*, then renders the unchanged web client.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../web/src/App.tsx';
import '../../web/src/styles.css';
import './preview.css';
import { createBackend, type Backend } from './backend.ts';
import { botTick, seedBots } from './bots.ts';
import { installFetchShim } from './fetch-shim.ts';
import { loadSave, wipeSave, writeSave } from './persist.ts';
import { mountPill } from './pill.ts';

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
    try {
      return await createBackend(saved.db, saved.token);
    } catch (err) {
      // A damaged or incompatible save must not lock the player out: start a fresh world.
      console.warn('The saved world could not be opened; starting a new one.', err);
      await wipeSave();
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
  const pill = mountPill({
    storage: { ok: true },
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
    storageOk = await writeSave({ db: bytes, token: backend.getToken() });
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
    void flush();
  };
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });

  installFetchShim(backend, markDirty);
  // Debug handle for poking at the in-page server from the console (e.g. clanfirePreview.ctx.store).
  (window as unknown as { clanfirePreview?: unknown }).clanfirePreview = { ctx: backend.ctx };

  // The web client's live-update socket stays off here (no network); polling carries the preview as before.
  (window as unknown as { __CLANFIRE_PREVIEW__?: boolean }).__CLANFIRE_PREVIEW__ = true;

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
