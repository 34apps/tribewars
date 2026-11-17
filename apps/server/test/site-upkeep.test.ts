// Site upkeep is throttled (SiteService.reconcileIfDue): it runs when something it watches changed or every SITE_UPKEEP_INTERVAL_MS of
// game-clock time, not on every request. The events below must still show their effect at the very next processing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SITE_UPKEEP_INTERVAL_MS, emptyUnits } from '@clanfire/engine';
import { makeApp } from './helpers.ts';
import { addMember, newLeader, type App } from './tribe-helpers.ts';
import { unprotect } from './warfare-helpers.ts';

async function setup() {
  const { app, clock } = await makeApp();
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  unprotect(app, alice, amy);
  const tribeId = alice.tribeId;
  // Alice's tribe holds site 1; Alice and Amy each have a contingent there (rows written straight to the database).
  app.ctx.store.sites.setHolder(1, tribeId);
  for (const p of [alice, amy]) {
    const v = app.ctx.store.villagesOfPlayer(p.id)[0];
    assert.ok(v);
    app.ctx.store.sites.addGarrison(1, p.id, v.id, { ...emptyUnits(), pikeman: 10 }, clock.now(), null);
  }
  return { app, clock, alice, amy, tribeId };
}

const runs = (app: App): number => app.ctx.game.sites.upkeepRuns;
const garrison = (app: App): number => app.ctx.store.sites.garrisonAt(1).length;
const settle = (app: App, clock: { now(): number }): void => void app.ctx.game.processDue(clock.now());

test('no upkeep pass on back-to-back requests; one more after the interval, and when the clock goes backwards', async () => {
  const { app, clock } = await setup();
  settle(app, clock);
  const base = runs(app);
  assert.ok(base >= 1, 'the first processing runs the upkeep');
  for (let i = 0; i < 5; i++) {
    clock.advance(100);
    settle(app, clock);
  }
  assert.equal(runs(app), base, 'nothing changed and under the interval: no pass');
  clock.advance(SITE_UPKEEP_INTERVAL_MS);
  settle(app, clock);
  assert.equal(runs(app), base + 1, 'the interval is the safety net');
  settle(app, clock);
  assert.equal(runs(app), base + 1);
  clock.t -= 60_000;
  settle(app, clock);
  assert.equal(runs(app), base + 2, 'a clock that went backwards runs a pass');
  await app.close();
});

test('a member who leaves, a ban, a lost village, a dissolved tribe and an ended alliance act at the very next processing', async () => {
  const { app, clock, alice, amy, tribeId } = await setup();
  settle(app, clock);
  assert.equal(garrison(app), 2);
  const before = runs(app);

  // A member leaves: her troops walk home at once (no 5 s wait).
  clock.advance(100);
  const res = await amy.c.post('/api/tribe/leave');
  assert.equal(res.statusCode, 200);
  settle(app, clock);
  assert.equal(garrison(app), 1);
  assert.ok(runs(app) > before);
  assert.ok((await amy.c.state()).movements.some((m) => m.kind === 'return'), 'her troops are on the road home');

  // The last holding member is banned: the site is neutral.
  clock.advance(100);
  app.ctx.store.banPlayer(alice.id, 'test', clock.now());
  settle(app, clock);
  assert.equal(garrison(app), 0);
  assert.equal(app.ctx.store.sites.getSite(1).holderTribeId, null);

  // A lost village: its contingent is disbanded.
  app.ctx.store.sites.setHolder(1, tribeId);
  const v = app.ctx.store.villagesOfPlayer(amy.id)[0];
  assert.ok(v);
  app.ctx.store.sites.addGarrison(1, amy.id, v.id, { ...emptyUnits(), pikeman: 5 }, clock.now(), null);
  clock.advance(100);
  settle(app, clock);
  clock.advance(100);
  app.ctx.store.releaseVillage(v.id, 'Abandoned village');
  settle(app, clock);
  assert.equal(garrison(app), 0, 'troops of a released village are gone');

  // A dissolved tribe frees its site.
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  unprotect(app, bob);
  app.ctx.store.sites.setHolder(1, bob.tribeId);
  const bv = app.ctx.store.villagesOfPlayer(bob.id)[0];
  assert.ok(bv);
  app.ctx.store.sites.addGarrison(1, bob.id, bv.id, { ...emptyUnits(), pikeman: 5 }, clock.now(), null);
  clock.advance(100);
  settle(app, clock);
  assert.equal(garrison(app), 1);
  app.ctx.store.tribes.deleteTribe(bob.tribeId);
  settle(app, clock);
  assert.equal(garrison(app), 0);
  assert.equal(app.ctx.store.sites.getSite(1).holderTribeId, null);
  await app.close();
});

test('an ally relation that ends sends the ally troops home at the next processing', async () => {
  const { app, clock, tribeId } = await setup();
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  unprotect(app, bob);
  const rel = app.ctx.store.tribes.insertRelation(tribeId, bob.tribeId, 'ally', null, clock.now(), null);
  const bv = app.ctx.store.villagesOfPlayer(bob.id)[0];
  assert.ok(bv);
  app.ctx.store.sites.addGarrison(1, bob.id, bv.id, { ...emptyUnits(), pikeman: 5 }, clock.now(), null);
  clock.advance(100);
  settle(app, clock);
  assert.equal(garrison(app), 3, 'allied troops stay');
  clock.advance(100);
  app.ctx.store.tribes.deleteRelation(rel);
  settle(app, clock);
  assert.equal(garrison(app), 2, 'the ex-ally went home');
  await app.close();
});
