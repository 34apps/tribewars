// Lobby client: safe world paths, verbatim lobby API paths, and the Play handshake (pass in the body only).

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isLobbyPath } from '@clanfire/engine';
import type { LobbyWorldDto } from '@clanfire/engine';
import { ApiRequestError, api, lobbyApiBase, safeWorldPath, withApiBase } from '../src/api.ts';
import { TENT_COLOURS, daysAgoLabel, enterWorld, groupWorlds, lobbyRouteHash, lobbyScreen, parseLobbyHash, startedLabel, tentColour, worldButtonLabel } from '../src/lobby.ts';
import { isLobbyWorld, loadWorldInfo, resetWorldInfoCache } from '../src/hooks/useWorldInfo.ts';

interface Call {
  url: string;
  method: string;
  body: string | undefined;
  credentials: string | undefined;
}

const g = globalThis as { fetch?: unknown; window?: unknown };
const realFetch = g.fetch;
const realWindow = g.window;

/** Replace fetch with a recorder; `answer` maps a call to [status, json]. */
function mockFetch(answer: (c: Call) => [number, unknown]): Call[] {
  const calls: Call[] = [];
  g.fetch = async (url: string, init: RequestInit = {}) => {
    const call: Call = { url, method: init.method ?? 'GET', body: init.body as string | undefined, credentials: init.credentials };
    calls.push(call);
    const [status, json] = answer(call);
    return new Response(status === 204 ? null : JSON.stringify(json), { status });
  };
  return calls;
}

afterEach(() => {
  g.fetch = realFetch;
  g.window = realWindow;
  resetWorldInfoCache();
});

test('safeWorldPath accepts plain world paths and nothing else', () => {
  assert.equal(safeWorldPath('/w/w1/'), '/w/w1/');
  assert.equal(safeWorldPath('/w/world-2/'), '/w/world-2/');
  assert.equal(safeWorldPath('/play/'), '/play/');
  for (const bad of [
    '',
    '/',
    '//evil.com/',
    '//evil.com',
    'https://x/',
    'javascript:alert(1)//',
    '/\\evil.com/',
    '/a/../b/',
    '/./a/',
    '/w/w1',
    '/w/w1/?x=1',
    '/w/w1/#a',
    '/w//w1/',
    '/w/w 1/',
    '/w/w1/\n',
    'w/w1/',
    '/' + 'a'.repeat(300) + '/',
  ]) {
    assert.equal(safeWorldPath(bad), null, JSON.stringify(bad));
  }
  assert.equal(safeWorldPath(undefined), null);
  assert.equal(safeWorldPath(42), null);
});

test('isLobbyPath recognises the lobby page and its API only', () => {
  assert.equal(isLobbyPath('/lobby/'), true);
  assert.equal(isLobbyPath('/lobby'), true);
  assert.equal(isLobbyPath('/lobby/api/worlds'), true);
  assert.equal(isLobbyPath('/lobbyx/'), false);
  assert.equal(isLobbyPath('/w/w1/'), false);
  assert.equal(isLobbyPath('/'), false);
});

test('withApiBase never rewrites lobby paths, under a world page or the lobby page', () => {
  assert.equal(lobbyApiBase, '/lobby/api');
  for (const pathname of ['/w/w1/', '/lobby/', '/']) {
    g.window = { location: { pathname } };
    assert.equal(withApiBase('/lobby/api/auth/me'), '/lobby/api/auth/me');
    assert.equal(withApiBase('/lobby/api/worlds/w1/enter'), '/lobby/api/worlds/w1/enter');
    assert.equal(withApiBase('/w/w1/api/auth/enter'), '/w/w1/api/auth/enter');
  }
});

test('lobby api calls hit /lobby/api verbatim, even from a world page', async () => {
  g.window = { location: { pathname: '/w/w1/' } };
  const calls = mockFetch((c) => (c.url.endsWith('/auth/logout') ? [204, null] : c.url.endsWith('/worlds') ? [200, { worlds: [] }] : [200, { account: null }]));
  await api.lobbyMe();
  await api.lobbyLogin({ username: 'ann', password: 'secret123' });
  await api.lobbyRegister({ username: 'ann', password: 'secret123', chieftain: 'x' });
  await api.lobbyWorlds();
  await api.lobbyLogout();
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET /lobby/api/auth/me',
      'POST /lobby/api/auth/login',
      'POST /lobby/api/auth/register',
      'GET /lobby/api/worlds',
      'POST /lobby/api/auth/logout',
    ],
  );
  assert.equal(JSON.parse(calls[2].body ?? '{}').chieftain, 'x');
  assert.ok(calls.every((c) => c.credentials === 'same-origin'));
});

test('worldInfo follows the page prefix and the lobby flag is read from it', async () => {
  g.window = { location: { pathname: '/w/w2/' } };
  const calls = mockFetch(() => [200, { id: 'w2', name: 'Two', speed: 1, startedAt: 'x', lobby: true }]);
  const info = await loadWorldInfo();
  await loadWorldInfo();
  assert.equal(calls.length, 1, 'cached: one request');
  assert.equal(calls[0].url, '/w/w2/api/world/info');
  assert.equal(isLobbyWorld(info), true);
  assert.equal(isLobbyWorld('loading'), false);
  assert.equal(isLobbyWorld('failed'), false);
  assert.equal(isLobbyWorld({ ...info, lobby: false }), false);
});

test('a failed world info request is not cached', async () => {
  g.window = { location: { pathname: '/' } };
  mockFetch(() => [500, { error: 'server_error', message: 'x' }]);
  await assert.rejects(loadWorldInfo());
  const calls = mockFetch(() => [200, { id: 'w1', name: 'W', speed: 1, startedAt: 'x', lobby: false }]);
  await loadWorldInfo();
  assert.equal(calls.length, 1);
});

const world: LobbyWorldDto = { id: 'w1', name: 'World 1', status: 'open', path: '/w/w1/', lastPlayedAt: null };
const PASS = 'PAYLOAD.SIGNATURE';

test('enterWorld asks the lobby, posts the pass in the body to the world, then navigates', async () => {
  g.window = { location: { pathname: '/lobby/' } };
  const calls = mockFetch((c) =>
    c.url === '/lobby/api/worlds/w1/enter' ? [200, { pass: PASS, path: '/w/w1/', expiresAt: 1 }] : [200, { player: null }],
  );
  const went: string[] = [];
  await enterWorld(world, (p) => went.push(p));
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    ['POST /lobby/api/worlds/w1/enter', 'POST /w/w1/api/auth/enter'],
  );
  assert.deepEqual(JSON.parse(calls[1].body ?? '{}'), { pass: PASS });
  assert.equal(calls[1].credentials, 'same-origin');
  assert.ok(calls.every((c) => !c.url.includes(PASS) && !c.url.includes('pass')), 'the pass never appears in a URL');
  assert.deepEqual(went, ['/w/w1/']);
});

test('enterWorld refuses unsafe addresses before and after the lobby answers', async () => {
  g.window = { location: { pathname: '/lobby/' } };
  let calls = mockFetch(() => [200, { pass: PASS, path: '/w/w1/', expiresAt: 1 }]);
  const went: string[] = [];
  await assert.rejects(enterWorld({ ...world, path: '//evil.com/' }, (p) => went.push(p)), ApiRequestError);
  assert.equal(calls.length, 0, 'nothing sent for a bad listed path');

  calls = mockFetch(() => [200, { pass: PASS, path: 'https://evil.com/', expiresAt: 1 }]);
  await assert.rejects(enterWorld(world, (p) => went.push(p)), ApiRequestError);
  assert.equal(calls.length, 1, 'the pass is not forwarded anywhere');

  calls = mockFetch(() => [200, { pass: PASS, path: '/w/w2/', expiresAt: 1 }]);
  await assert.rejects(enterWorld(world, (p) => went.push(p)), ApiRequestError);
  assert.equal(calls.length, 1, 'a different path than the listed one is refused');
  assert.deepEqual(went, []);
});

test('enterWorld surfaces API errors and does not navigate', async () => {
  g.window = { location: { pathname: '/lobby/' } };
  mockFetch(() => [403, { error: 'forbidden', message: 'This world is closed.' }]);
  const went: string[] = [];
  await assert.rejects(
    enterWorld(world, (p) => went.push(p)),
    (e: unknown) => e instanceof ApiRequestError && e.message === 'This world is closed.' && e.status === 403,
  );
  // The world refusing the pass (e.g. name conflict) also stops before navigating.
  mockFetch((c) =>
    c.url.startsWith('/lobby/') ? [200, { pass: PASS, path: '/w/w1/', expiresAt: 1 }] : [409, { error: 'conflict', message: 'That name is taken in this world.' }],
  );
  await assert.rejects(enterWorld(world, (p) => went.push(p)), /name is taken/);
  assert.deepEqual(went, []);
});

test('finished worlds say "View results", the others "Play"', () => {
  assert.equal(worldButtonLabel('finished'), 'View results');
  for (const s of ['open', 'full', 'closed'] as const) assert.equal(worldButtonLabel(s), 'Play');
});

test('lobby worlds: yours, results, the newest open ones to join, and the unplayed ones for All worlds; closed worlds are left out', () => {
  const w = (id: string, status: LobbyWorldDto['status'], lastPlayedAt: number | null, openedAt = 0): LobbyWorldDto => ({ id, name: id, status, path: `/w/${id}/`, lastPlayedAt, openedAt });
  const list = [
    w('a', 'open', 100, 10),
    w('b', 'open', null, 20),
    w('c', 'full', 300, 30),
    w('d', 'full', null, 40),
    w('e', 'finished', 50, 5),
    w('f', 'closed', 10),
    w('g', 'closed', null),
    w('h', 'open', null, 60),
    w('i', 'open', null, 50),
    w('j', 'open', null, 70),
    w('k', 'finished', null, 1),
  ];
  const g = groupWorlds(list);
  assert.deepEqual(g.yours.map((x) => x.id), ['c', 'a'], 'played and running, last played first');
  assert.deepEqual(g.results.map((x) => x.id), ['e'], 'played and finished');
  assert.deepEqual(g.join.map((x) => x.id), ['j', 'h', 'i'], 'the 3 newest open worlds not played');
  assert.deepEqual(g.others.open.map((x) => x.id), ['j', 'h', 'i', 'b'], 'newest first');
  assert.deepEqual(g.others.full.map((x) => x.id), ['d']);
  assert.deepEqual(g.others.finished.map((x) => x.id), ['k']);
  assert.equal(g.otherCount, 6, 'only worlds never played are counted');
  assert.deepEqual(list.map((x) => x.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], 'the input is not changed');
});

test('lobby worlds: a lobby that sends no start date still lists worlds (list order) and shows no "Started" line', () => {
  const w = (id: string): LobbyWorldDto => ({ id, name: id, status: 'open', path: `/w/${id}/`, lastPlayedAt: null }) as LobbyWorldDto;
  assert.deepEqual(groupWorlds([w('x'), w('y')]).join.map((r) => r.id), ['x', 'y']);
  assert.equal(startedLabel(undefined), null);
  assert.equal(startedLabel(Number.NaN), null);
});

test('"Started N days ago" line', () => {
  const day = 86_400_000;
  assert.equal(startedLabel(100 * day - 5, 100 * day), 'Started today');
  assert.equal(startedLabel(99 * day, 100 * day), 'Started 1 day ago');
  assert.equal(startedLabel(81 * day, 100 * day), 'Started 19 days ago');
});

test('lobby address: #signin, #signup and #worlds are routes; anything else is the front page', () => {
  assert.equal(parseLobbyHash('#signin'), 'signin');
  assert.equal(parseLobbyHash('#signup'), 'signup');
  assert.equal(parseLobbyHash('#worlds'), 'worlds');
  assert.equal(parseLobbyHash('signin'), 'signin', 'the "#" is optional');
  for (const other of ['', '#', '#home', '#Signin', '#signin/extra', '#worlds?x=1', '#%73ignin', '# signin', '#__proto__', '#constructor']) {
    assert.equal(parseLobbyHash(other), 'home', JSON.stringify(other));
  }
  assert.equal(lobbyRouteHash('home'), '');
  for (const r of ['signin', 'signup', 'worlds'] as const) assert.equal(parseLobbyHash(lobbyRouteHash(r)), r, 'a route survives the round trip');
});

test('lobby screens: signed out sees the front page or the form; signed in never sees the form; #worlds needs an account', () => {
  assert.equal(lobbyScreen('home', false), 'home');
  assert.equal(lobbyScreen('signin', false), 'form-login');
  assert.equal(lobbyScreen('signup', false), 'form-register');
  assert.equal(lobbyScreen('worlds', false), 'home', 'signed out, #worlds falls back to the front page');
  assert.equal(lobbyScreen('home', true), 'your-worlds');
  assert.equal(lobbyScreen('signin', true), 'your-worlds');
  assert.equal(lobbyScreen('signup', true), 'your-worlds');
  assert.equal(lobbyScreen('worlds', true), 'all-worlds');
});

test('tent colour: the same world always gets the same colour, from the fixed set', () => {
  for (const id of ['w1', 'w2', 'hollow-marsh', '', 'x'.repeat(200)]) {
    assert.equal(tentColour(id), tentColour(id));
    assert.ok((TENT_COLOURS as readonly string[]).includes(tentColour(id)));
  }
  const used = new Set(Array.from({ length: 40 }, (_, i) => tentColour(`w${i}`)));
  assert.ok(used.size >= 3, 'worlds spread over several colours');
});

test('world age: "today", "1 day ago", "N days ago"', () => {
  const day = 86_400_000;
  const now = 100 * day;
  assert.equal(daysAgoLabel(now - 3600_000, now), 'today');
  assert.equal(daysAgoLabel(now + 5000, now), 'today', 'a clock a little ahead is still today');
  assert.equal(daysAgoLabel(now - day, now), '1 day ago');
  assert.equal(daysAgoLabel(now - 9 * day - 5, now), '9 days ago');
});
