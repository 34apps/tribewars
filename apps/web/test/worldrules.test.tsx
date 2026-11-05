// Per-world rules in the web client: the "World rules" page (values in real time, flags, editable-after-open note), the cached
// config hook with its DEFAULT fallback, and screens reading queue sizes, the tribe limit, hold times and features from the world.

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_WORLD_CONFIG, DEFAULT_WORLD, WORLD_CONFIG_FIELDS, defaultWorldConfig, makeRenownInfo, setWorldConfigValue, villageRenownCost, villageRenownPrice } from '@clanfire/engine';
import type { MyTribeResponse, WorldConfig, WorldConfigResponse, WorldSettings } from '@clanfire/engine';
import { GameContext, useRules } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { loadWorldConfig, readyState, resetWorldConfigCache, useWorldConfig } from '../src/hooks/useWorldConfig.ts';
import type { WorldConfigState } from '../src/hooks/useWorldConfig.ts';
import { realDaysText, realHoursText, ruleGroups, ruleValueText } from '../src/ruleText.ts';
import { TribeContext } from '../src/tribe/context.ts';
import type { TribeApi } from '../src/tribe/context.ts';
import { JoinButton } from '../src/tribe/Join.tsx';
import { chieftainBatchPrice, chieftainsAffordable, hoursText, nextChieftainPrice, selectableUnits, showsSiegePicker, strikeHint } from '../src/villages.ts';
import { WorldRulesPanel } from '../src/views/WorldRulesView.tsx';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function config(speed: number, over: (c: WorldConfig) => WorldConfig = (c) => c): WorldConfig {
  return over(setWorldConfigValue(defaultWorldConfig(), 'pace.speed', speed));
}

function response(c: WorldConfig, extra: Partial<WorldConfigResponse> = {}): WorldConfigResponse {
  return { id: 'w1', name: 'Test World', open: true, openedAt: '2026-11-01T10:00:00.000Z', map: { radius: 60, layout: 'scattered' }, config: c, editableAfterOpen: ['tribe.maxMembers'], ...extra };
}

const page = (r: WorldConfigResponse) => text(renderToStaticMarkup(createElement(WorldRulesPanel, { state: readyState(r) })));

// ---- the page ---------------------------------------------------------------------------------------------

test('page at speed 1: hours stay hours, days become days, no "at speed 1" notes', () => {
  const html = page(response(config(1)));
  assert.ok(html.includes('Test World'));
  assert.ok(html.includes('Open since'));
  assert.ok(html.includes('Hold time, player village 8 h'), html);
  assert.ok(html.includes('Hold time, abandoned village 2 h'), html);
  assert.ok(html.includes('Beginner protection'));
  assert.ok(!html.includes('at speed 1)'), 'no speed-1 notes at speed 1');
  // 48 h and up reads as days.
  const c = setWorldConfigValue(config(1), 'protection.beginnerHours', 72);
  assert.ok(page(response(c)).includes('Beginner protection 3 days'));
});

test('page at speed 10: real time divides by the speed and the speed-1 value is shown', () => {
  const html = page(response(config(10)));
  assert.ok(html.includes('World speed 10×'));
  assert.ok(html.includes('Hold time, player village 48 min (8 h at speed 1)'), html);
  assert.ok(html.includes('Hold time, abandoned village 12 min (2 h at speed 1)'), html);
  // Counts are not scaled: the tribe limit and queues stay as they are.
  assert.ok(html.includes(`Tribe size limit ${DEFAULT_WORLD_CONFIG.tribe.maxMembers}`));
  assert.ok(html.includes(`Build queue ${DEFAULT_WORLD_CONFIG.queues.build}`));
});

test('unit speed shows next to the world speed', () => {
  const c = setWorldConfigValue(config(2), 'pace.unitSpeed', 1.5);
  const html = page(response(c));
  assert.ok(html.includes('World speed 2×'));
  assert.ok(html.includes('Troops and shipments walk at 3×'));
});

test('flags read On and Off, and the non-default numbers show', () => {
  let c = setWorldConfigValue(config(1), 'features.siege', false);
  c = setWorldConfigValue(c, 'queues.build', 4);
  c = setWorldConfigValue(c, 'tribe.maxMembers', 12);
  const html = page(response(c));
  assert.ok(html.includes('Siege (Log Rams, Boulder Slings) Off'), html);
  assert.ok(html.includes('Fire Shrines and the Great Fire On'), html);
  assert.ok(html.includes('Build queue 4'));
  assert.ok(html.includes('Tribe size limit 12'));
});

test('every setting of the engine list has a row', () => {
  const html = renderToStaticMarkup(createElement(WorldRulesPanel, { state: readyState(response(config(1))) }));
  for (const f of WORLD_CONFIG_FIELDS) assert.ok(html.includes(`data-path="${f.path}"`), f.path);
});

test('open world marks only the settings that can still change; a closed world says everything can', () => {
  const open = page(response(config(1), { open: true, editableAfterOpen: ['tribe.maxMembers'] }));
  assert.equal(open.split('Can still change').length - 1, 2, 'one row tag plus the sentence in the note');
  const closed = page(response(config(1), { open: false, openedAt: null }));
  assert.ok(closed.includes('Not open yet'));
  assert.ok(closed.includes('can still change any rule'));
  assert.ok(!closed.includes('Can still change'));
});

test('a failed load shows a plain notice and the standard rules; loading shows a status line', () => {
  const failed: WorldConfigState = { status: 'failed', config: DEFAULT_WORLD_CONFIG, response: null };
  const html = text(renderToStaticMarkup(createElement(WorldRulesPanel, { state: failed })));
  assert.ok(html.includes('could not be loaded'));
  assert.ok(html.includes('Hold time, player village 8 h'));
  const loading = text(renderToStaticMarkup(createElement(WorldRulesPanel, { state: { status: 'loading', config: DEFAULT_WORLD_CONFIG, response: null } })));
  assert.ok(loading.includes('Loading the rules'));
});

test('value words', () => {
  assert.equal(realHoursText(8), '8 h');
  assert.equal(realHoursText(47.5), '47.5 h');
  assert.equal(realHoursText(48), '2 days');
  assert.equal(realHoursText(0.8), '48 min');
  assert.equal(realHoursText(0.01), '36 s');
  assert.equal(realDaysText(14), '14 days');
  assert.equal(realDaysText(1.4), '1.4 days');
  assert.equal(realDaysText(0.5), '12 h');
  const share = WORLD_CONFIG_FIELDS.find((f) => f.path === 'conquest.renownGrowth');
  assert.ok(share);
  assert.equal(ruleValueText(share, 1.5, 4).value, '1.5×');
  const groups = ruleGroups(config(1), []);
  assert.deepEqual(groups.map((g) => g.id), ['pace', 'protection', 'npc', 'conquest', 'domination', 'tribe', 'features', 'queues']);
});

// ---- the hook and its fallback ---------------------------------------------------------------------------

const g = globalThis as { fetch?: unknown; window?: unknown };
const realFetch = g.fetch;
const realWindow = g.window;
afterEach(() => {
  g.fetch = realFetch;
  g.window = realWindow;
  resetWorldConfigCache();
});

function mockFetch(status: number, json: unknown): string[] {
  const urls: string[] = [];
  g.fetch = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(json), { status });
  };
  return urls;
}

test('loadWorldConfig asks /api/world/config under the page prefix, once', async () => {
  g.window = { location: { pathname: '/w/w2/' } };
  const c = config(10);
  const urls = mockFetch(200, response(c));
  const a = await loadWorldConfig();
  await loadWorldConfig();
  assert.deepEqual(urls, ['/w/w2/api/world/config']);
  assert.equal(a.config.pace.speed, 10);
});

test('a failed request is not cached (retry works) and the state falls back to the defaults', async () => {
  g.window = { location: { pathname: '/' } };
  mockFetch(500, { error: 'server_error', message: 'x' });
  await assert.rejects(loadWorldConfig());
  const urls = mockFetch(200, response(config(3)));
  await loadWorldConfig();
  assert.equal(urls.length, 1);
});

test('useWorldConfig returns the defaults before anything has loaded', () => {
  let seen: WorldConfig | null = null;
  const Probe = () => {
    seen = useWorldConfig();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  assert.deepEqual(seen, DEFAULT_WORLD_CONFIG);
});

test('readyState completes a partial or damaged config with the defaults', () => {
  const partial = { ...response(config(1)), config: { pace: { speed: 5 }, queues: { build: 'x' } } } as unknown as WorldConfigResponse;
  const s = readyState(partial);
  assert.equal(s.status, 'ready');
  assert.equal(s.config.pace.speed, 5);
  assert.equal(s.config.pace.unitSpeed, 1);
  assert.equal(s.config.queues.build, DEFAULT_WORLD_CONFIG.queues.build, 'a bad value falls back');
  assert.equal(s.config.tribe.maxMembers, DEFAULT_WORLD_CONFIG.tribe.maxMembers);
});

// ---- screens read the world's rules ----------------------------------------------------------------------

function settingsWith(c: WorldConfig | undefined): WorldSettings {
  return { ...DEFAULT_WORLD, seed: 1, radius: 50, ...(c ? { speed: c.pace.speed, config: c } : {}) } as WorldSettings;
}

function inGame(settings: WorldSettings, el: ReactElement): string {
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: { settings } as unknown as GameApi }, el));
}

test('useRules reads queue sizes and the tribe limit from the settings; no config = the defaults', () => {
  const Probe = () => {
    const r = useRules();
    return createElement('p', null, `${r.queues.build}/${r.queues.train}/${r.queues.research}/${r.tribe.maxMembers}`);
  };
  let c = setWorldConfigValue(defaultWorldConfig(), 'queues.build', 5);
  c = setWorldConfigValue(c, 'queues.train', 9);
  c = setWorldConfigValue(c, 'tribe.maxMembers', 7);
  assert.ok(inGame(settingsWith(c), createElement(Probe)).includes('5/9/'));
  assert.ok(inGame(settingsWith(c), createElement(Probe)).endsWith('/7</p>'));
  const d = DEFAULT_WORLD_CONFIG;
  assert.ok(inGame(settingsWith(undefined), createElement(Probe)).includes(`${d.queues.build}/${d.queues.train}/${d.queues.research}/${d.tribe.maxMembers}`));
});

test('the Join button says Full at this world\'s tribe limit, not the default one', () => {
  const small = setWorldConfigValue(defaultWorldConfig(), 'tribe.maxMembers', 10);
  const tribeApi = { data: { applications: [], invites: [] } as unknown as MyTribeResponse, busy: false, run: async () => undefined, confirm: async () => true, openTribe: () => undefined } as unknown as TribeApi;
  const render = (settings: WorldSettings) =>
    text(
      inGame(
        settings,
        createElement(TribeContext.Provider, { value: tribeApi }, createElement(JoinButton, { t: { id: 1, name: 'Wolves', members: 10, recruitment: 'open' }, onApply: () => undefined })),
      ),
    );
  assert.ok(render(settingsWith(small)).includes('Full'));
  assert.ok(render(settingsWith(undefined)).includes('Join'), 'the default limit is above 10');
});

test('Renown prices follow the world: the settings go to the engine', () => {
  let c = setWorldConfigValue(defaultWorldConfig(), 'conquest.renownBase', 500);
  c = setWorldConfigValue(c, 'conquest.renownGrowth', 2);
  const s = settingsWith(c);
  assert.equal(villageRenownCost(2, s), 1000);
  const info = makeRenownInfo(5000, 0, 2, s);
  assert.equal(info.nextVillageCost, 1000);
  assert.equal(nextChieftainPrice({ ...info, chieftainPrice: undefined, chieftains: 0 }, s), 1000);
  assert.equal(chieftainBatchPrice({ ...info, chieftains: 0 }, 2, s), villageRenownPrice(2, 0, s) + villageRenownPrice(2, 1, s));
  assert.equal(chieftainsAffordable({ ...info, balance: 1000, chieftains: 0 }, 5, s), 1);
  assert.notEqual(nextChieftainPrice({ ...info, chieftainPrice: undefined, chieftains: 0 }), 1000, 'without settings it is the default price');
});

test('strike hint uses the world\'s hold time and chain window, in real time', () => {
  let c = setWorldConfigValue(defaultWorldConfig(), 'conquest.holdHours', 12);
  c = setWorldConfigValue(c, 'conquest.holdHoursAbandoned', 3);
  c = setWorldConfigValue(c, 'conquest.chainWindowHours', 4);
  const s = settingsWith(c);
  assert.ok(strikeHint('player', s).includes('12-hour hold'));
  assert.ok(strikeHint('abandoned', s).includes('3-hour hold'));
  assert.ok(strikeHint('player', s).includes('within 4 hours of each other'));
  // At speed 10 the same rules play out ten times faster.
  const fast = settingsWith(setWorldConfigValue(c, 'pace.speed', 10));
  assert.ok(strikeHint('abandoned', fast).includes('18-minute hold'));
  const noPlayers = settingsWith(setWorldConfigValue(defaultWorldConfig(), 'conquest.playersCanBeConquered', false));
  assert.ok(strikeHint('player', noPlayers).includes('only abandoned villages can be taken'));
  assert.equal(hoursText(1), '1 hour');
  assert.equal(hoursText(8, true), '8-hour');
});

test('siege off hides the siege units and the building picker', () => {
  const home = { ...Object.fromEntries(['pikeman', 'logram', 'boulder'].map((u) => [u, 5])) } as never;
  assert.ok(selectableUnits('attack', home).includes('logram'));
  const off = selectableUnits('attack', home, false);
  assert.ok(off.includes('pikeman'));
  assert.ok(!off.includes('logram') && !off.includes('boulder'));
  assert.equal(showsSiegePicker('attack', { boulder: 2 }), true);
  assert.equal(showsSiegePicker('attack', { boulder: 2 }, false), false);
});
