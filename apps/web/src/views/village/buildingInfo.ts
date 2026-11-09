// Everything a page needs to know about one building right now: levels, queue, next-level cost and time, and why it can not be built.
// Pure (no hooks) so the Village list can call it per row; `useBuildingInfo` wraps it for one building. The server re-checks every build.

import { BUILDINGS, buildTimeMs, buildingCost, checkBuild, productionPerHour, storageCap } from '@clanfire/engine';
import type { BuildingId, Resources, VillageState, WorldSettings } from '@clanfire/engine';
import { useGame, useRules } from '../../game.ts';
import { pickBuildState, refusalOf } from '../../buildState.ts';
import type { BuildStatePick } from '../../buildState.ts';
import { formatDuration, formatLeft } from '../../format.ts';
import { reasonText, requirementText, timeToAfford, unmetRequirements } from '../../rules.ts';
import type { UnmetRequirement } from '../../rules.ts';
import { hearthBuildReason } from '../../villages.ts';

export interface BuildingInfo {
  id: BuildingId;
  level: number;
  /** Level the next build would produce (after the queue). */
  target: number;
  atMax: boolean;
  jobs: VillageState['buildQueue'];
  /** ms left on the running job (null when none runs). */
  upgradingLeftMs: number | null;
  /** The running job, if any. */
  active: VillageState['buildQueue'][number] | undefined;
  unmet: UnmetRequirement[];
  locked: boolean;
  /** Cost / time of `target`; null at max level. */
  cost: Resources | null;
  timeMs: number | null;
  /** Player-facing reason a build is refused right now (null = can build). */
  reason: string | null;
  /** ms until affordable (null = never at this income); only meaningful for the "afford" state. */
  affordInMs: number | null;
  /** ms until the earliest build job finishes (a slot frees). */
  queueFreesInMs: number | null;
  /** Resources the cost is short of (or above storage). */
  short: (r: keyof Resources) => boolean;
  pick: BuildStatePick;
  /** The same choice ignoring this building's own jobs: what the Upgrade button on the building page shows (another level can be queued). */
  actionPick: BuildStatePick;
}

export function buildingInfo(
  live: VillageState,
  now: number,
  settings: WorldSettings,
  hearthOut: boolean,
  queueLimit: number,
  id: BuildingId,
): BuildingInfo {
  const def = BUILDINGS[id];
  const level = live.buildings[id];
  const jobs = live.buildQueue.filter((j) => j.building === id);
  const active = jobs.find((j) => now >= j.startAt);
  const target = level + jobs.length + 1;
  const atMax = target > def.maxLevel;
  const unmet = unmetRequirements(live.buildings, def.requires);
  const locked = level === 0 && unmet.length > 0;
  const check = checkBuild(live, id, now, settings, queueLimit);
  const hearth = hearthBuildReason(hearthOut, id);
  const reason = atMax ? 'Max level' : hearth ?? (!check.ok ? reasonText(check, unmet) : null);
  const cost = atMax ? null : check.ok ? check.cost : buildingCost(id, target);
  const timeMs = atMax ? null : check.ok ? check.timeMs : buildTimeMs(id, target, live.buildings.hall, settings);
  const cap = storageCap(live);
  let affordInMs: number | null = null;
  if (!check.ok && check.reason === 'not_enough_resources' && cost) {
    affordInMs = timeToAfford(live.resources, productionPerHour(live, settings), cost, cap);
  }
  const queueFreesInMs = live.buildQueue.length > 0 ? Math.max(0, Math.min(...live.buildQueue.map((j) => j.finishAt)) - now) : null;
  const input = {
    level,
    jobsOfThis: jobs.length,
    upgradingLeftMs: active ? Math.max(0, active.finishAt - now) : null,
    atMax,
    locked,
    // A full queue is what the player can act on first, whatever the stock is.
    refusal: hearth ? 'other' : live.buildQueue.length >= queueLimit ? 'queue_full' : refusalOf(check, hearth),
    affordInMs,
    queueFreesInMs,
  };
  const pick = pickBuildState(input);
  const actionPick = pickBuildState({ ...input, jobsOfThis: 0, upgradingLeftMs: null });
  return {
    id,
    level,
    target,
    atMax,
    jobs,
    upgradingLeftMs: active ? Math.max(0, active.finishAt - now) : null,
    active,
    unmet,
    locked,
    cost,
    timeMs,
    reason,
    affordInMs,
    queueFreesInMs,
    short: (r) => !!cost && (Math.floor(live.resources[r] + 1e-9) < cost[r] || cost[r] > cap),
    pick,
    actionPick,
  };
}

export function useBuildingInfo(id: BuildingId): BuildingInfo {
  const { live, now, settings, village } = useGame();
  return buildingInfo(live, now, settings, !!village.hearth, useRules().queues.build, id);
}

/** The text under the state control on the building page: why it can not be built (or null). */
export function whyText(info: BuildingInfo, kind = info.actionPick.kind): string | null {
  switch (kind) {
    case 'queuefull':
      return `Queue full${info.queueFreesInMs !== null ? ` · frees in ${formatDuration(info.queueFreesInMs)}` : ''}`;
    case 'afford':
      return info.affordInMs === null ? 'Not enough resources · production too low' : `Not enough resources · ready in ${formatLeft(info.affordInMs)}`;
    case 'locked':
      return `Locked · needs ${requirementText(info.unmet)}`;
    case 'max':
      return 'Max level reached';
    case 'blocked':
      return info.reason;
    case 'queued':
      return `${info.jobs.length} queued · starts after the current job`;
    case 'upgrading':
      return null;
    default:
      return null;
  }
}
