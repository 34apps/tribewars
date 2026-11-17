// Two presses in the same tick send one request: the guard is a ref, not React state (state still reads "not busy" until the next render).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FirstStepsDto } from '@clanfire/engine';
import { firstStepsOpen } from '../src/firstSteps.ts';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { useLock } from '../src/hooks/useLock.ts';
import { useBuild } from '../src/views/village/useBuild.ts';

const g = globalThis as { fetch?: unknown };

function withGame(ui: ReactNode, calls: { refresh: number; applied: number }) {
  const game = {
    village: { id: 1 },
    applyVillage: () => void (calls.applied += 1),
    refresh: async () => void (calls.refresh += 1),
    toast: () => {},
    firstSteps: undefined,
  } as unknown as GameApi;
  return renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, ui));
}

test('useLock: the second begin() in the same tick is refused until end()', () => {
  let lock: ReturnType<typeof useLock> | undefined;
  const Probe = () => {
    lock = useLock();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  assert.ok(lock);
  assert.equal(lock.begin(), true);
  assert.equal(lock.begin(), false, 'no render in between, still refused');
  lock.end();
  assert.equal(lock.begin(), true);
});

test('Up pressed twice in one tick: exactly one build request, no state refetch after the success', async () => {
  const realFetch = g.fetch;
  const requests: string[] = [];
  g.fetch = async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const calls = { refresh: 0, applied: 0 };
    let hook: ReturnType<typeof useBuild> | undefined;
    const Probe = () => {
      hook = useBuild();
      return null;
    };
    withGame(createElement(Probe), calls);
    assert.ok(hook);
    hook.build('lumber');
    hook.build('lumber');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requests.filter((u) => u.includes('/build')).length, 1);
    assert.equal(calls.applied, 1, 'the response is applied once');
    assert.equal(calls.refresh, 0, 'and no extra GET /api/state');
  } finally {
    g.fetch = realFetch;
  }
});

test('a failed build does refetch the state (the screen may be stale)', async () => {
  const realFetch = g.fetch;
  g.fetch = async () => new Response(JSON.stringify({ error: 'invalid_input', message: 'No.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  try {
    const calls = { refresh: 0, applied: 0 };
    let hook: ReturnType<typeof useBuild> | undefined;
    const Probe = () => {
      hook = useBuild();
      return null;
    };
    withGame(createElement(Probe), calls);
    hook?.build('lumber');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls.applied, 0);
    assert.equal(calls.refresh, 1);
  } finally {
    g.fetch = realFetch;
  }
});

test('First steps card: a refetch is wanted only while some step is still open', () => {
  const step = (done: boolean) => ({ id: 'lumber2' as const, done, claimed: false, reward: { wood: 0, food: 0, iron: 0, gold: 0 } });
  const fs = (o: Partial<FirstStepsDto>): FirstStepsDto => ({ steps: [step(false)], hidden: false, allClaimed: false, ...o });
  assert.equal(firstStepsOpen(undefined), false);
  assert.equal(firstStepsOpen(fs({})), true);
  assert.equal(firstStepsOpen(fs({ hidden: true })), false);
  assert.equal(firstStepsOpen(fs({ allClaimed: true })), false);
  assert.equal(firstStepsOpen(fs({ steps: [step(true)] })), false);
});
