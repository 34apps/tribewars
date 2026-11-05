import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILDINGS,
  DEFAULT_WORLD,
  DEFAULT_WORLD_CONFIG,
  DOMINATION_DEFAULTS,
  FOUND_PROTECTION_HOURS,
  HEARTH_PLAYERS_ENABLED,
  HOLD_FAIL_HOURS,
  HOLD_HOURS,
  HOLD_HOURS_ABANDONED,
  MAX_BUILD_QUEUE,
  MAX_RESEARCH_QUEUE,
  MAX_TRAIN_QUEUE,
  NPC_MAX_LEVEL,
  NPC_START_GOLD_PER_TIER,
  NPC_START_RESOURCE_SHARE,
  RENOWN_VILLAGE_BASE,
  RENOWN_VILLAGE_GROWTH,
  RESTART_PROTECTION_HOURS,
  SHIPMENT_SPEED,
  SIEGE_OFF_MESSAGE,
  STRIKE_CHAIN_WINDOW_HOURS,
  STRIKE_LOCK_HOURS,
  TRIBE_MAX_MEMBERS,
  WORLD_CONFIG_FIELDS,
  applyBuild,
  applyOwnerChange,
  applyResearch,
  applyStrike,
  applyTrain,
  applyWorldConfig,
  botBuildChoice,
  chainedChieftains,
  checkBuild,
  checkResearch,
  checkStrike,
  checkTrain,
  checkWorldConfigInput,
  checkWorldConfigValue,
  createFoundedVillage,
  createNpcVillage,
  createPlayerVillage,
  flatShipmentTravelMs,
  flatTravelTimeMs,
  getWorldConfigValue,
  holdDueAt,
  isSafeAfterOpen,
  makeRenownInfo,
  moveSpeed,
  parseWorldConfigInput,
  resolveBattle,
  resolveWorldConfig,
  restartProtectionMs,
  setWorldConfigValue,
  settleVillage,
  shipmentTravelMs,
  siegeEnabled,
  storageCap,
  strikeChainWindowMs,
  travelTimeMs,
  updateHold,
  villageRenownCost,
  villageRenownPrice,
  worldConfigFromSettings,
  worldRules,
} from '../src/index.ts';
import type { VillageState, WorldSettings } from '../src/index.ts';
import { HOUR, S1, deepFreeze, units, village } from './helpers.ts';

/** Settings of a world that differs from the defaults in one setting. */
const cfg = (path: string, value: number | boolean, base: WorldSettings = S1): WorldSettings =>
  applyWorldConfig(base, setWorldConfigValue(DEFAULT_WORLD_CONFIG, path, value));

const T = 1_000_000;
/** A village with the storehouse full and enough of everything to queue several jobs. */
const rich = (buildings: Partial<VillageState['buildings']> = {}): VillageState => {
  const cap = storageCap(village({ buildings }));
  return village({ buildings, resources: { wood: cap, food: cap, iron: cap, gold: cap } });
};

describe('DEFAULT_WORLD_CONFIG', () => {
  it('equals the constants of config.ts and DEFAULT_WORLD', () => {
    const c = DEFAULT_WORLD_CONFIG;
    assert.deepEqual(c.pace, { speed: DEFAULT_WORLD.speed, unitSpeed: 1 });
    assert.deepEqual(c.protection, {
      beginnerHours: DEFAULT_WORLD.protectionHours,
      foundHours: FOUND_PROTECTION_HOURS,
      restartHours: RESTART_PROTECTION_HOURS,
    });
    assert.deepEqual(c.npc, {
      density: DEFAULT_WORLD.npcDensity,
      growthHours: DEFAULT_WORLD.npcGrowthHours,
      maxLevel: NPC_MAX_LEVEL,
      startStockShare: NPC_START_RESOURCE_SHARE,
      startGoldPerTier: NPC_START_GOLD_PER_TIER,
    });
    assert.deepEqual(c.conquest, {
      playersCanBeConquered: HEARTH_PLAYERS_ENABLED,
      renownBase: RENOWN_VILLAGE_BASE,
      renownGrowth: RENOWN_VILLAGE_GROWTH,
      chainWindowHours: STRIKE_CHAIN_WINDOW_HOURS,
      holdHours: HOLD_HOURS,
      holdHoursAbandoned: HOLD_HOURS_ABANDONED,
      holdFailHours: HOLD_FAIL_HOURS,
      lockHours: STRIKE_LOCK_HOURS,
    });
    assert.deepEqual(c.domination, DOMINATION_DEFAULTS);
    assert.equal(c.tribe.maxMembers, TRIBE_MAX_MEMBERS);
    assert.deepEqual(c.queues, { build: MAX_BUILD_QUEUE, research: MAX_RESEARCH_QUEUE, train: MAX_TRAIN_QUEUE });
    assert.equal(c.features.siege, true);
  });

  it('every default is valid under its own field range', () => {
    for (const f of WORLD_CONFIG_FIELDS) {
      const v = getWorldConfigValue(DEFAULT_WORLD_CONFIG, f.path);
      assert.notEqual(v, undefined, f.path);
      assert.ok(checkWorldConfigValue(f.path, v).ok, f.path);
    }
  });

  it('settings without a config run on the defaults', () => {
    assert.equal(worldRules(S1), DEFAULT_WORLD_CONFIG);
    assert.equal(worldRules(undefined), DEFAULT_WORLD_CONFIG);
    assert.equal(moveSpeed(S1), S1.speed);
    assert.equal(siegeEnabled(S1), true);
  });
});

describe('resolveWorldConfig', () => {
  it('a partial object keeps the rest at the defaults', () => {
    const c = resolveWorldConfig({ queues: { build: 5 } });
    assert.equal(c.queues.build, 5);
    assert.equal(c.queues.train, MAX_TRAIN_QUEUE);
    assert.deepEqual(c.conquest, DEFAULT_WORLD_CONFIG.conquest);
  });

  it('damaged values fall back to the default', () => {
    const c = resolveWorldConfig({
      pace: { speed: -3, unitSpeed: 'fast' },
      queues: { build: 2.5, research: 99, train: null },
      features: { siege: 'yes', morale: true },
      conquest: { holdHours: Number.NaN },
    });
    assert.equal(c.pace.speed, DEFAULT_WORLD_CONFIG.pace.speed);
    assert.equal(c.pace.unitSpeed, 1);
    assert.deepEqual(c.queues, DEFAULT_WORLD_CONFIG.queues);
    assert.equal(c.features.siege, true);
    assert.equal(c.features.morale, true); // the valid one next to the damaged one still counts
    assert.equal(c.conquest.holdHours, HOLD_HOURS);
  });

  it('unknown keys and groups are ignored', () => {
    const c = resolveWorldConfig({ pace: { speed: 4, bogus: 1 }, nope: { x: 1 }, __proto__: { polluted: true } });
    assert.equal(c.pace.speed, 4);
    assert.ok(!('nope' in c));
    assert.ok(!('bogus' in c.pace));
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('anything that is not an object gives the defaults', () => {
    for (const raw of [undefined, null, 'x', 5, [], true]) assert.deepEqual(resolveWorldConfig(raw), DEFAULT_WORLD_CONFIG);
  });

  it('returns a copy, never the shared defaults', () => {
    const c = resolveWorldConfig(undefined);
    assert.notEqual(c, DEFAULT_WORLD_CONFIG);
    c.queues.build = 9;
    assert.equal(DEFAULT_WORLD_CONFIG.queues.build, MAX_BUILD_QUEUE);
  });
});

describe('checkWorldConfigValue / parseWorldConfigInput / checkWorldConfigInput', () => {
  it('checks ranges, whole numbers and types', () => {
    assert.ok(checkWorldConfigValue('queues.build', 5).ok);
    assert.ok(!checkWorldConfigValue('queues.build', 0).ok);
    assert.ok(!checkWorldConfigValue('queues.build', 11).ok);
    assert.ok(!checkWorldConfigValue('queues.build', 2.5).ok);
    assert.ok(!checkWorldConfigValue('queues.build', Number.NaN).ok);
    assert.ok(!checkWorldConfigValue('queues.build', Infinity).ok);
    assert.ok(!checkWorldConfigValue('queues.build', '3').ok);
    assert.ok(checkWorldConfigValue('pace.unitSpeed', 0.5).ok); // not an integer field
    assert.ok(!checkWorldConfigValue('pace.unitSpeed', 0.05).ok);
    assert.ok(checkWorldConfigValue('features.siege', false).ok);
    assert.ok(!checkWorldConfigValue('features.siege', 1).ok);
    assert.ok(!checkWorldConfigValue('conquest.playersCanBeConquered', 'true').ok);
  });

  it('an unknown path is refused', () => {
    for (const p of ['nope', 'queues.nope', 'nope.build', '', 'queues']) {
      const r = checkWorldConfigValue(p, 1);
      assert.ok(!r.ok && r.reason === 'invalid_input', p);
      assert.ok(!parseWorldConfigInput(p, '1').ok, p);
    }
  });

  it('parses command-line text', () => {
    assert.deepEqual(parseWorldConfigInput('queues.build', ' 4 '), { ok: true, value: 4 });
    assert.deepEqual(parseWorldConfigInput('pace.unitSpeed', '0.5'), { ok: true, value: 0.5 });
    assert.deepEqual(parseWorldConfigInput('features.siege', 'off'), { ok: true, value: false });
    assert.deepEqual(parseWorldConfigInput('features.siege', 'YES'), { ok: true, value: true });
    assert.ok(!parseWorldConfigInput('features.siege', 'maybe').ok);
    assert.ok(!parseWorldConfigInput('queues.build', '').ok);
    assert.ok(!parseWorldConfigInput('queues.build', 'abc').ok);
    assert.ok(!parseWorldConfigInput('queues.build', '99').ok);
    assert.ok(!parseWorldConfigInput('queues.build', '1.5').ok);
  });

  it('checkWorldConfigInput reports the first bad value, accepts a good object', () => {
    const good = checkWorldConfigInput({ queues: { build: 4 }, features: { siege: false } });
    assert.ok(good.ok);
    if (good.ok) {
      assert.equal(good.config.queues.build, 4);
      assert.equal(good.config.features.siege, false);
    }
    assert.ok(!checkWorldConfigInput({ queues: { build: 400 } }).ok);
    assert.ok(!checkWorldConfigInput({ queues: { bogus: 1 } }).ok);
    assert.ok(!checkWorldConfigInput({ bogus: 1 }).ok);
    assert.ok(!checkWorldConfigInput(null).ok);
    assert.ok(!checkWorldConfigInput([]).ok);
  });
});

describe('setWorldConfigValue / applyWorldConfig / worldConfigFromSettings / isSafeAfterOpen', () => {
  it('setWorldConfigValue changes a copy and leaves the input alone', () => {
    const frozen = deepFreeze(structuredClone(DEFAULT_WORLD_CONFIG));
    const next = setWorldConfigValue(frozen, 'queues.build', 5);
    assert.equal(next.queues.build, 5);
    assert.equal(frozen.queues.build, MAX_BUILD_QUEUE);
    assert.equal(DEFAULT_WORLD_CONFIG.queues.build, MAX_BUILD_QUEUE);
    assert.notEqual(next.queues, frozen.queues);
    assert.equal(next.conquest.holdHours, frozen.conquest.holdHours);
  });

  it('applyWorldConfig keeps the flat fields equal to the config', () => {
    let c = setWorldConfigValue(DEFAULT_WORLD_CONFIG, 'pace.speed', 7);
    c = setWorldConfigValue(c, 'npc.density', 0.05);
    c = setWorldConfigValue(c, 'protection.beginnerHours', 12);
    c = setWorldConfigValue(c, 'npc.growthHours', 2);
    c = setWorldConfigValue(c, 'domination.winShare', 0.4);
    const s = applyWorldConfig(S1, c);
    assert.equal(s.speed, 7);
    assert.equal(s.npcDensity, 0.05);
    assert.equal(s.protectionHours, 12);
    assert.equal(s.npcGrowthHours, 2);
    assert.equal(s.domination?.winShare, 0.4);
    assert.equal(s.config, c);
    assert.equal(s.seed, S1.seed);
    assert.equal(s.radius, S1.radius);
    assert.equal(S1.speed, 1); // the input settings are untouched
  });

  it('worldConfigFromSettings: a world from before per-world rules keeps its flat values, defaults for the rest', () => {
    const c = worldConfigFromSettings({ speed: 4, npcDensity: 0.05, protectionHours: 10, npcGrowthHours: 2, domination: { ...DOMINATION_DEFAULTS, minAgeDays: 10 } });
    assert.equal(c.pace.speed, 4);
    assert.equal(c.npc.density, 0.05);
    assert.equal(c.protection.beginnerHours, 10);
    assert.equal(c.npc.growthHours, 2);
    assert.equal(c.domination.minAgeDays, 10);
    assert.deepEqual(c.conquest, DEFAULT_WORLD_CONFIG.conquest);
    assert.deepEqual(c.queues, DEFAULT_WORLD_CONFIG.queues);
    assert.deepEqual(worldConfigFromSettings({}), DEFAULT_WORLD_CONFIG);
  });

  it('isSafeAfterOpen', () => {
    for (const p of ['domination.winShare', 'domination.streakDays', 'tribe.maxMembers', 'features.scavenging', 'features.paidSpeedups']) {
      assert.ok(isSafeAfterOpen(p), p);
    }
    for (const p of ['queues.build', 'features.siege', 'features.sites', 'pace.speed', 'conquest.holdHours', 'npc.maxLevel', 'protection.foundHours']) {
      assert.ok(!isSafeAfterOpen(p), p);
    }
  });
});

describe('two configs behave differently', () => {
  it('Renown price of a village', () => {
    const a = cfg('conquest.renownBase', 500);
    const b = cfg('conquest.renownBase', 2000);
    assert.equal(villageRenownCost(2, a), Math.round(500 * RENOWN_VILLAGE_GROWTH));
    assert.equal(villageRenownCost(2, b), Math.round(2000 * RENOWN_VILLAGE_GROWTH));
    assert.equal(villageRenownCost(2, S1), villageRenownCost(2));
    assert.equal(villageRenownCost(2), Math.round(RENOWN_VILLAGE_BASE * RENOWN_VILLAGE_GROWTH));
    assert.equal(villageRenownCost(3, cfg('conquest.renownGrowth', 1)), RENOWN_VILLAGE_BASE);
    assert.ok(villageRenownPrice(2, 1, b) > villageRenownPrice(2, 1, a));
    assert.equal(makeRenownInfo(0, 0, 2, a).nextVillageCost, villageRenownCost(2, a));
  });

  it('hold time of a Strike (player and abandoned village)', () => {
    const a = cfg('conquest.holdHoursAbandoned', 3);
    const b = cfg('conquest.holdHoursAbandoned', 20);
    const strike = (s: WorldSettings, v: VillageState): VillageState => applyStrike(v, { claimBy: 7, now: T, settings: s, occupiers: units({ chieftain: 1 }) });
    assert.equal(strike(a, createNpcVillage(2, 0, 99)).hearth?.holdMs, 3 * HOUR);
    assert.equal(strike(b, createNpcVillage(2, 0, 99)).hearth?.holdMs, 20 * HOUR);
    assert.equal(strike(S1, createNpcVillage(2, 0, 99)).hearth?.holdMs, HOLD_HOURS_ABANDONED * HOUR);
    const p = cfg('conquest.holdHours', 5);
    assert.equal(strike(p, createPlayerVillage(0)).hearth?.holdMs, 5 * HOUR);
    assert.equal(strike(S1, createPlayerVillage(0)).hearth?.holdMs, HOLD_HOURS * HOUR);
  });

  it('hold failure time', () => {
    const hearth = { status: 'out' as const, claimBy: 7, outAt: T, holdMs: 6 * HOUR, runningSince: null, underSince: T };
    const a = cfg('conquest.holdFailHours', 1);
    const b = cfg('conquest.holdFailHours', 8);
    assert.equal(holdDueAt(hearth, a), T + HOUR);
    assert.equal(holdDueAt(hearth, b), T + 8 * HOUR);
    assert.equal(updateHold(hearth, 1, T + 2 * HOUR, a).outcome, 'failed');
    assert.equal(updateHold(hearth, 1, T + 2 * HOUR, b).outcome, 'paused');
  });

  it('Chieftain chain window', () => {
    const a = cfg('conquest.chainWindowHours', 1);
    const b = cfg('conquest.chainWindowHours', 10);
    assert.equal(strikeChainWindowMs(a), HOUR);
    assert.equal(strikeChainWindowMs(b), 10 * HOUR);
    const entries = [{ chieftains: 2, at: 0 }];
    assert.equal(chainedChieftains(entries, 5 * HOUR, a), 0);
    assert.equal(chainedChieftains(entries, 5 * HOUR, b), 2);
  });

  it('lock after a change of owner', () => {
    const change = (s: WorldSettings): number | undefined =>
      applyOwnerChange(createPlayerVillage(0), { newOwnerOccupiers: units({ pikeman: 1 }), now: T, settings: s }).state.lockUntil;
    assert.equal(change(cfg('conquest.lockHours', 2)), T + 2 * HOUR);
    assert.equal(change(cfg('conquest.lockHours', 30)), T + 30 * HOUR);
    assert.equal(change(S1), T + STRIKE_LOCK_HOURS * HOUR);
  });

  it('protection of a founded and a restarted village', () => {
    assert.equal(createFoundedVillage(100, cfg('protection.foundHours', 2)).state.protectedUntil, 100 + 2 * HOUR);
    assert.equal(createFoundedVillage(100, cfg('protection.foundHours', 40)).state.protectedUntil, 100 + 40 * HOUR);
    assert.equal(createFoundedVillage(100, S1).state.protectedUntil, 100 + FOUND_PROTECTION_HOURS * HOUR);
    assert.equal(restartProtectionMs(cfg('protection.restartHours', 3)), 3 * HOUR);
    assert.equal(restartProtectionMs(cfg('protection.restartHours', 50)), 50 * HOUR);
    assert.equal(restartProtectionMs(S1), RESTART_PROTECTION_HOURS * HOUR);
  });

  it('abandoned villages: top level, start stock, start gold', () => {
    const low = cfg('npc.maxLevel', 2);
    const v = createNpcVillage(5, 0, undefined, low);
    for (const b of Object.keys(v.buildings) as Array<keyof typeof v.buildings>) assert.ok(v.buildings[b] <= 2, b);
    const high = createNpcVillage(5, 0, undefined, cfg('npc.maxLevel', 30));
    assert.ok(Object.values(high.buildings).reduce((x, y) => x + y, 0) > Object.values(v.buildings).reduce((x, y) => x + y, 0));
    // the defaults when no settings are given
    assert.deepEqual(createNpcVillage(3, 0), createNpcVillage(3, 0, undefined, S1));

    const empty = createNpcVillage(3, 0, undefined, cfg('npc.startStockShare', 0));
    assert.equal(empty.resources.wood, 0);
    assert.equal(empty.resources.iron, 0);
    const full = createNpcVillage(3, 0, undefined, cfg('npc.startStockShare', 1));
    assert.equal(full.resources.wood, storageCap(full));

    assert.equal(createNpcVillage(3, 0, undefined, cfg('npc.startGoldPerTier', 7)).resources.gold, 21);
    assert.equal(createNpcVillage(3, 0).resources.gold, NPC_START_GOLD_PER_TIER * 3);
  });

  it('abandoned villages grow only to the world top level', () => {
    const grown = (s: WorldSettings): VillageState => settleVillage(createNpcVillage(1, 0, 5, s), 2000 * HOUR, s);
    const level1 = cfg('npc.maxLevel', 1);
    const v1 = grown(level1);
    for (const b of Object.keys(v1.buildings) as Array<keyof typeof v1.buildings>) assert.ok(v1.buildings[b] <= Math.max(BUILDINGS[b].startLevel, 1), b);
    const sum = (v: VillageState): number => Object.values(v.buildings).reduce((x, y) => x + y, 0);
    assert.ok(sum(grown(cfg('npc.maxLevel', 6))) > sum(v1));
  });

  it('build queue', () => {
    const queue3 = cfg('queues.build', 3);
    const queue1 = cfg('queues.build', 1);
    const fill = (s: WorldSettings): VillageState => {
      let v = rich();
      for (const b of ['lumber', 'farm'] as const) {
        const c = checkBuild(v, b, 0, s);
        if (c.ok) v = applyBuild(v, b, 0, s);
      }
      return v;
    };
    const v3 = fill(queue3);
    assert.equal(v3.buildQueue.length, 2);
    const third3 = checkBuild(v3, 'mine', 0, queue3);
    assert.ok(third3.ok || third3.reason !== 'queue_full');
    const third2 = checkBuild(v3, 'mine', 0, S1);
    assert.ok(!third2.ok && third2.reason === 'queue_full');
    const v1 = fill(queue1);
    assert.equal(v1.buildQueue.length, 1);
    const second1 = checkBuild(v1, 'farm', 0, queue1);
    assert.ok(!second1.ok && second1.reason === 'queue_full');
    // an explicit limit still wins over the world's
    const forced = checkBuild(v3, 'mine', 0, queue3, 2);
    assert.ok(!forced.ok && forced.reason === 'queue_full');
  });

  it('bot respects the world build queue', () => {
    const v = rich();
    const full = applyBuild(applyBuild(v, 'lumber', 0, S1), 'farm', 0, S1);
    assert.equal(botBuildChoice(full, 0, S1, () => 0.5), null);
    assert.notEqual(botBuildChoice(full, 0, cfg('queues.build', 5), () => 0.5), null);
  });

  it('training queue', () => {
    const base = rich({ barracks: 1 });
    const fill = (s: WorldSettings): VillageState => {
      let v = base;
      for (let i = 0; i < MAX_TRAIN_QUEUE + 1; i++) if (checkTrain(v, 'pikeman', 1, 0, s).ok) v = applyTrain(v, 'pikeman', 1, 0, s);
      return v;
    };
    assert.equal(fill(S1).trainQueues.barracks.length, MAX_TRAIN_QUEUE);
    assert.equal(fill(cfg('queues.train', 1)).trainQueues.barracks.length, 1);
    assert.equal(fill(cfg('queues.train', 3)).trainQueues.barracks.length, 3);
    const one = fill(cfg('queues.train', 1));
    const c = checkTrain(one, 'pikeman', 1, 0, cfg('queues.train', 1));
    assert.ok(!c.ok && c.reason === 'queue_full');
  });

  it('research queue', () => {
    const base = rich({ drillyard: 3, storehouse: 8 });
    const fill = (s: WorldSettings): VillageState => {
      let v = base;
      for (const u of ['guard', 'outrider'] as const) if (checkResearch(v, u, 0, s).ok) v = applyResearch(v, u, 0, s);
      return v;
    };
    assert.equal(fill(cfg('queues.research', 1)).researchQueue?.length, 1);
    assert.equal(fill(cfg('queues.research', 2)).researchQueue?.length, 2);
    const one = fill(cfg('queues.research', 1));
    const c = checkResearch(one, 'outrider', 0, cfg('queues.research', 1));
    assert.ok(!c.ok && c.reason === 'queue_full');
    assert.ok(checkResearch(one, 'outrider', 0, cfg('queues.research', 2)).ok);
  });

  it('unit speed changes marching and shipments, not production or build time', () => {
    const fast = cfg('pace.unitSpeed', 2);
    const slow = cfg('pace.unitSpeed', 0.5);
    assert.equal(moveSpeed(S1), 1);
    assert.equal(moveSpeed(fast), 2);
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 0 };
    assert.equal(flatShipmentTravelMs(from, to, S1), Math.ceil((10 * HOUR) / SHIPMENT_SPEED));
    assert.equal(flatShipmentTravelMs(from, to, fast), Math.ceil((10 * HOUR) / (SHIPMENT_SPEED * 2)));
    assert.equal(flatShipmentTravelMs(from, to, slow), Math.ceil((10 * HOUR) / (SHIPMENT_SPEED * 0.5)));
    assert.ok(shipmentTravelMs(from, to, fast) < shipmentTravelMs(from, to, S1));
    assert.ok(shipmentTravelMs(from, to, slow) > shipmentTravelMs(from, to, S1));
    const army = units({ raider: 10 });
    assert.ok(flatTravelTimeMs(from, to, army, fast) < flatTravelTimeMs(from, to, army, S1));
    assert.ok(travelTimeMs(from, to, army, fast) < travelTimeMs(from, to, army, S1));
    // production and timers stay on the world speed
    assert.deepEqual(settleVillage(village(), 5 * HOUR, fast), settleVillage(village(), 5 * HOUR, S1));
    const b1 = checkBuild(village(), 'lumber', 0, S1);
    const b2 = checkBuild(village(), 'lumber', 0, fast);
    assert.ok(b1.ok && b2.ok && b1.timeMs === b2.timeMs);
  });

  it('world speed still divides every duration', () => {
    const quick = cfg('pace.speed', 10);
    assert.equal(strikeChainWindowMs(quick), Math.round((STRIKE_CHAIN_WINDOW_HOURS * HOUR) / 10));
    assert.equal(restartProtectionMs(quick), Math.round((RESTART_PROTECTION_HOURS * HOUR) / 10));
  });

  it('siege off refuses to train and to research siege units, and skips siege in battle', () => {
    const off = cfg('features.siege', false);
    assert.equal(siegeEnabled(off), false);
    const barracks = { ...rich({ barracks: 8, storehouse: 8, drillyard: 5 }), researched: ['logram' as const, 'boulder' as const] };
    for (const u of ['logram', 'boulder'] as const) {
      const c = checkTrain(barracks, u, 1, 0, off);
      assert.ok(!c.ok && c.reason === 'requirements_not_met' && c.message === SIEGE_OFF_MESSAGE, u);
      assert.throws(() => applyTrain(barracks, u, 1, 0, off), { message: SIEGE_OFF_MESSAGE });
      assert.ok(checkTrain(barracks, u, 1, 0, S1).ok, `${u} trains when siege is on`);
      const r = checkResearch(rich({ drillyard: 5, storehouse: 8 }), u, 0, off);
      assert.ok(!r.ok && r.reason === 'requirements_not_met' && r.message === SIEGE_OFF_MESSAGE, u);
      assert.ok(checkResearch(rich({ drillyard: 5, storehouse: 8 }), u, 0, S1).ok, `${u} researches when siege is on`);
    }
    // other units are not affected
    assert.ok(checkTrain(rich({ barracks: 1 }), 'pikeman', 1, 0, off).ok);

    const defender = village({ buildings: { wall: 6 }, resources: { wood: 100 } });
    const input = { attackerUnits: units({ raider: 200, logram: 60 }), defender, seed: 11 };
    const on = resolveBattle(input);
    assert.ok(on.attackerWon);
    assert.ok(on.siege!.length > 0);
    assert.ok(on.wallDuring! < 6);
    const skipped = resolveBattle(input, off);
    assert.deepEqual(skipped.siege, []);
    assert.equal(skipped.wallDuring, 6);
    assert.deepEqual(resolveBattle(input, S1), on);
    // the lost-attack share is skipped too
    const weak = { attackerUnits: units({ logram: 3 }), defender: village({ buildings: { wall: 6 }, troops: { pikeman: 200 } }), seed: 3 };
    assert.ok(!resolveBattle(weak).attackerWon);
    assert.deepEqual(resolveBattle(weak, off).siege, []);
  });

  it('players cannot be conquered: a Strike on a player village is refused', () => {
    const off = cfg('conquest.playersCanBeConquered', false);
    const on = cfg('conquest.playersCanBeConquered', true);
    const target = { abandoned: false, points: 0, now: T };
    const army = units({ chieftain: 1, raider: 5 });
    const refused = checkStrike({ attackerWon: true }, army, target, {}, 0, off);
    assert.ok(!refused.ok && refused.reason === 'players_disabled');
    assert.ok(checkStrike({ attackerWon: true }, army, target, {}, 0, on).ok);
    // abandoned villages can always be taken
    assert.ok(checkStrike({ attackerWon: true }, army, { ...target, abandoned: true }, {}, 0, off).ok);
    // the explicit option still wins over the world
    assert.ok(checkStrike({ attackerWon: true }, army, target, { playersEnabled: true }, 0, off).ok);
    const forcedOff = checkStrike({ attackerWon: true }, army, target, { playersEnabled: false }, 0, on);
    assert.ok(!forcedOff.ok && forcedOff.reason === 'players_disabled');
    // no settings: the defaults
    assert.equal(checkStrike({ attackerWon: true }, army, target).ok, HEARTH_PLAYERS_ENABLED);
  });
});
