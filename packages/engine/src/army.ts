// Movement, sending, battle resolution and their effects on villages.

import {
  BATTLE_LOSS_EXPONENT,
  BATTLE_LUCK,
  HEARTH_MAX_CHIEFTAINS,
  MAX_UNIT_COUNT,
  SCOUT_DEFENSE_FACTOR,
  SCOUT_LOSS_EXPONENT,
  SCOUT_UNIT,
  UNITS,
  WALL_BASE_DEFENSE,
  WALL_BONUS_PER_LEVEL,
  WALL_DEFENSE_PER_LEVEL,
} from './config.ts';
import { bulwarkMultiplier, mightMultiplier } from './drillyard.ts';
import { buildSiteProblem, terrainAmountOf } from './world.ts';
import { addClamped, storageCap, vaultProtection } from './economy.ts';
import { mulberry32 } from './random.ts';
import { applySiegeHits, hasSiegeUnits, resolveSiege, resolveSiegeDuring, siegeEnabled, siegeLostSurvivors } from './siege.ts';
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
  SiegeHit,
  Units,
  VillageState,
  WorldSettings,
} from './types.ts';
import { MS_PER_HOUR, cloneVillage, distance, emptyResources, emptyUnits, fail, isUnitId, normalizeUnits, totalUnits } from './util.ts';
import { armyRouteTimeMs, travelRoute } from './travel.ts';
import type { TravelPreview } from './travel.ts';
import { settleVillage } from './village.ts';
import { moveSpeed } from './world-config.ts';

// ---- Travel -------------------------------------------------------------------------------------

/** Tiles per hour (speed 1) of the slowest unit present; 0 for an empty army. */
export function armySpeed(units: Units): number {
  let slowest = Infinity;
  for (const u of UNIT_IDS) if (units[u] > 0) slowest = Math.min(slowest, UNITS[u].speed);
  return slowest === Infinity ? 0 : slowest;
}

/**
 * Travel time on flat ground in ms: ceil(distance / (slowest speed * world speed) hours). `Infinity` for an empty army.
 * Terrain is ignored: this is the "without terrain" time of the send preview. Troops walk at `moveSpeed(s)` (world speed times unit speed).
 */
export function flatTravelTimeMs(from: Coords, to: Coords, units: Units, s: WorldSettings): number {
  const speed = armySpeed(units);
  if (speed <= 0) return Infinity;
  // Multiply before dividing so exact results (e.g. 5 tiles at 6 tiles/h) don't pick up float noise.
  return Math.ceil((distance(from, to) * MS_PER_HOUR) / (speed * moveSpeed(s)));
}

/**
 * Travel time in ms, terrain included (docs/GAME_DESIGN.md 18.4a): the straight line is sampled tile by tile
 * (`travelRoute`, from the world seed) and each unit walks it at its own pace over each ground; the army arrives with
 * its slowest unit. Over grass it equals `flatTravelTimeMs`; never more than TERRAIN_MAX_SLOWDOWN times that. The same
 * stretch back takes the same time. `Infinity` for an empty army (callers must reject those with checkSend first).
 * Every rule that needs a travel time goes through this function, on the server, from the server's own settings.
 * `waymarks`: the Waymarks the mover's tribe holds (see `tribeWaymarks`); they halve the terrain penalty near them.
 */
export function travelTimeMs(from: Coords, to: Coords, units: Units, s: WorldSettings, waymarks: readonly Coords[] = []): number {
  return armyRouteTimeMs(travelRoute(from, to, s.seed, terrainAmountOf(s), waymarks), units, moveSpeed(s));
}

/** The send preview: time on flat ground, time with terrain, and the route (for the map). */
export function travelPreview(from: Coords, to: Coords, units: Units, s: WorldSettings, waymarks: readonly Coords[] = []): TravelPreview {
  const route = travelRoute(from, to, s.seed, terrainAmountOf(s), waymarks);
  return { flatMs: flatTravelTimeMs(from, to, units, s), ms: armyRouteTimeMs(route, units, moveSpeed(s)), route };
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
  // 'scout' is the old scouting mission, kept so older clients still work: it is the same as an attack of Pathfinders only.
  if (mission === 'scout') {
    for (const u of UNIT_IDS) {
      if (u !== SCOUT_UNIT && army[u] > 0) {
        return fail('invalid_input', `Only ${UNITS[SCOUT_UNIT].name}s can scout. Send other troops on an attack.`);
      }
    }
    return { ok: true };
  }
  // Siege units only ever go on an attack: they cannot scout, found, occupy or be stationed.
  if (mission !== 'attack' && hasSiegeUnits(army)) {
    return fail('invalid_input', 'Log Rams and Boulder Slings can only join an attack.');
  }
  const chieftains = army.chieftain;
  if (mission === 'found') {
    // One Chieftain carries the ember; everything else is the escort that becomes the new village's garrison.
    if (chieftains !== 1) return fail('invalid_input', `A found mission needs exactly one ${UNITS.chieftain.name}.`);
    return { ok: true };
  }
  if (mission === 'support' || mission === 'occupy') {
    if (chieftains > 0) return fail('invalid_input', `${UNITS.chieftain.name}s can't be stationed in a village.`);
    return { ok: true };
  }
  if (mission === 'attack') {
    if (chieftains > HEARTH_MAX_CHIEFTAINS) {
      return fail('invalid_input', `At most ${HEARTH_MAX_CHIEFTAINS} ${UNITS.chieftain.name}s can join an attack.`);
    }
    let attack = 0;
    for (const u of UNIT_IDS) attack += army[u] * UNITS[u].attack;
    // Pathfinders have no attack: an army of them alone is a scouting march, with other troops they scout first and sit out
    // the battle (owner, 2026-11-06). A Chieftain alone may be sent too (the Strike attempt on an abandoned village needs him);
    // with no escort he simply dies.
    if (!(attack > 0) && chieftains <= 0 && army[SCOUT_UNIT] <= 0) {
      return fail('invalid_input', 'These troops cannot attack.');
    }
  }
  return { ok: true };
}

/** Why a site fails, in words (shared by the server error and the map panel). Forest counts as buildable land. */
export const FOUND_PROBLEM_TEXT = {
  outside: 'A village cannot be founded there: it is outside the world.',
  terrain: 'A village cannot be founded there: lakes and mountains cannot be built on.',
  near: 'A village cannot be founded there: it is too close to another village.',
} as const;

/**
 * Can a found mission go to tile (x, y)? In the world, buildable ground (no lake, no mountain), no village on it or within
 * SPAWN_MIN_SPACING (Chebyshev) of it. `isOccupied(x, y)` is the server's village lookup. Re-check on arrival: the tile may
 * have been taken meanwhile (then the Chieftain turns back). Never throws.
 */
export function checkFoundTarget(
  target: Coords,
  s: WorldSettings,
  isOccupied: (x: number, y: number) => boolean,
): CheckResult<{}> {
  if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) return fail('invalid_target', 'Invalid coordinates.');
  const problem = buildSiteProblem(target.x, target.y, s, isOccupied);
  if (problem) return fail('invalid_target', FOUND_PROBLEM_TEXT[problem]);
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

/**
 * Deterministic battle for a seed. Does not change any village; see applyBattleToDefender.
 * Log Rams fire first (docs/GAME_DESIGN.md 18.9): the Wall they leave is the Wall the defence uses (`wallDuring`).
 * With `s` of a world that has siege off (`features.siege` false) no siege step runs at all: the Wall stays as it is and
 * `siege` is []. Without `s` siege is on.
 */
export function resolveBattle(input: BattleInput, s?: Pick<WorldSettings, 'config'>): BattleResult {
  const { defender } = input;
  const siegeOn = siegeEnabled(s);
  const attackerUnits = normalizeUnits(input.attackerUnits);
  const defenderUnits = normalizeUnits(defender.troops);
  const support = (input.support ?? []).map((c) => normalizeUnits(c));
  const rng = mulberry32(input.seed);
  // Always draw, so the later draws (random siege target) see the same rng position with or without `fixedLuck`.
  const drawnLuck = rng() * 2 * BATTLE_LUCK - BATTLE_LUCK;
  const luck = typeof input.fixedLuck === 'number' && Number.isFinite(input.fixedLuck) ? Math.max(-BATTLE_LUCK, Math.min(BATTLE_LUCK, input.fixedLuck)) : drawnLuck;

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
  // Log Rams sent fire first; the lowered Wall is what the defence uses in this battle.
  const wall = siegeOn ? resolveSiegeDuring(attackerUnits, defender.buildings.wall).wall : defender.buildings.wall;
  const defensePower = (defenseUnits + WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * wall) * (1 + WALL_BONUS_PER_LEVEL * wall) * (input.defenceMultiplier ?? 1);

  const attackerWon = attackPower > defensePower;
  const attackerLosses = emptyUnits();
  const attackerSurvivors = emptyUnits();
  const defenderLosses = emptyUnits();
  const supportLosses = support.map(() => emptyUnits());
  let loot = emptyResources();
  let siege: SiegeHit[] = [];

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
    // Loot is always full: everything the survivors can carry, up to what the village holds above its Vault.
    // (A Strike attempt or relief attack is not a raid and takes nothing: `noLoot`.)
    let capacity = 0;
    for (const u of UNIT_IDS) capacity += attackerSurvivors[u] * UNITS[u].carry;
    if (!input.noLoot) {
      const hidden = vaultProtection(defender);
      const lootable = emptyResources();
      for (const r of RESOURCE_IDS) lootable[r] = Math.max(0, Math.floor(defender.resources[r]) - hidden) + Math.max(0, Math.floor(input.extraLootable?.[r] ?? 0));
      loot = waterFillLoot(Math.floor(capacity), lootable);
    }
    // The survivors shoot after the battle (Log Rams: full points, sharing their level cap with the during step).
    if (siegeOn) siege = resolveSiege(attackerSurvivors, defender.buildings, input.siegeTarget, input.seed, attackerUnits);
  } else {
    const ratio = Math.pow(attackPower / defensePower, BATTLE_LOSS_EXPONENT);
    for (const u of UNIT_IDS) {
      attackerLosses[u] = attackerUnits[u];
      defenderLosses[u] = Math.min(defenderUnits[u], Math.round(defenderUnits[u] * ratio));
      support.forEach((contingent, i) => {
        (supportLosses[i] as Units)[u] = Math.min(contingent[u], Math.round(contingent[u] * ratio));
      });
    }
    // A lost attack still does reduced damage: a share of each siege kind counts as a survivor for the after step.
    if (siegeOn) siege = resolveSiege(siegeLostSurvivors(attackerUnits, ratio), defender.buildings, input.siegeTarget, input.seed, attackerUnits);
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
    siege,
    wallDuring: wall,
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
 * Remove the defender's losses and the loot, then lower the buildings the siege units hit (docs/GAME_DESIGN.md 18.9). The
 * defender must already be settled to the battle time (resolveBattle's `defender` input must be that same state).
 */
export function applyBattleToDefender(defender: VillageState, r: BattleResult): VillageState {
  const v = cloneVillage(defender);
  const losses = normalizeUnits(r.defenderLosses);
  for (const u of UNIT_IDS) v.troops[u] = Math.max(0, v.troops[u] - losses[u]);
  for (const id of RESOURCE_IDS) v.resources[id] = Math.max(0, v.resources[id] - r.loot[id]);
  applySiegeHits(v, r.siege ?? []);
  return v;
}

/**
 * Remove units that died in battle from the origin's `away`. The caller must have settled `origin`
 * to the battle time first.
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
