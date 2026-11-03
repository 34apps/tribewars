// Cancelling a movement shortly after it left (docs/GAME_DESIGN.md section 13).

import { CANCEL_WINDOW_MS } from './config.ts';

/** Movement kinds the sender may call back (everything outgoing except a return). */
export const CANCELLABLE_KINDS = ['attack', 'scout', 'support', 'shipment'] as const;

/** The last moment (ms, server clock) a movement that left at `departAt` can still be cancelled. */
export function cancelDeadline(departAt: number): number {
  return departAt + CANCEL_WINDOW_MS;
}

/** True while an outgoing movement may be cancelled: not a return, inside the window and not yet arrived. */
export function canCancel(m: { kind: string; departAt: number; arriveAt: number }, now: number): boolean {
  return (CANCELLABLE_KINDS as readonly string[]).includes(m.kind) && now <= cancelDeadline(m.departAt) && now < m.arriveAt;
}

/** Travel time of the way back after a cancel: exactly what has been travelled, at least one second. */
export function cancelReturnMs(departAt: number, now: number): number {
  return Math.max(1000, now - departAt);
}
