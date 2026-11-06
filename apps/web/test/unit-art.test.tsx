// Unit figures (art/UnitFigure.tsx) and the unit info card (components/UnitInfo.tsx): fallback and numbers from engine data.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { BUILDINGS, DEFAULT_WORLD, POP_PER_UNIT, UNITS, UNIT_IDS, emptyUnits, flatTravelTimeMs, trainTimeMs } from '@clanfire/engine';
import type { UnitId, VillageState, WorldSettings } from '@clanfire/engine';
import { formatDuration } from '../src/format.ts';

let server: ViteDevServer;
let fig: {
  UnitFigure: (p: { unit: UnitId; pose?: string; size: number; className?: string }) => ReactElement;
  hasUnitFigure: (u: UnitId, pose?: string) => boolean;
};
let info: {
  UnitInfoBody: (p: { unit: UnitId; settings: WorldSettings; buildings: VillageState['buildings'] }) => ReactElement;
  timePerTileMs: (u: UnitId, s: WorldSettings) => number;
  requiresText: (u: UnitId) => string;
};

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  fig = (await server.ssrLoadModule('/src/art/UnitFigure.tsx')) as typeof fig;
  info = (await server.ssrLoadModule('/src/components/UnitInfo.tsx')) as typeof info;
});

after(async () => {
  await server.close();
});

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

test('every unit has its figure image in every pose (a missing file would fall back to the line icon)', () => {
  for (const u of UNIT_IDS) {
    for (const pose of ['idle', 'march', 'victory', 'defeated', 'icon']) assert.ok(fig.hasUnitFigure(u, pose), `${u} ${pose}`);
    const html = renderToString(createElement(fig.UnitFigure, { unit: u, size: 64 }));
    assert.match(html, /<img /);
    assert.match(html, /alt=""/);
  }
});

test('the unit info card shows the engine numbers for every unit', () => {
  const settings: WorldSettings = { ...DEFAULT_WORLD, speed: 2 };
  const buildings = { ...emptyBuildings(), barracks: 3, stables: 2, drillyard: 1 };
  for (const u of UNIT_IDS) {
    const def = UNITS[u];
    const plain = text(renderToString(createElement(info.UnitInfoBody, { unit: u, settings, buildings })));
    assert.ok(plain.includes(def.name), u);
    assert.ok(plain.includes(def.description), u);
    assert.match(plain, new RegExp(`Attack ${def.attack}\\b`));
    assert.match(plain, new RegExp(`Defence vs infantry ${def.defenseInfantry}\\b`));
    assert.match(plain, new RegExp(`Defence vs cavalry ${def.defenseCavalry}\\b`));
    assert.match(plain, new RegExp(`Carry ${def.carry}\\b`));
    assert.match(plain, new RegExp(`Population ${POP_PER_UNIT[u]}\\b`));
    assert.ok(plain.includes(`${formatDuration(info.timePerTileMs(u, settings))} per tile`), u);
    assert.ok(plain.includes(`${formatDuration(trainTimeMs(u, { buildings } as VillageState, settings))} each`), u);
    assert.ok(plain.includes(info.requiresText(u)), u);
    assert.ok(plain.includes(`${BUILDINGS[def.building].name} ${Math.max(1, buildings[def.building])})`), u);
  }
});

test('time per tile is the send preview rule for one tile', () => {
  const settings: WorldSettings = { ...DEFAULT_WORLD, speed: 1 };
  for (const u of UNIT_IDS) {
    const one = { ...emptyUnits(), [u]: 1 };
    assert.equal(info.timePerTileMs(u, settings), flatTravelTimeMs({ x: 0, y: 0 }, { x: 1, y: 0 }, one, settings));
  }
  assert.ok(info.timePerTileMs('raider', { ...settings, speed: 10 }) < info.timePerTileMs('raider', settings));
});

function emptyBuildings(): VillageState['buildings'] {
  return Object.fromEntries(Object.keys(BUILDINGS).map((b) => [b, 0])) as VillageState['buildings'];
}
