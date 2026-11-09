// Pure helpers of the desktop "no tribe yet" Tribe page (FrameNoTribe.tsx): what the action cell of a tribe row says, and the
// room a row has. Same rules as the phone's JoinButton (tribe/Join.tsx).

import type { Recruitment } from '@clanfire/engine';

/** Tribe rows per page of the "Find a tribe" table (what fits the 900 px frame). */
export const NOTRIBE_ROWS = 10;
/** Invitation rows shown at once in the right column (more are paged). */
export const NOTRIBE_INVITES = 2;

export type JoinAction = 'invited' | 'full' | 'join' | 'apply' | 'applied' | 'invite-only';

export interface JoinFacts {
  maxMembers: number;
  /** Tribe ids I applied to. */
  appliedTo: readonly number[];
  /** Tribe ids that invited me. */
  invitedBy: readonly number[];
}

/** What the action cell of a tribe row shows: an invitation wins, then Full, then the tribe's recruitment. */
export function joinAction(t: { id: number; members: number; recruitment: Recruitment }, f: JoinFacts): JoinAction {
  if (f.invitedBy.includes(t.id)) return 'invited';
  if (t.members >= f.maxMembers) return 'full';
  if (t.recruitment === 'open') return 'join';
  if (t.recruitment === 'application') return f.appliedTo.includes(t.id) ? 'applied' : 'apply';
  return 'invite-only';
}

/** "Who may join" column. */
export const WHO_MAY_JOIN: Record<Recruitment, string> = { open: 'Open to all', application: 'By application', invite: 'Invite only' };

/** Width in percent (0..100) of a tribe's member bar. */
export function memberFill(members: number, maxMembers: number): number {
  if (maxMembers <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((members / maxMembers) * 100)));
}
