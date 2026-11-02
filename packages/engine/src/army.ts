// Movement, sending, battle resolution and their effects on villages.

import { BATTLE_LOSS_EXPONENT, BATTLE_LUCK, MAX_UNIT_COUNT, UNITS, WALL_BASE_DEFENSE, WALL_BONUS_PER_LEVEL, WALL_DEFENSE_PER_LEVEL } from './config.ts';
import { addClamped, storageCap, vaultProtection } from './economy.ts';
import { mulberry32 } from './random.ts';
import { GameError, RESOURCE_IDS, UNIT_IDS } from './types.ts';
import type { BattleInput, BattleResult, CheckResult, Coords, ResourceId, Resources, Units, VillageState, WorldSettings } from './types.ts';
import { MS_PER_HOUR, cloneVillage, distance, emptyResources, emptyUnits, fail, isUnitId, totalUnits } from './util.ts';
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

function normalizeUnits(input: unknown): Units | string {
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
  const normalised = normalizeUnits(units);
  if (typeof normalised === 'string') return fail('invalid_input', normalised);
  if (totalUnits(normalised) === 0) return fail('no_troops', 'Select at least one unit.');
  for (const u of UNIT_IDS) {
    if (normalised[u] > state.troops[u]) return fail('not_enough_troops', `Not enough ${UNITS[u].name} at home.`);
  }
  return { ok: true, units: normalised };
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

/** Deterministic battle for a seed. Does not change any village; see applyBattleToDefender. */
export function resolveBattle(input: BattleInput): BattleResult {
  const { attackerUnits, defender } = input;
  const rng = mulberry32(input.seed);
  const luck = rng() * 2 * BATTLE_LUCK - BATTLE_LUCK;

  let attackInfantry = 0;
  let attackCavalry = 0;
  for (const u of UNIT_IDS) {
    const power = attackerUnits[u] * UNITS[u].attack;
    if (UNITS[u].unitClass === 'infantry') attackInfantry += power;
    else attackCavalry += power;
  }
  const attackRaw = attackInfantry + attackCavalry;
  const attackPower = attackRaw * (1 + luck);

  // Defenders are weighed against the mix of the attacking army (infantry vs cavalry).
  const infantryShare = attackRaw > 0 ? attackInfantry / attackRaw : 1;
  const cavalryShare = 1 - infantryShare;
  let defenseUnits = 0;
  for (const u of UNIT_IDS) {
    defenseUnits += defender.troops[u] * (UNITS[u].defenseInfantry * infantryShare + UNITS[u].defenseCavalry * cavalryShare);
  }
  const wall = defender.buildings.wall;
  const defensePower = (defenseUnits + WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * wall) * (1 + WALL_BONUS_PER_LEVEL * wall);

  const attackerWon = attackPower > defensePower;
  const defenderUnits = { ...defender.troops };
  const attackerLosses = emptyUnits();
  const attackerSurvivors = emptyUnits();
  const defenderLosses = emptyUnits();
  let loot = emptyResources();

  if (attackerWon) {
    const ratio = Math.pow(defensePower / attackPower, BATTLE_LOSS_EXPONENT);
    for (const u of UNIT_IDS) {
      attackerLosses[u] = Math.min(attackerUnits[u], Math.round(attackerUnits[u] * ratio));
      attackerSurvivors[u] = attackerUnits[u] - attackerLosses[u];
      defenderLosses[u] = defenderUnits[u];
    }
    let capacity = 0;
    for (const u of UNIT_IDS) capacity += attackerSurvivors[u] * UNITS[u].carry;
    const hidden = vaultProtection(defender);
    const lootable = emptyResources();
    for (const r of RESOURCE_IDS) lootable[r] = Math.max(0, Math.floor(defender.resources[r]) - hidden);
    loot = waterFillLoot(capacity, lootable);
  } else {
    const ratio = Math.pow(attackPower / defensePower, BATTLE_LOSS_EXPONENT);
    for (const u of UNIT_IDS) {
      attackerLosses[u] = attackerUnits[u];
      defenderLosses[u] = Math.min(defenderUnits[u], Math.round(defenderUnits[u] * ratio));
    }
  }

  return { attackerWon, luck, attackPower, defensePower, attackerLosses, attackerSurvivors, defenderUnits, defenderLosses, loot };
}

/**
 * Remove the defender's losses and the loot. The defender must already be settled to the battle time
 * (resolveBattle's `defender` input must be that same state).
 */
export function applyBattleToDefender(defender: VillageState, r: BattleResult): VillageState {
  const v = cloneVillage(defender);
  for (const u of UNIT_IDS) v.troops[u] = Math.max(0, v.troops[u] - r.defenderLosses[u]);
  for (const id of RESOURCE_IDS) v.resources[id] = Math.max(0, v.resources[id] - r.loot[id]);
  return v;
}

/**
 * Remove units that died in battle from the origin's `away`. The caller must have settled `origin`
 * to the battle time first, so the lower food upkeep only applies from then on.
 */
export function applyAttackerLosses(origin: VillageState, losses: Units): VillageState {
  const v = cloneVillage(origin);
  for (const u of UNIT_IDS) v.away[u] = Math.max(0, v.away[u] - losses[u]);
  return v;
}

/** Settle to t, then bring survivors home and add the loot (clamped to the storage cap). */
export function applyReturn(origin: VillageState, survivors: Units, loot: Resources, t: number, s: WorldSettings): VillageState {
  const v = settleVillage(origin, t, s);
  for (const u of UNIT_IDS) {
    v.away[u] = Math.max(0, v.away[u] - survivors[u]);
    v.troops[u] += survivors[u];
  }
  const cap = storageCap(v);
  for (const r of RESOURCE_IDS) v.resources[r] = addClamped(v.resources[r], loot[r], cap);
  return v;
}
