// War Chest UI: pay-in validation, shortfall text, and the block rendering from state.chest (absent chest hides it).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChestInfo } from '@clanfire/engine';
import { ApiRequestError, api } from '../src/api.ts';
import { chestErrorText, chestMissing, chestPayInAmount, chestShort, chieftainTrainReason, chieftainPriceText } from '../src/chest.ts';
import { WarChestPayIn, WarChestProgress } from '../src/components/WarChest.tsx';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { NEEDS_CHEST_TEXT } from '../src/shortfall.ts';

const chest: ChestInfo = { gold: 1500, reserved: 2000, chieftainPrice: 3200 };

function render(game: Partial<GameApi>, el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game as GameApi }, el));
}

test('pay-in amount is exactly what is missing, capped by the village gold', () => {
  assert.equal(chestPayInAmount(1700, 5000), 1700);
  assert.equal(chestPayInAmount(1700, 800.9), 800);
  assert.equal(chestPayInAmount(1700, 0), 0);
  assert.equal(chestPayInAmount(0, 100), 0);
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

const villageWith = (gold: number, hearth: unknown = null) =>
  ({ chest, village: { id: 1, hearth }, live: { resources: { wood: 0, food: 0, iron: 0, gold } } }) as unknown as Partial<GameApi>;

test('the progress row shows chest gold over the next price, no ledger labels', () => {
  const html = render({ chest }, createElement(WarChestProgress));
  assert.ok(html.includes('War Chest'));
  assert.ok(html.includes('1,500 / 3,200 gold'));
  assert.ok(!html.includes('Ready'));
  for (const gone of ['Held', 'Missing', 'Still missing']) assert.ok(!html.includes(gone), gone);
  const full = render({ chest: { gold: 5000, reserved: 0, chieftainPrice: 3200 } }, createElement(WarChestProgress));
  assert.ok(full.includes('5,000 / 3,200 gold'));
  assert.ok(full.includes('wc-ready">Ready<'));
});

test('without state.chest the row and the pay-in render nothing', () => {
  assert.equal(render({ chest: undefined }, createElement(WarChestProgress)), '');
  assert.equal(render({ chest: undefined }, createElement(WarChestPayIn)), ''); 
});

test('the pay-in is one button: missing gold when the village has enough, else all its gold', () => {
  assert.ok(render(villageWith(5000), createElement(WarChestPayIn)).includes('Pay in 1,700 gold'));
  assert.ok(render(villageWith(120.7), createElement(WarChestPayIn)).includes('Pay in 120 gold'));
  const html = render(villageWith(5000), createElement(WarChestPayIn));
  assert.ok(!html.includes('<input') && !html.includes('>All<'));
});

test('the pay-in is hidden when nothing is missing and disabled at 0 gold', () => {
  const enough = { ...villageWith(500), chest: { gold: 3200, reserved: 0, chieftainPrice: 3200 } };
  assert.equal(render(enough, createElement(WarChestPayIn)), '');
  const none = render(villageWith(0), createElement(WarChestPayIn));
  assert.ok(none.includes('No gold in this village'));
  assert.ok(/<button[^>]*disabled/.test(none));
});

test('Train is off with a one-line hint when Renown or the chest is short', () => {
  assert.equal(chieftainTrainReason(0, 1000, chest), 'Need 1,000 Renown');
  assert.equal(chieftainTrainReason(1000, 1000, chest), 'Needs War Chest gold');
  assert.equal(chieftainTrainReason(1000, 1000, { gold: 3200, chieftainPrice: 3200 }), null);
  assert.equal(chieftainTrainReason(1000, 1000, undefined), null);
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
