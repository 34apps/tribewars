// The "your villages were abandoned" notice and what abandonment leaves behind (GAME_DESIGN.md section 17).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abandonIdleMs, type MovementResponse } from '@clanfire/engine';
import { Client, HOUR, MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { newPlayer } from './tribe-helpers.ts';
import { stateOf, stationSupport, village, world } from './warfare-helpers.ts';

type Me = { player: { abandonedNotice: { villages: number; idleDays: number } | null } };

test('notice: set per owner on abandon, exposed on the player, cleared by dismiss, absent for active players', async () => {
  const { app, clock } = await makeApp(); // speed 10: abandoned after 3 days
  const gone = await newPlayer(app, 'away_long');
  const here = await newPlayer(app, 'around');
  assert.equal((await gone.c.get('/api/auth/me')).json<Me>().player.abandonedNotice, null, 'nothing yet');

  const ms = abandonIdleMs(app.ctx.settings);
  clock.advance(ms - HOUR);
  ok(await here.c.get('/api/state'));
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  app.ctx.game.runCaretaker(clock.now()); // a second run must not count again

  const expected = { villages: 1, idleDays: Math.round((ms / (24 * HOUR)) * 10) / 10 };
  assert.equal(expected.idleDays, 3, 'real days value, scaled by world speed (30 / 10)');
  assert.deepEqual((await gone.c.get('/api/auth/me')).json<Me>().player.abandonedNotice, expected);
  const st = await gone.c.state(); // the returning player gets a new village, and the notice is still there
  assert.deepEqual(st.player.abandonedNotice, expected);
  assert.equal(st.villages.length, 1);
  assert.equal((await here.c.get('/api/auth/me')).json<Me>().player.abandonedNotice, null, 'active player: no notice');

  errorOf(await new Client(app).post('/api/me/abandoned-notice/dismiss', {}), 401, 'unauthorized');
  const dismissed = await gone.c.post('/api/me/abandoned-notice/dismiss', {});
  ok(dismissed);
  assert.equal(dismissed.json<Me>().player.abandonedNotice, null);
  assert.equal((await gone.c.state()).player.abandonedNotice, null, 'stays cleared');
  ok(await here.c.post('/api/me/abandoned-notice/dismiss', {})); // harmless for someone without a notice
  assert.equal((await here.c.get('/api/auth/me')).json<Me>().player.abandonedNotice, null);
  await app.close();
});

test('support stationed elsewhere stays when its owner is abandoned; the host can still send it home', async () => {
  const { app, clock, alice, amy } = await world();
  const entry = await stationSupport(app, clock, alice, amy, { pikeman: 5 });
  const homeId = (await village(alice)).id;

  clock.advance(abandonIdleMs(app.ctx.settings) - HOUR);
  ok(await amy.c.get('/api/state'));
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(app.ctx.store.getVillage(homeId)?.ownerId, null, 'alice lost her home village');

  const still = (await stateOf(amy)).stationed.here;
  assert.deepEqual(still.map((s) => [s.id, s.units.pikeman]), [[entry.id, 5]], 'support still stands in the host village');
  assert.equal(app.ctx.store.getStationed(entry.id)?.ownerPlayerId, alice.id);

  // The host sends it home to the now-abandoned village; arrival and later reads do not break.
  const res = await amy.c.post(`/api/stationed/${entry.id}/send-back`);
  ok(res, 201);
  const { movement } = res.json<MovementResponse>();
  clock.set(movement.arriveAt);
  app.ctx.game.processDue(clock.now());
  assert.deepEqual((await stateOf(amy)).stationed.here, []);
  assert.ok((app.ctx.store.getVillage(homeId)?.state.troops.pikeman ?? 0) >= 5, 'troops arrived in the abandoned village');
  ok(await alice.c.get('/api/state'));
  await app.close();
});
