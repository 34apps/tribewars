// War Chest UI: pay-in validation, shortfall text, and the block rendering from state.chest (absent chest hides it).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChestInfo } from '@clanfire/engine';
import { ApiRequestError, api } from '../src/api.ts';
import { chestErrorText, chestMissing, chestPayInReason, chestShort, chieftainPriceText, parseChestGold } from '../src/chest.ts';
import { WarChestPayIn, WarChestSummary } from '../src/components/WarChest.tsx';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { NEEDS_CHEST_TEXT } from '../src/shortfall.ts';

const chest: ChestInfo = { gold: 1500, reserved: 2000, chieftainPrice: 3200 };

function render(game: Partial<GameApi>, el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game as GameApi }, el));
}

test('pay-in accepts whole numbers from 1 to the village gold only', () => {
  assert.equal(parseChestGold('250', 1000), 250);
  assert.equal(parseChestGold('1000', 1000), 1000);
  assert.equal(parseChestGold('1', 1000), 1);
  for (const bad of ['', '0', '-5', '2.5', '1e3', 'abc', '1001', ' ']) assert.equal(parseChestGold(bad, 1000), null, bad);
  assert.equal(parseChestGold('5', 0), null);
});

test('pay-in reasons: hearth out, no gold, empty, too much, ok', () => {
  assert.equal(chestPayInReason('10', 100, true), 'The hearth is out');
  assert.equal(chestPayInReason('10', 0, false), 'No gold in this village');
  assert.equal(chestPayInReason('', 100, false), 'Enter an amount');
  assert.equal(chestPayInReason('500', 100, false), 'Not enough gold in this village');
  assert.equal(chestPayInReason('10', 100, false), null);
});

test('server refusals are put in plain words', () => {
  assert.equal(chestErrorText('not_enough_resources', 'x'), 'Not enough gold in this village');
  assert.equal(chestErrorText('requirements_not_met', 'x'), 'The hearth is out');
  assert.equal(chestErrorText('other', 'fallback'), 'fallback');
});

test('the chest is short when its gold is below the next Chieftain price; absent chest is never short', () => {
  assert.equal(chestShort(chest), true);
  assert.equal(chestMissing(chest), 1700);
  assert.equal(chestShort({ gold: 3200, reserved: 0, chieftainPrice: 3200 }), false);
  assert.equal(chestMissing({ gold: 9000, chieftainPrice: 3200 }), 0);
  assert.equal(chestShort(undefined), false);
  assert.equal(NEEDS_CHEST_TEXT, 'Needs War Chest gold');
});

test('price text adds the chest gold only when the server sent a chest', () => {
  assert.equal(chieftainPriceText(1200, chest), '1,200 Renown + 3,200 War Chest gold');
  assert.equal(chieftainPriceText(1200, undefined), '1,200 Renown');
});

test('the summary shows the chest numbers and the missing gold', () => {
  const html = render({ chest }, createElement(WarChestSummary));
  for (const text of ['1,500', '2,000', '3,200', '1,700', 'Still missing']) assert.ok(html.includes(text), text);
  const enough = render({ chest: { gold: 5000, reserved: 0, chieftainPrice: 3200 } }, createElement(WarChestSummary));
  assert.ok(enough.includes('None'));
});

test('without state.chest the block and the pay-in render nothing', () => {
  assert.equal(render({ chest: undefined }, createElement(WarChestSummary)), '');
  assert.equal(render({ chest: undefined }, createElement(WarChestPayIn)), '');
});

test('the pay-in shows the one-way warning and an All button', () => {
  const game = { chest, village: { id: 1, hearth: null }, live: { resources: { wood: 0, food: 0, iron: 0, gold: 120.7 } } } as unknown as Partial<GameApi>;
  const html = render(game, createElement(WarChestPayIn));
  assert.ok(html.includes("Gold paid in can&#x27;t be taken back out. Only Chieftains use it. Raids can&#x27;t touch it."));
  assert.ok(html.includes('up to 120'));
  assert.ok(html.includes('>All<'));
});

test('api.chestDeposit posts {gold} to the village chest route', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ village: {}, chest }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const res = await api.chestDeposit(7, 250);
    assert.deepEqual(res.chest, chest);
    assert.ok(calls[0]?.url.endsWith('/api/villages/7/chest'));
    assert.deepEqual(calls[0]?.body, { gold: 250 });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(ApiRequestError);
});
