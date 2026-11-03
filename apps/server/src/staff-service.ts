// Staff moderation: player lookup, mute / unmute / ban / unban / warn, audit log reads. Every action is checked
// against the staff member's role (re-read from the database on each request), written to the audit log, and runs
// in one transaction. Staff can never act on themselves or on someone of equal or higher rank.

import {
  AUDIT_PAGE_MAX,
  GameError,
  MOD_REASON_MAX,
  MUTE_MAX_MINUTES,
  PLAYER_SEARCH_MAX,
  staffRank,
  type AuditEntryDto,
  type AuditListResponse,
  type BanRequest,
  type ModerationNoteRequest,
  type MuteRequest,
  type StaffMeResponse,
  type StaffPlayerDetailDto,
  type StaffPlayerListResponse,
  type WarnRequest,
} from '@clanfire/engine';
import type { AuditFilter, AuditRow, PlayerLookupRow } from './staff-store.ts';
import { toPlayerSummary } from './staff-store.ts';
import type { PlayerRow, Store } from './store.ts';
import type { StaffActing, SupportService } from './support-service.ts';
import { cleanText, len } from './tribe-service.ts';

const MINUTE = 60_000;

const auditDto = (r: AuditRow): AuditEntryDto => ({
  id: r.id,
  at: r.at,
  actorId: r.actorId,
  actorName: r.actorName,
  actorIp: r.actorIp,
  action: r.action,
  targetPlayerId: r.targetPlayerId,
  targetName: r.targetName,
  detail: r.detail,
});

function reasonOf(raw: string | undefined, required: boolean): string {
  const s = raw === undefined ? '' : cleanText(raw, 'The reason');
  const n = len(s);
  if ((required && n < 1) || n > MOD_REASON_MAX) throw new GameError('invalid_input', `The reason needs ${required ? 1 : 0} to ${MOD_REASON_MAX} characters.`);
  return s;
}

export class StaffService {
  constructor(
    private readonly store: Store,
    private readonly support: SupportService,
  ) {}

  private get st() {
    return this.store.staff;
  }

  me(staff: PlayerRow): StaffMeResponse {
    return { staffRole: staff.staffRole ?? 'support', username: staff.username };
  }

  // ---- lookup ------------------------------------------------------------------------------------

  search(query: string, now: number): StaffPlayerListResponse {
    const q = cleanText(query, 'The search').normalize('NFC');
    return { players: q === '' ? [] : this.st.search(q, PLAYER_SEARCH_MAX).map((p) => toPlayerSummary(p, now)) };
  }

  /** Profile for staff. Opening it is itself audited. IPs only for moderator and admin. Never includes private mail. */
  detail(a: StaffActing, id: number): StaffPlayerDetailDto {
    return this.store.tx(() => {
      const p = this.player(id);
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action: 'staff_view_player', targetPlayer: id });
      return this.detailOf(a, p);
    });
  }

  private detailOf(a: StaffActing, p: PlayerLookupRow): StaffPlayerDetailDto {
    return {
      ...toPlayerSummary(p, a.t),
      banReason: p.banReason,
      muteReason: p.mutedUntil !== null && p.mutedUntil > a.t ? p.muteReason : null,
      ips: staffRank(a.staff.staffRole) >= staffRank('moderator') ? this.st.ipsOf(p.id) : [],
      openReportsAgainst: this.st.openReportsAgainst(p.id),
      ticketCount: this.st.ticketCountOf(p.id),
      recentAudit: this.st.auditAbout(p.id, 10).map(auditDto),
    };
  }

  // ---- moderation --------------------------------------------------------------------------------

  mute(a: StaffActing, id: number, req: MuteRequest): StaffPlayerDetailDto {
    if (!Number.isInteger(req.minutes) || req.minutes < 1 || req.minutes > MUTE_MAX_MINUTES) {
      throw new GameError('invalid_input', `A mute lasts 1 to ${MUTE_MAX_MINUTES} minutes.`);
    }
    const reason = reasonOf(req.reason, true);
    return this.act(a, id, 'mute', `${req.minutes} min: ${reason}`, 'Notice: temporary mute', req, (p) => {
      this.st.setMute(p.id, a.t + req.minutes * MINUTE, reason);
    });
  }

  unmute(a: StaffActing, id: number, req: ModerationNoteRequest): StaffPlayerDetailDto {
    const note = reasonOf(req.reason, false);
    return this.act(a, id, 'unmute', note, null, {}, (p) => this.st.clearMute(p.id));
  }

  /** Ends the player's sessions (Store.banPlayer) and blocks sign-in. */
  ban(a: StaffActing, id: number, req: BanRequest): StaffPlayerDetailDto {
    const reason = reasonOf(req.reason, true);
    return this.act(a, id, 'ban', reason, 'Notice: account suspension', req, (p) => this.store.banPlayer(p.id, reason, a.t));
  }

  unban(a: StaffActing, id: number, req: ModerationNoteRequest): StaffPlayerDetailDto {
    const note = reasonOf(req.reason, false);
    return this.act(a, id, 'unban', note, null, {}, (p) => this.store.unbanPlayer(p.id));
  }

  /** A formal notice without a punishment: needs a template and/or text. */
  warn(a: StaffActing, id: number, req: WarnRequest): StaffPlayerDetailDto {
    if (req.templateId === undefined && (req.extra === undefined || req.extra.trim() === '')) {
      throw new GameError('invalid_input', 'A warning needs a template or some text.');
    }
    const note = reasonOf(req.reason, false);
    return this.act(a, id, 'warn', note, 'Notice: warning', req, () => undefined);
  }

  private act(
    a: StaffActing,
    id: number,
    action: string,
    detail: string,
    noticeSubject: string | null,
    notice: { templateId?: number; extra?: string },
    apply: (p: PlayerLookupRow) => void,
  ): StaffPlayerDetailDto {
    return this.store.tx(() => {
      const p = this.player(id);
      if (p.id === a.staff.id) throw new GameError('forbidden', "You can't do that to yourself.");
      if (staffRank(p.staffRole) >= staffRank(a.staff.staffRole)) throw new GameError('forbidden', "You can't act on a staff member of the same or a higher role.");
      apply(p);
      let note = '';
      if (noticeSubject !== null && (notice.templateId !== undefined || (notice.extra !== undefined && notice.extra.trim() !== ''))) {
        const ticketId = this.support.openNotice(a, p, noticeSubject, notice.templateId, notice.extra);
        note = ` (notice: ticket #${ticketId})`;
      }
      this.store.audit({ at: a.t, actorId: a.staff.id, actorIp: a.ip, action, targetPlayer: p.id, detail: `${detail}${note}` });
      const fresh = this.player(id);
      return this.detailOf(a, fresh);
    });
  }

  private player(id: number): PlayerLookupRow {
    const p = this.st.lookup(id);
    if (!p) throw new GameError('not_found', 'That player does not exist.');
    return p;
  }

  // ---- audit log ---------------------------------------------------------------------------------

  audit(f: AuditFilter, limit: number): AuditListResponse {
    const n = Math.min(Math.max(limit, 1), AUDIT_PAGE_MAX);
    const rows = this.st.auditPage(f, n + 1);
    const shown = rows.slice(0, n);
    return { entries: shown.map(auditDto), nextBefore: rows.length > n ? shown[shown.length - 1]!.id : null };
  }
}
