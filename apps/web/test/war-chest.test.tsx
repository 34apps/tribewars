// War Chest UI: pay-in validation, shortfall text, and the block rendering from state.chest (absent chest hides it).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChestInfo } from '@clanfire/engine';
import { ApiRequestError, api } from '../src/api.ts';
import { chestErrorText, chestFillAmount, chestMissing, chestWholePrice, chestBatchDue, chestBatchPrice, chestPayInAmount, chestShort, chieftainTrainReason } from '../src/chest.ts';
import { WarChestPayIn } from '../src/components/WarChest.tsx';
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

const wholeChest: ChestInfo = { gold: 100, reserved: 0, chieftainPrice: 800, chieftainPrices: [800, 1280, 2048], villagePrice: 800 };
const villageWith = (gold: number, hearth: unknown = null, c: ChestInfo = wholeChest) =>
  ({ chest: c, village: { id: 1, hearth }, live: { resources: { wood: 0, food: 0, iron: 0, gold } } }) as unknown as Partial<GameApi>;

test('the whole price is the next Chieftain price; fill is price minus chest, capped by village gold; a batch adds the prices', () => {
  assert.equal(chestWholePrice(wholeChest), 800);
  assert.equal(chestFillAmount(wholeChest, 5000), 700);
  assert.equal(chestFillAmount(wholeChest, 300.9), 300);
  assert.equal(chestFillAmount({ ...wholeChest, gold: 800 }, 5000), 0);
  assert.equal(chestFillAmount({ ...wholeChest, gold: 9000 }, 5000), 0);
  assert.equal(chestBatchPrice(wholeChest, 1), 800);
  assert.equal(chestBatchPrice(wholeChest, 3), 800 + 1280 + 2048);
  assert.equal(chestBatchDue({ ...wholeChest, banked: 500 }, 2), 800 + 1280 - 500, 'banked gold comes off');
  assert.equal(chestBatchDue({ ...wholeChest, banked: 99999 }, 2), 0);
  assert.equal(chestBatchPrice({ chieftainPrice: 500 }, 2), 1000, 'an older server: the next price for each');
});

test('without state.chest the pay-in renders nothing', () => {
  assert.equal(render({ chest: undefined }, createElement(WarChestPayIn)), '');
});

test('the pay-in is always there: amount field, Fill to next Chieftain, All gold here, Pay in', () => {
  const html = render(villageWith(5000), createElement(WarChestPayIn));
  assert.ok(html.includes('<input') && html.includes('inputMode="numeric"'));
  assert.ok(html.includes('Fill to next Chieftain (700)') && html.includes('All gold here (5,000)'));
  assert.ok(/<button[^>]*disabled[^>]*>Pay in</.test(html), 'Pay in waits for an amount');
  assert.ok(html.includes('taken back out'));
  assert.ok(render(villageWith(120.7), createElement(WarChestPayIn)).includes('Fill to next Chieftain (120)'));
});

test('the pay-in stays when the chest already covers the Chieftain; Fill is hidden then', () => {
  const html = render(villageWith(500, null, { ...wholeChest, gold: 800 }), createElement(WarChestPayIn));
  assert.ok(html.includes('<input') && html.includes('All gold here (500)'));
  assert.ok(!html.includes('Fill to next Chieftain'));
});

test('hearth out and no gold give the plain reason and switch the controls off', () => {
  const none = render(villageWith(0), createElement(WarChestPayIn));
  assert.ok(none.includes('No gold in this village'));
  assert.ok(/<input[^>]*disabled/.test(none) && /<button[^>]*disabled[^>]*>Pay in</.test(none));
  const cold = render(villageWith(900, { until: 1 }), createElement(WarChestPayIn));
  assert.ok(cold.includes('The hearth is out'));
  assert.ok(/<input[^>]*disabled/.test(cold) && /<button[^>]*disabled[^>]*>All gold here/.test(cold));
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

/** A realistic chest for the Banner Hall card: the next Chieftain costs 500 gold, then 800, then 1,280 (the whole village price each). */
const bannerChest: ChestInfo = { gold: 100, reserved: 0, chieftainPrice: 500, chieftainPrices: [500, 800, 1280], villagePrice: 500 };

const bannerGame = (over: Record<string, unknown> = {}, queue: unknown[] = []) => {
  const live = { ...createPlayerVillage(0), buildings: { ...createPlayerVillage(0).buildings, bannerhall: 1 }, resources: { wood: 50000, food: 50000, iron: 50000, gold: 5000 } };
  live.trainQueues = { ...live.trainQueues, bannerhall: queue as never };
  return {
    chest: bannerChest,
    renown: { total: 9000, spent: 0, balance: 9000, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0, chieftainPrice: 1300, chieftainPrices: [1300, 2080, 3328], chieftainsHeld: 0 },
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
  assert.equal((html.match(/<li>(Train Chieftains here|Send them from the map|Hold the village)/g) ?? []).length, 3);
  assert.ok(html.includes('How many?') && html.includes('A village needs 1, plus 1 for every 12,000 points it has (most 3).'));
  // Header chips, a plain 1 / 2 / 3 control (no prices inside), the bars, the tooltip hint.
  assert.ok(html.includes('At home 0') && html.includes('On the way 0') && html.includes('Training 0'));
  for (const n of [1, 2, 3]) assert.ok(new RegExp(`aria-pressed="${n === 1}"[^>]*>${n}</button>`).test(html), `count ${n}`);
  assert.ok(!/\d Renown ·/.test(html), 'no prices in the count buttons');
  assert.ok(html.includes('role="progressbar"') && !html.includes('From Feasts and battles'));
  assert.ok(html.includes('Price: your 2nd village'), 'price title');
  assert.ok(html.includes('9,000 / 1,300') && html.includes('100 / 500') && html.includes('War Chest gold'), 'one Renown bar, one War Chest gold bar');
  assert.ok(html.includes('400 gold missing: pay in below') && html.includes('Fill to next Chieftain (400)') && html.includes('All gold here (5,000)'), 'the pay-in sits on the gold bar');
  for (const gone of ['Deposit for training', 'A deposit is reserved', 'rest of the village price', 'is paid when you send them']) assert.ok(!html.includes(gone), gone);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('Paid in full when trained. Sending him costs nothing more. If he dies or you cancel him, the price stays banked: the next Chieftain costs only resources.'));
  assert.ok(!text.includes('Banked from earlier'), 'no banked line when nothing is banked');
  assert.ok(!text.includes('1st 1,300'), 'no breakdown for one Chieftain');
  assert.ok(text.includes('Train Chieftains here. Each one pays the price of one village when you train him.'));
  assert.ok(text.includes('Hold the village for') && !text.includes('Support box'));
  assert.ok(text.includes('At home 0') && !text.includes('You have 0 at home'), 'what is at home is the header chip only (no wrapped second line)');
});

test('Banner Hall: for 2 Chieftains the title names two villages, the bars add the prices, a breakdown and the missing Renown', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const chains = [{ villageId: 85, name: 'Sable', x: 3, y: 4, have: 1, need: 3, endsAt: 1000 + 114 * 60_000 }];
  const html = render(
    bannerGame({ now: 1000, chains, renown: { total: 2000, spent: 0, balance: 2000, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0, chieftainPrice: 1300, chieftainPrices: [1300, 2080, 3328], chieftainsHeld: 0 } }),
    createElement(BannerHallPanel),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('Price: your 2nd and 3rd villages'));
  assert.ok(text.includes('2,000 / 3,380') && text.includes('1,380 Renown missing: hold Feasts in this hall or win battles'), 'Renown: balance against the first two prices added');
  assert.ok(text.includes('100 / 1,300'), 'gold: chest against 500 + 800');
  assert.ok(text.includes('1st 1,300 · 2nd 2,080 Renown'));
  assert.ok(text.includes('1,380 more Renown needed'), 'the Train button says why');
});

test('Banked Renown and gold lower the bars and show one line', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const html = render(
    bannerGame({
      renown: { total: 2000, spent: 0, balance: 2000, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0, chieftainPrice: 300, chieftainPrices: [1300, 2080, 3328], chieftainsHeld: 0, banked: 1000 },
      chest: { gold: 100, reserved: 0, banked: 200, chieftainPrice: 300, chieftainPrices: [500, 800, 1280] },
    }),
    createElement(BannerHallPanel),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('2,000 / 300') && text.includes('100 / 300'), 'bars count the price minus the bank');
  assert.ok(text.includes('Banked from earlier Chieftains: 1,000 Renown + 200 gold'));
  assert.ok(text.includes('200 gold missing: pay in below'));
});

test('Train button: ready shows the time; missing Renown and missing gold say the first thing missing', async () => {
  const { BannerHallPanel } = await import('../src/views/village/BannerHall.tsx');
  const ready = render(bannerGame({ chest: { gold: 5000, reserved: 0, chieftainPrice: 500, chieftainPrices: [500, 800, 1280] } }), createElement(BannerHallPanel));
  assert.ok(/Train 1 Chieftain · [\dm: ]+s?\b/.test(ready.replace(/<[^>]+>/g, '')) && !/<button[^>]*disabled=""[^>]*bh-train-btn/.test(ready), 'ready');
  assert.ok(ready.includes('5,000 / 500') && !ready.includes('gold missing') && !ready.includes('Fill to next Chieftain') && ready.includes('All gold here'), 'chest covers the price: no missing text, no Fill, pay-in stays');
  const noRenown = render(bannerGame({ renown: { total: 100, spent: 0, balance: 100, nextVillageCost: 1300, villages: 1, reserved: 0, chieftains: 0, chieftainPrice: 1300, chieftainPrices: [1300, 2080, 3328], chieftainsHeld: 0 } }), createElement(BannerHallPanel));
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
  assert.ok(html.includes('●○○') && text.includes('1 of 3 Chieftains arrived, 1h 54m left') && !/Send \d more/.test(text), 'chain row, status only: nothing here starts a send');
  assert.ok(text.includes('needs 2 more'), 'chain preselects the missing count, minus the Chieftain already in training');
  assert.ok(/aria-pressed="true"[^>]*>1</.test(html), 'count 1 preselected: one of the two is already in training');
  const idle = render(bannerGame({ chains: [{ villageId: 85, name: "Sable's village", x: 3, y: 4, have: 1, need: 3, endsAt: 1000 + 114 * 60_000 }] }), createElement(BannerHallPanel));
  assert.ok(/aria-pressed="true"[^>]*>2</.test(idle), 'count 2 preselected when none is in training');
  assert.ok(text.includes('Old Fort') && text.includes('Hold 5h 12m left'), 'hold row');
  assert.ok(text.includes('Cancel'));
});
