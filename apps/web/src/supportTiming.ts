// "Will my help arrive in time?" for the support form (pure text and decisions; no React, no I/O).
// The help lands at now + the engine travel time of the chosen troops (the slowest unit decides, the same number the real send
// uses); each known attack on the target lands at its server-clock `arriveAt` (see incoming.ts for who may know about which attack).

import { arrivalVerdict } from './incoming.ts';
import type { KnownAttack } from './incoming.ts';
import { formatLeft } from './format.ts';

export interface SupportTimingLine {
  movementId: number;
  /** True when the help lands strictly before this attack. */
  inTime: boolean;
  /** The sentence the form shows. */
  text: string;
}

/** Most attacks listed (the soonest first). */
export const SUPPORT_TIMING_MAX = 3;

const ORDINAL = ['First', 'Second', 'Third'] as const;

/** "12m" / "5h 12m" / "2d 3h"; a gap under a second reads "a moment". */
function gapText(ms: number): string {
  return ms < 1000 ? 'a moment' : formatLeft(ms);
}

/**
 * One verdict per attack on the target village that has not landed yet, soonest first, at most `SUPPORT_TIMING_MAX`.
 * `travelMs` is the engine travel time of the chosen troops, `now` the server-synced clock. Nothing for no attack or for
 * an army that is not picked yet (a non-finite or non-positive time).
 */
export function supportTimingLines(
  travelMs: number,
  now: number,
  attacks: ReadonlyArray<Pick<KnownAttack, 'movementId' | 'arriveAt'>>,
): SupportTimingLine[] {
  if (!Number.isFinite(travelMs) || travelMs <= 0) return [];
  const helpAt = now + travelMs;
  const open = attacks.filter((a) => a.arriveAt > now).sort((a, b) => a.arriveAt - b.arriveAt || a.movementId - b.movementId);
  const shown = open.slice(0, SUPPORT_TIMING_MAX);
  const several = open.length > 1;
  return shown.map((a, i) => {
    const v = arrivalVerdict(helpAt, a.arriveAt);
    const lead = several ? `${ORDINAL[i] ?? 'Next'} attack: ` : '';
    let text: string;
    if (v.inTime) text = several ? `arrives ${gapText(v.gapMs)} before it lands` : `Arrives ${gapText(v.gapMs)} before the attack lands`;
    else if (v.gapMs < 1000) text = several ? 'arrives as it lands: too late' : 'Arrives as the attack lands: too late';
    else text = several ? `arrives ${gapText(v.gapMs)} too late: it lands first` : `Arrives ${gapText(v.gapMs)} too late: the attack lands first`;
    return { movementId: a.movementId, inTime: v.inTime, text: `${lead}${text}` };
  });
}
