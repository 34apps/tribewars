// Tribes: founding, membership, roles, diplomacy, event log and chat (docs/GAME_DESIGN.md section 11).
// Every mutation runs in one BEGIN IMMEDIATE transaction (Store.tx) and re-checks membership and role
// inside it. Rule helpers (permissions, name/tag checks, pact notice) come from the engine.

import {
  GameError,
  PLAYER_MAX_APPLICATIONS,
  TRIBE_APPLICATION_MESSAGE_MAX,
  TRIBE_CHAT_KEEP,
  TRIBE_CHAT_MESSAGE_MAX,
  TRIBE_EVENTS_KEEP,
  TRIBE_FOUND_HALL_LEVEL,
  TRIBE_INVITE_TTL_HOURS,
  TRIBE_MAX_ALLIES,
  TRIBE_MAX_MEMBERS,
  TRIBE_MAX_NAPS,
  TRIBE_MAX_OPEN_INVITES,
  canKick,
  canTribe,
  checkTribeDescription,
  checkTribeIdentity,
  effectiveRights,
  normalizeTribeName,
  normalizeTribeTag,
  pactNoticeMs,
  parseGrants,
  seesLeadershipBoards,
  settleVillage,
  villagePoints,
  type ChatMessageDto,
  type ChatResponse,
  type CreateTribeRequest,
  type DiplomacyKind,
  type DiplomacyProposalDto,
  type MyTribeResponse,
  type Recruitment,
  type TribeAction,
  type TribeApplicationDto,
  type TribeDto,
  type TribeEventDto,
  type TribeInviteDto,
  type TribeListResponse,
  type TribeMemberDto,
  type TribeRelationDto,
  type TribeRole,
  type TribeSettingsRequest,
  type TribeSummaryDto,
  type WorldSettings,
} from '@clanfire/engine';
import type { PlayerRow, Store } from './store.ts';
import type { ApplicationRow, InviteRow, MemberRow, MembershipRow, ProposalRow, RankedTribeRow, RelationSideRow, TribeRow } from './tribe-store.ts';

const MS_PER_HOUR = 3_600_000;
const LIST_LIMIT = 100;
const EVENTS_SHOWN = 50;
const CHAT_PAGE = 100;

/** Chat spam guard, per player, in memory: at most 1 message per second and 20 per minute. */
const CHAT_MIN_GAP_MS = 1000;
const CHAT_PER_MINUTE = 20;
const CHAT_MAX_TRACKED = 5000;

const ROLE_RANK: Record<TribeRole, number> = { leader: 0, officer: 1, member: 2 };

const DENIED: Record<TribeAction, string> = {
  edit_settings: 'Only the leader and officers can change the tribe settings.',
  invite: 'Only the leader and officers can invite players.',
  handle_applications: 'Only the leader and officers can handle applications.',
  kick: 'Only the leader and officers can remove members.',
  diplomacy: 'Only the leader and officers can manage diplomacy.',
  set_roles: 'Only the leader can change roles.',
  transfer_leadership: 'Only the leader can hand over leadership.',
  disband: 'Only the leader can disband the tribe.',
  chat: "You can't use the tribe chat.",
  forum_manage: "You don't have the right to manage the forum boards.",
  forum_moderate: "You don't have the right to moderate the forum.",
};

const RECRUITMENT_LABEL: Record<Recruitment, string> = {
  open: 'open (anyone can join)',
  application: 'applications',
  invite: 'invitations only',
};

const KIND_LABEL: Record<DiplomacyKind, string> = { ally: 'alliance', nap: 'non-aggression pact', enemy: 'war' };

/**
 * Control characters (keeping tab, newline and carriage return), line/paragraph separators and bidi overrides
 * have no place in descriptions, messages or chat; lone surrogates would not survive being stored as UTF-8.
 */
function hasForbiddenChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 ? c !== 0x09 && c !== 0x0a && c !== 0x0d : c >= 0x7f && c <= 0x9f) return true;
    if (c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function invalid(message: string): GameError {
  return new GameError('invalid_input', message);
}

/** Plain-text user input: normalised newlines, trimmed, no control characters. Length is the caller's business. */
export function cleanText(raw: string, what: string): string {
  if (hasForbiddenChars(raw)) throw invalid(`${what} contains characters that are not allowed.`);
  return raw.replace(/\r\n?/g, '\n').trim();
}

export const len = (s: string): number => [...s].length;

function fmtUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

class ChatLimiter {
  private readonly recent = new Map<number, number[]>();

  /** Count one message; false when the player is over the limit (nothing is recorded then). */
  allow(playerId: number, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((x) => x > now - 60_000);
    const last = times[times.length - 1];
    if ((last !== undefined && now - last < CHAT_MIN_GAP_MS) || times.length >= CHAT_PER_MINUTE) {
      this.recent.set(playerId, times);
      return false;
    }
    if (this.recent.size >= CHAT_MAX_TRACKED && !this.recent.has(playerId)) this.sweep(now);
    times.push(now);
    this.recent.set(playerId, times);
    return true;
  }

  private sweep(now: number): void {
    for (const [id, times] of this.recent) {
      const last = times[times.length - 1];
      if (last === undefined || last <= now - 60_000) this.recent.delete(id);
    }
  }
}

export class TribeService {
  private readonly chatLimiter = new ChatLimiter();

  constructor(
    private readonly store: Store,
    private readonly settings: WorldSettings,
  ) {}

  private get ts() {
    return this.store.tribes;
  }

  // ---- reads --------------------------------------------------------------------------------------

  /** All tribes by points, best first; `q` filters by name or tag (the rank stays the global one). */
  list(q: string | undefined): TribeListResponse {
    const needle = (q ?? '').trim().toLowerCase();
    const tribes: TribeSummaryDto[] = [];
    this.ts.ranking().forEach((r, i) => {
      if (tribes.length >= LIST_LIMIT) return;
      if (needle === '' || r.name.toLowerCase().includes(needle) || r.tag.toLowerCase().includes(needle)) tribes.push(this.summary(r, i + 1));
    });
    return { tribes };
  }

  get(id: number, t: number): TribeDto {
    return this.tribeDto(id, t);
  }

  /** The caller's tribe page (or the tribeless view: invitations and applications addressed to / sent by me). */
  mine(player: PlayerRow, t: number): MyTribeResponse {
    this.purgeExpired(t);
    this.refreshPoints(player.id, t);
    return this.view(player.id, t);
  }

  // ---- founding and joining -----------------------------------------------------------------------

  found(player: PlayerRow, body: CreateTribeRequest, t: number): MyTribeResponse {
    // Input first (400), then game state (409).
    const identity = checkTribeIdentity(normalizeTribeName(body.name.normalize('NFC')), normalizeTribeTag(body.tag));
    if (!identity.ok) throw new GameError(identity.reason, identity.message);
    const desc = this.description(body.description ?? '');

    return this.store.tx(() => {
      if (this.ts.membership(player.id)) throw new GameError('already_in_tribe', 'You are already in a tribe. Leave it first.');
      const hall = this.refreshPoints(player.id, t);
      if (hall < TRIBE_FOUND_HALL_LEVEL) {
        throw new GameError('requirements_not_met', `You need a Town Hall at level ${TRIBE_FOUND_HALL_LEVEL} to found a tribe (yours is level ${hall}).`);
      }
      if (this.ts.getTribeByName(identity.name)) throw new GameError('tribe_name_taken', 'That tribe name is already taken.');
      if (this.ts.getTribeByTag(identity.tag)) throw new GameError('tribe_name_taken', 'That tribe tag is already taken.');

      const tribeId = this.ts.insertTribe(identity.name, identity.tag, desc, body.recruitment, t);
      this.ts.insertMember(player.id, tribeId, 'leader', t);
      this.store.forum.createDefaultBoards(tribeId, t);
      this.ts.deleteApplicationsOfPlayer(player.id);
      this.event(tribeId, t, `${player.username} founded the tribe.`);
      return this.view(player.id, t);
    });
  }

  join(player: PlayerRow, tribeId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      if (this.ts.membership(player.id)) throw new GameError('already_in_tribe', 'You are already in a tribe. Leave it first.');
      const tribe = this.tribeOrThrow(tribeId);
      if (tribe.recruitment !== 'open') {
        throw new GameError('forbidden', 'This tribe is not open to everyone. Apply or ask for an invitation.');
      }
      this.requireRoom(tribe.id);
      this.addMember(tribe.id, player.id, player.username, t, 'joined the tribe.');
      return this.view(player.id, t);
    });
  }

  apply(player: PlayerRow, tribeId: number, rawMessage: string, t: number): MyTribeResponse {
    const message = cleanText(rawMessage, 'The message');
    if (len(message) > TRIBE_APPLICATION_MESSAGE_MAX) throw invalid(`The message may have at most ${TRIBE_APPLICATION_MESSAGE_MAX} characters.`);

    return this.mutate(t, () => {
      if (this.ts.membership(player.id)) throw new GameError('already_in_tribe', 'You are already in a tribe. Leave it first.');
      const tribe = this.tribeOrThrow(tribeId);
      if (tribe.recruitment !== 'application') {
        throw new GameError(
          'forbidden',
          tribe.recruitment === 'open' ? 'This tribe is open: you can join it directly.' : 'This tribe only takes invitations.',
        );
      }
      this.requireRoom(tribe.id);
      if (this.ts.findApplication(tribe.id, player.id)) throw new GameError('requirements_not_met', 'You have already applied to this tribe.');
      if (this.ts.countApplicationsOfPlayer(player.id) >= PLAYER_MAX_APPLICATIONS) {
        throw new GameError('requirements_not_met', `You can have at most ${PLAYER_MAX_APPLICATIONS} open applications. Withdraw one first.`);
      }
      this.ts.insertApplication(tribe.id, player.id, message, t);
      return this.view(player.id, t);
    });
  }

  // ---- settings ------------------------------------------------------------------------------------

  updateSettings(player: PlayerRow, body: TribeSettingsRequest, t: number): MyTribeResponse {
    if (body.description === undefined && body.recruitment === undefined) throw invalid('Nothing to change.');
    const desc = body.description === undefined ? null : this.description(body.description);

    return this.mutate(t, () => {
      const m = this.requireMember(player, 'edit_settings');
      const tribe = this.tribeOrThrow(m.tribeId);
      const nextDesc = desc ?? tribe.description;
      const nextRec = body.recruitment ?? tribe.recruitment;
      if (nextDesc !== tribe.description) this.event(tribe.id, t, `${player.username} updated the tribe description.`);
      if (nextRec !== tribe.recruitment) this.event(tribe.id, t, `${player.username} set recruitment to ${RECRUITMENT_LABEL[nextRec]}.`);
      this.ts.updateTribeSettings(tribe.id, nextDesc, nextRec);
      return this.view(player.id, t);
    });
  }

  // ---- invitations -----------------------------------------------------------------------------------

  invite(player: PlayerRow, username: string, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'invite');
      const target = this.store.getPlayerByLowerName(username.trim().toLowerCase());
      if (!target) throw new GameError('not_found', 'No player has that name.');
      if (this.ts.membership(target.id)?.tribeId === m.tribeId) {
        throw new GameError('already_in_tribe', `${target.username} is already in your tribe.`);
      }
      // Invitations to other tribes' members are fine: they can accept once they are tribeless.
      this.ts.deleteExpiredInvitesFor(m.tribeId, target.id, t);
      if (this.ts.findInvite(m.tribeId, target.id, t)) {
        throw new GameError('requirements_not_met', `${target.username} already has an open invitation from your tribe.`);
      }
      if (this.ts.countInvitesOfTribe(m.tribeId, t) >= TRIBE_MAX_OPEN_INVITES) {
        throw new GameError('requirements_not_met', `Your tribe can have at most ${TRIBE_MAX_OPEN_INVITES} open invitations. Cancel one first.`);
      }
      this.ts.insertInvite(m.tribeId, target.id, player.id, t, t + TRIBE_INVITE_TTL_HOURS * MS_PER_HOUR);
      return this.view(player.id, t);
    });
  }

  cancelInvite(player: PlayerRow, inviteId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'invite');
      const inv = this.ts.getInvite(inviteId, t);
      if (!inv || inv.tribeId !== m.tribeId) throw new GameError('not_found', 'Invitation not found.');
      this.ts.deleteInvite(inv.id);
      return this.view(player.id, t);
    });
  }

  acceptInvite(player: PlayerRow, inviteId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const inv = this.myInvite(player, inviteId, t);
      if (this.ts.membership(player.id)) throw new GameError('already_in_tribe', 'You are already in a tribe. Leave it first.');
      this.requireRoom(inv.tribeId);
      this.ts.deleteInvite(inv.id);
      this.addMember(inv.tribeId, player.id, player.username, t, 'joined the tribe.');
      return this.view(player.id, t);
    });
  }

  declineInvite(player: PlayerRow, inviteId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      this.ts.deleteInvite(this.myInvite(player, inviteId, t).id);
      return this.view(player.id, t);
    });
  }

  // ---- applications ----------------------------------------------------------------------------------

  withdrawApplication(player: PlayerRow, applicationId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const app = this.ts.getApplication(applicationId);
      if (!app || app.playerId !== player.id) throw new GameError('not_found', 'Application not found.');
      this.ts.deleteApplication(app.id);
      return this.view(player.id, t);
    });
  }

  acceptApplication(player: PlayerRow, applicationId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'handle_applications');
      const app = this.tribeApplication(m, applicationId);
      if (this.ts.membership(app.playerId)) throw new GameError('already_in_tribe', `${app.username} is already in a tribe.`);
      this.requireRoom(m.tribeId);
      this.ts.deleteApplication(app.id);
      this.addMember(m.tribeId, app.playerId, app.username, t, `joined the tribe (accepted by ${player.username}).`);
      return this.view(player.id, t);
    });
  }

  declineApplication(player: PlayerRow, applicationId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'handle_applications');
      this.ts.deleteApplication(this.tribeApplication(m, applicationId).id);
      return this.view(player.id, t);
    });
  }

  // ---- members -----------------------------------------------------------------------------------------

  kick(player: PlayerRow, targetId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'kick');
      if (targetId === player.id) throw new GameError('invalid_target', 'Use "Leave tribe" to leave your own tribe.');
      const target = this.tribeMate(m, targetId);
      if (!canKick(m.role, target.role, m.grants)) {
        throw new GameError('forbidden', target.role === 'leader' ? "The leader can't be removed." : 'Only the leader can remove officers.');
      }
      this.ts.deleteMember(target.playerId);
      this.event(m.tribeId, t, `${this.nameOf(target.playerId)} was removed from the tribe by ${player.username}.`);
      return this.view(player.id, t);
    });
  }

  setRole(player: PlayerRow, targetId: number, role: Exclude<TribeRole, 'leader'>, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'set_roles');
      if (targetId === player.id) {
        throw new GameError('invalid_target', 'Your own role cannot be changed. To step down, hand over leadership first.');
      }
      const target = this.tribeMate(m, targetId);
      if (target.role !== role) {
        this.ts.setMemberRole(target.playerId, role);
        const name = this.nameOf(target.playerId);
        this.event(
          m.tribeId,
          t,
          role === 'officer' ? `${player.username} promoted ${name} to officer.` : `${player.username} made ${name} a regular member.`,
        );
      }
      return this.view(player.id, t);
    });
  }

  /**
   * Leader only: replace the explicit rights of one member (on top of their role). Only TRIBE_GRANTABLE rights
   * can be given. Grants stay when the role changes and are cleared when the member leaves or is removed.
   */
  setGrants(player: PlayerRow, targetId: number, rawGrants: unknown, t: number): TribeMemberDto {
    const grants = parseGrants(rawGrants);
    if (!grants) throw invalid('Grants must be a list of distinct, grantable rights.');
    return this.mutate(t, () => {
      const m = this.requireMember(player);
      if (m.role !== 'leader') throw new GameError('forbidden', 'Only the leader can change members\' rights.');
      if (targetId === player.id) throw new GameError('invalid_target', 'The leader already has every right.');
      const target = this.tribeMate(m, targetId);
      const before = target.grants.join(',');
      this.ts.setMemberGrants(target.playerId, grants);
      if (before !== grants.join(',')) {
        const name = this.nameOf(target.playerId);
        this.event(m.tribeId, t, `${player.username} ${grants.length > 0 ? `set ${name}'s extra rights to: ${grants.join(', ')}` : `removed ${name}'s extra rights`}.`);
      }
      const row = this.ts.members(m.tribeId).find((x) => x.playerId === target.playerId);
      if (!row) throw new GameError('not_found', 'That player is not in your tribe.');
      return memberDto(row, true);
    });
  }

  transfer(player: PlayerRow, targetId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'transfer_leadership');
      if (targetId === player.id) throw new GameError('invalid_target', 'You are already the leader.');
      const target = this.tribeMate(m, targetId);
      // The old leader steps down first: the database allows only one leader per tribe.
      this.ts.setMemberRole(player.id, 'officer');
      this.ts.setMemberRole(target.playerId, 'leader');
      this.event(m.tribeId, t, `${player.username} handed leadership to ${this.nameOf(target.playerId)}.`);
      return this.view(player.id, t);
    });
  }

  leave(player: PlayerRow, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player);
      const members = this.ts.memberCount(m.tribeId);
      if (members <= 1) {
        this.disbandTribe(m, t);
      } else if (m.role === 'leader') {
        throw new GameError('requirements_not_met', 'You lead this tribe. Hand over leadership to another member before you leave.');
      } else {
        this.ts.deleteMember(player.id);
        this.event(m.tribeId, t, `${player.username} left the tribe.`);
      }
      return this.view(player.id, t);
    });
  }

  disband(player: PlayerRow, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      this.disbandTribe(this.requireMember(player, 'disband'), t);
      return this.view(player.id, t);
    });
  }

  // ---- diplomacy ---------------------------------------------------------------------------------------

  /** Propose an alliance / NAP, or declare an enemy (which takes effect at once). */
  diplomacy(player: PlayerRow, rawTag: string, kind: DiplomacyKind, t: number): MyTribeResponse {
    const tag = normalizeTribeTag(rawTag);
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'diplomacy');
      const other = this.ts.getTribeByTag(tag);
      if (!other) throw new GameError('not_found', 'No tribe has that tag.');
      if (other.id === m.tribeId) throw new GameError('invalid_target', "Your tribe can't have diplomacy with itself.");
      const existing = this.ts.relationBetween(m.tribeId, other.id, t);
      const pending = this.ts.proposalBetween(m.tribeId, other.id);
      const them = `[${other.tag}]`;

      if (kind === 'enemy') {
        if (existing && existing.kind !== 'enemy') {
          throw new GameError(
            'requirements_not_met',
            `You can't declare ${them} an enemy while your ${KIND_LABEL[existing.kind]} with them is active or being cancelled.`,
          );
        }
        if (existing) throw new GameError('requirements_not_met', `Your tribe and ${them} are already enemies.`);
        if (pending) this.ts.deleteProposal(pending.id);
        this.ts.deleteRelationBetween(m.tribeId, other.id);
        this.ts.insertRelation(m.tribeId, other.id, 'enemy', m.tribeId, t, null);
        this.event(m.tribeId, t, `${player.username} declared ${them} an enemy.`);
        this.event(other.id, t, `[${m.tribeTag}] declared us an enemy.`);
        return this.view(player.id, t);
      }

      if (existing && existing.kind === kind && existing.endsAt === null) {
        throw new GameError('requirements_not_met', `Your tribe already has a ${KIND_LABEL[kind]} with ${them}.`);
      }
      if (pending) {
        throw new GameError(
          'requirements_not_met',
          pending.fromTribeId === m.tribeId
            ? `You already have a pending proposal to ${them}. Withdraw it first.`
            : `${them} has already sent you a proposal. Accept or decline it first.`,
        );
      }
      this.requireDiplomacyRoom(m.tribeId, kind, other.id, t);
      this.ts.insertProposal(kind, m.tribeId, other.id, t);
      const what = kind === 'ally' ? 'an alliance' : 'a non-aggression pact';
      this.event(m.tribeId, t, `${player.username} proposed ${what} with ${them}.`);
      this.event(other.id, t, `[${m.tribeTag}] proposed ${what} with us.`);
      return this.view(player.id, t);
    });
  }

  acceptProposal(player: PlayerRow, proposalId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'diplomacy');
      const p = this.ts.getProposal(proposalId);
      if (!p || p.toTribeId !== m.tribeId) throw new GameError('not_found', 'Proposal not found.');
      this.requireDiplomacyRoom(m.tribeId, p.kind, p.fromTribeId, t);
      this.ts.deleteProposal(p.id);
      // Replaces whatever relation the pair had (a war ends, a cancelled pact is renewed).
      this.ts.deleteRelationBetween(m.tribeId, p.fromTribeId);
      this.ts.insertRelation(m.tribeId, p.fromTribeId, p.kind, null, t, null);
      this.event(m.tribeId, t, `${player.username} accepted the ${KIND_LABEL[p.kind]} with [${p.fromTag}].`);
      this.event(p.fromTribeId, t, `[${p.toTag}] accepted our ${KIND_LABEL[p.kind]} proposal.`);
      return this.view(player.id, t);
    });
  }

  declineProposal(player: PlayerRow, proposalId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'diplomacy');
      const p = this.ts.getProposal(proposalId);
      if (!p || p.toTribeId !== m.tribeId) throw new GameError('not_found', 'Proposal not found.');
      this.ts.deleteProposal(p.id);
      this.event(m.tribeId, t, `${player.username} declined the ${KIND_LABEL[p.kind]} proposal from [${p.fromTag}].`);
      this.event(p.fromTribeId, t, `[${p.toTag}] declined our ${KIND_LABEL[p.kind]} proposal.`);
      return this.view(player.id, t);
    });
  }

  withdrawProposal(player: PlayerRow, proposalId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'diplomacy');
      const p = this.ts.getProposal(proposalId);
      if (!p || p.fromTribeId !== m.tribeId) throw new GameError('not_found', 'Proposal not found.');
      this.ts.deleteProposal(p.id);
      this.event(m.tribeId, t, `${player.username} withdrew the ${KIND_LABEL[p.kind]} proposal to [${p.toTag}].`);
      this.event(p.toTribeId, t, `[${p.fromTag}] withdrew their ${KIND_LABEL[p.kind]} proposal.`);
      return this.view(player.id, t);
    });
  }

  /** End a war at once; an alliance / NAP starts its notice period and keeps protecting until it runs out. */
  cancelRelation(player: PlayerRow, relationId: number, t: number): MyTribeResponse {
    return this.mutate(t, () => {
      const m = this.requireMember(player, 'diplomacy');
      const r = this.ts.getRelation(relationId);
      if (!r || (r.tribeA !== m.tribeId && r.tribeB !== m.tribeId) || (r.endsAt !== null && r.endsAt <= t)) {
        throw new GameError('not_found', 'Relation not found.');
      }
      const otherId = r.tribeA === m.tribeId ? r.tribeB : r.tribeA;
      const other = this.tribeOrThrow(otherId);
      const label = KIND_LABEL[r.kind];

      if (r.kind === 'enemy') {
        this.ts.deleteRelation(r.id);
        this.event(m.tribeId, t, `${player.username} ended the war with [${other.tag}].`);
        this.event(other.id, t, `[${m.tribeTag}] ended the war with us.`);
      } else {
        if (r.endsAt !== null) {
          throw new GameError('requirements_not_met', `This ${label} is already being cancelled. It ends ${fmtUtc(r.endsAt)}.`);
        }
        const endsAt = t + pactNoticeMs(this.settings);
        this.ts.setRelationEnds(r.id, endsAt);
        this.event(m.tribeId, t, `${player.username} cancelled the ${label} with [${other.tag}]. It still protects both tribes until ${fmtUtc(endsAt)}.`);
        this.event(other.id, t, `[${m.tribeTag}] cancelled our ${label}. It still protects both tribes until ${fmtUtc(endsAt)}.`);
      }
      return this.view(player.id, t);
    });
  }

  // ---- chat --------------------------------------------------------------------------------------------

  /** Messages with id > `after` (max 100, oldest first), or the last 100 when `after` is null. */
  chatList(player: PlayerRow, after: number | null): ChatResponse {
    const m = this.requireMember(player, 'chat');
    const rows = after === null ? this.ts.lastMessages(m.tribeId, CHAT_PAGE) : this.ts.messagesAfter(m.tribeId, after, CHAT_PAGE);
    return { messages: rows.map((r) => ({ id: r.id, playerId: r.playerId, username: r.username, chieftain: r.chieftain, text: r.text, createdAt: r.createdAt })) };
  }

  chatPost(player: PlayerRow, rawText: string, t: number): ChatMessageDto {
    const text = cleanText(rawText, 'The message');
    const n = len(text);
    if (n < 1 || n > TRIBE_CHAT_MESSAGE_MAX) throw invalid(`A chat message needs 1 to ${TRIBE_CHAT_MESSAGE_MAX} characters.`);

    return this.store.tx(() => {
      const m = this.requireMember(player, 'chat');
      if (!this.chatLimiter.allow(player.id, t)) {
        throw new GameError('rate_limited', 'You are sending messages too fast. Please slow down.');
      }
      const id = this.ts.insertMessage(m.tribeId, player.id, text, t, TRIBE_CHAT_KEEP);
      return { id, playerId: player.id, username: player.username, chieftain: player.chieftain, text, createdAt: t };
    });
  }

  // ---- internals: guards -------------------------------------------------------------------------------

  /** Run a mutation in one transaction, after cleaning up expired invitations and relations. */
  private mutate<T>(t: number, fn: () => T): T {
    return this.store.tx(() => {
      this.purgeExpired(t);
      return fn();
    });
  }

  /** The caller's membership (re-read inside the transaction), optionally checked against a permission. */
  private requireMember(player: PlayerRow, action?: TribeAction): MembershipRow {
    const m = this.ts.membership(player.id);
    if (!m) throw new GameError('not_in_tribe', 'You are not in a tribe.');
    if (action && !canTribe(m.role, action, m.grants)) throw new GameError('forbidden', DENIED[action]);
    return m;
  }

  private tribeOrThrow(id: number): TribeRow {
    const tribe = this.ts.getTribe(id);
    if (!tribe) throw new GameError('not_found', 'Tribe not found.');
    return tribe;
  }

  private requireRoom(tribeId: number): void {
    if (this.ts.memberCount(tribeId) >= TRIBE_MAX_MEMBERS) {
      throw new GameError('tribe_full', `This tribe is full (${TRIBE_MAX_MEMBERS} members).`);
    }
  }

  /** Active relations of this kind + pending outgoing proposals must stay below the cap. */
  private requireDiplomacyRoom(tribeId: number, kind: DiplomacyKind, otherId: number, t: number): void {
    if (kind === 'enemy') return;
    const max = kind === 'ally' ? TRIBE_MAX_ALLIES : TRIBE_MAX_NAPS;
    const used = this.ts.countActiveRelations(tribeId, kind, t, otherId) + this.ts.countOutgoingProposals(tribeId, kind);
    if (used >= max) {
      throw new GameError(
        'requirements_not_met',
        `A tribe can have at most ${max} ${kind === 'ally' ? 'allies' : 'non-aggression pacts'}, counting pending proposals. Cancel one first.`,
      );
    }
  }

  private myInvite(player: PlayerRow, inviteId: number, t: number): InviteRow {
    const inv = this.ts.getInvite(inviteId, t);
    if (!inv || inv.playerId !== player.id) throw new GameError('not_found', 'That invitation has expired or no longer exists.');
    return inv;
  }

  private tribeApplication(m: MembershipRow, applicationId: number): ApplicationRow {
    const app = this.ts.getApplication(applicationId);
    if (!app || app.tribeId !== m.tribeId) throw new GameError('not_found', 'Application not found.');
    return app;
  }

  /** Another member of the caller's tribe. */
  private tribeMate(m: MembershipRow, playerId: number): MembershipRow {
    const target = this.ts.membership(playerId);
    if (!target || target.tribeId !== m.tribeId) throw new GameError('not_found', 'That player is not in your tribe.');
    return target;
  }

  private nameOf(playerId: number): string {
    return this.store.getPlayer(playerId)?.username ?? 'someone';
  }

  private description(raw: string): string {
    const checked = checkTribeDescription(cleanText(raw, 'The description'));
    if (!checked.ok) throw new GameError(checked.reason, checked.message);
    return checked.text;
  }

  // ---- internals: writes -------------------------------------------------------------------------------

  private event(tribeId: number, t: number, text: string): void {
    this.ts.insertEvent(tribeId, t, text, TRIBE_EVENTS_KEEP);
  }

  /** Every way into a tribe ends here: one tribe per player, and other applications are withdrawn. */
  private addMember(tribeId: number, playerId: number, username: string, t: number, what: string): void {
    this.ts.insertMember(playerId, tribeId, 'member', t);
    this.ts.deleteApplicationsOfPlayer(playerId);
    this.event(tribeId, t, `${username} ${what}`);
  }

  /** Delete the tribe (everything hanging off it goes with it) and tell the tribes it had relations with. */
  private disbandTribe(m: MembershipRow, t: number): void {
    for (const r of this.ts.relationsOfTribe(m.tribeId, t)) {
      this.event(r.otherId, t, `[${m.tribeTag}] was disbanded, so our ${KIND_LABEL[r.kind]} with them is over.`);
    }
    this.ts.deleteTribe(m.tribeId);
  }

  /** Delete expired invitations and relations (they are ignored on read anyway) and log the ended pacts. */
  private purgeExpired(t: number): void {
    const expired = this.ts.expiredRelations(t);
    if (expired.length === 0 && !this.ts.hasExpiredInvites(t)) return;
    this.store.tx(() => {
      for (const r of expired) {
        const when = r.endsAt ?? t;
        this.ts.insertEvent(r.tribeA, when, `Our ${KIND_LABEL[r.kind]} with [${r.tagB}] has ended.`, TRIBE_EVENTS_KEEP);
        this.ts.insertEvent(r.tribeB, when, `Our ${KIND_LABEL[r.kind]} with [${r.tagA}] has ended.`, TRIBE_EVENTS_KEEP);
        this.ts.deleteRelation(r.id);
      }
      this.ts.deleteExpiredInvites(t);
    });
  }

  /**
   * Re-derive the points of the player's villages from their settled state (building levels change lazily).
   * Returns the highest Town Hall level, which founding needs.
   */
  private refreshPoints(playerId: number, t: number): number {
    let hall = 0;
    for (const v of this.store.villagesOfPlayer(playerId)) {
      const settled = settleVillage(v.state, t, this.settings);
      const points = villagePoints(settled);
      if (points !== v.points) this.store.setPoints(v.id, points);
      hall = Math.max(hall, settled.buildings.hall);
    }
    return hall;
  }

  // ---- internals: views --------------------------------------------------------------------------------

  private summary(r: RankedTribeRow, rank: number): TribeSummaryDto {
    return { id: r.id, name: r.name, tag: r.tag, members: r.members, points: r.points, villages: r.villages, recruitment: r.recruitment, rank };
  }

  /** `withGrants`: include each member's explicit grants (only for the tribe's own members). */
  private tribeDto(tribeId: number, t: number, withGrants = false): TribeDto {
    const tribe = this.tribeOrThrow(tribeId);
    const ranking = this.ts.ranking();
    const index = ranking.findIndex((r) => r.id === tribeId);
    const ranked = ranking[index];
    if (!ranked) throw new GameError('not_found', 'Tribe not found.');
    const memberList: TribeMemberDto[] = this.ts
      .members(tribeId)
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || b.points - a.points || a.joinedAt - b.joinedAt || a.playerId - b.playerId)
      .map((x) => ({
        playerId: x.playerId,
        username: x.username,
        chieftain: x.chieftain,
        role: x.role,
        points: x.points,
        villageX: x.villageX,
        villageY: x.villageY,
        joinedAt: x.joinedAt,
        ...(withGrants ? { grants: x.grants } : {}),
      }));
    return {
      ...this.summary(ranked, index + 1),
      description: tribe.description,
      createdAt: tribe.createdAt,
      members: memberList.length,
      memberList,
      relations: this.ts.relationsOfTribe(tribeId, t).map((r) => relationDto(r, tribeId)),
    };
  }

  private view(playerId: number, t: number): MyTribeResponse {
    const m = this.ts.membership(playerId);
    if (!m) {
      return {
        tribe: null,
        role: null,
        invites: this.ts.invitesForPlayer(playerId, t).map(inviteDto),
        applications: this.ts.applicationsOfPlayer(playerId).map(applicationDto),
        proposals: [],
        events: [],
        rights: [],
        forumUnread: 0,
      };
    }
    return {
      tribe: this.tribeDto(m.tribeId, t, true),
      role: m.role,
      invites: canTribe(m.role, 'invite', m.grants) ? this.ts.invitesOfTribe(m.tribeId, t).map(inviteDto) : [],
      applications: canTribe(m.role, 'handle_applications', m.grants) ? this.ts.applicationsOfTribe(m.tribeId).map(applicationDto) : [],
      proposals: this.ts.proposalsOfTribe(m.tribeId).map((p) => proposalDto(p, m.tribeId)),
      events: this.ts.events(m.tribeId, EVENTS_SHOWN).map((e): TribeEventDto => ({ id: e.id, createdAt: e.createdAt, text: e.text })),
      rights: effectiveRights(m.role, m.grants),
      forumUnread: this.store.forum.unreadCount(playerId, m.tribeId, seesLeadershipBoards(m.role, m.grants)),
    };
  }
}

function memberDto(x: MemberRow, withGrants: boolean): TribeMemberDto {
  return {
    playerId: x.playerId,
    username: x.username,
    chieftain: x.chieftain,
    role: x.role,
    points: x.points,
    villageX: x.villageX,
    villageY: x.villageY,
    joinedAt: x.joinedAt,
    ...(withGrants ? { grants: x.grants } : {}),
  };
}

function inviteDto(i: InviteRow): TribeInviteDto {
  return {
    id: i.id,
    tribe: { id: i.tribeId, name: i.tribeName, tag: i.tribeTag },
    playerId: i.playerId,
    username: i.username,
    invitedBy: i.invitedBy,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
  };
}

function applicationDto(a: ApplicationRow): TribeApplicationDto {
  return {
    id: a.id,
    tribe: { id: a.tribeId, name: a.tribeName, tag: a.tribeTag },
    playerId: a.playerId,
    username: a.username,
    points: a.points,
    message: a.message,
    createdAt: a.createdAt,
  };
}

function proposalDto(p: ProposalRow, myTribeId: number): DiplomacyProposalDto {
  const outgoing = p.fromTribeId === myTribeId;
  return {
    id: p.id,
    kind: p.kind,
    direction: outgoing ? 'outgoing' : 'incoming',
    other: outgoing ? { id: p.toTribeId, name: p.toName, tag: p.toTag } : { id: p.fromTribeId, name: p.fromName, tag: p.fromTag },
    createdAt: p.createdAt,
  };
}

function relationDto(r: RelationSideRow, myTribeId: number): TribeRelationDto {
  return {
    id: r.id,
    kind: r.kind,
    other: { id: r.otherId, name: r.otherName, tag: r.otherTag },
    since: r.createdAt,
    endsAt: r.endsAt,
    declaredByUs: r.kind === 'enemy' && r.declaredBy === myTribeId,
  };
}
