// SQL for the tribe tables: prepared statements with bound parameters only. Rules live in tribe-service.ts.
// Expired invites and relations are filtered out by every read here ("ignored on read") and deleted lazily.

import type { DiplomacyKind, PlayerTribeDto, Recruitment, TribeRole } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface TribeRow {
  id: number;
  name: string;
  tag: string;
  description: string;
  recruitment: Recruitment;
  createdAt: number;
}

/** A player's place in a tribe, with the tribe's name and tag. */
export interface MembershipRow {
  playerId: number;
  tribeId: number;
  role: TribeRole;
  joinedAt: number;
  tribeName: string;
  tribeTag: string;
}

export interface MemberRow {
  playerId: number;
  username: string;
  chieftain: string;
  role: TribeRole;
  joinedAt: number;
  points: number;
  villageX: number;
  villageY: number;
}

export interface RankedTribeRow {
  id: number;
  name: string;
  tag: string;
  recruitment: Recruitment;
  createdAt: number;
  members: number;
  points: number;
}

export interface InviteRow {
  id: number;
  tribeId: number;
  tribeName: string;
  tribeTag: string;
  playerId: number;
  username: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApplicationRow {
  id: number;
  tribeId: number;
  tribeName: string;
  tribeTag: string;
  playerId: number;
  username: string;
  points: number;
  message: string;
  createdAt: number;
}

export interface ProposalRow {
  id: number;
  kind: 'ally' | 'nap';
  fromTribeId: number;
  toTribeId: number;
  createdAt: number;
  fromName: string;
  fromTag: string;
  toName: string;
  toTag: string;
}

/** One row per unordered pair; `tribeA < tribeB`. */
export interface RelationRow {
  id: number;
  tribeA: number;
  tribeB: number;
  kind: DiplomacyKind;
  /** The declaring tribe, for enemy relations only. */
  declaredBy: number | null;
  createdAt: number;
  endsAt: number | null;
}

/** A relation seen from one tribe's side. */
export interface RelationSideRow extends RelationRow {
  otherId: number;
  otherName: string;
  otherTag: string;
}

export interface ExpiredRelationRow extends RelationRow {
  nameA: string;
  tagA: string;
  nameB: string;
  tagB: string;
}

export interface EventRow {
  id: number;
  createdAt: number;
  text: string;
}

export interface MessageRow {
  id: number;
  playerId: number;
  username: string;
  chieftain: string;
  text: string;
  createdAt: number;
}

function toTribe(r: Raw): TribeRow {
  return {
    id: r.id as number,
    name: r.name as string,
    tag: r.tag as string,
    description: r.description as string,
    recruitment: r.recruitment as Recruitment,
    createdAt: r.created_at as number,
  };
}

function toMembership(r: Raw): MembershipRow {
  return {
    playerId: r.player_id as number,
    tribeId: r.tribe_id as number,
    role: r.role as TribeRole,
    joinedAt: r.joined_at as number,
    tribeName: r.tribe_name as string,
    tribeTag: r.tribe_tag as string,
  };
}

function toInvite(r: Raw): InviteRow {
  return {
    id: r.id as number,
    tribeId: r.tribe_id as number,
    tribeName: r.tribe_name as string,
    tribeTag: r.tribe_tag as string,
    playerId: r.player_id as number,
    username: r.username as string,
    invitedBy: r.invited_by_name as string,
    createdAt: r.created_at as number,
    expiresAt: r.expires_at as number,
  };
}

function toApplication(r: Raw): ApplicationRow {
  return {
    id: r.id as number,
    tribeId: r.tribe_id as number,
    tribeName: r.tribe_name as string,
    tribeTag: r.tribe_tag as string,
    playerId: r.player_id as number,
    username: r.username as string,
    points: r.points as number,
    message: r.message as string,
    createdAt: r.created_at as number,
  };
}

function toProposal(r: Raw): ProposalRow {
  return {
    id: r.id as number,
    kind: r.kind as 'ally' | 'nap',
    fromTribeId: r.from_tribe_id as number,
    toTribeId: r.to_tribe_id as number,
    createdAt: r.created_at as number,
    fromName: r.from_name as string,
    fromTag: r.from_tag as string,
    toName: r.to_name as string,
    toTag: r.to_tag as string,
  };
}

function toRelation(r: Raw): RelationRow {
  return {
    id: r.id as number,
    tribeA: r.tribe_a as number,
    tribeB: r.tribe_b as number,
    kind: r.kind as DiplomacyKind,
    declaredBy: (r.declared_by as number | null) ?? null,
    createdAt: r.created_at as number,
    endsAt: (r.ends_at as number | null) ?? null,
  };
}

const INVITE_SQL = `
SELECT i.id, i.tribe_id, t.name AS tribe_name, t.tag AS tribe_tag, i.player_id, p.username,
       b.username AS invited_by_name, i.created_at, i.expires_at
FROM tribe_invites i
JOIN tribes t  ON t.id = i.tribe_id
JOIN players p ON p.id = i.player_id
JOIN players b ON b.id = i.invited_by`;

const APPLICATION_SQL = `
SELECT a.id, a.tribe_id, t.name AS tribe_name, t.tag AS tribe_tag, a.player_id, p.username, a.message, a.created_at,
       (SELECT COALESCE(SUM(v.points), 0) FROM villages v WHERE v.owner_id = a.player_id) AS points
FROM tribe_applications a
JOIN tribes t  ON t.id = a.tribe_id
JOIN players p ON p.id = a.player_id`;

const PROPOSAL_SQL = `
SELECT q.id, q.kind, q.from_tribe_id, q.to_tribe_id, q.created_at,
       f.name AS from_name, f.tag AS from_tag, o.name AS to_name, o.tag AS to_tag
FROM tribe_proposals q
JOIN tribes f ON f.id = q.from_tribe_id
JOIN tribes o ON o.id = q.to_tribe_id`;

const MEMBERSHIP_SQL = `
SELECT m.player_id, m.tribe_id, m.role, m.joined_at, t.name AS tribe_name, t.tag AS tribe_tag
FROM tribe_members m JOIN tribes t ON t.id = m.tribe_id`;

const ACTIVE = '(r.ends_at IS NULL OR r.ends_at > ?)';

export class TribeStore extends SqlBase {
  // ---- tribes ----------------------------------------------------------------------------------

  insertTribe(name: string, tag: string, description: string, recruitment: Recruitment, createdAt: number): number {
    return this.run(
      'INSERT INTO tribes (name, name_lower, tag, description, recruitment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      name,
      name.toLowerCase(),
      tag,
      description,
      recruitment,
      createdAt,
    ).id;
  }

  getTribe(id: number): TribeRow | null {
    const r = this.get('SELECT * FROM tribes WHERE id = ?', id);
    return r ? toTribe(r) : null;
  }

  getTribeByName(name: string): TribeRow | null {
    const r = this.get('SELECT * FROM tribes WHERE name_lower = ?', name.toLowerCase());
    return r ? toTribe(r) : null;
  }

  getTribeByTag(tag: string): TribeRow | null {
    const r = this.get('SELECT * FROM tribes WHERE tag = ?', tag);
    return r ? toTribe(r) : null;
  }

  updateTribeSettings(id: number, description: string, recruitment: Recruitment): void {
    this.run('UPDATE tribes SET description = ?, recruitment = ? WHERE id = ?', description, recruitment, id);
  }

  /** Cascades to members, invites, applications, proposals, relations, events and chat. */
  deleteTribe(id: number): void {
    this.run('DELETE FROM tribes WHERE id = ?', id);
  }

  /** Every tribe with its member count and points, best first (ties: the older tribe). Rank = index + 1. */
  ranking(): RankedTribeRow[] {
    return this.all(
      `SELECT t.id, t.name, t.tag, t.recruitment, t.created_at,
              COUNT(DISTINCT m.player_id) AS members, COALESCE(SUM(v.points), 0) AS total_points
       FROM tribes t
       LEFT JOIN tribe_members m ON m.tribe_id = t.id
       LEFT JOIN villages v ON v.owner_id = m.player_id
       GROUP BY t.id
       ORDER BY total_points DESC, t.created_at ASC, t.id ASC`,
    ).map((r) => ({
      id: r.id as number,
      name: r.name as string,
      tag: r.tag as string,
      recruitment: r.recruitment as Recruitment,
      createdAt: r.created_at as number,
      members: r.members as number,
      points: r.total_points as number,
    }));
  }

  // ---- members ---------------------------------------------------------------------------------

  membership(playerId: number): MembershipRow | null {
    const r = this.get(`${MEMBERSHIP_SQL} WHERE m.player_id = ?`, playerId);
    return r ? toMembership(r) : null;
  }

  /** The PlayerDto.tribe value for a player. */
  playerTribe(playerId: number): PlayerTribeDto | null {
    const m = this.membership(playerId);
    return m ? { id: m.tribeId, name: m.tribeName, tag: m.tribeTag, role: m.role } : null;
  }

  insertMember(playerId: number, tribeId: number, role: TribeRole, joinedAt: number): void {
    this.run('INSERT INTO tribe_members (player_id, tribe_id, role, joined_at) VALUES (?, ?, ?, ?)', playerId, tribeId, role, joinedAt);
  }

  setMemberRole(playerId: number, role: TribeRole): void {
    this.run('UPDATE tribe_members SET role = ? WHERE player_id = ?', role, playerId);
  }

  deleteMember(playerId: number): void {
    this.run('DELETE FROM tribe_members WHERE player_id = ?', playerId);
  }

  memberCount(tribeId: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM tribe_members WHERE tribe_id = ?', tribeId);
    return r ? (r.n as number) : 0;
  }

  members(tribeId: number): MemberRow[] {
    return this.all(
      `SELECT m.player_id, p.username, p.chieftain, m.role, m.joined_at,
              (SELECT COALESCE(SUM(v.points), 0) FROM villages v WHERE v.owner_id = m.player_id) AS points,
              COALESCE((SELECT v.x FROM villages v WHERE v.owner_id = m.player_id ORDER BY v.id LIMIT 1), 0) AS vx,
              COALESCE((SELECT v.y FROM villages v WHERE v.owner_id = m.player_id ORDER BY v.id LIMIT 1), 0) AS vy
       FROM tribe_members m JOIN players p ON p.id = m.player_id
       WHERE m.tribe_id = ?`,
      tribeId,
    ).map((r) => ({
      playerId: r.player_id as number,
      username: r.username as string,
      chieftain: r.chieftain as string,
      role: r.role as TribeRole,
      joinedAt: r.joined_at as number,
      points: r.points as number,
      villageX: r.vx as number,
      villageY: r.vy as number,
    }));
  }

  // ---- invites ---------------------------------------------------------------------------------

  insertInvite(tribeId: number, playerId: number, invitedBy: number, createdAt: number, expiresAt: number): number {
    return this.run(
      'INSERT INTO tribe_invites (tribe_id, player_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      tribeId,
      playerId,
      invitedBy,
      createdAt,
      expiresAt,
    ).id;
  }

  /** An open (unexpired) invitation by id. */
  getInvite(id: number, now: number): InviteRow | null {
    const r = this.get(`${INVITE_SQL} WHERE i.id = ? AND i.expires_at > ?`, id, now);
    return r ? toInvite(r) : null;
  }

  findInvite(tribeId: number, playerId: number, now: number): InviteRow | null {
    const r = this.get(`${INVITE_SQL} WHERE i.tribe_id = ? AND i.player_id = ? AND i.expires_at > ?`, tribeId, playerId, now);
    return r ? toInvite(r) : null;
  }

  invitesOfTribe(tribeId: number, now: number): InviteRow[] {
    return this.all(`${INVITE_SQL} WHERE i.tribe_id = ? AND i.expires_at > ? ORDER BY i.id DESC`, tribeId, now).map(toInvite);
  }

  invitesForPlayer(playerId: number, now: number): InviteRow[] {
    return this.all(`${INVITE_SQL} WHERE i.player_id = ? AND i.expires_at > ? ORDER BY i.id DESC`, playerId, now).map(toInvite);
  }

  countInvitesOfTribe(tribeId: number, now: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM tribe_invites WHERE tribe_id = ? AND expires_at > ?', tribeId, now);
    return r ? (r.n as number) : 0;
  }

  countInvitesForPlayer(playerId: number, now: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM tribe_invites WHERE player_id = ? AND expires_at > ?', playerId, now);
    return r ? (r.n as number) : 0;
  }

  deleteInvite(id: number): void {
    this.run('DELETE FROM tribe_invites WHERE id = ?', id);
  }

  /** Remove an expired invitation row for this pair, so a fresh invitation can be inserted. */
  deleteExpiredInvitesFor(tribeId: number, playerId: number, now: number): void {
    this.run('DELETE FROM tribe_invites WHERE tribe_id = ? AND player_id = ? AND expires_at <= ?', tribeId, playerId, now);
  }

  hasExpiredInvites(now: number): boolean {
    return this.get('SELECT 1 AS one FROM tribe_invites WHERE expires_at <= ? LIMIT 1', now) !== undefined;
  }

  deleteExpiredInvites(now: number): void {
    this.run('DELETE FROM tribe_invites WHERE expires_at <= ?', now);
  }

  // ---- applications ----------------------------------------------------------------------------

  insertApplication(tribeId: number, playerId: number, message: string, createdAt: number): number {
    return this.run('INSERT INTO tribe_applications (tribe_id, player_id, message, created_at) VALUES (?, ?, ?, ?)', tribeId, playerId, message, createdAt).id;
  }

  getApplication(id: number): ApplicationRow | null {
    const r = this.get(`${APPLICATION_SQL} WHERE a.id = ?`, id);
    return r ? toApplication(r) : null;
  }

  findApplication(tribeId: number, playerId: number): ApplicationRow | null {
    const r = this.get(`${APPLICATION_SQL} WHERE a.tribe_id = ? AND a.player_id = ?`, tribeId, playerId);
    return r ? toApplication(r) : null;
  }

  applicationsOfTribe(tribeId: number): ApplicationRow[] {
    return this.all(`${APPLICATION_SQL} WHERE a.tribe_id = ? ORDER BY a.id`, tribeId).map(toApplication);
  }

  applicationsOfPlayer(playerId: number): ApplicationRow[] {
    return this.all(`${APPLICATION_SQL} WHERE a.player_id = ? ORDER BY a.id`, playerId).map(toApplication);
  }

  countApplicationsOfPlayer(playerId: number): number {
    const r = this.get('SELECT COUNT(*) AS n FROM tribe_applications WHERE player_id = ?', playerId);
    return r ? (r.n as number) : 0;
  }

  deleteApplication(id: number): void {
    this.run('DELETE FROM tribe_applications WHERE id = ?', id);
  }

  deleteApplicationsOfPlayer(playerId: number): void {
    this.run('DELETE FROM tribe_applications WHERE player_id = ?', playerId);
  }

  // ---- proposals -------------------------------------------------------------------------------

  insertProposal(kind: 'ally' | 'nap', fromTribeId: number, toTribeId: number, createdAt: number): number {
    return this.run('INSERT INTO tribe_proposals (kind, from_tribe_id, to_tribe_id, created_at) VALUES (?, ?, ?, ?)', kind, fromTribeId, toTribeId, createdAt).id;
  }

  getProposal(id: number): ProposalRow | null {
    const r = this.get(`${PROPOSAL_SQL} WHERE q.id = ?`, id);
    return r ? toProposal(r) : null;
  }

  /** The pending proposal between two tribes, in either direction. */
  proposalBetween(x: number, y: number): ProposalRow | null {
    const r = this.get(`${PROPOSAL_SQL} WHERE (q.from_tribe_id = ? AND q.to_tribe_id = ?) OR (q.from_tribe_id = ? AND q.to_tribe_id = ?)`, x, y, y, x);
    return r ? toProposal(r) : null;
  }

  proposalsOfTribe(tribeId: number): ProposalRow[] {
    return this.all(`${PROPOSAL_SQL} WHERE q.from_tribe_id = ? OR q.to_tribe_id = ? ORDER BY q.id DESC`, tribeId, tribeId).map(toProposal);
  }

  countOutgoingProposals(tribeId: number, kind: 'ally' | 'nap'): number {
    const r = this.get('SELECT COUNT(*) AS n FROM tribe_proposals WHERE from_tribe_id = ? AND kind = ?', tribeId, kind);
    return r ? (r.n as number) : 0;
  }

  deleteProposal(id: number): void {
    this.run('DELETE FROM tribe_proposals WHERE id = ?', id);
  }

  // ---- relations -------------------------------------------------------------------------------

  insertRelation(x: number, y: number, kind: DiplomacyKind, declaredBy: number | null, createdAt: number, endsAt: number | null): number {
    const [a, b] = x < y ? [x, y] : [y, x];
    return this.run(
      'INSERT INTO tribe_relations (tribe_a, tribe_b, kind, declared_by, created_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)',
      a,
      b,
      kind,
      declaredBy,
      createdAt,
      endsAt,
    ).id;
  }

  getRelation(id: number): RelationRow | null {
    const r = this.get('SELECT * FROM tribe_relations WHERE id = ?', id);
    return r ? toRelation(r) : null;
  }

  /** The relation between two tribes that is in force at `at` (not yet past its notice end). */
  relationBetween(x: number, y: number, at: number): RelationRow | null {
    const [a, b] = x < y ? [x, y] : [y, x];
    const r = this.get(`SELECT * FROM tribe_relations r WHERE r.tribe_a = ? AND r.tribe_b = ? AND ${ACTIVE}`, a, b, at);
    return r ? toRelation(r) : null;
  }

  /** The tribe's relations in force at `at`, with the other tribe's name and tag. */
  relationsOfTribe(tribeId: number, at: number): RelationSideRow[] {
    return this.all(
      `SELECT r.*, o.id AS other_id, o.name AS other_name, o.tag AS other_tag
       FROM tribe_relations r
       JOIN tribes o ON o.id = CASE WHEN r.tribe_a = ? THEN r.tribe_b ELSE r.tribe_a END
       WHERE (r.tribe_a = ? OR r.tribe_b = ?) AND ${ACTIVE}
       ORDER BY r.id`,
      tribeId,
      tribeId,
      tribeId,
      at,
    ).map((r) => ({
      ...toRelation(r),
      otherId: r.other_id as number,
      otherName: r.other_name as string,
      otherTag: r.other_tag as string,
    }));
  }

  /** other tribe id -> relation kind, for one tribe. One query, used once per map request. */
  relationKindsOf(tribeId: number, at: number): Map<number, DiplomacyKind> {
    const rows = this.all(
      `SELECT CASE WHEN r.tribe_a = ? THEN r.tribe_b ELSE r.tribe_a END AS other_id, r.kind
       FROM tribe_relations r
       WHERE (r.tribe_a = ? OR r.tribe_b = ?) AND ${ACTIVE}`,
      tribeId,
      tribeId,
      tribeId,
      at,
    );
    return new Map(rows.map((r) => [r.other_id as number, r.kind as DiplomacyKind]));
  }

  /** Ally/NAP relations of this kind in force (incl. serving notice), not counting the one with `exceptOther`. */
  countActiveRelations(tribeId: number, kind: DiplomacyKind, at: number, exceptOther: number): number {
    const r = this.get(
      `SELECT COUNT(*) AS n FROM tribe_relations r
       WHERE (r.tribe_a = ? OR r.tribe_b = ?) AND r.kind = ? AND ${ACTIVE}
         AND (CASE WHEN r.tribe_a = ? THEN r.tribe_b ELSE r.tribe_a END) <> ?`,
      tribeId,
      tribeId,
      kind,
      at,
      tribeId,
      exceptOther,
    );
    return r ? (r.n as number) : 0;
  }

  setRelationEnds(id: number, endsAt: number): void {
    this.run('UPDATE tribe_relations SET ends_at = ? WHERE id = ?', endsAt, id);
  }

  deleteRelation(id: number): void {
    this.run('DELETE FROM tribe_relations WHERE id = ?', id);
  }

  /** Delete whatever relation row exists for the pair (in force or already expired). */
  deleteRelationBetween(x: number, y: number): void {
    const [a, b] = x < y ? [x, y] : [y, x];
    this.run('DELETE FROM tribe_relations WHERE tribe_a = ? AND tribe_b = ?', a, b);
  }

  expiredRelations(at: number): ExpiredRelationRow[] {
    return this.all(
      `SELECT r.*, a.name AS name_a, a.tag AS tag_a, b.name AS name_b, b.tag AS tag_b
       FROM tribe_relations r
       JOIN tribes a ON a.id = r.tribe_a
       JOIN tribes b ON b.id = r.tribe_b
       WHERE r.ends_at IS NOT NULL AND r.ends_at <= ?`,
      at,
    ).map((r) => ({
      ...toRelation(r),
      nameA: r.name_a as string,
      tagA: r.tag_a as string,
      nameB: r.name_b as string,
      tagB: r.tag_b as string,
    }));
  }

  // ---- events ----------------------------------------------------------------------------------

  /** Add a log line and drop the oldest beyond `keep`. */
  insertEvent(tribeId: number, createdAt: number, text: string, keep: number): void {
    this.run('INSERT INTO tribe_events (tribe_id, created_at, text) VALUES (?, ?, ?)', tribeId, createdAt, text);
    this.run(
      `DELETE FROM tribe_events WHERE tribe_id = ?
         AND id <= COALESCE((SELECT id FROM tribe_events WHERE tribe_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`,
      tribeId,
      tribeId,
      keep,
    );
  }

  /** Newest first. */
  events(tribeId: number, limit: number): EventRow[] {
    return this.all('SELECT id, created_at, text FROM tribe_events WHERE tribe_id = ? ORDER BY id DESC LIMIT ?', tribeId, limit).map((r) => ({
      id: r.id as number,
      createdAt: r.created_at as number,
      text: r.text as string,
    }));
  }

  // ---- chat ------------------------------------------------------------------------------------

  /** Add a chat message and drop the oldest beyond `keep`. */
  insertMessage(tribeId: number, playerId: number, text: string, createdAt: number, keep: number): number {
    const id = this.run('INSERT INTO tribe_messages (tribe_id, player_id, text, created_at) VALUES (?, ?, ?, ?)', tribeId, playerId, text, createdAt).id;
    this.run(
      `DELETE FROM tribe_messages WHERE tribe_id = ?
         AND id <= COALESCE((SELECT id FROM tribe_messages WHERE tribe_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?), 0)`,
      tribeId,
      tribeId,
      keep,
    );
    return id;
  }

  /** Messages with id > `after`, oldest first. */
  messagesAfter(tribeId: number, after: number, limit: number): MessageRow[] {
    return this.all(
      `SELECT c.id, c.player_id, p.username, p.chieftain, c.text, c.created_at
       FROM tribe_messages c JOIN players p ON p.id = c.player_id
       WHERE c.tribe_id = ? AND c.id > ? ORDER BY c.id ASC LIMIT ?`,
      tribeId,
      after,
      limit,
    ).map(toMessage);
  }

  /** The newest `limit` messages, oldest first. */
  lastMessages(tribeId: number, limit: number): MessageRow[] {
    return this.all(
      `SELECT * FROM (
         SELECT c.id, c.player_id, p.username, p.chieftain, c.text, c.created_at
         FROM tribe_messages c JOIN players p ON p.id = c.player_id
         WHERE c.tribe_id = ? ORDER BY c.id DESC LIMIT ?
       ) ORDER BY id ASC`,
      tribeId,
      limit,
    ).map(toMessage);
  }

  getMessage(id: number): MessageRow | null {
    const r = this.get(
      `SELECT c.id, c.player_id, p.username, p.chieftain, c.text, c.created_at
       FROM tribe_messages c JOIN players p ON p.id = c.player_id WHERE c.id = ?`,
      id,
    );
    return r ? toMessage(r) : null;
  }

  // ---- points ----------------------------------------------------------------------------------

  /** Sum of the player's villages' cached points. */
  playerPoints(playerId: number): number {
    const r = this.get('SELECT COALESCE(SUM(points), 0) AS n FROM villages WHERE owner_id = ?', playerId);
    return r ? (r.n as number) : 0;
  }
}

function toMessage(r: Raw): MessageRow {
  return {
    id: r.id as number,
    playerId: r.player_id as number,
    username: r.username as string,
    chieftain: r.chieftain as string,
    text: r.text as string,
    createdAt: r.created_at as number,
  };
}
