// Movement, sending, battle resolution and their effects on villages.

import {
  BATTLE_LOSS_EXPONENT,
  BATTLE_LUCK,
  MAX_UNIT_COUNT,
  NPC_REPEAT_LOOT_FACTOR,
  NPC_REPEAT_LOOT_FLOOR,
  NPC_REPEAT_WINDOW_HOURS,
  SCOUT_DEFENSE_FACTOR,
  SCOUT_LOSS_EXPONENT,
  SCOUT_UNIT,
  UNITS,
  WALL_BASE_DEFENSE,
  WALL_BONUS_PER_LEVEL,
  WALL_DEFENSE_PER_LEVEL,
} from './config.ts';
import { bulwarkMultiplier, mightMultiplier } from './drillyard.ts';
import { addClamped, storageCap, vaultProtection } from './economy.ts';
import { mulberry32 } from './random.ts';
import { GameError, MISSIONS, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type {
  BattleInput,
  BattleResult,
  CheckResult,
  Coords,
  Mission,
  ResourceId,
  Resources,
  ScoutInput,
  ScoutResult,
  Units,
  VillageState,
  WorldSettings,
} from './types.ts';
import { MS_PER_HOUR, cloneVillage, distance, emptyResources, emptyUnits, fail, isUnitId, normalizeUnits, totalUnits } from './util.ts';
import { settleVillage } from './village.ts';

// ---- Travel -------------------------------------------------------------------------------------

/** Tiles per hour (speed 1) of the slowest unit present; 0 for an empty army. */
export function armySpeed(units: Units): number {
  let slowest = Infinity;
  for (const u of UNIT_IDS) if (units[u] > 0) slowest = Math.min(slowest, UNITS[u].speed);
  return slowest === Infinity ? 0 : slowest;
}

/**
 * Travel time in ms: ceil(distance / (slowest speed * world speed) hours). `Infinity` for an empty army
 * (callers must reject those with checkSend first).
 */
export function travelTimeMs(from: Coords, to: Coords, units: Units, s: WorldSettings): number {
  const speed = armySpeed(units);
  if (speed <= 0) return Infinity;
  // Multiply before dividing so exact results (e.g. 5 tiles at 6 tiles/h) don't pick up float noise.
  return Math.ceil((distance(from, to) * MS_PER_HOUR) / (speed * s.speed));
}

// ---- Sending ------------------------------------------------------------------------------------

/** Strict parse of a send order: whole numbers only, unknown unit ids rejected. Returns the full Units or an error message. */
function parseUnits(input: unknown): Units | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return 'Units must be an object.';
  const out = emptyUnits();
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!isUnitId(key)) return 'Unknown unit.';
    const count = raw[key];
    if (count === undefined) continue;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_UNIT_COUNT) {
      return `Unit counts must be whole numbers from 0 to ${MAX_UNIT_COUNT}.`;
    }
    out[key] = count;
  }
  return out;
}

/**
 * Validate an army to send from `state` (which the caller must have settled to the send time so
 * freshly trained units are home). Returns the normalised full Units. Never throws.
 * Target validity (village exists, not your own, protection) is the server's job.
 */
export function checkSend(state: VillageState, units: Partial<Units>): CheckResult<{ units: Units }> {
  const normalised = parseUnits(units);
  if (typeof normalised === 'string') return fail('invalid_input', normalised);
  if (totalUnits(normalised) === 0) return fail('no_troops', 'Select at least one unit.');
  const home = normalizeUnits(state.troops);
  for (const u of UNIT_IDS) {
    if (normalised[u] > home[u]) return fail('not_enough_troops', `Not enough ${UNITS[u].name} at home.`);
  }
  return { ok: true, units: normalised };
}

/**
 * Is a send with this mission and army allowed? Checks only the army, not the target (relation,
 * protection and the like are the server's job). Never throws.
 */
export function checkMission(mission: Mission, units: Units): CheckResult<{}> {
  if (typeof mission !== 'string' || !(MISSIONS as readonly string[]).includes(mission)) {
    return fail('invalid_input', 'Unknown mission.');
  }
  const army = normalizeUnits(units);
  if (totalUnits(army) <= 0) return fail('no_troops', 'Select at least one unit.');
  if (mission === 'scout') {
    for (const u of UNIT_IDS) {
      if (u !== SCOUT_UNIT && army[u] > 0) {
        return fail('invalid_input', `Only ${UNITS[SCOUT_UNIT].name}s can go on a scouting mission.`);
      }
    }
    return { ok: true };
  }
  if (mission === 'attack') {
    let attack = 0;
    for (const u of UNIT_IDS) attack += army[u] * UNITS[u].attack;
    if (!(attack > 0)) {
      return fail('invalid_input', `${UNITS[SCOUT_UNIT].name}s can't attack alone — send them on a scouting mission.`);
    }
  }
  return { ok: true };
}

/** Settle to t, then move the units from `troops` to `away`. Throws GameError when invalid. */
export function applySend(state: VillageState, units: Partial<Units>, t: number, s: WorldSettings): VillageState {
  if (!Number.isFinite(t)) throw new GameError('invalid_input', 'Invalid time.');
  const v = settleVillage(state, t, s);
  const check = checkSend(v, units);
  if (!check.ok) throw new GameError(check.reason, check.message);
  for (const u of UNIT_IDS) {
    v.troops[u] -= check.units[u];
    v.away[u] += check.units[u];
  }
  return v;
}

// ---- Battle -------------------------------------------------------------------------------------

/**
 * Split `capacity` evenly over the resources that still have stock ("water-filling"), repeating as
 * stocks run dry. Integer result; a remainder smaller than the number of open resources goes one
 * unit each in RESOURCE_IDS order.
 */
export function waterFillLoot(capacity: number, stock: Resources): Resources {
  const loot = emptyResources();
  let remaining = Math.max(0, Math.floor(capacity));
  let open: ResourceId[] = RESOURCE_IDS.filter((r) => stock[r] > 0);
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    if (share === 0) {
      for (const r of open.slice(0, remaining)) loot[r] += 1;
      break;
    }
    for (const r of open) {
      const take = Math.min(share, stock[r] - loot[r]);
      loot[r] += take;
      remaining -= take;
    }
    open = open.filter((r) => stock[r] - loot[r] > 0);
  }
  return loot;
}

/** How far back (ms) earlier raids by the same player on one abandoned village still count; shorter on a fast world. */
export function repeatRaidWindowMs(s: WorldSettings): number {
  return (NPC_REPEAT_WINDOW_HOURS * MS_PER_HOUR) / s.speed;
}

/**
 * Loot share for the next raid on an abandoned village after `earlierHits` won raids by the same player inside
 * NPC_REPEAT_WINDOW_HOURS: NPC_REPEAT_LOOT_FACTOR ^ hits, never below NPC_REPEAT_LOOT_FLOOR.
 */
export function repeatRaidLootFactor(earlierHits: number): number {
  const hits = Number.isFinite(earlierHits) && earlierHits > 0 ? Math.floor(earlierHits) : 0;
  return Math.max(NPC_REPEAT_LOOT_FLOOR, Math.pow(NPC_REPEAT_LOOT_FACTOR, hits));
}

/** Deterministic battle for a seed. Does not change any village; see applyBattleToDefender. */
export function resolveBattle(input: BattleInput): BattleResult {
  const { defender } = input;
  const attackerUnits = normalizeUnits(input.attackerUnits);
  const defenderUnits = normalizeUnits(defender.troops);
  const support = (input.support ?? []).map((c) => normalizeUnits(c));
  const rng = mulberry32(input.seed);
  const luck = rng() * 2 * BATTLE_LUCK - BATTLE_LUCK;

  let attackInfantry = 0;
  let attackCavalry = 0;
  for (const u of UNIT_IDS) {
    const power = attackerUnits[u] * UNITS[u].attack * mightMultiplier(input.attackerRanks, u);
    if (UNITS[u].unitClass === 'infantry') attackInfantry += power;
    else attackCavalry += power;
  }
  const attackRaw = attackInfantry + attackCavalry;
  const attackPower = attackRaw * (1 + luck);

  // Defenders are weighed against the mix of the attacking army (infantry vs cavalry).
  // Stationed support defends exactly like the village's own troops.
  const infantryShare = attackRaw > 0 ? attackInfantry / attackRaw : 1;
  const cavalryShare = 1 - infantryShare;
  let defenseUnits = 0;
  for (const u of UNIT_IDS) {
    // Each source (own troops, every support contingent) counts with its own home village's Bulwark.
    let count = defenderUnits[u] * bulwarkMultiplier(input.defenderRanks, u);
    support.forEach((contingent, i) => {
      count += contingent[u] * bulwarkMultiplier(input.supportRanks?.[i], u);
    });
    defenseUnits += count * (UNITS[u].defenseInfantry * infantryShare + UNITS[u].defenseCavalry * cavalryShare);
  }
  const wall = defender.buildings.wall;
  const defensePower = (defenseUnits + WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * wall) * (1 + WALL_BONUS_PER_LEVEL * wall);

  const attackerWon = attackPower > defensePower;
  const attackerLosses = emptyUnits();
  const attackerSurvivors = emptyUnits();
  const defenderLosses = emptyUnits();
  const supportLosses = support.map(() => emptyUnits());
  let loot = emptyResources();

  if (attackerWon) {
    const ratio = Math.pow(defensePower / attackPower, BATTLE_LOSS_EXPONENT);
    for (const u of UNIT_IDS) {
      attackerLosses[u] = Math.min(attackerUnits[u], Math.round(attackerUnits[u] * ratio));
      attackerSurvivors[u] = attackerUnits[u] - attackerLosses[u];
      defenderLosses[u] = defenderUnits[u];
      support.forEach((contingent, i) => {
        (supportLosses[i] as Units)[u] = contingent[u];
      });
    }
    let capacity = 0;
    for (const u of UNIT_IDS) capacity += attackerSurvivors[u] * UNITS[u].carry;
    const lootFactor = input.lootFactor === undefined ? 1 : Math.min(1, Math.max(0, input.lootFactor));
    capacity = Math.floor(capacity * lootFactor);
    const hidden = vaultProtection(defender);
    const lootable = emptyResources();
    for (const r of RESOURCE_IDS) lootable[r] = Math.max(0, Math.floor(defender.resources[r]) - hidden);
    loot = waterFillLoot(capacity, lootable);
  } else {
    const ratio = Math.pow(attackPower / defensePower, BATTLE_LOSS_EXPONENT);
    for (const u of UNIT_IDS) {
      attackerLosses[u] = attackerUnits[u];
      defenderLosses[u] = Math.min(defenderUnits[u], Math.round(defenderUnits[u] * ratio));
      support.forEach((contingent, i) => {
        (supportLosses[i] as Units)[u] = Math.min(contingent[u], Math.round(contingent[u] * ratio));
      });
    }
  }

  return {
    attackerWon,
    luck,
    attackPower,
    defensePower,
    attackerLosses,
    attackerSurvivors,
    defenderUnits,
    defenderLosses,
    supportLosses,
    loot,
  };
}

// ---- Scouting -----------------------------------------------------------------------------------

const nonNegative = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Pathfinder duel, no luck. The scouts get through only if they outnumber the defending Pathfinders
 * (own at home plus stationed support) times SCOUT_DEFENSE_FACTOR; a tie fails. Success: the sender
 * loses round(scouts * (D/scouts)^exp), D = defenders * factor (nothing when D = 0), defenders lose
 * none. Failure: every scout is caught and the defenders lose round(defenders * (scouts/D)^exp).
 */
export function resolveScouting(input: ScoutInput): ScoutResult {
  const scouts = nonNegative(input.scouts);
  const defenderScouts = nonNegative(input.defenderScouts);
  // Keen ranks scale each side's strength; counts (and so the loss caps) stay real numbers of Pathfinders.
  const strength = scouts * Math.max(0, input.scoutMultiplier ?? 1);
  const defense = (input.defenderStrength === undefined ? defenderScouts : Math.max(0, input.defenderStrength)) * SCOUT_DEFENSE_FACTOR;

  if (strength > defense) {
    const ratio = defense > 0 ? Math.pow(defense / strength, SCOUT_LOSS_EXPONENT) : 0;
    return { success: true, scoutLosses: Math.min(scouts, Math.round(scouts * ratio)), defenderScoutLosses: 0 };
  }
  const ratio = defense > 0 ? Math.pow(strength / defense, SCOUT_LOSS_EXPONENT) : 0;
  return { success: false, scoutLosses: scouts, defenderScoutLosses: Math.min(defenderScouts, Math.round(defenderScouts * ratio)) };
}

/**
 * Remove the defender's losses and the loot. The defender must already be settled to the battle time
 * (resolveBattle's `defender` input must be that same state).
 */
export function applyBattleToDefender(defender: VillageState, r: BattleResult): VillageState {
  const v = cloneVillage(defender);
  const losses = normalizeUnits(r.defenderLosses);
  for (const u of UNIT_IDS) v.troops[u] = Math.max(0, v.troops[u] - losses[u]);
  for (const id of RESOURCE_IDS) v.resources[id] = Math.max(0, v.resources[id] - r.loot[id]);
  return v;
}

/**
 * Remove units that died in battle from the origin's `away`. The caller must have settled `origin`
 * to the battle time first, so the lower food upkeep only applies from then on.
 */
export function applyAttackerLosses(origin: VillageState, losses: Units): VillageState {
  const v = cloneVillage(origin);
  const lost = normalizeUnits(losses);
  for (const u of UNIT_IDS) v.away[u] = Math.max(0, v.away[u] - lost[u]);
  return v;
}

/** Settle to t, then bring survivors home and add the loot (clamped to the storage cap). */
export function applyReturn(origin: VillageState, survivors: Units, loot: Resources, t: number, s: WorldSettings): VillageState {
  const v = settleVillage(origin, t, s);
  const back = normalizeUnits(survivors);
  for (const u of UNIT_IDS) {
    v.away[u] = Math.max(0, v.away[u] - back[u]);
    v.troops[u] += back[u];
  }
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = addClamped(v.resources[r], loot[r], cap);
  return v;
}
