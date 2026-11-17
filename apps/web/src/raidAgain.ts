// "Raid again" / "Scout again": the pure part. Compares the troops of the earlier march (ReportDigest.again) with what stands at home
// now and decides whether to send at once, offer what is there, or say there is nothing. The server still runs every normal send
// check (protection, march limit, ownership); this only chooses what to ask for and words the answer.

import { UNITS, UNIT_IDS, planSendAgain, settleVillage } from '@clanfire/engine';
import type { OwnVillageDto, SendAgainDto, SendResponse, UnitId, Units, WorldSettings } from '@clanfire/engine';
import { api, errorMessage } from './api.ts';
import { formatDuration } from './format.ts';

export type AgainDecision =
  /** Everything that went last time is at home: send it. */
  | { kind: 'send'; units: Partial<Units> }
  /** Some of it is at home: say what is missing and let the player choose. */
  | { kind: 'partial'; units: Partial<Units>; missing: Partial<Units>; wanted: Partial<Units>; home: Partial<Units>; text: string }
  /** Nothing of it is at home. */
  | { kind: 'none'; missing: Partial<Units>; wanted: Partial<Units>; home: Partial<Units>; text: string }
  /** The sending village is not (or no longer) one of mine. */
  | { kind: 'gone'; text: string };

/** "Raider" / "Raiders", "Pikeman" / "Pikemen" (the same plural rule as the rest of the app). */
const unitName = (u: UnitId, n: number): string => {
  const name = UNITS[u].name;
  if (n === 1) return name;
  if (/man$/.test(name)) return `${name.slice(0, -3)}men`;
  return /(s|x)$/.test(name) ? name : `${name}s`;
};
const fmt = (n: number): string => new Intl.NumberFormat().format(n);

/** "Missing: 20 Raiders — 100 of 120 at home" (several units are joined with "; "). */
export function missingText(wanted: Partial<Units>, home: Partial<Units>): string {
  const parts: string[] = [];
  for (const u of UNIT_IDS) {
    const want = wanted[u] ?? 0;
    const have = Math.min(want, Math.max(0, Math.floor(home[u] ?? 0)));
    if (want > have) parts.push(`${fmt(want - have)} ${unitName(u, want - have)} — ${fmt(have)} of ${fmt(want)} at home`);
  }
  return `Missing: ${parts.join('; ')}`;
}

/** "100 Raiders, 5 Pikemen" for the "Send what is there" line. */
export function unitsText(units: Partial<Units>): string {
  return UNIT_IDS.filter((u) => (units[u] ?? 0) > 0)
    .map((u) => `${fmt(units[u] ?? 0)} ${unitName(u, units[u] ?? 0)}`)
    .join(', ');
}

/** What to do for one report. `home` is the troops standing in the sending village now, or null when that village is not mine. */
export function decideAgain(again: Pick<SendAgainDto, 'units'>, home: Partial<Units> | null): AgainDecision {
  if (home === null) return { kind: 'gone', text: 'That village is not yours any more, so the troops cannot leave from there.' };
  const plan = planSendAgain(again.units, home);
  if (plan.complete) return { kind: 'send', units: plan.send };
  if (plan.empty) {
    return { kind: 'none', missing: plan.missing, wanted: again.units, home, text: `${missingText(again.units, home)}. None of these troops are at home right now.` };
  }
  return { kind: 'partial', units: plan.send, missing: plan.missing, wanted: again.units, home, text: missingText(again.units, home) };
}

/** Troops at home in one of my villages right now (settled to `now`), or null when it is not in my list. */
export function homeTroops(villages: readonly OwnVillageDto[], villageId: number, now: number, settings: WorldSettings): Partial<Units> | null {
  const v = villages.find((x) => x.id === villageId);
  if (!v) return null;
  return settleVillage(v.state, now, settings).troops;
}

/** Button text: "Raid again" for an attack, "Scout again" for scouting. */
export function againLabel(again: Pick<SendAgainDto, 'mission'>): string {
  return again.mission === 'scout' ? 'Scout again' : 'Raid again';
}

/** Past tense for the result line: "Raid sent to Hillfort." */
export function againSentText(again: Pick<SendAgainDto, 'mission' | 'targetName'>, arrivesIn: string): string {
  return `${again.mission === 'scout' ? 'Scouts' : 'Raid'} sent to ${again.targetName}. Arrives in ${arrivesIn}.`;
}

export type AgainOutcome = { ok: true; response: SendResponse; text: string } | { ok: false; text: string };

/**
 * The one send call of "raid again": the normal send route, from the report's village, at the report's target. A refusal comes back
 * as the server's own message (protected, march limit, not your village any more ...); nothing is swallowed.
 */
export async function sendAgain(again: SendAgainDto, units: Partial<Units>, now: number): Promise<AgainOutcome> {
  try {
    const response = await api.send(again.fromVillageId, { x: again.x, y: again.y, units, mission: again.mission });
    return { ok: true, response, text: againSentText(again, formatDuration(response.movement.arriveAt - now)) };
  } catch (e) {
    return { ok: false, text: errorMessage(e) };
  }
}
