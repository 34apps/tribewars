import assert from 'node:assert/strict';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { LOBBY_SESSION_COOKIE, type WorldStatus } from '@clanfire/engine';
import { buildApp, type BuildAppOptions } from '../src/app.ts';
import { generateKeyPair, publicKeyBase64, type GeneratedKeyPair } from '../src/pass.ts';

export const MINUTE = 60_000;
export const HOST = 'lobby.test';
export const PASSWORD = 'correct horse battery';

/** One key for all tests (generating is cheap, but a shared key keeps the helpers simple). */
export const KEY: GeneratedKeyPair = generateKeyPair();
export const PUBLIC_KEY = publicKeyBase64(KEY.privateKey);

export class Clock {
  t = Date.UTC(2026, 10, 4, 12, 0, 0);
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export async function makeApp(over: Partial<BuildAppOptions> = {}) {
  const clock = new Clock();
  const app = await buildApp({ dbPath: ':memory:', signingKey: KEY.privateKey, now: clock.now, secureCookies: false, ...over });
  return { app, clock };
}

let ipCounter = 0;
/** A fresh documentation-range IP per call, so tests do not trip each other's per-IP limits. */
export const nextIp = (): string => `198.51.100.${(ipCounter++ % 250) + 1}`;

/** A browser-like client: keeps the lobby cookie, sends Host and same-origin Origin. */
export class Client {
  cookie = '';
  constructor(
    readonly app: FastifyInstance,
    readonly ip = nextIp(),
  ) {}

  async call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { host: HOST, ...headers };
    if (method !== 'GET' && h.origin === undefined) h.origin = `http://${HOST}`;
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const res = await this.app.inject({ method, url, headers: h, payload, remoteAddress: this.ip });
    const set = res.cookies.find((c) => c.name === LOBBY_SESSION_COOKIE);
    if (set) this.cookie = set.value ? `${LOBBY_SESSION_COOKIE}=${set.value}` : '';
    return res;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.call('GET', url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.call('POST', url, body, headers);
  }
}

export async function register(app: FastifyInstance, username: string, ip?: string): Promise<Client> {
  const c = new Client(app, ip);
  const res = await c.post('/lobby/api/auth/register', { username, password: PASSWORD });
  assert.equal(res.statusCode, 201, res.body);
  return c;
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

/** Add a world straight into the database (the CLI is tested separately). */
export function addWorld(app: FastifyInstance, id: string, name = `World ${id}`, status: WorldStatus = 'open', path = `/w/${id}/`): void {
  app.ctx.store.insertWorld({ id, name, status, path, createdAt: 0 });
}
