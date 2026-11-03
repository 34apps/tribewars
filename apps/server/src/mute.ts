// Mutes: a muted player cannot write user text that other players read (mail, tribe chat, forum, tribe texts).
// They can still use support tickets. The caller's row is read from the database at the start of every request.

import { GameError } from '@clanfire/engine';
import type { PlayerRow } from './store.ts';

export const isMuted = (p: PlayerRow, now: number): boolean => p.mutedUntil !== null && p.mutedUntil > now;

const fmtUtc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Refuse with `forbidden` (and the end of the mute) while the player is muted. */
export function assertNotMuted(p: PlayerRow, now: number): void {
  if (isMuted(p, now)) {
    throw new GameError('forbidden', `You are muted until ${fmtUtc(p.mutedUntil as number)} and cannot write messages or posts. You can still contact support through a ticket.`);
  }
}
