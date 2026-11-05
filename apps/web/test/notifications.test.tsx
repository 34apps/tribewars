// Incoming-warning notifications (docs/GAME_DESIGN.md 18.10): the browser-alert decider, the guarded Notification wrappers, the
// API client calls, the bell and the list render. Also the 2026-11-05 clean-up: no upkeep line, no loot share in the web client.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { NotificationDto } from '@clanfire/engine';
import { api } from '../src/api.ts';
import { BrowserAlertsBox, NotificationBell, NotificationList } from '../src/components/Notifications.tsx';
import {
  MAX_ALERTS_PER_FETCH,
  NOTIFICATIONS_SHOWN,
  announceNew,
  browserAlertState,
  decideAnnouncements,
  lastAnnouncedKey,
  notificationBody,
  notificationTitle,
  readLastAnnounced,
  requestBrowserAlerts,
  shownNotifications,
  showBrowserAlert,
} from '../src/notifications.ts';
import { PopulationLine } from '../src/components/PopulationLine.tsx';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function note(id: number, extra: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id,
    kind: 'incoming_attack',
    movementId: 100 + id,
    origin: { villageId: 7, name: 'Oak Hollow', ownerName: 'Brann', x: 12, y: 34 },
    target: { villageId: 1, name: 'Home', ownerName: 'Me', x: 5, y: 6 },
    departAt: NOW - 60_000,
    arriveAt: NOW + 3_600_000,
    createdAt: NOW - 60_000,
    read: false,
    ...extra,
  };
}

const g = globalThis as { fetch?: unknown; window?: unknown; Notification?: unknown };
const realFetch = g.fetch;
const realWindow = g.window;
afterEach(() => {
  g.fetch = realFetch;
  g.window = realWindow;
  delete g.Notification;
});

// ---- decider --------------------------------------------------------------------------------------------

test('first load sets the baseline to the current maximum and announces nothing old', () => {
  const d = decideAnnouncements([note(3), note(9), note(5)], null, true);
  assert.deepEqual(d.announce, []);
  assert.equal(d.last, 9);
  assert.deepEqual(decideAnnouncements([], null, true), { announce: [], last: 0 });
});

test('only unread rows above the baseline are announced, oldest first, and the baseline moves up', () => {
  const list = [note(12), note(11, { read: true }), note(10), note(9)];
  const d = decideAnnouncements(list, 9, true);
  assert.deepEqual(d.announce.map((n) => n.id), [10, 12]);
  assert.equal(d.last, 12);
  assert.deepEqual(decideAnnouncements(list, 12, true).announce, [], 'nothing twice');
});

test('a burst is capped, keeping the newest', () => {
  const list = [1, 2, 3, 4, 5, 6].map((i) => note(i));
  const d = decideAnnouncements(list, 0, true);
  assert.equal(d.announce.length, MAX_ALERTS_PER_FETCH);
  assert.deepEqual(d.announce.map((n) => n.id), [4, 5, 6]);
  assert.equal(d.last, 6);
});

test('without permission nothing is announced but the baseline still advances (no replay later)', () => {
  const d = decideAnnouncements([note(4), note(5)], 3, false);
  assert.deepEqual(d.announce, []);
  assert.equal(d.last, 5);
});

test('a baseline above the list maximum (cancelled rows, other account) drops so new rows are not missed', () => {
  const d = decideAnnouncements([note(4)], 10, true);
  assert.deepEqual(d.announce, []);
  assert.equal(d.last, 4);
  assert.deepEqual(decideAnnouncements([note(4), note(5)], d.last, true).announce.map((n) => n.id), [5]);
  assert.deepEqual(decideAnnouncements([], 10, true), { announce: [], last: 0 });
});

test('announceNew stores the baseline per world and shows only what is new afterwards', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const shown: number[] = [];
  const deps = { storage, key: lastAnnouncedKey('/w/w2/'), canShow: true, show: (n: NotificationDto) => shown.push(n.id) };
  announceNew([note(1), note(2)], deps);
  assert.deepEqual(shown, [], 'first load: nothing old');
  assert.equal(readLastAnnounced(storage, deps.key), 2);
  announceNew([note(3), note(2), note(1)], deps);
  assert.deepEqual(shown, [3]);
  assert.equal(readLastAnnounced(storage, deps.key), 3);
  assert.notEqual(lastAnnouncedKey('/w/w2/'), lastAnnouncedKey('/w/w1/'));
  assert.equal(lastAnnouncedKey('/'), 'clanfire.alerts.lastId');
  assert.equal(readLastAnnounced({ getItem: () => 'junk' }, 'k'), null);
  assert.equal(readLastAnnounced({ getItem: () => { throw new Error('blocked'); } }, 'k'), null);
});

// ---- texts and the Notification API wrappers -------------------------------------------------------------

test('title and body carry origin, target and arrival time, never units', () => {
  const n = note(1);
  assert.equal(notificationTitle(n), 'Incoming attack');
  assert.equal(notificationTitle(note(2, { kind: 'incoming_support' })), 'Incoming support');
  assert.equal(notificationTitle(note(3, { kind: 'incoming_resources' })), 'Incoming resources');
  assert.equal(notificationBody(n, () => '14:05'), 'From Oak Hollow (12|34) to Home, arrives 14:05');
  assert.match(notificationBody(n), /arrives \d/);
});

test('without the Notification API the state is unsupported and nothing throws', async () => {
  assert.equal(browserAlertState(), 'unsupported');
  assert.equal(await requestBrowserAlerts(), 'unsupported');
  assert.equal(showBrowserAlert(note(1)), false);
});

test('requestBrowserAlerts asks the browser and reports the new state; a browser alert has title, body and a tag', async () => {
  const made: Array<{ title: string; opts: { body?: string; tag?: string } }> = [];
  let asked = 0;
  class FakeNotification {
    static permission = 'default';
    static async requestPermission() {
      asked += 1;
      FakeNotification.permission = 'granted';
      return 'granted';
    }
    constructor(title: string, opts: { body?: string; tag?: string }) {
      made.push({ title, opts });
    }
  }
  g.Notification = FakeNotification;
  assert.equal(browserAlertState(), 'default');
  assert.equal(asked, 0, 'reading the state never prompts');
  assert.equal(await requestBrowserAlerts(), 'granted');
  assert.equal(asked, 1);
  assert.equal(showBrowserAlert(note(8)), true);
  assert.equal(made[0].title, 'Incoming attack');
  assert.match(made[0].opts.body ?? '', /^From Oak Hollow \(12\|34\) to Home, arrives /);
  assert.equal(made[0].opts.tag, 'clanfire-notification-8');
  // announceNew goes through the same wrapper when permission is granted
  const data = new Map<string, string>([['k', '8']]);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  announceNew([note(9)], { storage, key: 'k' });
  assert.equal(made.length, 2);
  assert.equal(made[1].opts.tag, 'clanfire-notification-9');
});

test('a throwing or blocked Notification constructor is swallowed', async () => {
  class Broken {
    static permission = 'granted';
    static async requestPermission() {
      throw new Error('no');
    }
    constructor() {
      throw new TypeError('Illegal constructor');
    }
  }
  g.Notification = Broken;
  assert.equal(showBrowserAlert(note(1)), false);
  assert.equal(await requestBrowserAlerts(), 'granted');
});

// ---- API client (mocked fetch) -----------------------------------------------------------------------------

test('getNotifications and markNotificationsRead call the contract endpoints', async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  g.window = { location: { pathname: '/w/w1/' } };
  g.fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
    return new Response(JSON.stringify({ notifications: [note(1)], unread: 1 }), { status: 200 });
  };
  const list = await api.getNotifications();
  assert.equal(list.unread, 1);
  assert.equal(list.notifications[0].origin.name, 'Oak Hollow');
  await api.markNotificationsRead();
  await api.markNotificationsRead([4, 5]);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ['GET', '/w/w1/api/notifications'],
    ['POST', '/w/w1/api/notifications/read'],
    ['POST', '/w/w1/api/notifications/read'],
  ]);
  assert.equal(calls[1].body, '{}', 'no ids = mark all');
  assert.equal(calls[2].body, '{"ids":[4,5]}');
});

// ---- render ----------------------------------------------------------------------------------------------------

test('the bell shows an unread badge, red for attacks, and nothing when all is read', () => {
  const none = renderToString(createElement(NotificationBell, { unread: 0, danger: false, onClick: () => {} }));
  assert.ok(!none.includes('badge'));
  assert.match(none, /aria-label="Notifications"/);
  const some = renderToString(createElement(NotificationBell, { unread: 3, danger: true, onClick: () => {} }));
  assert.match(some, /badge badge-danger/);
  assert.match(some, /aria-label="Notifications, 3 unread"/);
  assert.equal(text(some).trim(), '3');
  const calm = renderToString(createElement(NotificationBell, { unread: 250, danger: false, onClick: () => {}, compact: true }));
  assert.ok(!calm.includes('badge-danger'));
  assert.equal(text(calm).trim(), '99+');
});

test('the list shows kind, from and to, send and arrival, a Show button, and no unit list', () => {
  const items = [
    note(3, { kind: 'incoming_support', origin: { villageId: 8, name: 'Pine Ford', ownerName: 'Isla', x: 1, y: 2 } }),
    note(2),
    note(1, { kind: 'incoming_resources', read: true, arriveAt: NOW - 120_000 }),
  ];
  const html = renderToString(createElement(NotificationList, { items, now: NOW, onOpen: () => {} }));
  const plain = text(html);
  assert.match(plain, /Incoming support/);
  assert.match(plain, /Incoming attack/);
  assert.match(plain, /Incoming resources/);
  assert.match(plain, /from Isla, Pine Ford \( ?1\|2 ?\) to Home/);
  assert.match(plain, /from Brann, Oak Hollow \( ?12\|34 ?\) to Home/);
  assert.match(plain, /1:00:00/, 'live countdown');
  assert.match(plain, /Arrives /);
  assert.match(plain, /arrived/);
  assert.equal((html.match(/>Show</g) ?? []).length, 3);
  assert.ok(html.indexOf('Pine Ford') < html.indexOf('Oak Hollow'), 'newest first');
  assert.ok(!/pikeman|logram|boulder|troops|units|army size/i.test(plain), 'never any unit list');
  assert.match(html, /notif is-unread is-attack/);
});

test('the list is capped at the newest 20 and says so; empty shows a calm line', () => {
  const many = Array.from({ length: 35 }, (_, i) => note(i + 1));
  assert.equal(shownNotifications(many).length, NOTIFICATIONS_SHOWN);
  assert.equal(shownNotifications(many)[0].id, 35);
  const html = renderToString(createElement(NotificationList, { items: many, now: NOW, onOpen: () => {} }));
  assert.equal((html.match(/<li /g) ?? []).length, NOTIFICATIONS_SHOWN);
  assert.match(text(html), /Showing the newest 20 of 35/);
  assert.match(text(renderToString(createElement(NotificationList, { items: [], now: NOW, onOpen: () => {} }))), /No warnings yet/);
});

test('"Turn on browser alerts" shows only while the browser can still be asked', () => {
  const box = (state: 'unsupported' | 'default' | 'granted' | 'denied') => renderToString(createElement(BrowserAlertsBox, { state, onEnable: () => {} }));
  assert.match(box('default'), /<button[^>]*>Turn on browser alerts<\/button>/);
  for (const s of ['unsupported', 'granted', 'denied'] as const) assert.ok(!box(s).includes('<button'), s);
  assert.match(text(box('unsupported')), /cannot show alerts/);
  assert.match(text(box('denied')), /blocked/);
  assert.match(text(box('granted')), /are on/);
});

// ---- 2026-11-05 clean-up: no upkeep, no loot share -----------------------------------------------------------------

test('the Army population line talks about population only', () => {
  const plain = text(renderToString(createElement(PopulationLine, { used: 120, cap: 400 })));
  assert.match(plain, /Population 120 \/ 400/);
  assert.ok(!/eat|upkeep|food/i.test(plain), plain);
});

test('the web client no longer uses upkeep, net food production or the loot share', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 20);
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(!/\.upkeep\b|upkeepPerHour|netProductionPerHour|lootShare|FOOD_UPKEEP|not_enough_food/.test(src), f);
    assert.ok(!/Troops eat|Upkeep</.test(src), f);
  }
});
