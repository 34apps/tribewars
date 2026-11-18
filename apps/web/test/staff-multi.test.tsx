// Staff page "Shared connections": the group card in plain words (risk line, members, links, what happened between them, buttons), the
// section only for moderators, and the random device id the client sends.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MultiGroupDto } from '@clanfire/engine';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { GroupCard, pairLines } from '../src/views/staff/MultiGroups.tsx';
import StaffView from '../src/views/StaffView.tsx';
import { deviceId } from '../src/device.ts';

const NOW = Date.UTC(2026, 10, 18, 12);

function group(over: Partial<MultiGroupDto> = {}): MultiGroupDto {
  return {
    key: '4,9',
    kind: 'connection',
    members: [
      { id: 4, username: 'Kessa', householdShared: false, bannedAt: null, villages: 3, points: 4210, tribeTag: 'EMB', lastActive: NOW - 60_000 },
      { id: 9, username: 'Brann', householdShared: false, bannedAt: null, villages: 1, points: 612, tribeTag: null, lastActive: NOW - 3_600_000 },
    ],
    links: [{ kind: 'device', label: 'device 3fa91c0d', seen: [{ playerId: 4, firstSeen: NOW - 9 * 86_400_000, lastSeen: NOW }, { playerId: 9, firstSeen: NOW - 5 * 86_400_000, lastSeen: NOW - 3_600_000 }] }],
    pairs: [
      {
        a: 4,
        b: 9,
        ship: [{ count: 0, resources: 0, days: 0 }, { count: 0, resources: 0, days: 0 }],
        shipBlocked: 2,
        support: [0, 0],
        supportBlocked: 0,
        attacks: [{ count: 5, noDefence: 5, loot: 7400, lostAttacker: 0, lostDefender: 31 }, { count: 0, noDefence: 0, loot: 0, lostAttacker: 0, lostDefender: 0 }],
        attackBlocked: 0,
        conquests: [1, 0],
        strikes: [0, 0],
        alternating: null,
      },
    ],
    relays: [{ from: 4, via: 20, viaName: 'Thirdman', to: 9, at: NOW - 3_600_000, resources: 900 }],
    flags: [{ code: 'feeding', text: 'Kessa took 7,400 resources from Brann in 5 attacks' }],
    risk: { level: 'high', score: 5, text: 'High risk: Kessa took 7,400 resources from Brann in 5 attacks.' },
    lastEventAt: NOW,
    reviewed: false,
    ...over,
  };
}

function render(g: MultiGroupDto, canBan = true): string {
  const game = { now: NOW, toast: () => {}, player: { id: 1, username: 'mod', staffRole: 'moderator' } } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(GroupCard, { g, now: NOW, canBan, onProfile: () => {}, onChanged: () => {}, onReview: () => {} })));
}

test('a group card shows risk, members with household state, links, interactions, relays and the buttons', () => {
  const html = render(group());
  assert.match(html, /High risk/);
  assert.match(html, /Kessa took 7,400 resources from Brann/);
  assert.match(html, /no household/);
  assert.match(html, /3 villages/);
  assert.match(html, /tribe \[EMB\]/);
  assert.match(html, /device 3fa91c0d/);
  assert.match(html, /Kessa attacked Brann: 5 attacks \(5 met no defence\), loot 7,400/);
  assert.match(html, /Kessa took 1 village from Brann/);
  assert.match(html, /Attempts refused by the same-connection check: shipments 2/);
  assert.match(html, /Relay: Kessa to Thirdman to Brann/);
  assert.match(html, /Mark reviewed/);
  assert.equal((html.match(/>Ban…</g) ?? []).length, 2, 'a Ban button per member');
  assert.match(html, /Open the profile of Kessa/);
});

test('banned members have no Ban button; reviewed groups have no Mark reviewed; support-less view has no Ban at all', () => {
  const g = group();
  g.members[1] = { ...g.members[1]!, bannedAt: NOW - 1000 };
  const html = render({ ...g, reviewed: true });
  assert.equal((html.match(/>Ban…</g) ?? []).length, 1);
  assert.doesNotMatch(html, /Mark reviewed/);
  assert.match(html, /tag-bad">banned/);
  assert.doesNotMatch(render(group(), false), /Ban…/);
});

test('a behaviour-only group says so; a quiet group says nothing happened', () => {
  const html = render(group({ kind: 'behaviour', links: [], pairs: [], relays: [], flags: [], risk: { level: 'low', score: 0, text: 'Low risk: x.' } }));
  assert.match(html, /caught by behaviour, no shared connection/);
  assert.match(html, /Nothing yet/);
  assert.match(html, /tag-ok">Low risk/);
});

test('pair sentences only mention what happened', () => {
  const p = group().pairs[0]!;
  const lines = pairLines(p, (id) => (id === 4 ? 'Kessa' : 'Brann'));
  assert.equal(lines.length, 3);
  assert.deepEqual(pairLines({ ...p, attacks: [p.attacks[1], p.attacks[1]], conquests: [0, 0], shipBlocked: 0 }, () => 'x'), []);
});

function staffPage(role: string): string {
  const game = { now: NOW, toast: () => {}, navigate: () => {}, player: { id: 1, username: 'me', staffRole: role } } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(StaffView)));
}

test('the Shared connections section is for moderators and admins, not for support', () => {
  assert.match(staffPage('moderator'), /Shared connections/);
  assert.match(staffPage('admin'), /Shared connections/);
  assert.doesNotMatch(staffPage('support'), /Shared connections/);
});

test('the device id is one random 128-bit hex id, kept for the browser', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const id = deviceId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(deviceId(), id);
  assert.equal(store.get('clanfire_device'), id);
});
