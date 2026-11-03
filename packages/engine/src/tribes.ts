// Tribe rules shared by server (enforces) and client (shows/hides actions). See GAME_DESIGN.md section 11.

import {
  PACT_NOTICE_HOURS,
  TRIBE_DESCRIPTION_MAX,
  TRIBE_NAME_MAX,
  TRIBE_NAME_MIN,
  TRIBE_NAME_PATTERN,
  TRIBE_GRANTABLE,
  TRIBE_PERMISSIONS,
  TRIBE_TAG_PATTERN,
} from './config.ts';
import { MS_PER_HOUR, fail } from './util.ts';
import {
  DIPLOMACY_KINDS,
  RECRUITMENT_MODES,
  TRIBE_ROLES,
  type CheckResult,
  type DiplomacyKind,
  type PlayerRelation,
  type Recruitment,
  type TribeAction,
  type TribeRole,
  type WorldSettings,
} from './types.ts';

const NAME_RE = new RegExp(TRIBE_NAME_PATTERN, 'u');
const TAG_RE = new RegExp(TRIBE_TAG_PATTERN);

export function isTribeRole(x: unknown): x is TribeRole {
  return typeof x === 'string' && (TRIBE_ROLES as readonly string[]).includes(x);
}
export function isRecruitment(x: unknown): x is Recruitment {
  return typeof x === 'string' && (RECRUITMENT_MODES as readonly string[]).includes(x);
}
export function isDiplomacyKind(x: unknown): x is DiplomacyKind {
  return typeof x === 'string' && (DIPLOMACY_KINDS as readonly string[]).includes(x);
}

export function isGrantable(x: unknown): x is TribeAction {
  return typeof x === 'string' && (TRIBE_GRANTABLE as readonly string[]).includes(x);
}

/**
 * Validate a list of explicit grants: an array of distinct, grantable rights. Returns the list in canonical order,
 * or null when the input is not acceptable (wrong type, unknown or non-grantable right, duplicate).
 */
export function parseGrants(x: unknown): TribeAction[] | null {
  if (!Array.isArray(x) || x.length > TRIBE_GRANTABLE.length) return null;
  const seen = new Set<string>();
  for (const g of x) {
    if (!isGrantable(g) || seen.has(g)) return null;
    seen.add(g);
  }
  return TRIBE_GRANTABLE.filter((g) => seen.has(g));
}

/** May a member with `role` (and the leader's individual `grants` for them) do `action`? Role default OR grant. */
export function canTribe(role: TribeRole, action: TribeAction, grants: readonly TribeAction[] = []): boolean {
  return TRIBE_PERMISSIONS[action].includes(role) || (isGrantable(action) && grants.includes(action));
}

/** Every right the member effectively has (for the client to show or hide buttons). */
export function effectiveRights(role: TribeRole, grants: readonly TribeAction[] = []): TribeAction[] {
  return (Object.keys(TRIBE_PERMISSIONS) as TribeAction[]).filter((a) => canTribe(role, a, grants));
}

/** Who sees the leadership boards of the forum: leader, officers, and members who may moderate or manage it. */
export function seesLeadershipBoards(role: TribeRole, grants: readonly TribeAction[] = []): boolean {
  return canTribe(role, 'forum_moderate', grants) || canTribe(role, 'forum_manage', grants);
}

/** Officers may remove members; only the leader may remove officers. Nobody removes the leader. */
export function canKick(actor: TribeRole, target: TribeRole, actorGrants: readonly TribeAction[] = []): boolean {
  if (target === 'leader' || !canTribe(actor, 'kick', actorGrants)) return false;
  return target === 'member' || actor === 'leader';
}

/** Trims and collapses inner whitespace runs to one space. */
export function normalizeTribeName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

/** Tags are case-insensitive and stored upper-case. */
export function normalizeTribeTag(tag: string): string {
  return tag.trim().toUpperCase();
}

/** Validates already-normalized values. */
export function checkTribeIdentity(name: string, tag: string): CheckResult<{ name: string; tag: string }> {
  const len = [...name].length;
  if (len < TRIBE_NAME_MIN || len > TRIBE_NAME_MAX || !NAME_RE.test(name)) {
    return fail(
      'invalid_input',
      `Tribe name: ${TRIBE_NAME_MIN}-${TRIBE_NAME_MAX} letters, digits, spaces and - ' . characters.`,
    );
  }
  if (!TAG_RE.test(tag)) return fail('invalid_input', 'Tribe tag: 2-6 letters A-Z or digits.');
  return { ok: true, name, tag };
}

export function checkTribeDescription(text: string): CheckResult<{ text: string }> {
  const t = text.trim();
  if ([...t].length > TRIBE_DESCRIPTION_MAX) {
    return fail('invalid_input', `Description: at most ${TRIBE_DESCRIPTION_MAX} characters.`);
  }
  return { ok: true, text: t };
}

/** Notice period before a cancelled alliance or NAP stops protecting either side. */
export function pactNoticeMs(s: WorldSettings): number {
  return Math.round((PACT_NOTICE_HOURS * MS_PER_HOUR) / s.speed);
}

/** Relations that forbid attacking (your own village, your tribe, allies, NAP partners). */
export function isAttackForbidden(relation: PlayerRelation): boolean {
  return relation === 'self' || relation === 'tribe' || relation === 'ally' || relation === 'nap';
}

/** May troops be stationed in a village of a player with this relation? Only tribe-mates and allies. */
export function isSupportAllowed(relation: PlayerRelation): boolean {
  return relation === 'tribe' || relation === 'ally';
}
