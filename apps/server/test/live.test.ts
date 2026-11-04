// Live updates over WebSocket (GET /api/live): auth, Origin, isolation between players and tribes, caps, message
// limits, heartbeat, logout/ban, and "hints only after the transaction commits".

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import WebSocket from 'ws';
import {
  LIVE_CLOSE_BAD_MESSAGE,
  LIVE_CLOSE_SESSION_ENDED,
  type LiveMessage,
  type LiveTopic,
} from '@clanfire/engine';
import { LIVE_MAX_MESSAGE_BYTES, LIVE_MAX_PER_IP, LIVE_MAX_PER_SESSION, LIVE_MSG_PER_WINDOW } from '../src/live.ts';
import { Client, HOUR, PASSWORD, makeApp, ok, register } from './helpers.ts';
import { join } from './tribe-helpers.ts';
import { giveTroops, sendOk, world, type App } from './warfare-helpers.ts';

const DAY = 24 * HOUR;

// Cleanup that runs even when a test fails: every socket is terminated and every listening app is closed,
// so no open handle can keep `node --test` waiting.
const openSockets = new Set<WebSocket>();
const listening = new Set<App>();
afterEach(async () => {
  for (const ws of openSockets) ws.terminate();
  openSockets.clear();
  for (const app of listening) await app.close();
  listening.clear();
});

/** A WebSocket test client that records every frame and the close code. */
class Sock {
  readonly msgs: LiveMessage[] = [];
  private pongs = 0;
  private waiting: (() => void) | null = null;
  readonly closed: Promise<number>;
  closeCode: number | null = null;

  private constructor(readonly ws: WebSocket) {
    openSockets.add(ws);
    this.closed = new Promise((resolve) => {
      ws.on('close', (code: number) => {
        this.closeCode = code;
        resolve(code);
      });
    });
    ws.on('message', (data: Buffer) => {
      const m = JSON.parse(data.toString('utf8')) as LiveMessage;
      this.msgs.push(m);
      if (m.type === 'pong') {
        this.pongs += 1;
        this.waiting?.();
      }
    });
  }

  /** Open a socket. Resolves to the socket, or to the HTTP status when the upgrade was refused. */
  static open(app: App, c: Client | null, opts: { origin?: string | null; ip?: string; autoPong?: boolean; cookie?: string } = {}): Promise<Sock | number> {
    const addr = app.server.address() as { port: number };
    const host = `127.0.0.1:${addr.port}`;
    const headers: Record<string, string> = {};
    const origin = opts.origin === undefined ? `http://${host}` : opts.origin;
    if (origin !== null) headers.origin = origin;
    const cookie = opts.cookie ?? c?.cookie;
    if (cookie) headers.cookie = cookie;
    if (opts.ip) headers['x-forwarded-for'] = opts.ip;
    const ws = new WebSocket(`ws://${host}/api/live`, { headers, autoPong: opts.autoPong ?? true });
    return new Promise((resolve, reject) => {
      const sock = new Sock(ws);
      ws.on('open', () => resolve(sock));
      ws.on('unexpected-response', (_req: unknown, res: { statusCode: number; resume(): void }) => {
        res.resume();
        resolve(res.statusCode);
      });
      ws.on('error', (err: Error) => {
        if (!/Unexpected server response/.test(err.message)) reject(err);
      });
    });
  }

  static async connect(app: App, c: Client, opts: Parameters<typeof Sock.open>[2] = {}): Promise<Sock> {
    const s = await Sock.open(app, c, opts);
    assert.ok(typeof s !== 'number', `upgrade refused with ${s}`);
    await s.sync();
    return s;
  }

  /** Round trip a ping: frames arrive in order, so everything sent before it has been received afterwards. */
  async sync(): Promise<void> {
    const before = this.pongs;
    const done = new Promise<void>((resolve) => {
      this.waiting = resolve;
    });
    this.ws.send('ping');
    await Promise.race([done, this.closed]);
    assert.ok(this.pongs > before || this.closeCode !== null, 'pong received');
  }

  /** Topics of every hint received so far, one array per frame. */
  hints(): LiveTopic[][] {
    return this.msgs.flatMap((m) => (m.type === 'hint' ? [m.topics] : []));
  }

  /** Forget what was received so far. */
  clear(): void {
    this.msgs.length = 0;
  }

  close(): void {
    this.ws.close();
  }
}

async function listen(app: App): Promise<void> {
  listening.add(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
}

const has = (s: Sock, topic: LiveTopic): boolean => s.hints().some((t) => t.includes(topic));

test('live: refused without a valid session (401) and for a foreign Origin (403); the greeting comes first', async () => {
  const { app } = await world();
  await listen(app);
  assert.equal(await Sock.open(app, null), 401);
  assert.equal(await Sock.open(app, null, { cookie: 'tw_session=' + 'A'.repeat(43) }), 401);
  assert.equal(await Sock.open(app, null, { cookie: 'tw_session=garbage' }), 401);

  const a = new Client(app);
  ok(await a.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
  assert.equal(await Sock.open(app, a, { origin: 'http://evil.example' }), 403);
  assert.equal(await Sock.open(app, a, { origin: 'null' }), 403);
  const good = await Sock.connect(app, a);
  assert.deepEqual(good.msgs[0], { type: 'hello' });
  good.close();
  await app.close();
});

test('live: ALLOWED_ORIGINS lets a CDN origin through while other origins stay refused', async () => {
  const { app } = await makeApp({ allowedOrigins: ['https://play.example.com'] });
  const bob = await register(app, 'bob', '10.1.1.1');
  await listen(app);
  const s = await Sock.open(app, bob, { origin: 'https://play.example.com' });
  assert.ok(typeof s !== 'number');
  s.close();
  assert.equal(await Sock.open(app, bob, { origin: 'https://other.example.com' }), 403);
  await app.close();
});

test('live: an attack on bob notifies bob (and his tribe), the attacker, and nobody else; mail and chat reach only their audience', async () => {
  const { app, clock, alice, amy, bob, bea, lou } = await world();
  await listen(app);
  const s = {
    alice: await Sock.connect(app, alice.c),
    amy: await Sock.connect(app, amy.c),
    bob: await Sock.connect(app, bob.c),
    bea: await Sock.connect(app, bea.c),
    lou: await Sock.connect(app, lou.c),
  };
  const syncAll = async (): Promise<void> => {
    for (const x of Object.values(s)) await x.sync();
  };
  const reset = async (): Promise<void> => {
    await syncAll();
    for (const x of Object.values(s)) x.clear();
  };
  await reset();

  // 1. Alice (ALPHA) attacks bob (BRAVO): bob and the attacker's other tabs get "game"; bea (BRAVO) hears about the
  //    tribe alert; amy (ALPHA, only the attacker's tribe) and the bystander lou hear nothing.
  giveTroops(app, alice, { raider: 5 });
  const { movement } = await sendOk(alice, bob, 'attack', { raider: 5 });
  await syncAll();
  assert.ok(has(s.alice, 'game'), 'attacker is told');
  assert.ok(has(s.bob, 'game'), 'target is told');
  assert.ok(has(s.bea, 'tribe'), 'target tribe sees the alert change');
  assert.deepEqual(s.amy.hints(), [], 'attacker tribe-mate is not told');
  assert.deepEqual(s.lou.hints(), [], 'bystander is not told');

  // 2. The battle resolves: both sides get "reports" and "game"; the bystander still hears nothing.
  await reset();
  clock.set(movement.arriveAt);
  ok(await bob.c.get('/api/state')); // any API call processes what is due
  await syncAll();
  for (const side of [s.alice, s.bob]) {
    assert.ok(has(side, 'reports'), 'report created');
    assert.ok(has(side, 'game'), 'movement resolved');
  }
  assert.deepEqual(s.lou.hints(), []);
  assert.deepEqual(s.amy.hints().flat().filter((t) => t === 'reports'), []);

  // 3. Mail reaches the recipient only.
  await reset();
  clock.advance(HOUR);
  const mail = await alice.c.post('/api/mail', { to: 'bob', subject: 's', body: 'hello' });
  assert.ok(mail.statusCode < 300, mail.body);
  await syncAll();
  assert.ok(has(s.bob, 'mail'));
  assert.ok(!has(s.lou, 'mail') && !has(s.amy, 'mail') && !has(s.bea, 'mail'));

  // 4. Tribe chat reaches the tribe's members only.
  await reset();
  ok(await alice.c.post('/api/tribe/chat', { text: 'hi tribe' }), 201);
  await syncAll();
  assert.ok(has(s.alice, 'chat') && has(s.amy, 'chat'));
  assert.ok(!has(s.bob, 'chat') && !has(s.bea, 'chat') && !has(s.lou, 'chat'));

  for (const x of Object.values(s)) x.close();
  await app.close();
});

test('live: a player who joins a tribe starts receiving its events, one who leaves stops', async () => {
  const { app, clock, alice, lou } = await world();
  await listen(app);
  const l = await Sock.connect(app, lou.c);
  await join(lou, alice.tribeId);
  l.clear();
  ok(await alice.c.post('/api/tribe/chat', { text: 'welcome' }), 201);
  await l.sync();
  assert.ok(has(l, 'chat'), 'new member receives tribe chat');

  ok(await lou.c.post('/api/tribe/leave'));
  await l.sync();
  l.clear();
  clock.advance(HOUR); // chat has its own flood limit
  ok(await alice.c.post('/api/tribe/chat', { text: 'anyone?' }), 201);
  await l.sync();
  assert.ok(!has(l, 'chat'), 'a former member no longer receives tribe chat');
  l.close();
  await app.close();
});

test('live: hints are held until the transaction commits and dropped when it rolls back', async () => {
  const { app, alice } = await world();
  const store = app.ctx.store;
  let delivered = 0;
  store.onLive = (events) => {
    delivered += events.length;
  };
  assert.throws(() =>
    store.tx(() => {
      store.emit({ kind: 'player', playerId: alice.id, topics: ['game'] });
      assert.equal(delivered, 0, 'nothing is published inside the transaction');
      throw new Error('boom');
    }),
  );
  assert.equal(delivered, 0, 'a rolled-back transaction announces nothing');
  store.tx(() => {
    store.emit({ kind: 'player', playerId: alice.id, topics: ['game'] });
    assert.equal(delivered, 0);
  });
  assert.equal(delivered, 1, 'published right after the commit');
  await app.close();
});

test(`live: at most ${LIVE_MAX_PER_SESSION} sockets per session (HTTP 429 beyond), another session is unaffected, slots free up`, async () => {
  const { app, alice } = await world();
  await listen(app);
  const open: Sock[] = [];
  for (let i = 0; i < LIVE_MAX_PER_SESSION; i++) open.push(await Sock.connect(app, alice.c));
  assert.equal(await Sock.open(app, alice.c), 429);

  const second = new Client(app);
  ok(await second.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
  const other = await Sock.connect(app, second);

  const first = open.shift();
  assert.ok(first);
  first.close();
  await first.closed;
  const again = await Sock.open(app, alice.c);
  assert.ok(typeof again !== 'number', 'a freed slot can be used again');
  again.close();
  other.close();
  for (const s of open) s.close();
  await app.close();
});

test(`live: at most ${LIVE_MAX_PER_IP} sockets per IP`, async () => {
  const { app } = await world();
  await listen(app);
  // This app trusts no proxy, so every socket below comes from 127.0.0.1 (the inject IPs only spread the logins).
  const socks: Sock[] = [];
  const sessions = Math.ceil(LIVE_MAX_PER_IP / LIVE_MAX_PER_SESSION) + 1;
  let refused = 0;
  for (let i = 0; i < sessions; i++) {
    const c = new Client(app, `10.7.0.${i + 1}`);
    ok(await c.post('/api/auth/login', { username: 'alice', password: PASSWORD }));
    for (let j = 0; j < LIVE_MAX_PER_SESSION; j++) {
      const s = await Sock.open(app, c);
      if (typeof s === 'number') {
        assert.equal(s, 429);
        refused += 1;
      } else socks.push(s);
    }
  }
  assert.equal(socks.length, LIVE_MAX_PER_IP);
  assert.ok(refused > 0, 'the sockets beyond the per-IP cap were refused');
  for (const s of socks) s.close();
  await app.close();
});

test('live: only ping is accepted; other text, binary, bursts and oversized frames close the socket', async () => {
  const { app, alice } = await world();
  await listen(app);

  const text = await Sock.connect(app, alice.c);
  text.ws.send(JSON.stringify({ type: 'build', building: 'hall' }));
  assert.equal(await text.closed, LIVE_CLOSE_BAD_MESSAGE);

  const json = await Sock.connect(app, alice.c);
  json.ws.send(JSON.stringify({ type: 'ping', extra: 1 }));
  assert.equal(await json.closed, LIVE_CLOSE_BAD_MESSAGE);

  const bin = await Sock.connect(app, alice.c);
  bin.ws.send(Buffer.from([1, 2, 3]));
  assert.equal(await bin.closed, LIVE_CLOSE_BAD_MESSAGE);

  const big = await Sock.connect(app, alice.c);
  big.ws.send('x'.repeat(LIVE_MAX_MESSAGE_BYTES + 1));
  assert.equal(await big.closed, 1009, 'too big (close code "message too big")');

  const fast = await Sock.connect(app, alice.c); // sync() already sent one ping
  for (let i = 0; i < LIVE_MSG_PER_WINDOW + 1; i++) fast.ws.send('ping');
  assert.equal(await fast.closed, LIVE_CLOSE_BAD_MESSAGE);

  const ok1 = await Sock.connect(app, alice.c);
  ok1.ws.send(JSON.stringify({ type: 'ping' }));
  await ok1.sync();
  assert.equal(ok1.closeCode, null, 'normal pings keep working');
  ok1.close();
  await app.close();
});

test('live: logout closes only that session\'s sockets; a ban closes all of the player\'s sockets', async () => {
  const { app, bob } = await world();
  await listen(app);
  const other = new Client(app);
  ok(await other.post('/api/auth/login', { username: 'bob', password: PASSWORD }));
  const a = await Sock.connect(app, bob.c);
  const b = await Sock.connect(app, other);

  ok(await bob.c.post('/api/auth/logout'), 204);
  assert.equal(await a.closed, LIVE_CLOSE_SESSION_ENDED);
  await b.sync();
  assert.equal(b.closeCode, null, 'the other login stays connected');

  app.ctx.store.banPlayer(bob.id, 'test', 0);
  assert.equal(await b.closed, LIVE_CLOSE_SESSION_ENDED);
  assert.equal(app.ctx.live?.size, 0);
  await app.close();
});

test('live: heartbeat drops sockets that stop answering and sockets whose session is gone', async () => {
  const { app, clock, alice, bob } = await world();
  await listen(app);
  const hub = app.ctx.live;
  assert.ok(hub);
  const dead = await Sock.connect(app, alice.c, { autoPong: false });
  const alive = await Sock.connect(app, bob.c);
  assert.equal(hub.size, 2);

  hub.heartbeat(); // pings both
  await alive.sync(); // the live client answers
  hub.heartbeat(); // the silent one never answered the last ping
  assert.equal(await dead.closed, 1006);
  assert.equal(hub.size, 1);

  await alive.sync(); // answers the ping of the second beat
  clock.advance(31 * DAY); // sessions last 30 days
  hub.heartbeat();
  assert.equal(await alive.closed, LIVE_CLOSE_SESSION_ENDED);
  assert.equal(hub.size, 0);
  await app.close();
});

test('live: server shutdown closes the sockets', async () => {
  const { app, alice } = await world();
  await listen(app);
  const s = await Sock.connect(app, alice.c);
  await app.close();
  await s.closed;
  assert.notEqual(s.closeCode, null);
});
