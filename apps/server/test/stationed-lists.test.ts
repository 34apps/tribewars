// The Support lists: "here" holds only OTHER players' troops standing in the player's villages; "abroad" holds the player's own troops anywhere else
// (including in his own other villages, which are NOT also listed as guests).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateOf, stationSupport, units, unprotect, world } from './warfare-helpers.ts';
import { villagesOf } from './village-helpers.ts';

test('an own stack in his own other village is abroad only; an ally\'s stack is a guest for the host and abroad for the ally', async () => {
  const { app, clock, alice, amy } = await world();
  unprotect(app, alice, amy);
  const store = app.ctx.store;
  const home = villagesOf(app, alice)[0]!;
  const second = store.abandonedVillageIds()[0]!;
  store.setVillageOwner(second, alice.id, 'Alice two');
  const ownRow = store.addStationed(alice.id, home.id, second, units({ pikeman: 7 }), clock.now());

  assert.deepEqual(store.stationedAbroad(alice.id).map((s) => s.id), [ownRow]);
  assert.deepEqual(store.stationedHere(alice.id), [], 'own troops are not guests');

  const guest = await stationSupport(app, clock, amy, alice, { pikeman: 5 });
  const here = store.stationedHere(alice.id);
  assert.deepEqual(here.map((s) => s.id), [guest.id]);
  assert.deepEqual(store.stationedAbroad(alice.id).map((s) => s.id), [ownRow], 'the ally\'s stack is not alice\'s abroad');
  assert.deepEqual(store.stationedHere(amy.id), []);
  assert.deepEqual(store.stationedAbroad(amy.id).map((s) => s.id), [guest.id]);

  // The API state the client reads says the same.
  const a = (await stateOf(alice)).stationed;
  assert.deepEqual(a.here.map((s) => s.id), [guest.id]);
  assert.deepEqual(a.abroad.map((s) => s.id), [ownRow]);
  const m = (await stateOf(amy)).stationed;
  assert.deepEqual(m.here, []);
  assert.deepEqual(m.abroad.map((s) => s.id), [guest.id]);
});
