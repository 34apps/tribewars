// The "your villages were abandoned" notice and what abandonment leaves behind (GAME_DESIGN.md section 17).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abandonIdleMs } from '@clanfire/engine';
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

test('an abandoned village disbands its owner\'s troops standing elsewhere (the home is gone) and sends hosted support home', async () => {
  const { app, clock, alice, amy } = await world();
  const away = await stationSupport(app, clock, alice, amy, { pikeman: 5 }); // alice's troops stand in amy's village
  const hosted = await stationSupport(app, clock, amy, alice, { guard: 4 }); // amy's troops stand in alice's village
  const homeId = (await village(alice)).id;
  const amyHome = (await village(amy)).id;
  const awayBefore = app.ctx.store.getVillage(amyHome)?.state.away.guard;
  assert.equal(awayBefore, 4);

  clock.advance(abandonIdleMs(app.ctx.settings) - HOUR);
  ok(await amy.c.get('/api/state'));
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  assert.equal(app.ctx.store.getVillage(homeId)?.ownerId, null, 'alice lost her home village');

  // Alice's contingent is gone with its home; amy's support was sent home from the abandoned village.
  assert.equal(app.ctx.store.getStationed(away.id), null, 'the troops of the abandoned owner are disbanded');
  assert.equal(app.ctx.store.getStationed(hosted.id), null, 'hosted support left the abandoned village');
  assert.deepEqual((await stateOf(amy)).stationed.here, []);
  const back = (await stateOf(amy)).movements.find((m) => m.kind === 'return');
  assert.ok(back, 'amy\'s support walks home');
  assert.equal(back.units?.guard, 4);
  clock.set(back.arriveAt);
  const home = (await village(amy)).state;
  assert.equal(home.troops.guard, 4, 'and arrives');
  assert.equal(home.away.guard, 0);
  ok(await alice.c.get('/api/state')); // the returning owner is fine
  await app.close();
});
