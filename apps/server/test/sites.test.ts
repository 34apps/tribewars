// Map sites (Fire Shrines, docs/GAME_DESIGN.md 18.4b "Step 5"): storage, placement, sending, capture, holding, recall, the Renown
// bonus and the frozen world. Everything is put into the database directly and the test clock moves; nothing waits on real time.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SITE_NO_VILLAGE_RADIUS,
  generateSites,
  isNearSite,
  shrineWakeMs,
  siteCalmMs,
  siteMilitiaPopulation,
  type MovementResponse,
  type SendResponse,
  type SitesResponse,
  type Units,
} from '@clanfire/engine';
import { endWorld } from '../src/domination-service.ts';
import { awayFromSites, withoutSiteTiles } from '../src/site-layout.ts';
import { routeBucket } from '../src/security.ts';
import { Client, errorOf, makeApp, ok, register } from './helpers.ts';
import { addMember, formPact, myTribe, newLeader, newPlayer, type P } from './tribe-helpers.ts';
import { homeOf, runTo, strongHome } from './village-helpers.ts';
import { latestReport, reports, sendFails, sendOk, send, unprotect } from './warfare-helpers.ts';

const BIG = { raider: 3000 } as const; // beats the militia of an unawake Great Fire (750 pikemen + 750 shieldbearers)

async function world(sandbox: string[] = ['alice', 'amy', 'bob', 'bea']) {
  const { app, clock } = await makeApp({ sandboxUsers: sandbox });
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  const bea = await addMember(app, bob, 'bea');
  const lou = await newPlayer(app, 'lou');
  unprotect(app, alice, amy, bob, bea, lou);
  const site = generateSites(app.ctx.settings.seed, app.ctx.settings.radius)[0];
  assert.ok(site && site.kind === 'great_fire', 'the test world has a Great Fire');
  return { app, clock, alice, amy, bob, bea, lou, site };
}
type W = Awaited<ReturnType<typeof world>>;

const sitesOf = async (p: P): Promise<SitesResponse> => {
  const res = await p.c.get('/api/sites');
  ok(res);
  return res.json<SitesResponse>();
};
const greatFire = async (p: P) => {
  const s = (await sitesOf(p)).sites.find((x) => x.id === 1);
  assert.ok(s);
  return s;
};

/** Fill `p`'s village with `troops` and send them to the Great Fire; returns the movement. */
async function march(w: W, p: P, mission: 'attack' | 'support', troops: Partial<Units>, extra: object = {}) {
  strongHome(w.app, w.clock, p, troops);
  const home = homeOf(w.app, p);
  const res = await p.c.post(`/api/villages/${home.id}/send`, { x: w.site.x, y: w.site.y, units: troops, mission, ...extra });
  ok(res, 201);
  return res.json<SendResponse>().movement;
}

/** `p` takes the Great Fire with a big army and the calm time that follows passes. */
async function capture(w: W, p: P, troops: Partial<Units> = BIG): Promise<void> {
  const m = await march(w, p, 'attack', troops);
  runTo(w.app, w.clock, m.arriveAt);
  assert.equal((await greatFire(p)).holder?.tag, p === w.alice || p === w.amy ? 'ALPHA' : 'BRAVO');
  runTo(w.app, w.clock, w.clock.now() + siteCalmMs(w.app.ctx.settings) + 1000);
}

/** Put troops of `p`'s village straight onto the site (as if a support had arrived). */
function station(w: W, p: P, troops: Partial<Units>): void {
  strongHome(w.app, w.clock, p, {});
  const home = homeOf(w.app, p);
  home.state.away = { ...home.state.away, ...troops } as Units;
  w.app.ctx.store.saveVillage(home.id, home.state, home.points);
  w.app.ctx.store.sites.addGarrison(1, p.id, home.id, { ...emptyAll(), ...troops }, w.clock.now(), null);
}
const emptyAll = (): Units => ({ pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 });

const garrisonOf = (w: W): number => w.app.ctx.store.sites.garrisonAt(1).length;

// ---- storage, list, placement -------------------------------------------------------------------------------------------

test('GET /api/sites needs a session and lists every site neutral at the start, with the militia as the garrison', async () => {
  const w = await world();
  assert.equal((await new Client(w.app).get('/api/sites')).statusCode, 401);
  const res = await sitesOf(w.lou);
  const expected = generateSites(w.app.ctx.settings.seed, w.app.ctx.settings.radius);
  assert.deepEqual(res.sites.map((s) => [s.id, s.kind, s.x, s.y]), expected.map((s) => [s.id, s.kind, s.x, s.y]));
  const gf = res.sites[0];
  assert.ok(gf);
  assert.equal(gf.holder, null);
  assert.equal(gf.awake, false);
  assert.equal(gf.garrison, siteMilitiaPopulation('great_fire', false));
  assert.equal(gf.calmUntil, null);
  assert.equal(gf.bonus, 0);
  assert.equal(gf.mine, 0);
  assert.equal(res.myBonus, 0);
  const created = Number(w.app.ctx.store.getMeta('world_created_at'));
  assert.equal(res.wakesAt, created + shrineWakeMs(w.app.ctx.settings));
});

test('the world start and every landing keep villages away from the sites', async () => {
  const w = await world();
  for (let i = 0; i < 12; i++) await newPlayer(w.app, `settler${i}`);
  const sites = generateSites(w.app.ctx.settings.seed, w.app.ctx.settings.radius);
  const store = w.app.ctx.store;
  let checked = 0;
  for (let x = -w.app.ctx.settings.radius; x <= w.app.ctx.settings.radius; x++) {
    for (let y = -w.app.ctx.settings.radius; y <= w.app.ctx.settings.radius; y++) {
      if (!store.villageExistsAt(x, y)) continue;
      checked++;
      assert.equal(isNearSite(x, y, sites), false, `no village at ${x}|${y}, within ${SITE_NO_VILLAGE_RADIUS} of a site`);
    }
  }
  assert.ok(checked > 15, 'the world has villages to check');
});

test('placement helpers: draw again until the spot is clear, give up when the world is all site, drop crowded abandoned villages', () => {
  const sites = generateSites(4242, 100);
  const first = sites[0];
  assert.ok(first);
  const picks = [{ x: first.x + 1, y: first.y - 2 }, { x: first.x + SITE_NO_VILLAGE_RADIUS, y: first.y }, { x: first.x + 40, y: first.y }];
  let calls = 0;
  const spot = awayFromSites(sites, () => picks[calls++] ?? picks[2]!);
  assert.deepEqual(spot, { x: first.x + SITE_NO_VILLAGE_RADIUS, y: first.y }, 'a tile exactly SITE_NO_VILLAGE_RADIUS away is fine');
  assert.equal(calls, 2);
  assert.throws(() => awayFromSites(sites, () => ({ x: first.x, y: first.y })), /no free place/);
  const kept = withoutSiteTiles(sites, [{ x: first.x, y: first.y, tier: 1 }, { x: first.x + 5, y: first.y, tier: 2 }]);
  assert.deepEqual(kept.map((p) => p.tier), [2]);
});

test('a Chieftain cannot found a village next to a site', async () => {
  const w = await world();
  const home = homeOf(w.app, w.alice);
  const res = await w.alice.c.post(`/api/villages/${home.id}/send`, { x: w.site.x, y: w.site.y, units: { chieftain: 1 }, mission: 'found' });
  errorOf(res, 400, 'invalid_target');
  assert.match(res.json<{ message: string }>().message, /Fire Shrine/);
});

test('only attack and support go to a site: scouts, shipments, Chieftains and tribeless players are refused', async () => {
  const w = await world();
  strongHome(w.app, w.clock, w.alice, { raider: 10, pathfinder: 5, chieftain: 1 });
  await sendFails(w.alice, w.site, 'scout', { pathfinder: 3 }, 400, 'invalid_target');
  await sendFails(w.alice, w.site, 'occupy', { raider: 3 }, 400, 'invalid_target');
  await sendFails(w.alice, w.site, 'attack', { raider: 3, chieftain: 1 }, 400, 'invalid_target');
  strongHome(w.app, w.clock, w.lou, { raider: 10 });
  assert.match(await sendFails(w.lou, w.site, 'attack', { raider: 3 }, 400, 'invalid_target'), /tribe/);
  const home = homeOf(w.app, w.alice);
  errorOf(await w.alice.c.post(`/api/villages/${home.id}/ship`, { x: w.site.x, y: w.site.y, resources: { wood: 1 } }), 400, 'invalid_target');
  // Nothing was sent.
  assert.equal((await w.alice.c.state()).movements.length, 0);
});

// ---- capture ------------------------------------------------------------------------------------------------------------

test('an attack on a neutral site fights the militia; the winners stay, their tribe holds it and it is calm for a while', async () => {
  const w = await world();
  const m = await march(w, w.alice, 'attack', BIG);
  assert.deepEqual([m.kind, m.target.villageId, m.target.name, m.target.x, m.target.y], ['attack', 0, 'Great Fire', w.site.x, w.site.y]);
  assert.equal(homeOf(w.app, w.alice).state.away.raider, 3000, 'the troops left home');
  // A march to a site is nobody's incoming attack: the tribe alert list stays empty.
  assert.equal((await w.amy.c.state()).tribeAlerts, 0);
  assert.equal((await w.bob.c.state()).movements.length, 0);

  runTo(w.app, w.clock, m.arriveAt);
  const gf = await greatFire(w.alice);
  assert.deepEqual(gf.holder && [gf.holder.tag, gf.holder.name], ['ALPHA', 'Alpha Pack']);
  assert.equal(gf.calmUntil, m.arriveAt + siteCalmMs(w.app.ctx.settings));
  const stayed = w.app.ctx.store.sites.garrisonAt(1);
  assert.equal(stayed.length, 1);
  const survivors = stayed[0]?.units.raider ?? 0;
  assert.ok(survivors > 0 && survivors <= 3000);
  assert.equal(gf.garrison, survivors, 'garrison = population of the survivors');
  assert.equal(gf.mine, survivors);
  assert.equal(homeOf(w.app, w.alice).state.away.raider, survivors, 'survivors stay in the home village away count; the dead are gone');
  assert.equal(gf.bonus, 0.03, 'dormant Great Fire: +3% Renown');
  assert.equal((await sitesOf(w.amy)).myBonus, 0.03, 'every member of the tribe gets it');
  assert.equal((await sitesOf(w.lou)).myBonus, 0, 'a player without a tribe does not');
  assert.equal((await sitesOf(w.bob)).myBonus, 0);

  const rep = await latestReport(w.alice);
  assert.equal(rep.title, `Your tribe took Great Fire (${w.site.x}|${w.site.y})`);
  assert.equal(rep.battle?.attackerWon, true);
  assert.equal(rep.battle?.defender.name, 'Great Fire');
  assert.equal(rep.battle?.wallLevel, null);
  assert.equal(rep.battle?.loot.wood, 0);
});

test('a lost attack on the militia costs the army and leaves the site neutral; the survivors walk home from the site', async () => {
  const w = await world();
  const m = await march(w, w.alice, 'attack', { raider: 20, pikeman: 10 });
  runTo(w.app, w.clock, m.arriveAt);
  assert.equal((await greatFire(w.alice)).holder, null);
  assert.equal(garrisonOf(w), 0);
  const rep = await latestReport(w.alice);
  assert.equal(rep.battle?.attackerWon, false);
  assert.equal(rep.title, `Attack on Great Fire (${w.site.x}|${w.site.y})`);
  assert.equal((await w.alice.c.state()).movements.filter((x) => x.kind === 'return').length, 0, 'an army of 30 against 1500 does not survive');
  assert.equal(homeOf(w.app, w.alice).state.away.raider, 0);
});

test('calm time: no attack on a site just taken, at send or on arrival (the army turns back and is told)', async () => {
  const w = await world();
  // Bob's army leaves while the site is still neutral, but arrives after Alice's capture.
  const a = await march(w, w.alice, 'attack', BIG, { travelSeconds: 60 });
  const b = await march(w, w.bob, 'attack', BIG, { travelSeconds: 300 });
  runTo(w.app, w.clock, a.arriveAt);
  assert.equal((await greatFire(w.bob)).holder?.tag, 'ALPHA');
  const refused = await send(w.bob, w.site, 'attack', { raider: 5 });
  errorOf(refused, 409, 'target_protected');
  assert.match(refused.json<{ message: string }>().message, /calm after a capture/);

  runTo(w.app, w.clock, b.arriveAt); // inside the calm time (12 min at speed 10)
  assert.ok(b.arriveAt < a.arriveAt + siteCalmMs(w.app.ctx.settings));
  assert.equal((await greatFire(w.bob)).holder?.tag, 'ALPHA', 'nothing changed');
  const rep = await latestReport(w.bob);
  assert.equal(rep.battle?.outcome, 'called_off');
  assert.match(rep.title, /called off: it is calm after a capture/);
  const back = (await w.bob.c.state()).movements.find((x) => x.kind === 'return');
  assert.ok(back, 'the army walks home');
  assert.equal(back.origin.name, 'Great Fire', 'and the return starts at the site');
  runTo(w.app, w.clock, back.arriveAt);
  assert.equal(homeOf(w.app, w.bob).state.troops.raider, 3000);
  assert.equal(homeOf(w.app, w.bob).state.away.raider, 0);
});

test('after the calm time an enemy attack fights the garrison: a win kills it all and the new tribe holds the site', async () => {
  const w = await world();
  await capture(w, w.alice, { raider: 3000 });
  const before = w.app.ctx.store.sites.garrisonAt(1)[0]?.units.raider ?? 0;
  assert.ok(before > 0);
  const m = await march(w, w.bob, 'attack', { raider: 5000 });
  runTo(w.app, w.clock, m.arriveAt);
  const gf = await greatFire(w.bob);
  assert.equal(gf.holder?.tag, 'BRAVO');
  assert.equal(garrisonOf(w), 1);
  assert.equal(w.app.ctx.store.sites.garrisonAt(1)[0]?.ownerPlayerId, w.bob.id);
  assert.equal(homeOf(w.app, w.alice).state.away.raider, 0, 'every defender died');
  assert.equal((await sitesOf(w.alice)).myBonus, 0, 'the bonus moved with the site');
  assert.equal((await sitesOf(w.bob)).myBonus, 0.03);
  // Alice, whose troops stood there, got the full picture.
  const rep = await latestReport(w.alice);
  assert.equal(rep.side, 'support');
  assert.equal(rep.title, `Your troops at Great Fire (${w.site.x}|${w.site.y}) were attacked`);
  assert.equal(rep.battle?.supportUnits?.raider, before);
});

test('a lost attack on a held site costs the garrison only what the battle says, and it stays held', async () => {
  const w = await world();
  await capture(w, w.alice, { raider: 3000 });
  const before = w.app.ctx.store.sites.garrisonAt(1)[0]?.units.raider ?? 0;
  const m = await march(w, w.bob, 'attack', { raider: 10 });
  runTo(w.app, w.clock, m.arriveAt);
  assert.equal((await greatFire(w.bob)).holder?.tag, 'ALPHA');
  const lost = (await latestReport(w.alice)).battle?.supportLosses?.raider ?? 0;
  assert.ok(lost > 0 && lost < before, 'the garrison lost some of its men');
  assert.equal(w.app.ctx.store.sites.garrisonAt(1)[0]?.units.raider, before - lost);
  assert.equal(homeOf(w.app, w.alice).state.away.raider, before - lost, 'and so did the home village away count');
});

test('own tribe, allies and pact partners cannot attack their own site; a shared connection cannot either', async () => {
  const w = await world();
  await capture(w, w.alice);
  strongHome(w.app, w.clock, w.amy, { raider: 50 });
  assert.match(await sendFails(w.amy, w.site, 'attack', { raider: 5 }, 400, 'invalid_target'), /can't attack/);
  await formPact(w.alice, 'BRAVO', w.bob, 'nap');
  strongHome(w.app, w.clock, w.bob, { raider: 50 });
  await sendFails(w.bob, w.site, 'attack', { raider: 5 }, 400, 'invalid_target');
  // A player of another tribe on the same connection as a player whose troops stand there.
  const w2 = await world();
  await capture(w2, w2.alice);
  w2.app.ctx.store.shareAnIp = () => true;
  strongHome(w2.app, w2.clock, w2.bob, { raider: 50 });
  assert.match(await sendFails(w2.bob, w2.site, 'attack', { raider: 5 }, 400, 'invalid_target'), /connection/);
});

// ---- support, cap, recall -----------------------------------------------------------------------------------------------

test('support: only to a held site, only from the holding tribe and its allies; the home count and the garrison follow', async () => {
  const w = await world();
  strongHome(w.app, w.clock, w.amy, { pikeman: 100 });
  assert.match(await sendFails(w.amy, w.site, 'support', { pikeman: 10 }, 400, 'invalid_target'), /Nobody holds/);
  await capture(w, w.alice);
  const m = await march(w, w.amy, 'support', { pikeman: 100 });
  assert.equal(m.kind, 'support');
  assert.deepEqual(m.units?.pikeman, 100);
  runTo(w.app, w.clock, m.arriveAt);
  const gf = await greatFire(w.amy);
  assert.equal(gf.mine, 100);
  assert.deepEqual(gf.myContingents?.map((c) => [c.villageId, c.units.pikeman]), [[homeOf(w.app, w.amy).id, 100]]);
  assert.equal(homeOf(w.app, w.amy).state.away.pikeman, 100);
  assert.equal(homeOf(w.app, w.amy).state.troops.pikeman, 0);

  // Others: a rival tribe and a loner are refused; an ally is allowed.
  strongHome(w.app, w.clock, w.bob, { pikeman: 50 });
  strongHome(w.app, w.clock, w.lou, { pikeman: 50 });
  assert.match(await sendFails(w.bob, w.site, 'support', { pikeman: 10 }, 400, 'invalid_target'), /own tribe or an ally/);
  await sendFails(w.lou, w.site, 'support', { pikeman: 10 }, 400, 'invalid_target');
  await formPact(w.alice, 'BRAVO', w.bob, 'ally');
  const b = await sendOk(w.bob, w.site, 'support', { pikeman: 50 });
  runTo(w.app, w.clock, b.movement.arriveAt);
  assert.equal((await greatFire(w.bob)).mine, 50);
  // An ally may not attack it.
  await sendFails(w.bob, w.site, 'attack', { pikeman: 1 }, 400, 'invalid_target');
});

test('the cap: a support that does not fit is refused at send; at arrival only what fits stays and the rest walks home', async () => {
  const w = await world();
  await capture(w, w.alice, { raider: 3000 });
  const held = w.app.ctx.store.sites.garrisonAt(1).reduce((n, c) => n + c.units.raider, 0);
  const room = 5000 - held;
  strongHome(w.app, w.clock, w.amy, { pikeman: room + 1 });
  assert.match(await sendFails(w.amy, w.site, 'support', { pikeman: room + 1 }, 400, 'invalid_target'), /takes at most 5000 population/);
  // Two supports both pass the send check (it counts only who stands there now); when they arrive the first fills most of the room,
  // of the second only 10 fit and 10 walk home.
  strongHome(w.app, w.clock, w.amy, { pikeman: room + 10 });
  await sendOk(w.amy, w.site, 'support', { pikeman: room - 10 });
  const second = await sendOk(w.amy, w.site, 'support', { pikeman: 20 });
  runTo(w.app, w.clock, second.movement.arriveAt);
  assert.equal((await greatFire(w.amy)).garrison, 5000);
  assert.equal((await greatFire(w.amy)).mine, room);
  const partial = (await w.amy.c.state()).movements.filter((x) => x.kind === 'return');
  assert.deepEqual(partial.map((x) => [x.origin.name, x.units?.pikeman]), [['Great Fire', 10]]);

  // Full to the brim: a support that was legal when it left turns back whole at arrival, and the sender is told.
  const store = w.app.ctx.store;
  const row = store.sites.garrisonAt(1).find((c) => c.ownerPlayerId === w.amy.id);
  assert.ok(row);
  store.sites.setGarrisonUnits(row.id, { ...row.units, pikeman: row.units.pikeman - 30 }); // room for 30 at send time
  const home = homeOf(w.app, w.amy);
  home.state.troops.pikeman = 30;
  store.saveVillage(home.id, home.state, home.points);
  const late = await sendOk(w.amy, w.site, 'support', { pikeman: 30 });
  store.sites.setGarrisonUnits(row.id, row.units); // someone else filled it meanwhile
  runTo(w.app, w.clock, late.movement.arriveAt);
  assert.equal((await greatFire(w.amy)).garrison, 5000);
  assert.match((await latestReport(w.amy)).title, /turned back: the site is full/);
  const back = (await w.amy.c.state()).movements.filter((x) => x.kind === 'return' && x.units?.pikeman === 30);
  assert.equal(back.length, 1);
});

test('recall: the owner brings troops home; when the last troop of the holding tribe leaves, the site is neutral and the allies go home', async () => {
  const w = await world();
  await capture(w, w.alice);
  await formPact(w.alice, 'BRAVO', w.bob, 'ally');
  strongHome(w.app, w.clock, w.bob, { pikeman: 40 });
  const bs = await sendOk(w.bob, w.site, 'support', { pikeman: 40 });
  runTo(w.app, w.clock, bs.movement.arriveAt);
  assert.equal(garrisonOf(w), 2);

  const aliceHome = homeOf(w.app, w.alice);
  // Partial recall first.
  const partial = await w.alice.c.post(`/api/sites/1/recall`, { villageId: aliceHome.id, units: { raider: 10 } });
  ok(partial, 201);
  const mv = partial.json<MovementResponse>().movement;
  assert.deepEqual([mv.kind, mv.direction, mv.origin.name, mv.target.name], ['return', 'outgoing', 'Great Fire', aliceHome.name]);
  assert.equal(mv.units?.raider, 10);
  assert.equal((await greatFire(w.alice)).holder?.tag, 'ALPHA');
  // Then all the rest: the holding tribe has no troop left.
  const rest = await w.alice.c.post(`/api/sites/1/recall`, { villageId: aliceHome.id });
  ok(rest, 201);
  const gf = await greatFire(w.alice);
  assert.equal(gf.holder, null, 'neutral again');
  assert.equal(gf.garrison, siteMilitiaPopulation('great_fire', false), 'the militia is back');
  assert.equal(garrisonOf(w), 0, "the ally's troops went home too");
  const returns = (await w.bob.c.state()).movements.filter((x) => x.kind === 'return');
  assert.equal(returns.length, 1);
  assert.equal(returns[0]?.units?.pikeman, 40);
  assert.equal((await sitesOf(w.alice)).myBonus, 0);
});

test('recall refuses strangers, unknown villages and bad input, and changes nothing', async () => {
  const w = await world();
  await capture(w, w.alice);
  const aliceHome = homeOf(w.app, w.alice);
  const before = garrisonOf(w);
  errorOf(await w.amy.c.post('/api/sites/1/recall', { villageId: aliceHome.id }), 404, 'not_found'); // another player's village
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: 987654 }), 404, 'not_found');
  errorOf(await w.alice.c.post('/api/sites/99/recall', { villageId: aliceHome.id }), 404, 'not_found');
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: aliceHome.id, units: { raider: 999999 } }), 409, 'not_enough_troops');
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: aliceHome.id, units: { raider: 0 } }), 400, 'no_troops');
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: 'x' }), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/sites/1/recall', {}), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: aliceHome.id, extra: 1 }), 400, 'invalid_input');
  errorOf(await w.alice.c.post('/api/sites/abc/recall', { villageId: aliceHome.id }), 400, 'invalid_input');
  const anon = await register(w.app, 'drifter', '10.77.0.1');
  errorOf(await anon.post('/api/sites/1/recall', { villageId: aliceHome.id }), 404, 'not_found');
  assert.equal(garrisonOf(w), before);
});

test('rate limit buckets: recall counts as a send, the list as a world read', () => {
  assert.equal(routeBucket('POST', '/api/sites/:id/recall'), 'send');
  assert.equal(routeBucket('GET', '/api/sites'), 'world');
});

// ---- who holds it: leaving, bans, tribes gone -----------------------------------------------------------------------------

test('a player who leaves the tribe or is banned sends their troops home; the site stays held while a member has troops there', async () => {
  const w = await world();
  await capture(w, w.alice);
  station(w, w.amy, { pikeman: 100 });
  assert.equal(garrisonOf(w), 2);
  // Amy leaves the tribe: her troops go home at the next processing, Alice still holds.
  ok(await w.amy.c.post('/api/tribe/leave'));
  w.clock.advance(1000);
  w.app.ctx.game.processDue(w.clock.now());
  assert.equal(garrisonOf(w), 1);
  const back = (await w.amy.c.state()).movements.find((x) => x.kind === 'return');
  assert.equal(back?.units?.pikeman, 100);
  assert.equal((await greatFire(w.alice)).holder?.tag, 'ALPHA');
  // Alice is banned: the holder's troops go home and the site is neutral.
  w.app.ctx.store.banPlayer(w.alice.id, 'test', w.clock.now());
  w.clock.advance(1000);
  w.app.ctx.game.processDue(w.clock.now());
  assert.equal(garrisonOf(w), 0);
  assert.equal(w.app.ctx.store.sites.getSite(1).holderTribeId, null);
  assert.ok((await w.bob.c.get('/api/sites')).statusCode === 200);
});

test('troops of a tribe that is neither holder nor ally go home; a dissolved holder tribe frees the site', async () => {
  const w = await world();
  await capture(w, w.alice);
  station(w, w.bob, { pikeman: 50 }); // bob is not an ally: gone at the next processing
  w.clock.advance(1000);
  w.app.ctx.game.processDue(w.clock.now());
  assert.equal(garrisonOf(w), 1, 'a tribe that is neither holder nor ally has no troops there');
  const tribeId = (await myTribe(w.alice)).tribe?.id;
  assert.ok(tribeId);
  w.app.ctx.store.tribes.deleteTribe(tribeId);
  w.clock.advance(1000);
  w.app.ctx.game.processDue(w.clock.now());
  assert.equal(garrisonOf(w), 0, 'no tribe, no holder: the troops go home');
  assert.equal((await greatFire(w.lou)).holder, null);
});

test('a village that changed hands disbands the troops it sent to a site', async () => {
  const w = await world();
  await capture(w, w.alice);
  const home = homeOf(w.app, w.alice);
  w.app.ctx.store.releaseVillage(home.id, 'Abandoned village');
  w.clock.advance(1000);
  w.app.ctx.game.processDue(w.clock.now());
  assert.equal(garrisonOf(w), 0);
  assert.equal(w.app.ctx.store.sites.getSite(1).holderTribeId, null);
});

// ---- the Renown bonus ------------------------------------------------------------------------------------------------------

test('Renown bonus: every member of the holding tribe earns more, once; others and tribeless players earn the same as before', async () => {
  const w = await world(['nobody']);
  await capture(w, w.alice);
  const store = w.app.ctx.store;
  const gain = (id: number, raw: number): number => {
    const before = store.getPlayer(id)?.renownTotal ?? 0;
    const credited = store.addRenown(id, raw);
    return Math.round(((store.getPlayer(id)?.renownTotal ?? 0) - before) * 1e6) / 1e6 === Math.round(credited * 1e6) / 1e6 ? credited : -1;
  };
  assert.equal(gain(w.alice.id, 100), 103, 'dormant Great Fire: +3%, applied once');
  assert.equal(gain(w.amy.id, 100), 103);
  assert.equal(gain(w.bob.id, 100), 100);
  assert.equal(gain(w.lou.id, 100), 100);
  // A test-mode top-up is not an earning.
  const sites = w.app.ctx.game.sites;
  const created = Number(store.getMeta('world_created_at'));
  const awakeAt = created + shrineWakeMs(w.app.ctx.settings);
  assert.equal(sites.renownBonusOf(w.alice.id, awakeAt - 1), 0.03);
  assert.equal(sites.renownBonusOf(w.alice.id, awakeAt), 0.1, 'awake: +10%');
  assert.equal(sites.renownBonusOf(w.lou.id, awakeAt), 0);
  const alicePlayer = store.getPlayer(w.alice.id);
  assert.ok(alicePlayer);
  const list = sites.list(alicePlayer, awakeAt);
  assert.equal(list.myBonus, 0.1);
  assert.equal(list.sites[0]?.awake, true);
  assert.equal(list.sites[0]?.bonus, 0.1);
  // A building level paid through a village save carries the bonus the same way.
  const paid = (p: P): number => {
    const v = homeOf(w.app, p);
    const state = structuredClone(v.state);
    state.buildings.farm += 1;
    const before = store.getPlayer(p.id)?.renownTotal ?? 0;
    store.saveVillage(v.id, state, v.points);
    return (store.getPlayer(p.id)?.renownTotal ?? 0) - before;
  };
  const raw = paid(w.lou);
  assert.ok(raw > 0, 'a new building level pays Renown');
  assert.ok(Math.abs(paid(w.amy) - raw * 1.03) < 1e-9, `${raw} becomes ${raw * 1.03} for a member`);
});

// ---- frozen world -----------------------------------------------------------------------------------------------------------

test('a world that has ended is frozen: no sends or recalls, marches in flight turn back, the holder stays', async () => {
  const w = await world();
  await capture(w, w.alice);
  const inflight = await march(w, w.bob, 'attack', { raider: 5000 });
  endWorld(w.app.ctx.store, { at: w.clock.now(), kind: 'manual', winner: null, reason: 'test', actorIp: 'cli' });
  strongHome(w.app, w.clock, w.amy, { pikeman: 10 });
  errorOf(await send(w.amy, w.site, 'support', { pikeman: 5 }), 403, 'forbidden');
  errorOf(await w.alice.c.post('/api/sites/1/recall', { villageId: homeOf(w.app, w.alice).id }), 403, 'forbidden');
  assert.equal((await w.alice.c.get('/api/sites')).statusCode, 200, 'reading still works');
  runTo(w.app, w.clock, inflight.arriveAt);
  assert.equal((await greatFire(w.bob)).holder?.tag, 'ALPHA', 'the arrival did not take the site');
  const rep = await latestReport(w.bob);
  assert.match(rep.title, /called off: the world has ended/);
  assert.equal(garrisonOf(w), 1, 'the garrison is untouched');
  // Leaving the tribe is refused in a frozen world, so the holder cannot change either.
  errorOf(await w.alice.c.post('/api/tribe/leave'), 403, 'forbidden');
});

// ---- cancel, state --------------------------------------------------------------------------------------------------------------

test('cancelling a march to a site brings the army back from the site tile', async () => {
  const w = await world();
  const m = await march(w, w.alice, 'attack', BIG);
  w.clock.advance(30_000);
  const res = await w.alice.c.post(`/api/movements/${m.id}/cancel`);
  ok(res, 201);
  const back = res.json<MovementResponse>().movement;
  assert.deepEqual([back.kind, back.origin.name, back.origin.x, back.origin.y], ['return', 'Great Fire', w.site.x, w.site.y]);
  runTo(w.app, w.clock, back.arriveAt);
  assert.equal(homeOf(w.app, w.alice).state.troops.raider, 3000);
  assert.equal((await reports(w.alice)).length, 0, 'a cancelled march leaves no report');
});

test('two armies that arrive in the same second: the lower movement id fights first, the other meets the calm time', async () => {
  const w = await world();
  const a = await march(w, w.alice, 'attack', BIG, { travelSeconds: 120 });
  const b = await march(w, w.bob, 'attack', BIG, { travelSeconds: 120 });
  assert.equal(a.arriveAt, b.arriveAt);
  runTo(w.app, w.clock, a.arriveAt);
  // Alice's movement has the lower id: she meets the militia, Bob arrives in her calm time and turns back.
  assert.equal((await greatFire(w.alice)).holder?.tag, 'ALPHA');
  assert.match((await latestReport(w.bob)).title, /called off/);
});
