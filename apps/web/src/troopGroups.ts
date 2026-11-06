// Troop groups for the send form (docs/GAME_DESIGN.md, army): one tap fills the counts. Pure helpers, no React.
// The built-in groups are computed from the troops at home; saved groups come from the server. The server and the engine
// still check every send, so these only choose numbers.

import {
  HEARTH_MAX_CHIEFTAINS,
  HOLD_MIN_POPULATION,
  POP_PER_UNIT,
  UNITS,
  UNIT_IDS,
  checkMission,
  checkSend,
  normalizeUnits,
} from '@clanfire/engine';
import type { MapVillageDto, Mission, UnitId, Units, VillageState } from '@clanfire/engine';
import { canStrike, strikeNeed } from './villages.ts';

export type BuiltinGroupId = 'all' | 'decoy' | 'escort';

export interface BuiltinGroup {
  id: BuiltinGroupId;
  label: string;
  /** One line shown as the chip's tooltip / screen-reader text. */
  hint: string;
  units: Partial<Units>;
}

const plural = (u: UnitId): string => `${UNITS[u].name}s`;

/** Everything at home among the visible units (an attack takes at most HEARTH_MAX_CHIEFTAINS Chieftains). */
export function pickAll(visible: readonly UnitId[], home: Units, mission: Mission = 'attack'): Partial<Units> {
  const out: Partial<Units> = {};
  for (const u of visible) {
    let n = home[u];
    if (u === 'chieftain' && mission === 'attack') n = Math.min(n, HEARTH_MAX_CHIEFTAINS);
    if (n > 0) out[u] = n;
  }
  return out;
}

/**
 * Exactly one unit of the slowest visible kind at home: the target sees an attack coming but it costs almost nothing.
 * Siege units come first (they are the slowest); Chieftains and Pathfinders are never decoys. Null when nothing fits or the one
 * unit would not pass the same send checks the form runs.
 */
export function pickDecoy(visible: readonly UnitId[], home: Units, mission: Mission = 'attack'): Partial<Units> | null {
  const candidates = visible.filter((u) => home[u] > 0 && u !== 'chieftain' && UNITS[u].attack > 0);
  if (candidates.length === 0) return null;
  const pool = candidates.some((u) => UNITS[u].siege) ? candidates.filter((u) => UNITS[u].siege) : candidates;
  let pick = pool[0]!;
  for (const u of pool) if (UNITS[u].speed < UNITS[pick].speed) pick = u;
  const units: Partial<Units> = { [pick]: 1 };
  const army = normalizeUnits(units);
  if (!checkMission(mission, army).ok) return null;
  if (!checkSend({ troops: home } as unknown as VillageState, units).ok) return null;
  return units;
}

/**
 * The Chieftains a Strike needs plus the strongest fighting troops (highest attack first) until the army's population reaches the
 * hold minimum. Takes everything fighting when that is not enough (the form's Strike warning then says what is missing).
 * Null when no Chieftain is at home. Siege units never join the escort.
 */
export function pickEscort(
  visible: readonly UnitId[],
  home: Units,
  chieftainsNeeded: number,
  minPopulation: number = HOLD_MIN_POPULATION,
): Partial<Units> | null {
  if (!visible.includes('chieftain') || home.chieftain <= 0) return null;
  const out: Partial<Units> = {};
  const chieftains = Math.min(Math.max(1, chieftainsNeeded), HEARTH_MAX_CHIEFTAINS, home.chieftain);
  out.chieftain = chieftains;
  let pop = chieftains * POP_PER_UNIT.chieftain;
  const fighters = visible
    .filter((u) => u !== 'chieftain' && !UNITS[u].siege && UNITS[u].attack > 0 && home[u] > 0)
    .sort((a, b) => UNITS[b].attack - UNITS[a].attack || UNIT_IDS.indexOf(a) - UNIT_IDS.indexOf(b));
  for (const u of fighters) {
    if (pop >= minPopulation) break;
    const n = Math.min(home[u], Math.ceil((minPopulation - pop) / POP_PER_UNIT[u]));
    out[u] = n;
    pop += n * POP_PER_UNIT[u];
  }
  return out;
}

export interface BuiltinContext {
  visible: readonly UnitId[];
  home: Units;
  mission: Mission;
  /** A relief attack on a cold village: no Chieftains, so no escort chip. */
  relief: boolean;
  target: Pick<MapVillageDto, 'kind' | 'points' | 'protected'> | null;
  /** The target's hold minimum when the map says (hearth.minPopulation); otherwise HOLD_MIN_POPULATION. */
  minPopulation?: number;
}

const hasUnits = (u: Partial<Units>): boolean => UNIT_IDS.some((id) => (u[id] ?? 0) > 0);

/** The built-in chips that apply to this form right now, in display order: All troops, Decoy, Chieftain escort. */
export function builtinGroups(ctx: BuiltinContext): BuiltinGroup[] {
  const out: BuiltinGroup[] = [];
  const { visible, home, mission } = ctx;
  if (visible.length === 0 || mission === 'found') return out;
  const all = pickAll(visible, home, mission);
  if (hasUnits(all)) out.push({ id: 'all', label: 'All troops', hint: 'Everything at home that this mission can take.', units: all });
  if (mission === 'attack') {
    const decoy = pickDecoy(visible, home, mission);
    if (decoy) {
      const u = UNIT_IDS.find((id) => decoy[id])!;
      out.push({ id: 'decoy', label: 'Decoy', hint: `One ${UNITS[u].name}: the target sees an attack coming, it costs you almost nothing.`, units: decoy });
    }
    const t = ctx.target;
    if (!ctx.relief && t && canStrike(t.kind) && !(t.kind === 'player' && t.protected)) {
      const escort = pickEscort(visible, home, strikeNeed(t.kind, t.points), ctx.minPopulation);
      if (escort) out.push({ id: 'escort', label: 'Chieftain escort', hint: 'The Chieftains a Strike needs and your strongest fighters to hold the village.', units: escort });
    }
  }
  return out;
}

export interface GroupFill {
  /** New text values for the count inputs (units not in the group are left out = empty). */
  counts: Partial<Record<UnitId, string>>;
  /** "Only 40 of 60 Raiders at home", one per short unit. */
  short: string[];
}

/** Fill the form from a group: min(group count, at home) for the visible units; others stay empty. */
export function fillFromGroup(units: Partial<Units>, visible: readonly UnitId[], home: Units): GroupFill {
  const counts: Partial<Record<UnitId, string>> = {};
  const short: string[] = [];
  for (const u of visible) {
    const want = units[u] ?? 0;
    if (want <= 0) continue;
    const n = Math.min(want, home[u]);
    if (n > 0) counts[u] = String(n);
    if (n < want) short.push(`Only ${n} of ${want} ${plural(u)} at home`);
  }
  return { counts, short };
}

/** The note under the chips after a tap that came up short; null when everything was there. */
export function shortNote(short: readonly string[]): string | null {
  return short.length > 0 ? `${short.slice(0, 3).join('. ')}${short.length > 3 ? '. And more.' : '.'}` : null;
}
