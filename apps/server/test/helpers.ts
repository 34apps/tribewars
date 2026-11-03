import assert from 'node:assert/strict';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { BattleReportData, GameStateResponse, MapResponse, OwnVillageDto, ReportDto, WorldSettings } from '@clanfire/engine';
import { buildApp, type BuildAppOptions } from '../src/app.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const HOST = 'clanfire.test';
export const PASSWORD = 'correct horse battery';

/** Small, fast, static world: no abandoned-village growth during tests. */
export const TEST_WORLD: Partial<WorldSettings> = {
  seed: 4242,
  speed: 10,
  radius: 12,
  npcDensity: 0.04,
  npcGrowthHours: 1000,
};

export class Clock {
  t = Date.UTC(2026, 5, 1, 12, 0, 0);
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  /** Jump forward to `t` (never backwards). */
  set(t: number): void {
    if (t > this.t) this.t = t;
  }
}

export async function makeApp(over: Partial<BuildAppOptions> & { world?: Partial<WorldSettings> } = {}) {
  const clock = new Clock();
  const { world, ...rest } = over;
  const app = await buildApp({
    dbPath: ':memory:',
    now: clock.now,
    settings: { ...TEST_WORLD, ...world },
    webDistDir: '/nonexistent/web/dist',
    secureCookies: false,
    ...rest,
  });
  return { app, clock };
}

/** A browser-like client: keeps the session cookie, sends Host and same-origin Origin. */
export class Client {
  cookie = '';
  constructor(
    readonly app: FastifyInstance,
    readonly ip = '127.0.0.1',
  ) {}

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { host: HOST, ...headers };
    if (method !== 'GET' && h.origin === undefined) h.origin = `http://${HOST}`;
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const res = await this.app.inject({ method, url, headers: h, payload, remoteAddress: this.ip });
    const set = res.cookies.find((c) => c.name === 'tw_session');
    if (set) this.cookie = set.value ? `tw_session=${set.value}` : '';
    return res;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.call('GET', url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.call('POST', url, body, headers);
  }

  put(url: string, body?: unknown) {
    return this.call('PUT', url, body);
  }

  delete(url: string) {
    return this.call('DELETE', url);
  }

  async state(): Promise<GameStateResponse> {
    const res = await this.get('/api/state');
    assert.equal(res.statusCode, 200, res.body);
    return res.json<GameStateResponse>();
  }

  async village(): Promise<OwnVillageDto> {
    const st = await this.state();
    const v = st.villages[0];
    assert.ok(v, 'player has a village');
    return v;
  }
}

export async function register(app: FastifyInstance, username: string, ip?: string): Promise<Client> {
  const c = new Client(app, ip);
  const res = await c.post('/api/auth/register', { username, password: PASSWORD });
  assert.equal(res.statusCode, 201, res.body);
  return c;
}

/** The battle part of a battle report (asserts the report is one). */
export function battleOf(report: ReportDto): BattleReportData {
  assert.equal(report.type, 'battle');
  assert.ok(report.battle, 'battle report has a battle');
  return report.battle;
}

export function ok(res: LightMyRequestResponse, status = 200): void {
  assert.equal(res.statusCode, status, res.body);
}

export function errorOf(res: LightMyRequestResponse, status: number, code: string): void {
  assert.equal(res.statusCode, status, res.body);
  const body = res.json<{ error: string; message: string }>();
  assert.equal(body.error, code, res.body);
  assert.equal(typeof body.message, 'string');
}

/** The weakest abandoned village (lowest points) in the whole test world. */
export async function weakestAbandoned(c: Client, radius: number) {
  const span = radius * 2 + 1;
  const res = await c.get(`/api/map?x=${-radius}&y=${-radius}&w=${span}&h=${span}`);
  ok(res);
  const npcs = res.json<MapResponse>().villages.filter((v) => v.kind === 'abandoned');
  assert.ok(npcs.length > 0, 'world has abandoned villages');
  return npcs.reduce((a, b) => (b.points < a.points ? b : a));
}

/**
 * Take a fresh village from nothing to `n` raiders at home using only the public API:
 * Town Hall 2 -> Barracks 1 -> Barracks 2, wait for resources, train, wait for training.
 */
export async function trainRaiders(c: Client, clock: Clock, n: number): Promise<number> {
  const vid = (await c.village()).id;
  for (const building of ['hall', 'barracks', 'barracks']) {
    ok(await c.post(`/api/villages/${vid}/build`, { building }));
    clock.advance(10 * MINUTE);
  }
  clock.advance(3 * HOUR);
  const trained = await c.post(`/api/villages/${vid}/train`, { unit: 'raider', count: n });
  ok(trained);
  const job = trained.json<OwnVillageDto>().state.trainQueues.barracks[0];
  assert.ok(job, 'training batch queued');
  clock.set(job.startAt + job.count * job.perUnitMs + 1000);
  const home = await c.village();
  assert.equal(home.state.troops.raider, n);
  return vid;
}
