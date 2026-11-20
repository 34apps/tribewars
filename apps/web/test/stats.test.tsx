// Analytics in the client (docs/ANALYTICS.md): the only browser part is the page ping and the "Share play stats" switch. Nothing is stored here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STATS_PAGES, type LobbyAccountDto } from '@clanfire/engine';
import { ShareStats } from '../src/components/ShareStats.tsx';
import { MENU_PAGES, RAID_TAB, AUTO_TAB, TABS } from '../src/game.ts';
import { shopFromOf } from '../src/shop.ts';

const account = (shareStats: boolean): LobbyAccountDto => ({ id: 1, username: 'Alice_1', chieftain: 'ysra', staffRole: null, badges: [], shareStats });
const SWITCH_ON = /<input[^>]*role="switch"[^>]*checked=""|<input[^>]*checked=""[^>]*role="switch"/;

test('the stats card of the Account page shows the Share play stats switch, on when the account shares, off when it does not', () => {
  const on = renderToStaticMarkup(createElement(ShareStats, { account: account(true), onChanged: () => {} }));
  assert.match(on, /Share play stats/);
  assert.match(on, SWITCH_ON);
  const off = renderToStaticMarkup(createElement(ShareStats, { account: account(false), onChanged: () => {} }));
  assert.match(off, /Share play stats/);
  assert.doesNotMatch(off, SWITCH_ON);
});

test('every page the client can show (except staff) is on the server list, and the list has nothing else', () => {
  const real = new Set<string>([...TABS, RAID_TAB, AUTO_TAB, ...MENU_PAGES.filter((p) => p !== 'staff')]);
  assert.deepEqual([...real].sort(), [...STATS_PAGES].sort());
});

test('the shop learns where it was opened from: ?from=menu or ?from=feast, anything else is the lobby', () => {
  assert.equal(shopFromOf(''), 'lobby');
  assert.equal(shopFromOf('?from=menu'), 'menu');
  assert.equal(shopFromOf('?from=feast'), 'feast');
  assert.equal(shopFromOf('?from=lobby'), 'lobby');
  assert.equal(shopFromOf('?from=Evil'), 'lobby');
  assert.equal(shopFromOf('?x=1&from=feast'), 'feast');
});
