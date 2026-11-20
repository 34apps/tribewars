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
  const head = (n: Me['player']['abandonedNotice']) => (n ? { villages: n.villages, idleDays: n.idleDays } : n);
  assert.deepEqual(head((await gone.c.get('/api/auth/me')).json<Me>().player.abandonedNotice), expected);
  const st = await gone.c.state(); // the returning player gets a new village, and the notice is still there
  assert.deepEqual(head(st.player.abandonedNotice as Me['player']['abandonedNotice']), expected);
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

type FullNotice = {
  villages: number;
  since: number;
  newVillageId?: number;
  list: { id: number; name: string; x: number; y: number; abandonedAt: number; status: string; takenBy?: string }[];
};

test('return summary: lists each village, shows who took one, says "start again" for a player left with nothing, cleared by dismiss', async () => {
  const { app, clock } = await makeApp();
  const gone = await newPlayer(app, 'away_sum');
  const taker = await newPlayer(app, 'taker');
  const homeId = (await village(gone)).id;
  const home = app.ctx.store.getVillage(homeId)!;
  clock.advance(abandonIdleMs(app.ctx.settings) - HOUR);
  ok(await taker.c.get('/api/state'));
  clock.advance(HOUR + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  const abandonedAt = clock.now();

  const st = await gone.c.state(); // returning: a fresh village comes with the notice
  const n = st.player.abandonedNotice as unknown as FullNotice;
  assert.equal(n.list.length, 1);
  assert.equal(n.list[0]!.id, homeId);
  assert.equal(n.list[0]!.name, home.name, 'the name from before the village became abandoned');
  assert.deepEqual([n.list[0]!.x, n.list[0]!.y], [home.x, home.y]);
  assert.equal(n.list[0]!.status, 'abandoned');
  assert.equal(n.list[0]!.abandonedAt, abandonedAt);
  assert.equal(n.since, abandonedAt);
  assert.equal(n.newVillageId, st.villages[0]!.id, 'start again = the new village');
  assert.ok(st.player.protectedUntil > clock.now(), 'with beginner protection');

  // Another player takes the old village.
  app.ctx.store.setVillageOwner(homeId, (await taker.c.state()).player.id, 'Taken');
  const n2 = (await gone.c.state()).player.abandonedNotice as unknown as FullNotice;
  assert.equal(n2.list[0]!.status, 'taken');
  assert.equal(n2.list[0]!.takenBy, 'taker');

  ok(await gone.c.post('/api/me/abandoned-notice/dismiss', {}));
  assert.equal((await gone.c.state()).player.abandonedNotice, null);
  assert.equal(app.ctx.store.abandonedVillagesOf((await gone.c.state()).player.id).length, 0, 'the list is gone with it');
  await app.close();
});

test('return summary: a player who still owns villages gets the list but no new village', async () => {
  const { app, clock } = await makeApp();
  const p = await newPlayer(app, 'keeps_one');
  const id = (await p.c.state()).player.id;
  app.ctx.store.addAbandonedVillage(id, 999, 'Lost one', 3, 4, clock.now());
  app.ctx.store.addAbandonedNotice(id, 1);
  const n = (await p.c.state()).player.abandonedNotice as unknown as FullNotice;
  assert.equal(n.list.length, 1);
  assert.equal(n.newVillageId, undefined);
  assert.equal(n.list[0]!.status, 'abandoned');
  await app.close();
});

test('return summary: a tombstone (deleted player) keeps no list', async () => {
  const { app, clock } = await makeApp();
  const gone = await newPlayer(app, 'away_del');
  clock.advance(abandonIdleMs(app.ctx.settings) + MINUTE);
  app.ctx.game.runCaretaker(clock.now());
  const id = (await gone.c.get('/api/auth/me')).json<{ player: { id: number } }>().player.id;
  assert.equal(app.ctx.store.abandonedVillagesOf(id).length, 1);
  app.ctx.store.accountData.tombstone(id, 'Deleted player', clock.now());
  assert.equal(app.ctx.store.abandonedVillagesOf(id).length, 0);
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
