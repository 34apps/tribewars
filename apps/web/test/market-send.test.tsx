// Market page "Send resources": target parsing, the typed-target states, the quick picks and the panel wiring (the map's ShipmentForm).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import type { ComponentType, Context } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { DEFAULT_WORLD, createPlayerVillage } from '@clanfire/engine';
import type { MapVillageDto, OwnVillageDto, VillageState } from '@clanfire/engine';
import type { GameApi } from '../src/game.ts';
import { ownPicks, parseCoords, typedHint, typedTarget } from '../src/views/village/marketTarget.ts';

let server: ViteDevServer;
let GameContext: Context<GameApi | null>;
let MarketSendPanel: ComponentType<{ phone?: boolean }>;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ GameContext } = await server.ssrLoadModule('/src/game.ts'));
  ({ MarketSendPanel } = await server.ssrLoadModule('/src/views/village/MarketSend.tsx'));
});

after(async () => {
  await server.close();
});

const own = (id: number, name: string, x: number, y: number): OwnVillageDto => ({ id, name, x, y, state: createPlayerVillage(0) });
const mapVillage = (over: Partial<MapVillageDto>): MapVillageDto =>
  ({ id: 9, name: 'Friend', kind: 'player', x: 3, y: 4, ownerName: 'f', points: 10, protected: false, tribeTag: null, tribeId: null, ownerChieftain: null, relation: 'neutral', ...over }) as MapVillageDto;

test('coordinates: x|y, spaces, commas, minus signs; junk and out-of-range text is refused', () => {
  assert.deepEqual(parseCoords('12|-5'), { x: 12, y: -5 });
  assert.deepEqual(parseCoords(' 12 | 5 '), { x: 12, y: 5 });
  assert.deepEqual(parseCoords('−3,−4'), { x: -3, y: -4 });
  assert.deepEqual(parseCoords('7 8'), { x: 7, y: 8 });
  for (const bad of ['', '12', '12|', 'a|b', '1|2|3', '12345|1']) assert.equal(parseCoords(bad), null, bad);
});

test('quick picks are my other villages, never the one I am in', () => {
  const all = [own(1, 'A', 0, 0), own(2, 'B', 5, 5), own(3, 'C', 6, 6)];
  assert.deepEqual(ownPicks(all, 2).map((v) => v.name), ['A', 'C']);
  assert.deepEqual(ownPicks([all[0]!], 1), []);
});

test('typed target: bad text, this village, loading, nothing there, blocked, and a village that can be sent to', () => {
  const here = { x: 0, y: 0 };
  assert.equal(typedTarget('', here, undefined, 1).kind, 'none');
  assert.equal(typedTarget('x', here, undefined, 1).kind, 'bad');
  assert.equal(typedTarget('0|0', here, undefined, 1).kind, 'self');
  assert.equal(typedTarget('3|4', here, undefined, 1).kind, 'loading');
  assert.equal(typedTarget('3|4', here, null, 1).kind, 'empty');
  assert.equal(typedTarget('3|4', here, mapVillage({ kind: 'npc' as never }), 1).kind, 'blocked');
  const ok = typedTarget('3|4', here, mapVillage({}), 1);
  assert.equal(ok.kind, 'ok');
  assert.equal(typedTarget('3|4', here, mapVillage({ kind: 'abandoned' }), 1).kind, 'ok');
  assert.equal(typedTarget('3|4', here, mapVillage({ kind: 'own', id: 2 }), 1).kind, 'ok', 'another village of mine');
  assert.equal(typedTarget('3|4', here, mapVillage({ kind: 'own', id: 1 }), 1).kind, 'blocked', 'the village I am in');
  assert.equal(typedHint(ok), null);
  assert.match(typedHint(typedTarget('x', here, undefined, 1))!, /12\|-5/);
});

function render(market: number, villages: OwnVillageDto[], phone = false): string {
  const live: VillageState = { ...createPlayerVillage(0), resources: { wood: 500, food: 400, iron: 300, gold: 200 } };
  live.buildings.market = market;
  const game = {
    live,
    now: 0,
    settings: DEFAULT_WORLD,
    village: villages[0],
    villages,
    player: { tribe: null },
    applySend: () => {},
    refresh: async () => {},
    toast: () => {},
    viewMovement: () => {},
  } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(MarketSendPanel, { phone })));
}

test('panel: another village is picked first, with the form, capacity and travel time; the coordinates field is always there', () => {
  const html = render(5, [own(1, 'Home', 0, 0), own(2, 'Outpost', 9, 9)]);
  assert.match(html, /Outpost/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /placeholder="x\|y"/);
  assert.match(html, /Wood/);
  assert.match(html, /Total/);
  assert.match(html, /Travel/);
  assert.match(html, /Pick resources/);
  assert.doesNotMatch(html, />Home</, 'the current village is not offered');
});

test('panel: with one village only the coordinates field and a hint show; no Market, no panel; phone uses the card', () => {
  const solo = render(5, [own(1, 'Home', 0, 0)]);
  assert.match(solo, /Type the coordinates/);
  assert.doesNotMatch(solo, /Total/);
  assert.equal(render(0, [own(1, 'Home', 0, 0)]), '');
  assert.match(render(5, [own(1, 'Home', 0, 0)], true), /class="vv-card mk-send is-phone"/);
});
