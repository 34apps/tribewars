// Badges: short chip labels, lobby Hall of Fame (renders / hidden when empty), profile hides empty badges.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BADGE_KINDS } from '@clanfire/engine';
import type { HallOfFameEntryDto, PlayerStatsDto } from '@clanfire/engine';
import { BadgeIcon, BadgeIcons, MemberBadges, BadgeRow, badgeLabel } from '../src/components/Badges.tsx';
import { HallOfFameList } from '../src/components/HallOfFame.tsx';
import { ProfileExtras } from '../src/views/ProfileExtras.tsx';

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('badge labels are short and show counts and places', () => {
  assert.equal(badgeLabel({ badge: 'champion' }), 'Champion');
  assert.equal(badgeLabel({ badge: 'second_tribe', count: 1 }), '2nd tribe');
  assert.equal(badgeLabel({ badge: 'third_tribe' }), '3rd tribe');
  assert.equal(badgeLabel({ badge: 'top10', place: 4 }), 'Top 10 · #4');
  assert.equal(badgeLabel({ badge: 'top10', bestPlace: 2, count: 3 }), 'Top 10 · #2 ×3');
  assert.equal(badgeLabel({ badge: 'veteran', count: 3 }), 'Veteran ×3');
});

test('every badge kind draws an icon; the row is empty without badges', () => {
  for (const k of BADGE_KINDS) assert.match(renderToStaticMarkup(createElement(BadgeIcon, { kind: k, place: 4 })), /<svg/);
  assert.equal(renderToStaticMarkup(createElement(BadgeRow, { badges: [] })), '');
  assert.equal(renderToStaticMarkup(createElement(BadgeIcons, { badges: [] })), '');
  const row = text(renderToStaticMarkup(createElement(BadgeRow, { badges: [{ badge: 'veteran', count: 2, bestPlace: null }] })));
  assert.equal(row, 'Veteran ×2');
});

const world: HallOfFameEntryDto = {
  worldId: 'w1',
  worldName: 'Ember',
  endedAt: 1_700_000_000_000,
  kind: 'domination',
  winner: { name: 'Ember Wolves', tag: 'EW' },
  topTribes: [],
  topPlayers: [{ rank: 1, name: 'Ana', points: 1200, tribeTag: 'EW' }, { rank: 2, name: 'Bo', points: 900, tribeTag: null }],
};

test('Hall of Fame shows a card per world and hides when empty', () => {
  assert.equal(renderToStaticMarkup(createElement(HallOfFameList, { worlds: [] })), '');
  const t = text(renderToStaticMarkup(createElement(HallOfFameList, { worlds: [world] })));
  assert.match(t, /Hall of Fame/);
  assert.match(t, /Ember/);
  assert.match(t, /\[EW\] Ember Wolves/);
  assert.match(t, /Ana/);
});

const stats = {} as PlayerStatsDto;

test('profile shows Badges only when there are some', () => {
  const none = renderToStaticMarkup(createElement(ProfileExtras, { stats, achievements: [], badges: [] }));
  assert.ok(!none.includes('Badges'));
  const some = renderToStaticMarkup(createElement(ProfileExtras, { stats, achievements: [], badges: [{ badge: 'champion', count: 1, bestPlace: null }] }));
  assert.match(text(some), /Badges.*Champion/);
});

test('member rows show badge icons with labels, and nothing without badges', () => {
  assert.equal(renderToStaticMarkup(createElement(MemberBadges, { badges: [] })), '');
  assert.equal(renderToStaticMarkup(createElement(MemberBadges, { badges: undefined })), '');
  const html = renderToStaticMarkup(createElement(MemberBadges, { badges: [{ badge: 'champion', count: 2, bestPlace: null }, { badge: 'top10', count: 1, bestPlace: 4 }] }));
  assert.equal((html.match(/<svg/g) ?? []).length, 2);
  assert.match(html, /aria-label="Champion ×2"/);
  assert.match(html, /aria-label="Top 10 · #4"/);
});

test('profile "This world" row shows only with world badges; Badges section shows for either list', () => {
  const none = renderToStaticMarkup(createElement(ProfileExtras, { stats, achievements: [], badges: [], worldBadges: [] }));
  assert.ok(!none.includes('This world'));
  const acct = renderToStaticMarkup(createElement(ProfileExtras, { stats, achievements: [], badges: [{ badge: 'veteran', count: 1, bestPlace: null }], worldBadges: [] }));
  assert.ok(!acct.includes('This world'));
  const world = renderToStaticMarkup(createElement(ProfileExtras, { stats, achievements: [], badges: [], worldBadges: [{ badge: 'top10', place: 3 }] }));
  assert.match(text(world), /Badges.*This world.*Top 10 · #3/);
  assert.ok(!world.includes('aria-label="Badges"><li') );
});
