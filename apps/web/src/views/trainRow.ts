// One unit's training row: the typed amount, what it costs, how many can be afforded and why Train is refused. Shared by the Army
// page's unit cards and the Barracks / Stables page, so both validate the same way. The server re-checks everything.

import { MAX_TRAIN_BATCH, RESOURCE_IDS, UNITS, checkTrain, isResearched, trainTimeMs } from '@clanfire/engine';
import type { Resources, TrainingBuildingId, UnitId, VillageState, WorldSettings } from '@clanfire/engine';
import { maxTrainable, reasonText, requirementText, unmetRequirements } from '../rules.ts';
import type { UnmetRequirement } from '../rules.ts';
import { HEARTH_OUT_REASON } from '../villages.ts';

export interface TrainRowState {
  unmet: UnmetRequirement[];
  /** Building requirements missing: the row is greyed out. */
  locked: boolean;
  /** Not researched yet (Drillyard). */
  unresearched: boolean;
  /** Typed amount, clamped to 0..MAX_TRAIN_BATCH (0 when empty or not a whole number). */
  count: number;
  perUnitMs: number;
  /** Most the village can pay for and house right now (0 when locked). */
  max: number;
  /** Why Train is refused (null = can train `count`). */
  reason: string | null;
  /** Cost of the typed amount (of one unit when nothing is typed). */
  batchCost: Resources;
}

export function trainRowState(args: {
  live: VillageState;
  unit: UnitId;
  building: TrainingBuildingId;
  text: string;
  now: number;
  settings: WorldSettings;
  trainQueueLimit: number;
  hearthOut: boolean;
}): TrainRowState {
  const { live, unit, building, text, now, settings } = args;
  const def = UNITS[unit];
  const unmet = unmetRequirements(live.buildings, def.requires);
  const locked = unmet.length > 0;
  const unresearched = !locked && !isResearched(live, unit);
  const parsed = text.trim() === '' ? 0 : Number(text);
  const count = Number.isInteger(parsed) ? Math.max(0, Math.min(MAX_TRAIN_BATCH, parsed)) : 0;
  const max = locked ? 0 : maxTrainable(live, unit, now, settings);
  const check = checkTrain(live, unit, Math.max(1, count), now, settings);
  const queueFull = live.trainQueues[building].length >= args.trainQueueLimit;

  let reason: string | null = null;
  if (args.hearthOut) reason = HEARTH_OUT_REASON;
  else if (locked) reason = `Needs ${requirementText(unmet)}`;
  else if (unresearched) reason = 'Research in Drillyard';
  else if (queueFull) reason = 'Queue full';
  else if (count < 1) reason = max < 1 ? 'Cannot afford one' : 'Enter amount';
  else if (!check.ok) reason = reasonText(check, unmet);

  const batchCost = Object.fromEntries(RESOURCE_IDS.map((r) => [r, def.cost[r] * Math.max(1, count)])) as Resources;
  return { unmet, locked, unresearched, count, perUnitMs: trainTimeMs(unit, live, settings), max, reason, batchCost };
}
