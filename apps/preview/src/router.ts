// A tiny stand-in for Fastify: it records the routes the real route modules register (app.get / app.post, with their
// onRequest hooks and JSON schemas) and runs a request through them, so the unchanged route code serves the preview.
//
// Supported: path params (:name), query strings, JSON bodies, onRequest / preValidation / preHandler hooks (function or
// array), the JSON-schema subset the routes use (type object|string|integer, required, additionalProperties, properties,
// pattern, minLength, maxLength, minimum, maximum, enum), and a reply with code/status/header/send/setCookie/clearCookie.

import { GameError, type ApiError, type GameErrorCode } from '@clanfire/engine';
import { statusFor } from '../../server/src/errors.ts';

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  ip: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  cookies: Record<string, string | undefined>;
  nowMs: number;
  player: unknown;
}

export interface CookieChange {
  name: string;
  value: string | null; // null = cleared
}

export interface FakeReply {
  statusCode: number;
  payload: unknown;
  sent: boolean;
  cookieChanges: CookieChange[];
  headers: Record<string, string>;
  code(n: number): FakeReply;
  status(n: number): FakeReply;
  header(name: string, value: string): FakeReply;
  send(payload?: unknown): FakeReply;
  setCookie(name: string, value: string, opts?: unknown): FakeReply;
  clearCookie(name: string, opts?: unknown): FakeReply;
}

type Hook = (req: FakeRequest, reply: FakeReply) => unknown;
type Handler = (req: FakeRequest, reply: FakeReply) => unknown;

interface Schema {
  type?: string;
  required?: readonly string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: readonly unknown[];
}

interface RouteOptions {
  schema?: { body?: Schema; params?: Schema; querystring?: Schema };
  onRequest?: Hook | Hook[];
  preValidation?: Hook | Hook[];
  preHandler?: Hook | Hook[];
}

interface Route {
  method: string;
  path: string;
  segments: string[];
  isStatic: boolean;
  opts: RouteOptions;
  handler: Handler;
}

const asArray = (h: Hook | Hook[] | undefined): Hook[] => (h === undefined ? [] : Array.isArray(h) ? h : [h]);

// ---- JSON-schema subset -------------------------------------------------------------------------------------------

const ucs2length = (s: string): number => [...s].length;

/** First violation as a readable string, or null when the value fits the schema. */
export function validate(schema: Schema, value: unknown, at: string): string | null {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at} must be object`;
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) return `${at} must have required property '${key}'`;
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) return `${at} must NOT have additional properties`;
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const err = validate(sub, obj[key], `${at}/${key}`);
        if (err) return err;
      }
    }
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${at} must be string`;
    if (schema.minLength !== undefined && ucs2length(value) < schema.minLength) return `${at} must NOT have fewer than ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && ucs2length(value) > schema.maxLength) return `${at} must NOT have more than ${schema.maxLength} characters`;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return `${at} must match pattern "${schema.pattern}"`;
  } else if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return `${at} must be integer`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${at} must be >= ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${at} must be <= ${schema.maximum}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${at} must be equal to one of the allowed values`;
  return null;
}

// ---- Reply ---------------------------------------------------------------------------------------------------------

function makeReply(): FakeReply {
  const reply: FakeReply = {
    statusCode: 200,
    payload: undefined,
    sent: false,
    cookieChanges: [],
    headers: {},
    code(n) {
      reply.statusCode = n;
      return reply;
    },
    status(n) {
      reply.statusCode = n;
      return reply;
    },
    header(name, value) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
    send(payload) {
      reply.payload = payload;
      reply.sent = true;
      return reply;
    },
    setCookie(name, value) {
      reply.cookieChanges.push({ name, value });
      return reply;
    },
    clearCookie(name) {
      reply.cookieChanges.push({ name, value: null });
      return reply;
    },
  };
  return reply;
}

// ---- App -----------------------------------------------------------------------------------------------------------

export interface RouterResponse {
  status: number;
  /** Serialised JSON, or null for an empty body. */
  body: string | null;
  headers: Record<string, string>;
  cookieChanges: CookieChange[];
}

export interface RouterRequest {
  method: string;
  /** Path and query, e.g. "/api/map?x=0&y=0&w=5&h=5". */
  url: string;
  bodyText: string | undefined;
  cookies: Record<string, string | undefined>;
  nowMs: number;
}

export const BODY_LIMIT = 16 * 1024;

function errorBody(error: GameErrorCode, message: string): ApiError {
  return { error, message };
}

export class FakeApp {
  private readonly routes: Route[] = [];

  private add(method: string, path: string, a: RouteOptions | Handler, b?: Handler): void {
    const opts = typeof a === 'function' ? {} : a;
    const handler = typeof a === 'function' ? a : b;
    if (!handler) throw new Error(`Route ${method} ${path} has no handler`);
    const segments = path.split('/').filter(Boolean);
    this.routes.push({ method, path, segments, isStatic: !segments.some((s) => s.startsWith(':')), opts, handler });
  }

  get(path: string, a: RouteOptions | Handler, b?: Handler): void {
    this.add('GET', path, a, b);
  }
  post(path: string, a: RouteOptions | Handler, b?: Handler): void {
    this.add('POST', path, a, b);
  }
  put(path: string, a: RouteOptions | Handler, b?: Handler): void {
    this.add('PUT', path, a, b);
  }
  delete(path: string, a: RouteOptions | Handler, b?: Handler): void {
    this.add('DELETE', path, a, b);
  }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    let best: { route: Route; params: Record<string, string> } | null = null;
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        const seg = route.segments[i] as string;
        const part = parts[i] as string;
        if (seg.startsWith(':')) {
          try {
            params[seg.slice(1)] = decodeURIComponent(part);
          } catch {
            ok = false;
          }
        } else if (seg !== part) ok = false;
      }
      if (!ok) continue;
      if (route.isStatic) return { route, params };
      best ??= { route, params };
    }
    return best;
  }

  async handle(r: RouterRequest): Promise<RouterResponse> {
    const reply = makeReply();
    try {
      await this.run(r, reply);
    } catch (err) {
      reply.cookieChanges.length = 0;
      this.fail(err, reply);
    }
    const body = reply.payload === undefined || reply.statusCode === 204 ? null : JSON.stringify(reply.payload);
    return { status: reply.statusCode, body, headers: reply.headers, cookieChanges: reply.cookieChanges };
  }

  private fail(err: unknown, reply: FakeReply): void {
    reply.headers = {};
    if (err instanceof GameError) {
      reply.code(statusFor(err.code)).send(errorBody(err.code, err.message));
      return;
    }
    console.error('Unhandled error in preview API:', err);
    reply.code(500).send(errorBody('internal_error', 'Something went wrong on the server.'));
  }

  private async run(r: RouterRequest, reply: FakeReply): Promise<void> {
    const u = new URL(r.url, 'http://preview.local');
    const query: Record<string, string> = {};
    for (const [k, v] of u.searchParams) query[k] = v;

    const req: FakeRequest = {
      method: r.method,
      url: r.url,
      headers: {},
      ip: '127.0.0.1',
      params: {},
      query,
      body: undefined,
      cookies: r.cookies,
      nowMs: r.nowMs,
      player: null,
    };
    // JSON bodies only; an empty body counts as "no body".
    if (r.bodyText !== undefined && r.bodyText.length > BODY_LIMIT) {
      throw new GameError('invalid_input', 'The request body is too large.');
    }
    if (r.bodyText !== undefined && r.bodyText.trim() !== '') {
      try {
        req.body = JSON.parse(r.bodyText);
      } catch {
        throw new GameError('invalid_input', 'The request body is not valid JSON.');
      }
    }

    const found = this.match(r.method, u.pathname);
    if (!found) {
      reply.code(404).send(errorBody('not_found', 'Not found.'));
      return;
    }
    req.params = found.params;
    const { opts } = found.route;

    const runHooks = async (hooks: Hook[]): Promise<void> => {
      for (const hook of hooks) await hook(req, reply);
    };

    await runHooks(asArray(opts.onRequest));
    await runHooks(asArray(opts.preValidation));

    const schema = opts.schema;
    if (schema?.params) {
      const err = validate(schema.params, req.params, 'params');
      if (err) throw new GameError('invalid_input', `Invalid request: ${err}.`);
    }
    if (schema?.querystring) {
      const err = validate(schema.querystring, req.query, 'querystring');
      if (err) throw new GameError('invalid_input', `Invalid request: ${err}.`);
    }
    if (schema?.body) {
      const err = validate(schema.body, req.body, 'body');
      if (err) throw new GameError('invalid_input', `Invalid request: ${err}.`);
    }

    await runHooks(asArray(opts.preHandler));

    const result = await found.route.handler(req, reply);
    if (reply.sent) return;
    if (result !== undefined && result !== reply) reply.send(result);
    else if (result === undefined) reply.code(reply.statusCode === 200 ? 204 : reply.statusCode).send();
  }
}
