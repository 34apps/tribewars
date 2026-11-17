// The Village page must show the whole scene in the first paint that shows the page (owner 2026-11-17: after a Safari reload the scene
// was a plain green box for seconds, then came in batches). Pieces: the visible scene renders in the very first (synchronous) render
// with a live landscape when no kept picture exists; building drawings are released to the scene together; the game clock alone never
// changes what the scene draws; the kept landscape picture store never throws without storage.
//
// The art modules use Vite-only features (import.meta.glob), so they are loaded through Vite's own SSR loader.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILDING_IDS, DEFAULT_WORLD, createPlayerVillage, settleVillage } from '@clanfire/engine';
import type { GameApi } from '../src/game.ts';

let server: ViteDevServer;
let Scene: (p: { mode: 'fit'; selected: null; onSelect: () => void; lazyBack?: boolean }) => unknown;
let GameContext: import('react').Context<GameApi | null>;
let sceneKey: (g: Pick<GameApi, 'village' | 'live' | 'now'>) => string;
let buildings: typeof import('../src/art/buildings.ts');
let backPics: typeof import('../src/views/village/backPics.ts');

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  Scene = (await server.ssrLoadModule('/src/views/village/VillageScene.tsx')).VillageScene;
  sceneKey = (await server.ssrLoadModule('/src/views/village/FrameVillage.tsx')).sceneKey;
  GameContext = (await server.ssrLoadModule('/src/game.ts')).GameContext; // the same module instance the scene uses
  buildings = (await server.ssrLoadModule('/src/art/buildings.ts')) as typeof buildings;
  backPics = (await server.ssrLoadModule('/src/views/village/backPics.ts')) as typeof backPics;
});
after(async () => {
  await server.close();
});

const T0 = 1_800_000_000_000;
function game(now: number, wood = 5000): Pick<GameApi, 'village' | 'live' | 'now'> & Partial<GameApi> {
  const state = createPlayerVillage(T0, { wood, food: 5000, iron: 5000, gold: 5000 });
  const live = settleVillage(state, now, DEFAULT_WORLD);
  return { village: { id: 1, x: 10, y: 10, name: 'Home', hearth: null, state } as never, live, now, settings: DEFAULT_WORLD };
}
const render = (props: object) =>
  renderToStaticMarkup(
    createElement(GameContext.Provider, { value: { ...game(T0 + 1000), applyVillage: () => {}, toast: () => {} } as unknown as GameApi }, createElement(Scene as never, { mode: 'fit', selected: null, onSelect: () => {}, ...props })),
  );

test('the visible scene is complete in its first render: a live landscape and every label, no waiting for a picture', () => {
  const html = render({});
  const labels = html.match(/class="vv-label"/g)?.length ?? 0;
  const built = BUILDING_IDS.filter((id) => game(T0).live.buildings[id] > 0).length;
  assert.equal(labels, built, "a label for every standing building");
  assert.ok(!html.includes('vv-pic'), 'no cached picture yet');
  const back = /<svg class="vv-svg vv-svg-back"[^>]*>([\s\S]*?)<\/svg>\s*<svg class="vv-svg"/.exec(html);
  assert.ok(back && back[1]!.length > 20000, 'the landscape and ground are drawn live, not left empty');
});

test('a scene behind a building page draws no live landscape (it waits for the picture)', () => {
  const html = render({ lazyBack: true });
  const back = /<svg class="vv-svg vv-svg-back"[^>]*><\/svg>/.test(html);
  assert.ok(back);
});

test('the game clock alone never changes what the scene draws; a started job or a new level does', () => {
  const a = sceneKey(game(T0 + 1000, 5000));
  const b = sceneKey(game(T0 + 61_000, 5000));
  assert.equal(a, b, 'a minute later, resources grown: same key');
  const withJob = (now: number) => {
    const g = game(now);
    const live = { ...g.live, buildQueue: [{ building: 'hall', targetLevel: 2, startAt: T0 + 30_000, finishAt: T0 + 90_000 }] } as typeof g.live;
    return sceneKey({ ...g, live });
  };
  assert.equal(withJob(T0 + 1000), withJob(T0 + 20_000), 'queued, not started: same key while waiting');
  assert.notEqual(withJob(T0 + 20_000), withJob(T0 + 40_000), 'the job starts: new key');
  const built = game(T0 + 1000);
  const up = sceneKey({ ...built, live: { ...built.live, buildings: { ...built.live.buildings, farm: built.live.buildings.farm + 1 } } });
  assert.notEqual(up, a);
});

test('sprites that load together are released together (one batch), and a slow one does not hold the others back for long', async () => {
  const real = (globalThis as { fetch?: unknown }).fetch;
  const gates = new Map<string, () => void>();
  (globalThis as { fetch?: unknown }).fetch = (url: string) =>
    new Promise((resolve) => {
      gates.set(url, () => resolve(new Response('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', { status: 200 })));
    });
  try {
    let changes = 0;
    const off = buildings.subscribeSprites(() => (changes += 1));
    const urls = ['/t/a.svg', '/t/b.svg', '/t/c.svg'];
    for (const u of urls) void buildings.loadSprite(u);
    gates.get('/t/a.svg')!();
    gates.get('/t/b.svg')!();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(buildings.readySprite('/t/a.svg'), null, 'a finished file waits for the ones still loading');
    assert.equal(changes, 0);
    gates.get('/t/c.svg')!();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(changes, 1, 'one change for the whole batch');
    assert.ok(urls.every((u) => buildings.readySprite(u)));
    // A slow file: the others are released after the cap.
    for (const u of ['/t/d.svg', '/t/e.svg']) void buildings.loadSprite(u);
    gates.get('/t/d.svg')!();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(buildings.readySprite('/t/d.svg'), 'released although /t/e.svg is still loading');
    gates.get('/t/e.svg')!();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(buildings.readySprite('/t/e.svg'));
    off();
  } finally {
    (globalThis as { fetch?: unknown }).fetch = real;
  }
});

test('the kept landscape picture store never throws when storage is missing', async () => {
  await backPics.restoreBackPics();
  await backPics.backPicsRestored();
  await backPics.persistBackPic('k', { x0: 0, y0: 0, x1: 1, y1: 1 }, '<svg/>');
});
