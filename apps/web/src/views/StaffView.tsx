// Staff tools (support / moderator / admin): ticket queue, report queue, player lookup with moderation, audit log.
// Shown only when player.staffRole is set; the server re-checks the role on every request, so hiding a button here
// is a convenience, never the protection. Loaded lazily (default export).

import { PageHeader } from '../components/PageHeader.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  MESSAGE_REPORT_CATEGORIES,
  MESSAGE_REPORT_STATUSES,
  MUTE_MAX_MINUTES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  renderTemplate,
  staffRank,
} from '@clanfire/engine';
import type {
  AuditEntryDto,
  MessageReportCategory,
  MessageReportStatus,
  MessageTemplateDto,
  StaffPlayerDetailDto,
  StaffPlayerSummaryDto,
  StaffReportDto,
  StaffTicketDto,
  StaffTicketSummaryDto,
  TicketCategory,
  TicketStatus,
} from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { formatAgo } from '../format.ts';
import { useGame } from '../game.ts';
import { CATEGORY_LABEL, PRIORITY_LABEL, REPORT_CATEGORY_LABEL, STATUS_LABEL, TicketThread } from '../components/supportBits.tsx';

type Section = 'tickets' | 'reports' | 'players' | 'audit';

const REPORT_STATUS_LABEL: Record<MessageReportStatus, string> = { open: 'Open', actioned: 'Action taken', dismissed: 'Dismissed' };

/** Runs an async action, shows errors as toasts. */
function useAction() {
  const { toast } = useGame();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (okMessage) toast(okMessage);
        return true;
      } catch (e) {
        toast(errorMessage(e), { kind: 'error' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

function TwoPane({ hasPane, list, pane, label }: { hasPane: boolean; list: ReactNode; pane: ReactNode; label: string }) {
  return (
    <div className={`mail staff-split${hasPane ? ' has-pane' : ''}`}>
      <section className="card mail-list-card" aria-label={`${label} list`}>
        {list}
      </section>
      <section className="card mail-pane" aria-label={label}>
        {pane}
      </section>
    </div>
  );
}

function ErrorLine({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {error}{' '}
      <button className="link" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

// ---- Tickets ---------------------------------------------------------------------------------------------

type Assignment = 'all' | 'unassigned' | 'mine';

function TicketDetail({ id, templates, onBack, onChanged }: { id: number; templates: MessageTemplateDto[]; onBack: () => void; onChanged: () => void }) {
  const { player } = useGame();
  const { busy, run } = useAction();
  const [ticket, setTicket] = useState<StaffTicketDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<TicketStatus>('pending');

  const load = useCallback(() => {
    setError(null);
    api
      .staffTicket(id)
      .then(setTicket)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    setTicket(null);
    load();
  }, [load]);

  const apply = (fn: () => Promise<StaffTicketDto>, ok?: string) =>
    run(async () => {
      setTicket(await fn());
      onChanged();
    }, ok);

  function pickTemplate(value: string) {
    if (!ticket || value === '') {
      setTemplateId(null);
      return;
    }
    const t = templates.find((x) => x.id === Number(value));
    if (!t) return;
    setTemplateId(t.id);
    setText(
      renderTemplate(t.body, {
        player: ticket.playerName,
        staff: player.username,
        ticket: `#${ticket.id}`,
        category: CATEGORY_LABEL[ticket.category],
      }),
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!ticket || busy || text.trim() === '') return;
    const body = text.trim();
    const ok = await apply(
      () =>
        api.staffReplyTicket(ticket.id, {
          body,
          internal,
          ...(internal ? {} : { status: after }),
          ...(templateId === null || internal ? {} : { templateId }),
        }),
      internal ? 'Note saved.' : 'Reply sent.',
    );
    if (ok) {
      setText('');
      setTemplateId(null);
    }
  }

  if (error) return <ErrorLine error={error} onRetry={load} />;
  if (!ticket) return <p className="muted">Loading…</p>;
  const mine = ticket.assignedTo === player.id;
  const ticketTemplates = templates.filter((t) => t.kind === 'ticket');

  return (
    <div className="mail-reader">
      <button type="button" className="btn btn-small mail-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="card-title mail-subject">
        #{ticket.id} {ticket.subject}
      </h2>
      <p className="muted mail-meta">
        {ticket.playerName} · {CATEGORY_LABEL[ticket.category]} · opened {new Date(ticket.createdAt).toLocaleString()}
        {ticket.openedByStaff ? ' · opened by staff' : ''}
        {ticket.assignedName ? ` · assigned to ${ticket.assignedName}` : ' · unassigned'}
      </p>
      <div className="staff-controls">
        <label className="field">
          Status
          <select className="input" value={ticket.status} disabled={busy} onChange={(e) => void apply(() => api.staffTicketStatus(ticket.id, e.target.value as TicketStatus))}>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Priority
          <select
            className="input"
            value={ticket.priority}
            disabled={busy}
            onChange={(e) => void apply(() => api.staffTicketPriority(ticket.id, e.target.value as 'normal' | 'high'))}
          >
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <div className="staff-assign">
          {!mine && (
            <button type="button" className="btn" disabled={busy} onClick={() => void apply(() => api.staffAssignTicket(ticket.id, player.id), 'Assigned to you.')}>
              Assign to me
            </button>
          )}
          {ticket.assignedTo !== null && (
            <button type="button" className="btn" disabled={busy} onClick={() => void apply(() => api.staffAssignTicket(ticket.id, null), 'Unassigned.')}>
              Unassign
            </button>
          )}
        </div>
      </div>
      <TicketThread messages={ticket.messages} viewerIsStaff />
      <form className="mail-compose" onSubmit={(e) => void send(e)}>
        <label className="field">
          Template
          <select className="input" value={templateId ?? ''} onChange={(e) => pickTemplate(e.target.value)}>
            <option value="">No template</option>
            {ticketTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {internal ? 'Internal note (the player cannot see it)' : 'Reply to the player'}
          <textarea
            className="input textarea"
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTemplateId(null);
            }}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
          <span>Internal note only</span>
        </label>
        {!internal && (
          <label className="field">
            Status after sending
            <select className="input" value={after} onChange={(e) => setAfter(e.target.value as TicketStatus)}>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || text.trim() === ''}>
          {busy ? 'Sending…' : internal ? 'Save note' : 'Send reply'}
        </button>
      </form>
    </div>
  );
}

function TicketQueue() {
  const { player, now } = useGame();
  const [status, setStatus] = useState<TicketStatus | ''>('open');
  const [category, setCategory] = useState<TicketCategory | ''>('');
  const [assignment, setAssignment] = useState<Assignment>('all');
  const [list, setList] = useState<StaffTicketSummaryDto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [templates, setTemplates] = useState<MessageTemplateDto[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const filter = useMemo(
    () => ({
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(assignment === 'unassigned' ? { unassigned: true } : {}),
      ...(assignment === 'mine' ? { assignee: player.id } : {}),
    }),
    [status, category, assignment, player.id],
  );

  const load = useCallback(async () => {
    try {
      const res = await api.staffTickets(filter);
      setList(res.tickets);
      setHasMore(res.hasMore);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);
  useEffect(() => {
    api
      .staffTemplates()
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, []);

  async function more() {
    setLoadingMore(true);
    try {
      const res = await api.staffTickets({ ...filter, offset: list?.length ?? 0 });
      setList((cur) => [...(cur ?? []), ...res.tickets]);
      setHasMore(res.hasMore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <TwoPane
      label="Ticket"
      hasPane={selected !== null}
      list={
        <>
          <div className="staff-filters">
            <label className="field">
              Status
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | '')}>
                <option value="">Any</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Topic
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory | '')}>
                <option value="">Any</option>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Assigned
              <select className="input" value={assignment} onChange={(e) => setAssignment(e.target.value as Assignment)}>
                <option value="all">Anyone</option>
                <option value="unassigned">Unassigned</option>
                <option value="mine">Assigned to me</option>
              </select>
            </label>
          </div>
          <ErrorLine error={error} onRetry={() => void load()} />
          {list === null && !error && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && <p className="muted">No tickets match.</p>}
          {list !== null && list.length > 0 && (
            <ul className="mail-list">
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`mail-item${selected === t.id ? ' is-selected' : ''}${t.status === 'open' ? ' is-unread' : ''}`}
                    aria-current={selected === t.id ? 'true' : undefined}
                    onClick={() => setSelected(t.id)}
                  >
                    <span className="mail-line">
                      <span className="mail-who">
                        {t.priority === 'high' && <span className="dot" role="img" aria-label="High priority" />}
                        {t.playerName}
                      </span>
                      <span className="muted mail-when">{formatAgo(t.updatedAt, now)}</span>
                    </span>
                    <span className="mail-subject-line">{t.subject}</span>
                    <span className="muted mail-preview">
                      {CATEGORY_LABEL[t.category]} · {STATUS_LABEL[t.status]} · {t.assignedName ?? 'unassigned'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <button type="button" className="btn btn-block mail-more" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'Loading…' : 'More tickets'}
            </button>
          )}
        </>
      }
      pane={
        selected === null ? (
          <p className="muted mail-hint">Pick a ticket.</p>
        ) : (
          <TicketDetail key={selected} id={selected} templates={templates} onBack={() => setSelected(null)} onChanged={() => void load()} />
        )
      }
    />
  );
}

// ---- Reports ---------------------------------------------------------------------------------------------

function ReportDetail({ report, onResolved, onBack, onLookup }: { report: StaffReportDto; onResolved: (r: StaffReportDto) => void; onBack: () => void; onLookup: (id: number) => void }) {
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const open = report.status === 'open';

  function resolve(status: 'actioned' | 'dismissed') {
    void run(async () => {
      onResolved(await api.staffResolveReport(report.id, { status, ...(note.trim() ? { resolutionNote: note.trim() } : {}) }));
    }, status === 'actioned' ? 'Marked as action taken.' : 'Report dismissed.');
  }

  return (
    <div className="mail-reader">
      <button type="button" className="btn btn-small mail-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="card-title">
        Report #{report.id}: {REPORT_CATEGORY_LABEL[report.category]}
      </h2>
      <p className="muted mail-meta">
        {report.kind === 'player' ? 'Player report' : report.kind === 'mail' ? 'Mail' : report.kind === 'chat' ? 'Tribe chat' : 'Forum post'} · reported{' '}
        <strong>{report.reportedName}</strong> by <strong>{report.reporterName}</strong> · {new Date(report.createdAt).toLocaleString()}
      </p>
      {report.snapshot && <div className="mail-text">{report.snapshot}</div>}
      {report.note && (
        <p>
          <strong>Reporter's note:</strong> <span className="mail-subject">{report.note}</span>
        </p>
      )}
      <div className="mail-actions">
        <button type="button" className="btn" onClick={() => onLookup(report.reportedPlayerId)}>
          Look up {report.reportedName}
        </button>
      </div>
      {open ? (
        <>
          <label className="field">
            Resolution note <span className="hint">(optional)</span>
            <textarea className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="mail-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => resolve('actioned')}>
              Action taken
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => resolve('dismissed')}>
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          {REPORT_STATUS_LABEL[report.status]}
          {report.handledAt ? ` · ${new Date(report.handledAt).toLocaleString()}` : ''}
          {report.resolutionNote ? ` · ${report.resolutionNote}` : ''}
        </p>
      )}
    </div>
  );
}

function ReportQueue({ onLookup }: { onLookup: (id: number) => void }) {
  const { now } = useGame();
  const [status, setStatus] = useState<MessageReportStatus | ''>('open');
  const [category, setCategory] = useState<MessageReportCategory | ''>('');
  const [list, setList] = useState<StaffReportDto[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const filter = useMemo(() => ({ ...(status ? { status } : {}), ...(category ? { category } : {}) }), [status, category]);

  const load = useCallback(async () => {
    try {
      const res = await api.staffReports(filter);
      setList(res.reports);
      setNextBefore(res.nextBefore);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);

  async function more() {
    if (nextBefore === null) return;
    setLoadingMore(true);
    try {
      const res = await api.staffReports({ ...filter, before: nextBefore });
      setList((cur) => [...(cur ?? []), ...res.reports]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const selected = list?.find((r) => r.id === selectedId) ?? null;

  return (
    <TwoPane
      label="Report"
      hasPane={selected !== null}
      list={
        <>
          <div className="staff-filters">
            <label className="field">
              Status
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as MessageReportStatus | '')}>
                <option value="">Any</option>
                {MESSAGE_REPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REPORT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Reason
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as MessageReportCategory | '')}>
                <option value="">Any</option>
                {MESSAGE_REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {REPORT_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ErrorLine error={error} onRetry={() => void load()} />
          {list === null && !error && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && <p className="muted">No reports match.</p>}
          {list !== null && list.length > 0 && (
            <ul className="mail-list">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`mail-item${selectedId === r.id ? ' is-selected' : ''}${r.status === 'open' ? ' is-unread' : ''}`}
                    aria-current={selectedId === r.id ? 'true' : undefined}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <span className="mail-line">
                      <span className="mail-who">{r.reportedName}</span>
                      <span className="muted mail-when">{formatAgo(r.createdAt, now)}</span>
                    </span>
                    <span className="mail-subject-line">{REPORT_CATEGORY_LABEL[r.category]}</span>
                    <span className="muted mail-preview">
                      {REPORT_STATUS_LABEL[r.status]} · by {r.reporterName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {nextBefore !== null && (
            <button type="button" className="btn btn-block mail-more" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'Loading…' : 'Older reports'}
            </button>
          )}
        </>
      }
      pane={
        selected === null ? (
          <p className="muted mail-hint">Pick a report.</p>
        ) : (
          <ReportDetail
            key={selected.id}
            report={selected}
            onBack={() => setSelectedId(null)}
            onLookup={onLookup}
            onResolved={(r) => setList((cur) => cur?.map((x) => (x.id === r.id ? r : x)) ?? cur)}
          />
        )
      }
    />
  );
}

// ---- Players ---------------------------------------------------------------------------------------------

function AuditList({ entries, showIp }: { entries: AuditEntryDto[]; showIp: boolean }) {
  if (entries.length === 0) return <p className="muted">Nothing yet.</p>;
  return (
    <ul className="staff-audit">
      {entries.map((a) => (
        <li key={a.id}>
          <span className="muted">{new Date(a.at).toLocaleString()}</span> <strong>{a.action}</strong>
          {a.actorName ? ` by ${a.actorName}` : ''}
          {a.targetName ? ` on ${a.targetName}` : ''}
          {showIp && a.actorIp ? ` (${a.actorIp})` : ''}
          {a.detail ? <span className="muted"> · {a.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

type ModAction = 'mute' | 'ban' | 'warn';

function PlayerDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { player, now } = useGame();
  const { busy, run } = useAction();
  const [detail, setDetail] = useState<StaffPlayerDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MessageTemplateDto[]>([]);
  const [action, setAction] = useState<ModAction | null>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [templateId, setTemplateId] = useState('');
  const [extra, setExtra] = useState('');
  const canModerate = staffRank(player.staffRole) >= staffRank('moderator');

  const load = useCallback(() => {
    setError(null);
    api
      .staffPlayer(id)
      .then(setDetail)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    setDetail(null);
    setAction(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!canModerate) return;
    api
      .staffTemplates()
      .then((r) => setTemplates(r.templates.filter((t) => t.kind === 'moderation')))
      .catch(() => setTemplates([]));
  }, [canModerate]);

  if (error) return <ErrorLine error={error} onRetry={load} />;
  if (!detail) return <p className="muted">Loading…</p>;

  const muted = detail.mutedUntil !== null && detail.mutedUntil > now;
  const banned = detail.bannedAt !== null;
  const minutesNum = Number(minutes);
  const minutesOk = Number.isInteger(minutesNum) && minutesNum >= 1 && minutesNum <= MUTE_MAX_MINUTES;
  const canSubmit = action !== null && !busy && (action === 'warn' || reason.trim() !== '') && (action !== 'mute' || minutesOk);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!detail || !action || !canSubmit) return;
    const notice = { ...(templateId ? { templateId: Number(templateId) } : {}), ...(extra.trim() ? { extra: extra.trim() } : {}) };
    const r = reason.trim();
    const call =
      action === 'mute'
        ? () => api.staffMute(detail.id, { minutes: minutesNum, reason: r, ...notice })
        : action === 'ban'
          ? () => api.staffBan(detail.id, { reason: r, ...notice })
          : () => api.staffWarn(detail.id, { ...(r ? { reason: r } : {}), ...notice });
    void run(async () => {
      setDetail(await call());
      setAction(null);
      setReason('');
      setExtra('');
      setTemplateId('');
    }, action === 'mute' ? 'Player muted.' : action === 'ban' ? 'Player banned.' : 'Warning sent.');
  }

  return (
    <div className="mail-reader">
      <button type="button" className="btn btn-small mail-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="card-title">{detail.username}</h2>
      <p className="muted mail-meta">
        Joined {new Date(detail.createdAt).toLocaleDateString()} · active {formatAgo(detail.lastActive, now)}
        {detail.staffRole ? ` · staff: ${detail.staffRole}` : ''} · {detail.ticketCount} tickets · {detail.openReportsAgainst} open reports against
      </p>
      {banned && (
        <p className="form-error">
          Banned {new Date(detail.bannedAt ?? 0).toLocaleString()}: {detail.banReason || 'no reason given'}
        </p>
      )}
      {muted && (
        <p className="form-error">
          Muted until {new Date(detail.mutedUntil ?? 0).toLocaleString()}: {detail.muteReason || 'no reason given'}
        </p>
      )}
      {canModerate && (
        <>
          <div className="mail-actions">
            {muted ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setDetail(await api.staffUnmute(detail.id)), 'Mute removed.')}>
                Unmute
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => setAction('mute')}>
                Mute…
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => setAction('warn')}>
              Warn…
            </button>
            {banned ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setDetail(await api.staffUnban(detail.id)), 'Ban lifted.')}>
                Unban
              </button>
            ) : (
              <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => setAction('ban')}>
                Ban…
              </button>
            )}
          </div>
          {action && (
            <form className="mail-compose" onSubmit={submit}>
              <h3 className="card-title">{action === 'mute' ? 'Mute' : action === 'ban' ? 'Ban' : 'Warn'} {detail.username}</h3>
              {action === 'mute' && (
                <label className="field">
                  Minutes (max {MUTE_MAX_MINUTES})
                  <input className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
                </label>
              )}
              <label className="field">
                Reason {action === 'warn' && <span className="hint">(optional)</span>}
                <textarea className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="field">
                Formal notice template <span className="hint">(optional, opens a ticket for the player)</span>
                <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">No notice</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Extra text for the notice <span className="hint">(optional)</span>
                <textarea className="input textarea" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
              </label>
              <div className="mail-actions">
                <button type="submit" className={`btn ${action === 'ban' ? 'btn-danger-outline' : 'btn-primary'}`} disabled={!canSubmit}>
                  {busy ? 'Working…' : 'Confirm'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setAction(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <h3 className="card-title">Addresses</h3>
          {detail.ips.length === 0 ? (
            <p className="muted">None recorded.</p>
          ) : (
            <ul className="staff-audit">
              {detail.ips.map((ip) => (
                <li key={ip.ip}>
                  <strong>{ip.ip}</strong> <span className="muted">first {new Date(ip.firstSeen).toLocaleDateString()}, last {formatAgo(ip.lastSeen, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h3 className="card-title">Recent history</h3>
      <AuditList entries={detail.recentAudit} showIp={canModerate} />
    </div>
  );
}

function PlayerLookup({ initialId }: { initialId: number | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffPlayerSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(initialId);
  useEffect(() => {
    if (initialId !== null) setSelected(initialId);
  }, [initialId]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      setResults((await api.staffPlayers(q)).players);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TwoPane
      label="Player"
      hasPane={selected !== null}
      list={
        <>
          <form className="staff-search" onSubmit={(e) => void search(e)}>
            <label className="visually-hidden" htmlFor="staff-player-q">
              Player name
            </label>
            <input id="staff-player-q" className="input" value={query} placeholder="Player name" maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={busy || query.trim() === ''}>
              {busy ? '…' : 'Search'}
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {results !== null && results.length === 0 && <p className="muted">No players found.</p>}
          {results !== null && results.length > 0 && (
            <ul className="mail-list">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`mail-item${selected === p.id ? ' is-selected' : ''}`} onClick={() => setSelected(p.id)}>
                    <span className="mail-line">
                      <span className="mail-who">{p.username}</span>
                    </span>
                    <span className="muted mail-preview">
                      {p.staffRole ? `${p.staffRole} · ` : ''}
                      {p.bannedAt ? 'banned' : p.mutedUntil ? 'muted' : 'in good standing'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      }
      pane={selected === null ? <p className="muted mail-hint">Search for a player.</p> : <PlayerDetail key={selected} id={selected} onBack={() => setSelected(null)} />}
    />
  );
}

// ---- Audit -----------------------------------------------------------------------------------------------

function AuditView() {
  const [entries, setEntries] = useState<AuditEntryDto[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.staffAudit({});
      setEntries(res.entries);
      setNextBefore(res.nextBefore);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function more() {
    if (nextBefore === null) return;
    setLoadingMore(true);
    try {
      const res = await api.staffAudit({ before: nextBefore });
      setEntries((cur) => [...(cur ?? []), ...res.entries]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="card" aria-label="Audit log">
      <ErrorLine error={error} onRetry={() => void load()} />
      {entries === null && !error && <p className="muted">Loading…</p>}
      {entries !== null && <AuditList entries={entries} showIp />}
      {nextBefore !== null && (
        <button type="button" className="btn btn-block" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Loading…' : 'Older entries'}
        </button>
      )}
    </section>
  );
}

// ---- Page ------------------------------------------------------------------------------------------------

export default function StaffView() {
  const { player, navigate } = useGame();
  const role = player.staffRole ?? null;
  const rank = staffRank(role);
  const [section, setSection] = useState<Section>('tickets');
  const [lookupId, setLookupId] = useState<number | null>(null);

  if (rank === 0) {
    return (
      <div className="page">
        <p className="muted">This page is for staff.</p>
      </div>
    );
  }

  const sections: Array<{ id: Section; label: string; minRank: number }> = [
    { id: 'tickets', label: 'Tickets', minRank: 1 },
    { id: 'reports', label: 'Reports', minRank: 2 },
    { id: 'players', label: 'Players', minRank: 1 },
    { id: 'audit', label: 'Audit', minRank: 2 },
  ];
  const visible = sections.filter((s) => rank >= s.minRank);

  return (
    <div className="page staff-page">
      <PageHeader
        icon="shield"
        title={`Staff tools (${role})`}
        actions={
          <button type="button" className="btn btn-small" onClick={() => navigate('village')}>
            ← Game
          </button>
        }
        tabs={visible.map((s) => ({ key: s.id, label: s.label }))}
        activeTab={section}
        onTab={(k) => setSection(k as Section)}
        tabsLabel="Staff sections"
        tabsRole="group"
      />
      {section === 'tickets' && <TicketQueue />}
      {section === 'reports' && rank >= 2 && (
        <ReportQueue
          onLookup={(id) => {
            setLookupId(id);
            setSection('players');
          }}
        />
      )}
      {section === 'players' && <PlayerLookup initialId={lookupId} />}
      {section === 'audit' && rank >= 2 && <AuditView />}
    </div>
  );
}
