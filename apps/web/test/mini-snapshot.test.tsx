// The small village picture (views/village/miniSnapshot.ts) is an SVG drawn as an image. Such an image is a sealed document: a blob: URL
// inside it and a <use> whose target lives elsewhere both paint nothing (the owner saw a plain green box in Safari). This checks the guard
// that refuses such a source, with the scene's real defs and props, and the store that keeps the pictures.
//
// The art modules use Vite-only features (import.meta.glob), so they are loaded through Vite's own SSR loader.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server: ViteDevServer;
let problems: (xml: string) => string[];
let Defs: () => unknown;
let propItems: () => { node: unknown }[];
let shots: typeof import('../src/views/village/miniShots.ts');

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  problems = (await server.ssrLoadModule('/src/views/village/miniSnapshot.ts')).snapshotProblems;
  const scenery = await server.ssrLoadModule('/src/art/scenery.tsx');
  Defs = scenery.SceneryDefs;
  propItems = scenery.sceneryItems;
  shots = (await server.ssrLoadModule('/src/views/village/miniShots.ts')) as typeof shots;
});
after(async () => {
  await server.close();
});

const svg = (...children: unknown[]) => renderToStaticMarkup(createElement('svg', { xmlns: 'http://www.w3.org/2000/svg' }, ...(children as never[])));

test('a source with the shared defs inlined and no blob: reference has no problems', () => {
  const uses = propItems().map((it) => it.node);
  const xml = svg(createElement('defs', null, createElement(Defs as never)), ...uses);
  assert.ok(uses.length > 20, 'the scene has props');
  assert.match(xml, /<use /);
  assert.deepEqual(problems(xml), []);
});

test('the scene props without the shared defs paint empty: every <use> target is reported missing', () => {
  const xml = svg(...propItems().map((it) => it.node));
  const found = problems(xml);
  assert.ok(found.length > 0);
  assert.ok(found.every((p) => /<use> target #vt-\w+ is missing/.test(p)), found.join('; '));
});

test('a blob: image inside the source is reported', () => {
  const xml = '<svg xmlns="http://www.w3.org/2000/svg"><image href="blob:http://localhost/1234-abcd" x="0" y="0" width="9" height="9"/></svg>';
  assert.deepEqual(problems(xml), ['contains a blob: reference']);
  assert.deepEqual(problems(xml.replace('blob:http://localhost/1234-abcd', 'data:image/png;base64,AAAA')), []);
});

test('xlink:href targets are checked too', () => {
  assert.equal(problems('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#nope"/></svg>').length, 1);
  assert.equal(problems('<svg xmlns="http://www.w3.org/2000/svg"><g id="yes"/><use xlink:href="#yes"/></svg>').length, 0);
});

test('a finished picture is found again, listeners of that village hear about it, a failed one is not retried', () => {
  const heard: string[] = [];
  const off = shots.subscribeMini('9@1,2', () => heard.push('9'));
  const other = shots.subscribeMini('8@1,2', () => heard.push('8'));
  assert.equal(shots.getMini('9@1,2'), undefined);
  shots.putMini('9@1,2', 'k1', { url: 'data:image/jpeg;base64,AAAA' });
  assert.equal(shots.getMini('9@1,2')?.key, 'k1');
  assert.deepEqual(heard, ['9']);
  assert.equal(shots.miniFailed('7@0,0', 'k'), false);
  shots.markMiniFailed('7@0,0', 'k');
  assert.equal(shots.miniFailed('7@0,0', 'k'), true);
  assert.equal(shots.miniFailed('7@0,0', 'k2'), false, 'other buildings try again');
  off();
  other();
});

test('the key shows what the picture shows: levels, running jobs, hearth', () => {
  const q = [{ startAt: 100, building: 'wall', targetLevel: 2 }, { startAt: 900, building: 'barracks', targetLevel: 1 }];
  const a = shots.miniKey({ wall: 1 }, q, 500, true);
  assert.equal(a, shots.miniKey({ wall: 1 }, q, 600, true), 'time passing alone changes nothing');
  assert.notEqual(a, shots.miniKey({ wall: 1 }, q, 1000, true), 'a job that starts shows its scaffold');
  assert.notEqual(a, shots.miniKey({ wall: 2 }, q, 500, true));
  assert.notEqual(a, shots.miniKey({ wall: 1 }, q, 500, false));
});
