// The 'expanding' world layout: abandoned villages around the centre at start, each newcomer lands in a growing disc
// and brings abandoned villages around them (GAME_DESIGN.md, world layout).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NPC_RING_BASE, NPC_RING_EXTRA_MAX, expandingRadius, generateExpandingStartNpcs } from '@clanfire/engine';
import { PASSWORD, makeApp } from './helpers.ts';

const world = { seed: 7, radius: 120, layout: 'expanding' as const, npcDensity: 0 };

test('expanding world: start rings, newcomers land in the disc and bring abandoned villages', async () => {
  const { app } = await makeApp({ world });
  const store = app.ctx.store;
  const start = generateExpandingStartNpcs(app.ctx.settings).length;
  assert.ok(start >= 10, 'abandoned villages exist around the centre at world start');
  assert.equal(store.abandonedVillageIds().length, start, 'only the start rings, none scattered over the whole map');

  let before = store.abandonedVillageIds().length;
  for (let i = 0; i < 6; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { host: 'clanfire.test', origin: 'http://clanfire.test', 'content-type': 'application/json' },
      payload: JSON.stringify({ username: `settler${i}`, password: PASSWORD }),
      remoteAddress: `10.0.0.${i + 1}`,
    });
    assert.equal(res.statusCode, 201, res.body);
    const player = store.getPlayerByLowerName(`settler${i}`);
    assert.ok(player);
    const mine = store.villagesOfPlayer(player.id);
    assert.equal(mine.length, 1);
    const v = mine[0]!;
    assert.ok(Math.hypot(v.x, v.y) <= expandingRadius(i) * 1.3 + 1, `settler ${i} lands near the centre, got ${v.x},${v.y}`);
    const after = store.abandonedVillageIds().length;
    const gained = after - before;
    assert.ok(gained >= 1 && gained <= NPC_RING_BASE + NPC_RING_EXTRA_MAX, `newcomer brings a few abandoned villages, got ${gained}`);
    before = after;
  }
  assert.equal(store.playerVillageCount(), 6);
  await app.close();
});

test('scattered world (default): no abandoned villages are added when a player registers', async () => {
  const { app } = await makeApp();
  const before = app.ctx.store.abandonedVillageIds().length;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { host: 'clanfire.test', origin: 'http://clanfire.test', 'content-type': 'application/json' },
    payload: JSON.stringify({ username: 'plainone', password: PASSWORD }),
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(app.ctx.store.abandonedVillageIds().length, before);
  await app.close();
});
