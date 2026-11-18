// The pencil "Rename village" next to the village name (owner 2026-11-18): always present, labelled, closed until pressed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { RenameButton } from '../src/components/RenameVillage.tsx';

const game = { village: { id: 1, name: 'Ember Hollow' }, applyVillage: () => {}, refresh: async () => {}, toast: () => {} } as unknown as GameApi;
const render = (frame: boolean) => renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(RenameButton, { frame })));

test('the pencil is a labelled button on phone and desktop, and the rename form is closed until it is pressed', () => {
  for (const frame of [false, true]) {
    const html = render(frame);
    assert.match(html, /aria-label="Rename village"/);
    assert.match(html, /title="Rename village"/);
    assert.match(html, /aria-expanded="false"/);
    assert.ok(!html.includes('Village name'), 'form closed');
  }
});

test('the pencil touch target is at least 40 px', () => {
  const css = readFileSync(new URL('../src/hud.css', import.meta.url), 'utf8');
  const sizes = [...css.matchAll(/\.vb-pencil(?:\.is-frame)?\s*\{[^}]*?width:\s*(\d+)px;\s*height:\s*(\d+)px/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(sizes.length >= 2);
  for (const [w, h] of sizes) assert.ok(w! >= 40 && h! >= 40);
});
