// Fill-up resource pills: fill state per Storehouse ratio, no red/underline signal on the number, and the tap card with the exact amount.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_WORLD, createPlayerVillage, storageCap } from '@clanfire/engine';
import { ResourcePills, fillState, fullInText, pillLabel } from '../src/components/ResourcePills.tsx';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';

const village = createPlayerVillage(0);
const cap = storageCap(village);

function render(wood: number, food: number, props: { compact?: boolean; initialOpen?: 'wood' | 'food' | 'iron' | 'gold' } = {}): string {
  const live = { ...village, resources: { wood, food, iron: 10, gold: 0 } };
  const game = { live, settings: DEFAULT_WORLD } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(ResourcePills, props)));
}

test('fill state: ok below 90%, near from 90%, full from 99.9%', () => {
  assert.equal(fillState(0.5), 'ok');
  assert.equal(fillState(0.9), 'near');
  assert.equal(fillState(0.998), 'near');
  assert.equal(fillState(0.999), 'full');
  assert.equal(fillState(1), 'full');
});

test('time until full: hours, none when full or not growing', () => {
  assert.equal(fullInText(0, 2700, 100), '27h');
  assert.equal(fullInText(2700, 2700, 100), null);
  assert.equal(fullInText(10, 2700, 0), null);
  assert.equal(fullInText(2650, 2700, 100), '30m');
});

test('screen-reader label says amount, cap, rate and full / almost full', () => {
  assert.equal(pillLabel('Food', 2_000_000, 2_000_000, 902, 'full'), 'Food: 2,000,000 of 2,000,000, plus 902 per hour, full');
  assert.match(pillLabel('Wood', 950, 1000, 5, 'near'), /almost full$/);
});

test('a full resource gets the full state; the number is plain (no danger class, no underline)', () => {
  const html = render(10, cap);
  assert.match(html, /class="rp is-full"[^>]*data-res="food"/);
  assert.match(html, /class="rp is-ok"[^>]*data-res="wood"/);
  assert.ok(!html.includes('is-near-full'));
  assert.ok(!html.includes('underline'));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Food: [\d,]+ of [\d,]+, plus \d+ per hour, full/);
  assert.ok(!html.includes('class="rp-card"'), 'closed by default');
});

test('90% fills gold (near)', () => {
  assert.match(render(Math.floor(cap * 0.92), 10), /class="rp is-near"[^>]*data-res="wood"/);
});

test('an open pill shows the card with the exact amount, the FULL tag and the storage-full warning', () => {
  const html = render(10, cap, { initialOpen: 'food' });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<dd>[\d,]+<\/dd>/);
  assert.ok(html.includes(`<dd>${cap.toLocaleString()}</dd>`));
  assert.match(html, /FULL/);
  assert.match(html, /Storage is full: new food is lost/);
  const early = render(500, 10, { initialOpen: 'wood', compact: true });
  assert.match(early, /<dd>500<\/dd>/);
  assert.match(early, /Full in/);
  assert.ok(!early.includes('FULL'));
});

test('phone pills show the number only (no rate text)', () => {
  const html = render(999_999, 10, { compact: true });
  assert.ok(html.includes('>999k<'));
  assert.ok(!html.includes('rp-rate'));
});
