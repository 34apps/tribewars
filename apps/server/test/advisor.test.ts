import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import type { AdvisorAskResponse } from '@clanfire/engine';
import type { AdvisorClient, AdvisorMessage } from '../src/advisor.ts';
import { HOUR, errorOf, makeApp, ok, register } from './helpers.ts';

const SECRET = 'sk-ant-test-SECRET-KEY';

function fakeClient(reply: (params: Record<string, unknown>) => AdvisorMessage | Promise<AdvisorMessage>) {
  const calls: Array<Record<string, unknown>> = [];
  const client: AdvisorClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return reply(params);
      },
    },
  };
  return { client, calls };
}

const GOOD: AdvisorMessage = {
  content: [{ type: 'thinking', text: 'secret thoughts' }, { type: 'text', text: ' Build a Lumber Camp, friend. ' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 },
};

test('answers with real state, the rules, the model settings; logs usage', async () => {
  const { client, calls } = fakeClient(() => GOOD);
  const { app } = await makeApp({ advisorClient: client });
  const c = await register(app, 'Alice');
  const v = await c.village();
  const res = await c.post('/api/advisor/ask', { question: '  What next?  ' });
  ok(res);
  assert.deepEqual(res.json<AdvisorAskResponse>(), { answer: 'Build a Lumber Camp, friend.', remaining: 19 });

  const p = calls[0];
  assert.ok(p);
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 1024);
  assert.deepEqual(p.output_config, { effort: 'low' });
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in p), k);
  const system = p.system as Array<{ text: string; cache_control?: unknown }>;
  const rules = readFileSync(new URL('../../../docs/GAME_DESIGN.md', import.meta.url), 'utf8');
  assert.ok(system.some((b) => b.text.includes(rules)));
  assert.deepEqual(system[system.length - 1]?.cache_control, { type: 'ephemeral' });
  const user = (p.messages as Array<{ content: string }>)[0]?.content ?? '';
  assert.match(user, /<game_state>/);
  assert.match(user, new RegExp(`"x":${v.x},"y":${v.y}`));
  assert.match(user, new RegExp(`"wood":${Math.floor(v.state.resources.wood)}`));
  assert.match(user, /<question>\nWhat next\?\n<\/question>/);

  const row = app.ctx.store.db.prepare('SELECT * FROM advisor_log').get() as Record<string, number | string>;
  assert.equal(row.model, 'claude-haiku-5-5');
  assert.equal(row.input_tokens, 1200);
  assert.equal(row.output_tokens, 40);
  assert.equal(row.cache_read_tokens, 1000);
  assert.equal(row.cache_write_tokens, 5);
  assert.equal(row.ok, 1);
});

test('21st question in an hour is rate limited; old entries do not count', async () => {
  const { client } = fakeClient(() => GOOD);
  const { app, clock } = await makeApp({ advisorClient: client });
  const c = await register(app, 'Bob');
  for (let i = 0; i < 20; i++) {
    const r = await c.post('/api/advisor/ask', { question: 'hi' });
    ok(r);
    assert.equal(r.json<AdvisorAskResponse>().remaining, 19 - i);
  }
  errorOf(await c.post('/api/advisor/ask', { question: 'hi' }), 429, 'rate_limited');
  clock.advance(HOUR + 1000);
  const r = await c.post('/api/advisor/ask', { question: 'hi' });
  ok(r);
  assert.equal(r.json<AdvisorAskResponse>().remaining, 19);
});

test('failed API calls give advisor_unavailable, leak nothing and keep the question', async () => {
  const errors = [
    new Anthropic.APIError(500, { error: { message: SECRET } }, SECRET, new Headers()),
    new Anthropic.APIConnectionError({ message: SECRET }),
  ];
  let n = 0;
  const { client } = fakeClient(() => {
    const e = errors[n++];
    if (e) throw e;
    return GOOD;
  });
  const { app } = await makeApp({ advisorClient: client });
  const c = await register(app, 'Cara');
  for (let i = 0; i < 2; i++) {
    const res = await c.post('/api/advisor/ask', { question: 'hi' });
    errorOf(res, 503, 'advisor_unavailable');
    assert.ok(!res.body.includes(SECRET));
    assert.ok(!res.body.includes('sk-ant'));
  }
  const res = await c.post('/api/advisor/ask', { question: 'hi' });
  ok(res);
  assert.equal(res.json<AdvisorAskResponse>().remaining, 19);
});

test('no client configured: 503', async () => {
  const { app } = await makeApp();
  const c = await register(app, 'Dan');
  errorOf(await c.post('/api/advisor/ask', { question: 'hi' }), 503, 'advisor_unavailable');
});

test('unauthenticated: 401; bad questions: 400; cross-site: 403', async () => {
  const { client, calls } = fakeClient(() => GOOD);
  const { app } = await makeApp({ advisorClient: client });
  const anon = await register(app, 'Eve');
  const other = new (anon.constructor as new (a: typeof app) => typeof anon)(app);
  errorOf(await other.post('/api/advisor/ask', { question: 'hi' }), 401, 'unauthorized');
  errorOf(await anon.post('/api/advisor/ask', { question: '   ' }), 400, 'invalid_input');
  errorOf(await anon.post('/api/advisor/ask', { question: 'x'.repeat(501) }), 400, 'invalid_input');
  errorOf(await anon.post('/api/advisor/ask', { question: 'hi', extra: 1 }), 400, 'invalid_input');
  errorOf(await anon.post('/api/advisor/ask', { question: 'hi' }, { origin: 'https://evil.example' }), 403, 'forbidden');
  ok(await anon.post('/api/advisor/ask', { question: 'x'.repeat(500) }));
  assert.equal(calls.length, 1);
});

test('refusal gives a friendly answer; empty text is unavailable', async () => {
  let mode = 'refusal';
  const { client } = fakeClient(() =>
    mode === 'refusal' ? { content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 } } : { content: [{ type: 'text', text: '  ' }], stop_reason: 'end_turn' },
  );
  const { app } = await makeApp({ advisorClient: client });
  const c = await register(app, 'Finn');
  const res = await c.post('/api/advisor/ask', { question: 'hi' });
  ok(res);
  assert.match(res.json<AdvisorAskResponse>().answer, /can't help/);
  mode = 'empty';
  errorOf(await c.post('/api/advisor/ask', { question: 'hi' }), 503, 'advisor_unavailable');
});

test('max_tokens stop returns the text so far', async () => {
  const { client } = fakeClient(() => ({ content: [{ type: 'text', text: 'Half an ans ' }], stop_reason: 'max_tokens' }));
  const { app } = await makeApp({ advisorClient: client });
  const c = await register(app, 'Gus');
  const res = await c.post('/api/advisor/ask', { question: 'hi' });
  ok(res);
  assert.equal(res.json<AdvisorAskResponse>().answer, 'Half an ans');
});
