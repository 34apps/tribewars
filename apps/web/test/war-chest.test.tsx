// War Chest UI: pay-in validation, shortfall text, and the block rendering from state.chest (absent chest hides it).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChestInfo } from '@clanfire/engine';
import { ApiRequestError, api } from '../src/api.ts';
import { chestErrorText, chestMissing, chestPayInAmount, chestShort, chieftainTrainReason, chieftainPriceText } from '../src/chest.ts';
import { WarChestPayIn, WarChestProgress } from '../src/components/WarChest.tsx';
import { DEFAULT_WORLD, createPlayerVillage } from '@clanfire/engine';
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

/** A realistic chest for the Banner Hall card: a deposit of 500 per Chieftain, a village price of 2,000. */
const bannerChest: ChestInfo = { gold: 100, reserved: 0, chieftainPrice: 500, villagePrice: 2000 };

const bannerGame = (over: Record<string, unknown> = {}, queue: unknown[] = []) => {
  const live = { ...createPlayerVillage(0), buildings: { ...createPlayerVillage(0).buildings, bannerhall: 1 }, resources: { wood: 50000, food: 50000, iron: 50000, gold: 5000 } };
  live.trainQueues = { ...live.trainQueues, bannerhall: queue as never };
  return {
    chest: bannerChest,
    renown: { total: 9000, spent: 0, balance: 9000, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0 },
    settings: DEFAULT_WORLD,
    now: 0,
    chains: [],
    holds: [],
    village: { id: 1, hearth: null },
    live,
    ...over,
  } as unknown as Partial<GameApi>;
};

test('Banner Hall page: Feast, the 3 steps, and ALL Chieftain things in one card (train here, no Army link)', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const html = render(bannerGame(), createElement(BannerHallPanel));
  assert.ok(html.includes('Full Feast price') && html.includes('level 2: -10%'));
  assert.ok(html.includes('id="bh-amount"') && /Max\s?\d/.test(html), 'amount field and Max button');
  for (const gone of ['Feasts left today', 'No Feasts left', 'a day', 'Feast all', 'Need 1,600 Renown', 'Each one costs more']) assert.ok(!html.includes(gone), gone);
  assert.ok(html.includes('How taking a village works'));
  assert.equal((html.match(/<li>(Train enough|Send them|Hold the village)/g) ?? []).length, 3);
  assert.ok(html.includes('How many?') && html.includes('A village needs 1, plus 1 for every 12,000 points it has (most 3).'));
  // Header chips, a plain 1 / 2 / 3 control (no prices inside), the bars, the tooltip hint.
  assert.ok(html.includes('At home 0') && html.includes('On the way 0') && html.includes('Training 0'));
  for (const n of [1, 2, 3]) assert.ok(new RegExp(`aria-pressed="${n === 1}"[^>]*>${n}</button>`).test(html), `count ${n}`);
  assert.ok(!/\d Renown ·/.test(html), 'no prices in the count buttons');
  assert.ok(html.includes('role="progressbar"') && html.includes('From Feasts and battles'));
  assert.ok(html.includes('War Chest gold') && html.includes('Pay in'), 'War Chest bar with a compact Pay in');
  assert.ok(html.includes('A deposit is reserved when training starts') && !html.includes('Each extra Chieftain costs more.'), 'tooltip hint only');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('You have 0 at home'), 'what is at home sits next to How many');
  assert.ok(
    text.includes('Each Chieftain: 325 Renown + 500 gold now. The rest of the village price (975 Renown, 1,500 gold) is paid when you send them.'),
    'the deposit and the rest in one plain line',
  );
});

test('Train button: ready shows the time; missing Renown and missing gold say the first thing missing', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const ready = render(bannerGame({ chest: { gold: 5000, reserved: 0, chieftainPrice: 500, villagePrice: 2000 } }), createElement(BannerHallPanel));
  assert.ok(/Train 1 Chieftain · [\dm: ]+s?\b/.test(ready.replace(/<[^>]+>/g, '')) && !/<button[^>]*disabled=""[^>]*bh-train-btn/.test(ready), 'ready');
  assert.ok(!ready.includes('Pay in'), 'no pay-in when the chest is full');
  const noRenown = render(bannerGame({ renown: { total: 100, spent: 0, balance: 100, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0 } }), createElement(BannerHallPanel));
  assert.ok(/[\d,]+ more Renown needed/.test(noRenown), 'missing Renown');
  assert.ok(/<button[^>]*(bh-train-btn[^>]*disabled|disabled[^>]*bh-train-btn)/.test(noRenown));
  const noGold = render(bannerGame(), createElement(BannerHallPanel));
  assert.ok(/[\d,]+ more War Chest gold needed/.test(noGold), 'missing gold');
});

test('Banner Hall shows the training status, open strike chains and villages being held', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const queue = [{ unit: 'chieftain', count: 1, done: 0, startAt: 0, perUnitMs: 5 * 3600_000 - 1000 }];
  const html = render(
    bannerGame(
      {
        now: 1000,
        chains: [{ villageId: 85, name: "Sable's village", x: 3, y: 4, have: 1, need: 3, endsAt: 1000 + 114 * 60_000 }],
        holds: [{ villageId: 9, name: 'Old Fort', x: 1, y: 1, running: true, holdMsLeft: 5 * 3600_000 + 12 * 60_000 }],
      },
      queue,
    ),
    createElement(BannerHallPanel),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('Training 1'), 'chip');
  assert.ok(text.includes('1 × Chieftain · ready in 4:59:'), 'batch row with its clock');
  assert.ok(text.includes("Sable's village") || text.includes('Sable&#x27;s village'));
  assert.ok(html.includes('●○○') && text.includes('1h 54m left') && text.includes('Send 2 more'), 'chain row');
  assert.ok(text.includes('needs 2 more'), 'chain preselects the missing count, minus the Chieftain already in training');
  assert.ok(/aria-pressed="true"[^>]*>1</.test(html), 'count 1 preselected: one of the two is already in training');
  const idle = render(bannerGame({ chains: [{ villageId: 85, name: "Sable's village", x: 3, y: 4, have: 1, need: 3, endsAt: 1000 + 114 * 60_000 }] }), createElement(BannerHallPanel));
  assert.ok(/aria-pressed="true"[^>]*>2</.test(idle), 'count 2 preselected when none is in training');
  assert.ok(text.includes('Old Fort') && text.includes('Hold 5h 12m left'), 'hold row');
  assert.ok(text.includes('Cancel'));
});
