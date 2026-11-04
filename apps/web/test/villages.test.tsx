// Pure helpers behind the village switcher, the hold clock, Strike/Found/Occupy and the Chieftain price (src/villages.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHIEFTAIN_MAX_BATCH, HOLD_MIN_POPULATION, emptyUnits, villageRenownCost, villageRenownPrice } from '@clanfire/engine';
import type { HearthInfoDto, MapVillageDto, RenownInfo, Units, VillageListItemDto, VillageReportData } from '@clanfire/engine';
import {
  chieftainBatchPrice,
  chieftainRenownNote,
  chieftainsAffordable,
  foundProblem,
  holdText,
  holdView,
  missionsFor,
  myOccupierPopulation,
  nextChieftainPrice,
  occupierGap,
  occupyWarning,
  orderVillages,
  renameProblem,
  selectableUnits,
  sendMode,
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

test('sendMode: an attack with Chieftains on an abandoned village is a Strike', () => {
  assert.equal(sendMode('attack', { pikeman: 50 }, 'abandoned'), 'attack');
  assert.equal(sendMode('attack', { pikeman: 50, chieftain: 1 }, 'abandoned'), 'strike');
  assert.equal(sendMode('attack', { chieftain: 1 }, 'player'), 'attack', 'players are not struck in step 2');
  assert.equal(sendMode('found', { chieftain: 1 }, null), 'found');
  assert.equal(sendMode('occupy', { pikeman: 5 }, 'abandoned'), 'occupy');
  assert.equal(sendMode('scout', { pathfinder: 3 }, 'abandoned'), 'scout');
});

test('strikeWarning asks for an escort and enough Chieftains', () => {
  assert.equal(strikeWarning({ chieftain: 1, raider: 100 }), null);
  assert.match(strikeWarning({ chieftain: 1 }) ?? '', /No escort/);
  assert.match(strikeWarning({ raider: 100 }) ?? '', /needs 1 Chieftain/);
  assert.match(strikeWarning({ chieftain: 1, raider: 100 }, false, 9000) ?? '', /needs 3 Chieftains/);
  assert.equal(strikeWarning({ chieftain: 3, raider: 100 }, false, 9000), null);
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
  assert.deepEqual(selectableUnits('attack', home), ['pikeman', 'pathfinder', 'chieftain']);
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
