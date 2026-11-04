// Smoke test for the village landscape options: every choice draws at every village size, on desktop and phone, without
// bad numbers, and each option is really different from the others. Guards against a missing or broken landscape file
// (which would stop the whole village page from loading).
//
// The art modules use Vite-only features (import.meta.glob), so they are loaded through Vite's own SSR loader.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

type Choice = 'current' | 'A' | 'B' | 'C';
const CHOICES: Choice[] = ['current', 'A', 'B', 'C'];

let server: ViteDevServer;
let Layer: (p: { choice: Choice; tier: number; wide: boolean }) => unknown;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  Layer = (await server.ssrLoadModule('/src/art/landscapes.tsx')).LandscapeLayer;
});

after(async () => {
  await server.close();
});

const draw = (choice: Choice, tier: number, wide: boolean) =>
  renderToString(createElement('svg', null, createElement(Layer as never, { choice, tier, wide })));

test('every landscape draws at every tier, wide and phone, with clean numbers', () => {
  for (const choice of CHOICES) {
    for (const wide of [true, false]) {
      for (const tier of [0, 1, 2, 3]) {
        const html = draw(choice, tier, wide);
        assert.ok(html.includes('vv-land'), `${choice} tier ${tier} draws a landscape layer`);
        assert.ok(!/NaN|undefined|Infinity/.test(html), `${choice} tier ${tier} ${wide ? 'wide' : 'phone'} has no NaN/undefined`);
      }
    }
  }
});

test('the options differ from each other and grow with the village', () => {
  const same = new Set(CHOICES.map((c) => draw(c, 1, true)));
  assert.equal(same.size, CHOICES.length);
  for (const choice of CHOICES) {
    assert.ok(draw(choice, 3, true).length > draw(choice, 0, true).length, `${choice} has more to see at the largest size`);
  }
});
