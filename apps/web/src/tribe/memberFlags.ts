// What a viewer with `role` may do to one tribe member. Pure; the server re-checks every action.

import { canKick, canTribe } from '@clanfire/engine';
import type { TribeRole } from '@clanfire/engine';

export interface MemberFlags {
  canSetRole: boolean;
  canRemove: boolean;
  canTransfer: boolean;
  /** Individual rights (online status, projects): only the leader, only for plain members. Officers already see activity by role. */
  canGrant: boolean;
  hasActions: boolean;
}

export function memberFlags(role: TribeRole, target: { role: TribeRole }, isMe: boolean): MemberFlags {
  const canSetRole = canTribe(role, 'set_roles') && !isMe && target.role !== 'leader';
  const canRemove = !isMe && canKick(role, target.role);
  const canTransfer = canTribe(role, 'transfer_leadership') && !isMe && target.role !== 'leader';
  const canGrant = role === 'leader' && !isMe && target.role === 'member';
  return { canSetRole, canRemove, canTransfer, canGrant, hasActions: canSetRole || canRemove || canTransfer || canGrant };
}
