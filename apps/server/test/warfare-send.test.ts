// Sending scouts and support, and the attack-only-with-attackers rule (GAME_DESIGN.md section 12).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { travelTimeMs, type MovementDto } from '@clanfire/engine';
import { errorOf, makeApp, ok, register, weakestAbandoned } from './helpers.ts';
import { formPact, newPlayer } from './tribe-helpers.ts';
import { giveTroops, movementsOf, sendFails, sendOk, stateOf, units, village, world } from './warfare-helpers.ts';

test('mission is required and must be attack, scout or support', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { raider: 3 });
  const home = await village(alice);
  const target = await village(bob);
  const body = { x: target.x, y: target.y, units: { raider: 1 } };
  errorOf(await alice.c.post(`/api/villages/${home.id}/send`, body), 400, 'invalid_input');
  errorOf(await alice.c.post(`/api/villages/${home.id}/send`, { ...body, mission: 'raid' }), 400, 'invalid_input');
  errorOf(await alice.c.post(`/api/villages/${home.id}/send`, { ...body, mission: null }), 400, 'invalid_input');
  errorOf(await alice.c.post(`/api/villages/${home.id}/send`, { ...body, mission: 'attack', extra: 1 }), 400, 'invalid_input');
  assert.deepEqual(await movementsOf(alice), []);
  assert.equal((await village(alice)).state.troops.raider, 3, 'nothing was sent');
  await app.close();
});

test('attack: Pathfinders alone become a scouting march (stealthy, like the old scout mission)', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 4, raider: 2 });
  const alone = await sendOk(alice, bob, 'attack', { pathfinder: 4 });
  assert.deepEqual([alone.movement.kind, alone.movement.direction], ['scout', 'outgoing']);
  assert.equal(alone.movement.units?.pathfinder, 4);
  assert.equal((await village(alice)).state.away.pathfinder, 4);
  assert.deepEqual((await movementsOf(bob)), [], 'the target sees nothing, as with the old scout mission');
  await app.close();
});

test('attack: a mixed army of Pathfinders and fighters is an attack', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 4, raider: 2 });
  const { movement } = await sendOk(alice, bob, 'attack', { pathfinder: 1, raider: 2 });
  assert.equal(movement.kind, 'attack');
  assert.deepEqual([movement.units?.pathfinder, movement.units?.raider], [1, 2]);
  await app.close();
});

test('scout: Pathfinders only, at least one, and they must be at home', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pathfinder: 3, raider: 5 });
  await sendFails(alice, bob, 'scout', { raider: 1 }, 400, 'invalid_input');
  await sendFails(alice, bob, 'scout', { pathfinder: 1, raider: 1 }, 400, 'invalid_input');
  await sendFails(alice, bob, 'scout', {}, 400, 'no_troops');
  await sendFails(alice, bob, 'scout', { pathfinder: 0 }, 400, 'no_troops');
  await sendFails(alice, bob, 'scout', { pathfinder: 4 }, 409, 'not_enough_troops');
  await sendFails(alice, bob, 'scout', { pathfinder: -1 }, 400, 'invalid_input');
  await sendFails(alice, bob, 'scout', { pathfinder: 1.5 }, 400, 'invalid_input');
  const home = (await village(alice)).state;
  assert.deepEqual([home.troops.pathfinder, home.troops.raider, home.away.pathfinder], [3, 5, 0]);
  assert.deepEqual(await movementsOf(alice), []);
  await app.close();
});

test('scout: the movement is an outgoing scout with units, same travel time as any other mission', async () => {
  const { app, clock, alice, lou } = await world();
  giveTroops(app, alice, { pathfinder: 3 });
  const home = await village(alice);
  const dest = await village(lou);
  const { village: after, movement } = await sendOk(alice, lou, 'scout', { pathfinder: 3 });
  assert.deepEqual([movement.kind, movement.direction], ['scout', 'outgoing']);
  assert.deepEqual([movement.origin.villageId, movement.target.villageId, movement.target.ownerName], [home.id, dest.id, 'lou']);
  assert.equal(movement.units?.pathfinder, 3);
  assert.equal(movement.loot, null);
  assert.equal(movement.departAt, clock.now());
  assert.equal(movement.arriveAt - movement.departAt, travelTimeMs(home, dest, movement.units ?? units({}), app.ctx.settings));
  assert.deepEqual([after.state.troops.pathfinder, after.state.away.pathfinder], [0, 3]);
  await app.close();
});

test('scout: same targets as an attack (not yourself, tribe-mates, allies, NAP partners); enemies, neutrals and abandoned villages are fine', async () => {
  const { app, alice, amy, bob, bea, lou } = await world();
  giveTroops(app, alice, { pathfinder: 20 });
  const own = await village(alice);

  assert.match(await sendFails(alice, own, 'scout', { pathfinder: 1 }, 400, 'invalid_target'), /own village/);
  assert.match(await sendFails(alice, amy, 'scout', { pathfinder: 1 }, 400, 'invalid_target'), /scout members of your own tribe/);

  await formPact(alice, 'BRAVO', bob, 'ally');
  const ally = await sendFails(alice, bob, 'scout', { pathfinder: 1 }, 409, 'target_protected');
  assert.match(ally, /scout \[BRAVO\]/);
  assert.match(ally, /alliance/);
  await formPact(alice, 'BRAVO', bob, 'nap');
  assert.match(await sendFails(alice, bea, 'scout', { pathfinder: 1 }, 409, 'target_protected'), /non-aggression pact/);
  assert.equal((await village(alice)).state.away.pathfinder, 0, 'nothing left home');

  // A neutral player, an enemy, and an abandoned village are all fine. (End the pact for good first.)
  app.ctx.store.db.exec('DELETE FROM tribe_relations');
  ok(await alice.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'enemy' }), 201);
  await sendOk(alice, bob, 'scout', { pathfinder: 1 });
  await sendOk(alice, lou, 'scout', { pathfinder: 1 });
  const npc = await weakestAbandoned(alice.c, 12);
  const { movement } = await sendOk(alice, npc, 'scout', { pathfinder: 1 });
  assert.equal(movement.target.ownerName, null);
  assert.equal((await village(alice)).state.away.pathfinder, 3);
  await app.close();
});

test('beginner protection: scouting a protected player is refused; scouting or attacking a player ends the sender\'s own protection', async () => {
  const { app, alice, bob, lou } = await world();
  giveTroops(app, alice, { pathfinder: 5, raider: 5 });
  const newbie = await newPlayer(app, 'newbie');
  const newbieSender = await newPlayer(app, 'newbie2');
  giveTroops(app, newbieSender, { pathfinder: 5, raider: 5 });

  // Protected targets: scouting is refused just like attacking.
  assert.match(await sendFails(alice, newbie, 'scout', { pathfinder: 1 }, 409, 'target_protected'), /protection/);
  assert.match(await sendFails(alice, newbie, 'attack', { raider: 1 }, 409, 'target_protected'), /protection/);
  assert.deepEqual(await movementsOf(alice), []);

  // Scouting an abandoned village keeps the sender's protection.
  const npc = await weakestAbandoned(newbieSender.c, 12);
  const before = (await stateOf(newbieSender)).player.protectedUntil;
  assert.ok(before > 0);
  await sendOk(newbieSender, npc, 'scout', { pathfinder: 1 });
  assert.equal((await stateOf(newbieSender)).player.protectedUntil, before);

  // Scouting a player ends it.
  await sendOk(newbieSender, lou, 'scout', { pathfinder: 1 });
  assert.equal((await stateOf(newbieSender)).player.protectedUntil, 0);

  // So does an attack on a player (the existing rule), but not a refused one.
  const other = await newPlayer(app, 'newbie3');
  giveTroops(app, other, { raider: 5 });
  const until = (await stateOf(other)).player.protectedUntil;
  await sendFails(other, newbie, 'attack', { raider: 1 }, 409, 'target_protected');
  assert.equal((await stateOf(other)).player.protectedUntil, until, 'a refused send does not end protection');
  await sendOk(other, bob, 'attack', { raider: 1 });
  assert.equal((await stateOf(other)).player.protectedUntil, 0);
  await app.close();
});

test('support: only to tribe-mates and allies; protection is ignored both ways', async () => {
  const { app, clock, alice, amy, bob, bea, lou } = await world();
  giveTroops(app, alice, { pikeman: 40, pathfinder: 4 });
  const own = await village(alice);

  // Never to yourself, abandoned villages, neutrals, enemies or NAP partners.
  const msg = await sendFails(alice, own, 'support', { pikeman: 1 }, 400, 'invalid_target');
  assert.match(msg, /own village/);
  const npc = await weakestAbandoned(alice.c, 12);
  await sendFails(alice, npc, 'support', { pikeman: 1 }, 400, 'invalid_target');
  await sendFails(alice, lou, 'support', { pikeman: 1 }, 400, 'invalid_target');
  await sendFails(alice, bob, 'support', { pikeman: 1 }, 400, 'invalid_target');
  ok(await alice.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'enemy' }), 201);
  await sendFails(alice, bob, 'support', { pikeman: 1 }, 400, 'invalid_target');
  await formPact(alice, 'BRAVO', bob, 'nap');
  await sendFails(alice, bob, 'support', { pikeman: 1 }, 400, 'invalid_target');
  // A tribeless player has no one to support.
  giveTroops(app, lou, { pikeman: 3 });
  await sendFails(lou, alice, 'support', { pikeman: 1 }, 400, 'invalid_target');
  assert.deepEqual(await movementsOf(alice), []);
  assert.equal((await village(alice)).state.troops.pikeman, 40);

  // Tribe-mates: any units, even towards a player under beginner protection, and it does not touch the sender's protection.
  const protectedMate = await newPlayer(app, 'carol');
  ok(await protectedMate.c.post('/api/tribes/' + alice.tribeId + '/join'));
  assert.ok((await stateOf(protectedMate)).player.protectedUntil > clock.now());
  const sender = await newPlayer(app, 'dan');
  ok(await sender.c.post('/api/tribes/' + alice.tribeId + '/join'));
  giveTroops(app, sender, { pikeman: 5, pathfinder: 2 });
  const sendersProtection = (await stateOf(sender)).player.protectedUntil;
  assert.ok(sendersProtection > clock.now());
  const { movement } = await sendOk(sender, protectedMate, 'support', { pikeman: 5, pathfinder: 2 });
  assert.deepEqual([movement.kind, movement.direction], ['support', 'outgoing']);
  assert.deepEqual([movement.units?.pikeman, movement.units?.pathfinder], [5, 2]);
  assert.equal((await stateOf(sender)).player.protectedUntil, sendersProtection, 'support never ends protection');
  const home = (await village(sender)).state;
  assert.deepEqual([home.troops.pikeman, home.away.pikeman, home.away.pathfinder], [0, 5, 2]);

  const toAmy = await sendOk(alice, amy, 'support', { pikeman: 10, pathfinder: 1 });
  assert.equal(toAmy.movement.target.ownerName, 'amy');

  // Allies; the support pact check is judged now, so a pact in its cancellation notice still counts.
  await formPact(alice, 'BRAVO', bob, 'ally');
  const toBob = await sendOk(alice, bob, 'support', { pikeman: 10 });
  assert.equal(toBob.movement.target.ownerName, 'bob');
  await sendOk(alice, bea, 'support', { pikeman: 10 });
  const rel = (await alice.c.get('/api/tribe')).json<{ tribe: { relations: Array<{ id: number }> } }>().tribe.relations[0];
  ok(await alice.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  await sendOk(alice, bob, 'support', { pikeman: 1 });
  await app.close();
});

test('support: needs troops at home, at least one unit, valid unit counts', async () => {
  const { app, alice, amy } = await world();
  giveTroops(app, alice, { pikeman: 3 });
  await sendFails(alice, amy, 'support', {}, 400, 'no_troops');
  await sendFails(alice, amy, 'support', { pikeman: 4 }, 409, 'not_enough_troops');
  await sendFails(alice, amy, 'support', { guard: 1 }, 409, 'not_enough_troops');
  await sendFails(alice, amy, 'support', { wizard: 1 }, 400, 'invalid_input');
  await sendFails(alice, amy, 'support', { pikeman: 'x' }, 400, 'invalid_input');
  const { movement } = await sendOk(alice, amy, 'support', { pikeman: 3 });
  const rest = await sendFails(alice, amy, 'support', { pikeman: 1 }, 409, 'not_enough_troops');
  assert.match(rest, /Pikeman/);
  assert.equal(movement.units?.pikeman, 3);
  await app.close();
});

test('only the owner of a village can send from it; a stranger cannot send for someone else', async () => {
  const { app, alice, bob } = await world();
  giveTroops(app, alice, { pikeman: 3 });
  const home = await village(alice);
  const target = await village(bob);
  errorOf(await bob.c.post(`/api/villages/${home.id}/send`, { x: target.x, y: target.y, units: { pikeman: 1 }, mission: 'support' }), 403, 'forbidden');
  const lone = await makeApp();
  const a = await register(lone.app, 'solo');
  errorOf(await a.post('/api/villages/99999/send', { x: 0, y: 0, units: { pikeman: 1 }, mission: 'support' }), 404, 'not_found');
  await lone.app.close();
  await app.close();
});

test('a scout or support in flight shows up for the sender as outgoing, with its units', async () => {
  const { app, alice, amy, lou } = await world();
  giveTroops(app, alice, { pathfinder: 2, pikeman: 4 });
  await sendOk(alice, lou, 'scout', { pathfinder: 2 });
  await sendOk(alice, amy, 'support', { pikeman: 4 });
  const mine: MovementDto[] = await movementsOf(alice);
  assert.deepEqual(mine.map((m) => [m.kind, m.direction]).sort(), [['scout', 'outgoing'], ['support', 'outgoing']]);
  assert.ok(mine.every((m) => m.units !== null));
  await app.close();
});
