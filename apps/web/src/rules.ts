// Client-side helpers built on the engine: previews, requirement text, "can I afford it" hints.
// The server re-checks everything; nothing here is authoritative.

import {
  BUILDINGS,
  HALL_TIME_FACTOR,
  MAX_TRAIN_BATCH,
  RESOURCE_IDS,
  RESOURCE_PRODUCER,
  TRAIN_TIME_FACTOR,
  UNITS,
  UNIT_IDS,
  WALL_BASE_DEFENSE,
  WALL_BONUS_PER_LEVEL,
  WALL_DEFENSE_PER_LEVEL,
  checkTrain,
  netProductionPerHour,
  productionFromLevels,
  storageCapForLevel,
  vaultForLevel,
} from '@clanfire/engine';
import type {
  BuildingId,
  BuildingLevels,
  CheckResult,
  GameErrorCode,
  ResourceId,
  Resources,
  UnitId,
  Units,
  VillageState,
  WorldSettings,
} from '@clanfire/engine';
import { formatCompact, formatInt, formatRate } from './format.ts';
import { RESOURCE_ICON } from './icons.ts';

export interface UnmetRequirement {
  building: BuildingId;
  need: number;
  have: number;
}

export function unmetRequirements(levels: BuildingLevels, requires: Partial<Record<BuildingId, number>>): UnmetRequirement[] {
  const out: UnmetRequirement[] = [];
  for (const key of Object.keys(requires) as BuildingId[]) {
    const need = requires[key] ?? 0;
    if (levels[key] < need) out.push({ building: key, need, have: levels[key] });
  }
  return out;
}

export function requirementText(list: UnmetRequirement[]): string {
  return list.map((r) => `${BUILDINGS[r.building].name} ${r.need}`).join(', ');
}

/** Short, player-facing reason for a failed check. Falls back to the engine's own message. */
export function reasonText(res: Extract<CheckResult<unknown>, { ok: false }>, unmet: UnmetRequirement[] = []): string {
  const code: GameErrorCode = res.reason;
  switch (code) {
    case 'requirements_not_met':
      return unmet.length > 0 ? `Needs ${requirementText(unmet)}` : res.message;
    case 'queue_full':
      return 'Queue full';
    case 'max_level':
      return 'Max level';
    case 'exceeds_storage':
      return 'Cost exceeds storage. Upgrade the Storehouse';
    default:
      return res.message.replace(/\.$/, '');
  }
}

export interface EffectLine {
  label: string;
  from: string;
  to: string;
}

const dash = '–';

function speedBonus(factor: number, level: number): string {
  if (level <= 0) return dash;
  const pct = Math.round((1 / Math.pow(factor, level - 1) - 1) * 100);
  return `+${pct}%`;
}

/** What a level does, formatted for "now -> next" display. */
export function buildingEffects(id: BuildingId, from: number, to: number, speed: number): EffectLine[] {
  const lines: EffectLine[] = [];
  const unlocks = unlockNames(id, to);
  switch (id) {
    case 'lumber':
    case 'farm':
    case 'mine':
    case 'goldmine': {
      const res = (Object.keys(RESOURCE_PRODUCER) as ResourceId[]).find((r) => RESOURCE_PRODUCER[r] === id);
      if (res) {
        const rate = (level: number) => productionFromLevels({ ...zeroLevels(), [id]: level }, speed)[res];
        lines.push({ label: id === 'farm' ? 'Food production' : 'Production', from: formatRate(rate(from)), to: formatRate(rate(to)) });
      }
      break;
    }
    case 'storehouse':
      lines.push({ label: 'Capacity', from: formatInt(storageCapForLevel(from)), to: formatInt(storageCapForLevel(to)) });
      break;
    case 'vault':
      lines.push({ label: 'Hides per resource', from: formatInt(vaultForLevel(from)), to: formatInt(vaultForLevel(to)) });
      break;
    case 'wall':
      lines.push({
        label: 'Defense bonus',
        from: `+${Math.round(WALL_BONUS_PER_LEVEL * from * 100)}%`,
        to: `+${Math.round(WALL_BONUS_PER_LEVEL * to * 100)}%`,
      });
      lines.push({
        label: 'Militia',
        from: formatInt(WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * from),
        to: formatInt(WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL * to),
      });
      break;
    case 'hall':
      lines.push({ label: 'Build speed', from: speedBonus(HALL_TIME_FACTOR, Math.max(1, from)), to: speedBonus(HALL_TIME_FACTOR, to) });
      break;
    case 'barracks':
    case 'stables':
      lines.push({ label: 'Training speed', from: speedBonus(TRAIN_TIME_FACTOR, from), to: speedBonus(TRAIN_TIME_FACTOR, to) });
      break;
  }
  if (unlocks.length > 0) lines.push({ label: 'Unlocks', from: '', to: unlocks.join(', ') });
  return lines;
}

function zeroLevels(): BuildingLevels {
  return Object.fromEntries(Object.keys(BUILDINGS).map((b) => [b, 0])) as BuildingLevels;
}

/** Buildings and units whose requirement on `id` is exactly `level`. */
function unlockNames(id: BuildingId, level: number): string[] {
  const names: string[] = [];
  for (const b of Object.values(BUILDINGS)) if (b.id !== id && b.requires[id] === level) names.push(b.name);
  for (const u of UNIT_IDS) if (UNITS[u].requires[id] === level) names.push(UNITS[u].name);
  return names;
}

/** Milliseconds until `cost` is affordable at the current net rates, or null when it never will be. */
export function timeToAfford(have: Resources, net: Resources, cost: Resources, cap: number): number | null {
  let worst = 0;
  for (const r of RESOURCE_IDS) {
    const missing = cost[r] - have[r];
    if (missing <= 0) continue;
    if (cost[r] > cap || net[r] <= 0) return null;
    worst = Math.max(worst, (missing / net[r]) * 3_600_000);
  }
  return worst;
}

/** Largest batch the village can pay for and feed, 0 when none. Verified with the engine check. */
export function maxTrainable(live: VillageState, u: UnitId, now: number, s: WorldSettings): number {
  const def = UNITS[u];
  let n = MAX_TRAIN_BATCH;
  for (const r of RESOURCE_IDS) {
    const c = def.cost[r];
    if (c > 0) n = Math.min(n, Math.floor(live.resources[r] / c));
  }
  const upkeep = def.upkeep * s.speed;
  if (upkeep > 0) n = Math.min(n, Math.floor(netProductionPerHour(live, s).food / upkeep + 1e-9));
  n = Math.max(0, n);
  for (let i = 0; i < 6 && n > 0 && !checkTrain(live, u, n, now, s).ok; i++) n -= 1;
  return n;
}

export function resourceText(r: Resources): string {
  return RESOURCE_IDS.filter((id) => r[id] > 0)
    .map((id) => `${RESOURCE_ICON[id]} ${formatCompact(r[id])}`)
    .join('  ');
}

export function unitListText(units: Units): string {
  return UNIT_IDS.filter((u) => units[u] > 0)
    .map((u) => `${formatInt(units[u])} ${UNITS[u].name}`)
    .join(', ');
}
