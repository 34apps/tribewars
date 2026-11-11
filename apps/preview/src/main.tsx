// Entry of the single-file preview. Starts the game (the real server code on sql.js, the 1 s tick, the computer players
// and saving) in a Web Worker so this page's main thread only draws the client; installs the fetch shim for /api/*,
// then renders the unchanged web client. `?inpage` (or a browser without workers) runs the game in the page instead.

import { clock } from './clock.ts'; // first: it replaces Date with the game clock before anything reads the time
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../web/src/App.tsx';
import '../../web/src/styles.css';
import '../../web/src/hud.css';
import '../../web/src/pages.css';
import './preview.css';
import { installFetchShim } from './fetch-shim.ts';
import type { SlowStep } from './host.ts';
import { connectInPage, connectWorker, type GameLink, type LinkEvents } from './link.ts';
import { loadSave, wipeSave } from './persist.ts';
import { mountPill, type Pill } from './pill.ts';
import { mountSpeed } from './speed.ts';
import { STAGE_TOPS } from '../../web/src/art/buildings.ts';
import { allowDesignPreviewForEveryone, setDesignPreview, setPreviewBuilding, setPreviewLook } from '../../web/src/views/village/designPreviewState.ts';

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

// Slow-step log for diagnosing stalls (preview only): window.__pvSlow lists steps over 30 ms. In worker mode the game's
// own steps (tick, bots, save, api) are marked "worker:" (they no longer block this page) and "api rt" is the page's
// round trip of one API call; `at` is this page's performance.now() time.
const slow: { what: string; ms: number; at: number }[] = [];
(window as unknown as { __pvSlow: typeof slow }).__pvSlow = slow;
const logSlow = (prefix: string) => (step: SlowStep): void => {
  slow.push({ what: prefix + step.what, ms: step.ms, at: Math.round(step.at - performance.timeOrigin) });
  if (slow.length > 200) slow.shift();
};

async function connect(events: (mode: 'worker' | 'inpage') => LinkEvents): Promise<GameLink> {
  const saved = await loadSave();
  const wantWorker = !new URLSearchParams(window.location.search).has('inpage') && typeof Worker !== 'undefined';
  if (wantWorker) {
    try {
      return await connectWorker(saved, events('worker'));
    } catch (err) {
      console.warn('The game worker could not start; running the game in the page.', err);
    }
  }
  return connectInPage(saved, events('inpage'));
}

async function boot(): Promise<void> {
  // The pill is mounted once the game is up; storage reports before that are kept here.
  let pill: Pill | null = null;
  let storageOk = true;
  const link = await connect((mode) => ({
    onStorage(ok) {
      storageOk = ok;
      pill?.setStorageOk(ok);
    },
    onSlow: logSlow(mode === 'worker' ? 'worker: ' : ''),
  }));
  if (link.discardedSave) await wipeSave();

  // The preview has no test-mode accounts: let its "Try look animations" button open the village's design preview bar.
  allowDesignPreviewForEveryone();
  pill = mountPill({
    storage: { ok: storageOk },
    onLookTester: () => {
      setPreviewBuilding(null);
      setPreviewLook(1);
      setDesignPreview(true);
      window.location.hash = 'village';
    },
    onShowcase: (stage) => {
      // Saved by the game before it resolves; then reload so the village view redraws from the changed state.
      link.showcase(stage, STAGE_TOPS).then(
        () => window.location.reload(),
        (err: unknown) => console.error('building showcase failed', err),
      );
    },
    onSampleData: async () => {
      // The route is the real sandbox one (this preview allows every account); it fills the signed-in player only.
      const res = await fetch('/api/sandbox/sample-data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(res.status === 401 ? 'sign in first' : `server said ${res.status}`);
      const out = (await res.json()) as { created: boolean; refreshed?: boolean };
      void link.flush().finally(() => window.location.reload());
      return out.created ? 'Done. Reloading…' : 'Sample reports refreshed';
    },
    onReset: () => {
      void link
        .stop()
        .catch(() => {})
        .then(() => wipeSave())
        .finally(() => window.location.reload());
    },
  });
  pill.setStorageOk(storageOk);

  // ---- game speed: chip on the left edge; skipping runs in the game (it moves the clock, which syncs back here) ----
  const speed = mountSpeed({
    getRate: clock.getRate,
    setRate: (r) => {
      clock.setRate(r);
      link.clockChanged();
    },
    getWorldSpeed: () => link.info().worldSpeed,
    gameNow: clock.gameNow,
    worldStart: () => link.info().worldStart,
    skip: (ms) => link.skip(ms),
  });
  clock.onChange(() => speed.refresh());

  window.addEventListener('pagehide', () => link.flushSoon());
  document.addEventListener('visibilitychange', () => {
    link.setHidden(document.hidden);
    if (document.visibilityState === 'hidden') link.flushSoon();
  });

  installFetchShim((m, p, b) => link.request(m, p, b), link.mode === 'worker' ? 'api rt' : 'api');
  (window as unknown as { clanfirePreview?: unknown }).clanfirePreview = link.debug;

  // The web client's live-update socket stays off here (no network); polling carries the preview as before.
  (window as unknown as { __CLANFIRE_PREVIEW__?: boolean }).__CLANFIRE_PREVIEW__ = true;

  // Test shortcut (preview build only; this world lives in the page): opening the page with ?demo signs straight into a fresh
  // account, so a phone or simulator can be checked without typing a name and password.
  if (new URLSearchParams(window.location.search).has('demo') && !link.info().hasToken) {
    const name = `demo${Math.floor(Math.random() * 1e6)}`;
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: 'preview-demo-pass' }) }).catch(
      (err: unknown) => {
        console.warn('demo sign-in failed', err);
        return null;
      },
    );
    if (res?.ok) await link.grant(name).catch((err: unknown) => console.warn('demo starter pack failed', err)); // the demo shortcut keeps the starter stores; real accounts start from zero
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
