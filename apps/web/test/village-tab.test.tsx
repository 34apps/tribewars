// The phone village tab under the top band: name, "−9 | 24" coordinate tag, protection tag while protected, switcher chevron only with several villages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPlayerVillage } from '@clanfire/engine';
import { VillageBar } from '../src/components/VillageSwitcher.tsx';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';

const NOW = 1_000_000;
const DAY = 86_400_000;

function render(opts: { name?: string; protectedMs?: number; villages?: number; frame?: boolean } = {}): string {
  const live = { ...createPlayerVillage(0), id: 1, name: opts.name ?? 'Oakridge', x: -9, y: 24 };
  const villages = Array.from({ length: opts.villages ?? 1 }, (_, i) => ({ ...live, id: i + 1, hearth: null, state: { resources: live.resources } }));
  const game = {
    village: { ...live, hearth: null },
    villages,
    villageList: null,
    live,
    now: NOW,
    tab: 'village',
    player: { protectedUntil: NOW + (opts.protectedMs ?? 0) },
    selectVillage: () => {},
    navigate: () => {},
    applyVillage: () => {},
    refresh: async () => {},
    toast: () => {},
  } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(VillageBar, { frame: opts.frame })));
}

test('the tab shows the village name and the filled coordinate tag with a true minus and spaces around the bar', () => {
  const html = render();
  assert.match(html, /class="vtab"/);
  assert.match(html, />Oakridge</);
  assert.match(html, /class="vtag vtag-xy">−9 \| 24</);
  assert.match(html, /aria-label="Rename village"/);
});

test('while protected the tab carries a teal tag with the time left and an explaining label', () => {
  const html = render({ protectedMs: 2 * DAY + 23 * 3_600_000 });
  assert.match(html, /class="vtag vtag-prot"/);
  assert.match(html, />2d</);
  assert.match(html, /title="Protected from attacks for 2d 23h"/);
  assert.match(html, /aria-label="Protected from attacks, 2d 23h left"/);
});

test('no protection tag when the village is not protected', () => {
  assert.ok(!render({ protectedMs: -1000 }).includes('vtag-prot'));
  assert.ok(!render().includes('Protected'));
});

test('the name is a plain label with one village and the switcher button with a chevron with several', () => {
  const one = render();
  assert.ok(!one.includes('Switch village'));
  assert.ok(!one.includes('vtab-chev'));
  assert.match(one, /class="vtab-name is-static"/);
  const many = render({ villages: 3 });
  assert.match(many, /<button type="button" class="vtab-name"[^>]*aria-haspopup="true"/);
  assert.match(many, /Switch village/);
  assert.match(many, /class="vtab-chev"/);
  assert.ok(!many.includes('vsw-pop'), 'list closed until pressed');
});

test('a long name stays one ellipsized line (the text span is the only part that shrinks)', () => {
  const html = render({ name: 'The Northern Riverside Hold', villages: 2 });
  assert.match(html, /class="vtab-name-text">The Northern Riverside Hold</);
});

test('the desktop frame bar keeps its own look (no tab)', () => {
  const html = render({ frame: true });
  assert.ok(!html.includes('class="vtab"'));
  assert.match(html, /fr-vrow/);
});
