// Pure helpers behind the village switcher, the hold clock, Strike/Found/Occupy and the Chieftain price (src/villages.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEFTAIN_MAX_BATCH, HOLD_HOURS, HOLD_HOURS_ABANDONED, HOLD_MIN_POPULATION, STRIKE_CHAIN_WINDOW_HOURS, emptyUnits, villageRenownCost, villageRenownPrice } from '@clanfire/engine';
import type { HearthInfoDto, MapVillageDto, RenownInfo, Units, VillageListItemDto, VillageReportData } from '@clanfire/engine';
import {
  abandonedStrength,
  chainText,
  siegeOptionLabel,
  HEARTH_OUT_BUILD_REASON,
  HEARTH_OUT_REASON,
  SEND_MODE_BUTTON,
  SEND_MODE_HINT,
  alertCount,
  canStrike,
  chieftainBatchPrice,
  chieftainRenownNote,
  chieftainsAffordable,
  foundProblem,
  hearthBuildReason,
  holdText,
  holdView,
  isReliefTarget,
  missionsFor,
  myOccupierPopulation,
  nextChieftainPrice,
  occupierGap,
  occupyWarning,
  orderVillages,
  renameProblem,
  selectableUnits,
  sendMode,
  sortHolds,
  strikeHint,
  strikeNeed,
  strikeWarning,
  villageBadges,
  villageReportText,
} from '../src/villages.ts';

const H = 3_600_000;
const NOW = 1_000_000_000;

const units = (u: Partial<Units>): Units => ({ ...emptyUnits(), ...u });

function hearth(over: Partial<HearthInfoDto> = {}): HearthInfoDto {
  return {
    claimBy: 'Rhea',
    claimById: 7,
    outAt: NOW - H,
    running: true,
    endsAt: NOW + 5 * H,
    holdMsLeft: 5 * H,
    failsAt: null,
    minPopulation: HOLD_MIN_POPULATION,
    ...over,
  };
}

function listItem(over: Partial<VillageListItemDto> & { id: number }): VillageListItemDto {
  return {
    name: `Village ${over.id}`,
    x: 0,
    y: 0,
    points: 10,
    hearth: 'lit',
    holdEndsAt: null,
    resources: { wood: 0, food: 0, iron: 0, gold: 0 },
    incomingAttack: false,
    nextAttackAt: null,
    protectedUntil: null,
    ...over,
  };
}

function mapVillage(over: Partial<MapVillageDto> & { id: number }): MapVillageDto {
  return {
    name: 'V',
    x: 3,
    y: 4,
    kind: 'abandoned',
    ownerName: null,
    points: 20,
    protected: false,
    tribeTag: null,
    tribeId: null,
    ownerChieftain: null,
    relation: null,
    ...over,
  };
}

function renown(over: Partial<RenownInfo> = {}): RenownInfo {
  return { total: 2000, spent: 500, balance: 1500, nextVillageCost: villageRenownCost(2), villages: 2, reserved: 0, chieftains: 0, chieftainPrice: villageRenownPrice(2, 0), ...over };
}

test('holdView counts down while running and shows what is left while paused', () => {
  const running = holdView(hearth(), NOW);
  assert.equal(running.running, true);
  assert.equal(running.leftMs, 5 * H);
  assert.equal(holdView(hearth(), NOW + 2 * H).leftMs, 3 * H);
  assert.equal(holdView(hearth(), NOW + 9 * H).leftMs, 0, 'never negative');
  const paused = holdView(hearth({ running: false, endsAt: null, holdMsLeft: 4 * H, failsAt: NOW + H }), NOW + H / 2);
  assert.equal(paused.running, false);
  assert.equal(paused.leftMs, 4 * H, 'a paused clock does not move');
  assert.equal(paused.failsInMs, H / 2);
});

test('holdText names the claimant and says running or paused with the time', () => {
  assert.match(holdText(hearth(), NOW), /Rhea holds this village.*5h 0m/);
  assert.match(holdText(hearth(), NOW, true), /^You hold this village/);
  const paused = holdText(hearth({ running: false, endsAt: null, failsAt: NOW + 2 * H }), NOW);
  assert.match(paused, /paused/);
  assert.match(paused, /fails in 2h 0m/);
  assert.match(paused, new RegExp(String(HOLD_MIN_POPULATION)));
});

test('occupierGap compares the occupiers with the minimum, and stays null when unknown', () => {
  assert.equal(occupierGap(hearth(), undefined), null);
  assert.deepEqual(occupierGap(hearth(), 100), { have: 100, need: HOLD_MIN_POPULATION, enough: false });
  assert.equal(occupierGap(hearth(), HOLD_MIN_POPULATION)?.enough, true);
});

test('myOccupierPopulation adds up my troops standing in one village', () => {
  const abroad = [
    { host: { villageId: 5 }, units: units({ pikeman: 100, knight: 5 }) },
    { host: { villageId: 5 }, units: units({ guard: 10 }) },
    { host: { villageId: 6 }, units: units({ pikeman: 999 }) },
  ];
  assert.equal(myOccupierPopulation(abroad, 5), 100 + 5 * 4 + 10);
  assert.equal(myOccupierPopulation(abroad, 9), 0);
});

test('orderVillages puts attacked villages first (soonest), then cold ones, then founding order', () => {
  const list = [
    listItem({ id: 1 }),
    listItem({ id: 2, hearth: 'out', holdEndsAt: NOW + 3 * H }),
    listItem({ id: 3, incomingAttack: true, nextAttackAt: NOW + 2 * H }),
    listItem({ id: 4 }),
    listItem({ id: 5, incomingAttack: true, nextAttackAt: NOW + H }),
    listItem({ id: 6, hearth: 'out', holdEndsAt: NOW + H }),
  ];
  assert.deepEqual(orderVillages(list).map((v) => v.id), [5, 3, 6, 2, 1, 4]);
  assert.deepEqual(list.map((v) => v.id), [1, 2, 3, 4, 5, 6], 'the input is not changed');
});

test('villageBadges say it in words: attack, hearth out, protected', () => {
  assert.deepEqual(villageBadges(listItem({ id: 1 }), NOW), []);
  const b = villageBadges(listItem({ id: 1, incomingAttack: true, nextAttackAt: NOW + 12 * 60_000, hearth: 'out', holdEndsAt: NOW + 5 * H, protectedUntil: NOW + 2 * H }), NOW);
  assert.deepEqual(b.map((x) => x.kind), ['attack', 'cold', 'protected']);
  assert.equal(b[0]!.text, 'Attack in 12m');
  assert.match(b[1]!.text, /Hearth out, lost in 5h/);
  assert.equal(villageBadges(listItem({ id: 1, hearth: 'out' }), NOW)[0]!.text, 'Hearth out');
  assert.equal(villageBadges(listItem({ id: 1, protectedUntil: NOW - 1 }), NOW).length, 0, 'ended protection is not shown');
});

test('renameProblem follows the server rule: 1 to 30 characters of letters, digits, spaces and . _ - apostrophe', () => {
  assert.equal(renameProblem('North Camp'), null);
  assert.equal(renameProblem("Ana's Hold-2_b."), null);
  assert.equal(renameProblem('Mühle'), null);
  assert.ok(renameProblem('   '));
  assert.ok(renameProblem(''));
  assert.ok(renameProblem('x'.repeat(31)));
  assert.equal(renameProblem('x'.repeat(30)), null);
  assert.ok(renameProblem('<b>hi</b>'));
});

test('Chieftain price: the next one, a batch and what the balance affords', () => {
  const r = renown();
  assert.equal(nextChieftainPrice(r), villageRenownPrice(2, 0));
  // Without the server's number the engine rule gives the same.
  assert.equal(nextChieftainPrice(renown({ chieftainPrice: undefined, chieftains: 1 })), villageRenownPrice(2, 1));
  assert.equal(chieftainBatchPrice(r, 0), 0);
  assert.equal(chieftainBatchPrice(r, 1), villageRenownPrice(2, 0));
  assert.equal(chieftainBatchPrice(r, 3), villageRenownPrice(2, 0) + villageRenownPrice(2, 1) + villageRenownPrice(2, 2));
  // Each Chieftain I already have makes the next one dearer.
  assert.ok(chieftainBatchPrice(renown({ chieftains: 2 }), 1) > chieftainBatchPrice(r, 1));
  assert.equal(chieftainsAffordable(renown({ balance: 0 })), 0);
  assert.equal(chieftainsAffordable(renown({ balance: villageRenownPrice(2, 0) })), 1);
  assert.equal(chieftainsAffordable(renown({ balance: 1e9 })), CHIEFTAIN_MAX_BATCH);
  assert.equal(chieftainsAffordable(renown({ balance: 1e9 }), 2), 2);
});

test('the Renown note carries the real refund share', () => {
  const t = chieftainRenownNote();
  assert.match(t, /reserved when training starts/);
  assert.match(t, /50% comes back if he dies/);
});

test('missionsFor: free tile founds, own villages support, my claim occupies, others follow the relation', () => {
  const ctx = { playerId: 7, currentVillageId: 1 };
  assert.deepEqual(missionsFor(null, ctx), ['found']);
  assert.deepEqual(missionsFor(mapVillage({ id: 1, kind: 'own' }), ctx), [], 'the village I am in');
  assert.deepEqual(missionsFor(mapVillage({ id: 2, kind: 'own' }), ctx), ['support']);
  assert.deepEqual(missionsFor(mapVillage({ id: 3 }), ctx), ['attack', 'scout']);
  assert.deepEqual(missionsFor(mapVillage({ id: 3, hearth: hearth({ claimById: 7 }) }), ctx), ['occupy', 'scout']);
  assert.deepEqual(missionsFor(mapVillage({ id: 3, hearth: hearth({ claimById: 8 }) }), ctx), ['attack', 'scout'], 'someone else holds it: attack it');
  assert.deepEqual(missionsFor(mapVillage({ id: 4, kind: 'player', relation: 'tribe' }), ctx), ['support']);
});

test('relief: a cold own, tribe-mate or ally village offers an attack next to Support; never to the claimant', () => {
  const ctx = { playerId: 7, currentVillageId: 1 };
  const cold = hearth({ claimById: 8 });
  assert.deepEqual(missionsFor(mapVillage({ id: 2, kind: 'own', hearth: cold }), ctx), ['support', 'attack'], 'another village of mine');
  assert.deepEqual(missionsFor(mapVillage({ id: 1, kind: 'own', hearth: cold }), ctx), [], 'the village I am in');
  assert.deepEqual(missionsFor(mapVillage({ id: 4, kind: 'player', relation: 'tribe', hearth: cold }), ctx), ['support', 'attack']);
  assert.deepEqual(missionsFor(mapVillage({ id: 5, kind: 'player', relation: 'ally', hearth: cold }), ctx), ['support', 'attack']);
  assert.deepEqual(missionsFor(mapVillage({ id: 4, kind: 'player', relation: 'tribe' }), ctx), ['support'], 'lit hearth: support only');
  assert.deepEqual(missionsFor(mapVillage({ id: 6, kind: 'player', relation: 'nap', hearth: cold }), ctx), [], 'a pact partner is not helped');
  assert.deepEqual(missionsFor(mapVillage({ id: 7, kind: 'player', relation: 'enemy', hearth: cold }), ctx), ['attack', 'scout'], 'enemies: plain attack');
  assert.equal(isReliefTarget(mapVillage({ id: 4, kind: 'player', relation: 'tribe', hearth: hearth({ claimById: 7 }) }), ctx), false, 'I hold it myself');
  assert.equal(isReliefTarget(mapVillage({ id: 3, kind: 'abandoned', hearth: cold }), ctx), false);
  assert.equal(isReliefTarget(null, ctx), false);
  assert.equal(sendMode('attack', { pikeman: 5 }, 'player', true), 'relieve');
  assert.equal(sendMode('attack', { chieftain: 1 }, 'player', true), 'relieve', 'never a Strike');
  assert.equal(sendMode('support', { pikeman: 5 }, 'player', true), 'support');
  assert.equal(SEND_MODE_BUTTON.relieve, 'Relieve');
  assert.match(SEND_MODE_HINT.relieve ?? '', /Fights only the occupiers holding this village\. No loot\. If they all fall the hearth relights\./);
  const home = units({ pikeman: 10, raider: 4, chieftain: 1, logram: 2, boulder: 2 });
  assert.deepEqual(selectableUnits('relieve', home), ['pikeman', 'raider'], 'no Chieftains, no siege');
});

test('sendMode: an attack with Chieftains on an abandoned or player village is a Strike', () => {
  assert.equal(sendMode('attack', { pikeman: 50 }, 'abandoned'), 'attack');
  assert.equal(sendMode('attack', { pikeman: 50, chieftain: 1 }, 'abandoned'), 'strike');
  assert.equal(sendMode('attack', { chieftain: 1 }, 'player'), 'strike', 'player villages can be struck (step 4)');
  assert.equal(sendMode('attack', { raider: 20 }, 'player'), 'attack');
  assert.equal(sendMode('attack', { chieftain: 1 }, 'own'), 'attack');
  assert.equal(sendMode('found', { chieftain: 1 }, null), 'found');
  assert.equal(sendMode('occupy', { pikeman: 5 }, 'abandoned'), 'occupy');
  assert.equal(sendMode('scout', { pathfinder: 3 }, 'abandoned'), 'scout');
});

test('strikeWarning asks for an escort and enough Chieftains', () => {
  assert.equal(strikeWarning({ chieftain: 1, raider: 100 }), null);
  assert.match(strikeWarning({ chieftain: 1 }) ?? '', /No escort/);
  assert.match(strikeWarning({ raider: 100 }) ?? '', /needs 1 Chieftain/);
  assert.match(strikeWarning({ chieftain: 1, raider: 100 }, false, 9000) ?? '', /needs 3 Chieftains/);
  // A player's village always carries the strong-escort advice once the count and escort are fine.
  assert.match(strikeWarning({ chieftain: 3, raider: 100 }, false, 9000) ?? '', /player defends/);
});

test('Strike on a player village: Chieftains needed, hint and escort warning', () => {
  assert.equal(canStrike('player'), true);
  assert.equal(canStrike('abandoned'), true);
  assert.equal(canStrike('own'), false);
  assert.equal(canStrike(null), false);
  assert.equal(strikeNeed('abandoned', 99_999), 1);
  assert.equal(strikeNeed('player', 0), 1);
  assert.equal(strikeNeed('player', 9000), 3);
  assert.ok(strikeHint('player').includes(`${HOLD_HOURS}-hour hold`));
  assert.match(strikeHint('player'), /Tribe-mates and allies cannot be struck/);
  assert.equal(strikeHint('abandoned').includes('Tribe-mates'), false);
  assert.ok(strikeHint('abandoned').includes(`${HOLD_HOURS_ABANDONED}-hour hold`));
  for (const kind of ['player', 'abandoned'] as const) {
    assert.ok(strikeHint(kind).includes(`separate attacks, as long as they arrive within ${STRIKE_CHAIN_WINDOW_HOURS} hours of each other and are still on their way home`), kind);
  }
  assert.match(strikeWarning({ chieftain: 1, raider: 100 }, false, 100) ?? '', /strong|defends/);
  assert.match(strikeWarning({ raider: 100 }, false, 9000) ?? '', /needs 3 Chieftains/);
});

test('hearth alerts: held villages sort by the soonest hand-over, badge counts both lists', () => {
  const h = (endsAt: number | null, holdMsLeft: number): { hearth: HearthInfoDto } => ({ hearth: hearth({ running: endsAt !== null, endsAt, holdMsLeft }) });
  const late = h(NOW + 5 * H, 5 * H);
  const soon = h(NOW + H, H);
  const paused = h(null, 2 * H);
  assert.deepEqual(sortHolds([paused, late, soon]), [soon, late, paused]);
  assert.equal(alertCount(null, []), 0);
  assert.equal(alertCount([1, 2], [1]), 3);
  assert.equal(alertCount(null, [1]), 1);
});

test('occupyWarning compares the new group plus those already there with the minimum', () => {
  assert.equal(occupyWarning({ pikeman: HOLD_MIN_POPULATION }, 0, HOLD_MIN_POPULATION), null);
  assert.match(occupyWarning({ pikeman: 50 }, 40, HOLD_MIN_POPULATION) ?? '', /90 of the 150 needed/);
  assert.equal(occupyWarning({ pikeman: 50 }, 100, HOLD_MIN_POPULATION), null);
});

test('foundProblem needs exactly one Chieftain', () => {
  assert.ok(foundProblem({ pikeman: 20 }));
  assert.equal(foundProblem({ chieftain: 1, pikeman: 20 }), null);
  assert.ok(foundProblem({ chieftain: 2 }));
});

test('selectableUnits: scouts are Pathfinders only, support and occupy never take a Chieftain', () => {
  const home = units({ pikeman: 5, pathfinder: 2, chieftain: 1 });
  assert.deepEqual(selectableUnits('scout', home), ['pathfinder']);
  assert.deepEqual(selectableUnits('support', home), ['pikeman', 'pathfinder']);
  assert.deepEqual(selectableUnits('occupy', home), ['pikeman', 'pathfinder']);
  assert.deepEqual(selectableUnits('attack', home), ['pikeman', 'pathfinder', 'chieftain', 'logram', 'boulder']); // siege rows show at 0
  assert.deepEqual(selectableUnits('found', units({ chieftain: 1 })), ['chieftain']);
});

test('villageReportText has plain words for every kind', () => {
  const ref = { villageId: 9, name: 'Old Fort', x: 12, y: -4, ownerName: null };
  const kinds: VillageReportData['kind'][] = ['struck', 'hearth_out', 'taken', 'lost', 'founded', 'found_failed', 'claim_failed', 'relit'];
  for (const kind of kinds) {
    const t = villageReportText({ kind, village: ref, holdEndsAt: NOW + 3 * H, claimBy: 'Rhea', reason: 'tile_taken' }, NOW);
    assert.ok(t.title.length > 0, kind);
    assert.ok(t.lines.length > 0 && t.lines.every((l) => l.length > 0), kind);
  }
  assert.match(villageReportText({ kind: 'struck', village: ref, holdEndsAt: NOW + 3 * H }, NOW).lines.join(' '), /yours in 3h 0m/);
  assert.match(villageReportText({ kind: 'struck', village: ref, holdEndsAt: null }, NOW).lines.join(' '), /paused/);
  assert.match(villageReportText({ kind: 'hearth_out', village: ref, claimBy: 'Rhea' }, NOW).lines[0]!, /Rhea put out the hearth/);
  assert.match(villageReportText({ kind: 'found_failed', village: ref, reason: 'village_limit' }, NOW).lines[0]!, /as many villages as the world allows/);
  assert.match(villageReportText({ kind: 'claim_failed', village: ref, reason: 'time', units: units({ pikeman: 4 }) }, NOW).lines.join(' '), /on their way home/);
});

test('a cold village builds only the Wall; training keeps the plain reason', () => {
  assert.equal(hearthBuildReason(false, 'wall'), null);
  assert.equal(hearthBuildReason(false, 'barracks'), null, 'lit hearth: nothing blocked here');
  assert.equal(hearthBuildReason(true, 'wall'), null, 'the Wall stays buildable');
  for (const id of ['hall', 'barracks', 'woodcutter', 'banner'] as const) assert.equal(hearthBuildReason(true, id), 'The hearth is out: only the Wall can be built', id);
  assert.equal(HEARTH_OUT_BUILD_REASON, 'The hearth is out: only the Wall can be built');
  assert.equal(HEARTH_OUT_REASON, 'The hearth is out');
});

test('abandoned strength: a band from the points, never more troops than the start garrison of the highest tier its points allow', () => {
  assert.equal(abandonedStrength(0).band, 'weak');
  assert.ok(abandonedStrength(0).maxTroops > 0);
  const small = abandonedStrength(50);
  const big = abandonedStrength(100_000);
  assert.ok(small.maxTroops <= big.maxTroops);
  assert.equal(big.band, 'strong');
  assert.equal(abandonedStrength(Number.NaN).band, 'weak');
  for (const p of [0, 10, 50, 200, 1000, 5000]) assert.ok(abandonedStrength(p).maxTroops <= abandonedStrength(p + 500).maxTroops, `monotonic at ${p}`);
});

test('chain text: "1 of 2 Chieftains" with the time left; nothing without a chain or after it ends', () => {
  assert.equal(chainText(undefined, 1000), null);
  assert.equal(chainText({ have: 1, need: 2, endsAt: 500 }, 1000), null);
  assert.match(chainText({ have: 1, need: 2, endsAt: 1000 + 5 * 60_000 }, 1000)!, /^1 of 2 Chieftains \(counts 5m/);
});

test('siege option label: level and age only with a scout report', () => {
  assert.equal(siegeOptionLabel('Wall', undefined, null), 'Wall');
  assert.equal(siegeOptionLabel('Wall', 7, null), 'Wall');
  assert.equal(siegeOptionLabel('Wall', 7, '3h ago'), 'Wall 7 · scouted 3h ago');
});
