// "Contact support": the player's own tickets (list + thread) and a form to open a new one.
// The server decides everything (ownership, limits, mute rules); this screen only shows and sends.

import { PageHeader } from '../components/PageHeader.tsx';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PLAYER_TICKET_CATEGORIES, TICKET_BODY_MAX, TICKET_SUBJECT_MAX } from '@clanfire/engine';
import type { TicketCategory, TicketDto, TicketSummaryDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { formatAgo } from '../format.ts';
import { useGame } from '../game.ts';
import { CATEGORY_LABEL, PLAYER_STATUS_LABEL, TicketThread, charCount } from '../components/supportBits.tsx';

type Pane = { kind: 'none' } | { kind: 'new' } | { kind: 'read'; id: number };

function NewTicket({ onCreated, onCancel }: { onCreated: (t: TicketDto) => void; onCancel: () => void }) {
  const { toast } = useGame();
  const [category, setCategory] = useState<TicketCategory>('gameplay');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = !busy && subject.trim() !== '' && body.trim() !== '' && charCount(subject) <= TICKET_SUBJECT_MAX && charCount(body) <= TICKET_BODY_MAX;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTicket({ category, subject: subject.trim(), body: body.trim() });
      toast('Sent');
      onCreated(t);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mail-compose" onSubmit={(e) => void submit(e)}>
      <button type="button" className="btn btn-small mail-back" onClick={onCancel}>
        ← Back
      </button>
      <h2 className="card-title">New request</h2>
      <label className="field">
        Topic
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
          {PLAYER_TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Subject
        <input className="input" value={subject} maxLength={TICKET_SUBJECT_MAX * 2} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        Message
        <textarea className="input textarea mail-body-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="mail-compose-foot">
        <span className={`muted${charCount(body) > TICKET_BODY_MAX ? ' loss' : ''}`} aria-live="polite">
          {charCount(body)} / {TICKET_BODY_MAX}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

function Thread({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged: () => void }) {
  const { toast } = useGame();
  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTicket(null);
    setError(null);
    api
      .ticket(id)
      .then((t) => {
        if (cancelled) return;
        setTicket(t);
        onChanged();
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiRequestError && e.code === 'not_found' ? 'Request not found.' : errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // onChanged refreshes the list's unread marker; deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(fn: () => Promise<TicketDto>, after?: () => void) {
    setBusy(true);
    try {
      setTicket(await fn());
      after?.();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const closed = ticket?.status === 'closed';
  const canSend = !busy && reply.trim() !== '' && charCount(reply) <= TICKET_BODY_MAX;

  return (
    <div className="mail-reader">
      <button type="button" className="btn btn-small mail-back" onClick={onBack}>
        ← Back
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!ticket && !error && <p className="muted">Loading…</p>}
      {ticket && (
        <>
          <h2 className="card-title mail-subject">{ticket.subject}</h2>
          <p className="muted mail-meta">
            {CATEGORY_LABEL[ticket.category]} · {PLAYER_STATUS_LABEL[ticket.status]} · opened {new Date(ticket.createdAt).toLocaleString()}
          </p>
          <TicketThread messages={ticket.messages} viewerIsStaff={false} />
          {closed ? (
            <p className="muted">Closed.</p>
          ) : (
            <form
              className="mail-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSend) void act(() => api.replyTicket(id, reply.trim()), () => setReply(''));
              }}
            >
              <label className="field">
                Your reply
                <textarea className="input textarea" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
              </label>
              <div className="mail-compose-foot">
                <span className={`muted${charCount(reply) > TICKET_BODY_MAX ? ' loss' : ''}`} aria-live="polite">
                  {charCount(reply)} / {TICKET_BODY_MAX}
                </span>
                <span className="mail-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.closeTicket(id))}>
                    Close request
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!canSend}>
                    {busy ? 'Sending…' : 'Reply'}
                  </button>
                </span>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

export function SupportView() {
  const { now, navigate } = useGame();
  const [list, setList] = useState<TicketSummaryDto[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ kind: 'none' });

  const load = useCallback(async () => {
    try {
      const res = await api.tickets();
      setList(res.tickets);
      setUnread(res.unread);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const closePane = useCallback(() => setPane({ kind: 'none' }), []);
  const selected = pane.kind === 'read' ? pane.id : null;

  return (
    <div className="page">
      <PageHeader icon="mail" title="Contact support" />
      <div className={`mail${pane.kind !== 'none' ? ' has-pane' : ''}`}>
        <section className="card mail-list-card" aria-label="Your requests">
          <div className="mail-toolbar">
            <button type="button" className="btn btn-small" onClick={() => navigate('village')}>
              ← Game
            </button>
            <span className="muted" aria-live="polite">
              {unread > 0 ? `${unread} new` : ''}
            </span>
            <button type="button" className="btn btn-primary" onClick={() => setPane({ kind: 'new' })}>
              New request
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}{' '}
              <button className="link" onClick={() => void load()}>
                Retry
              </button>
            </p>
          )}
          {list === null && !error && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && <p className="muted">No requests.</p>}
          {list !== null && list.length > 0 && (
            <ul className="mail-list">
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`mail-item${t.unread ? ' is-unread' : ''}${selected === t.id ? ' is-selected' : ''}`}
                    aria-current={selected === t.id ? 'true' : undefined}
                    onClick={() => setPane({ kind: 'read', id: t.id })}
                  >
                    <span className="mail-line">
                      <span className="mail-who">
                        {t.unread && <span className="dot" role="img" aria-label="New answer" />}
                        {CATEGORY_LABEL[t.category]}
                      </span>
                      <span className="muted mail-when">{formatAgo(t.updatedAt, now)}</span>
                    </span>
                    <span className="mail-subject-line">{t.subject}</span>
                    <span className="muted mail-preview">{PLAYER_STATUS_LABEL[t.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card mail-pane" aria-label="Request">
          {pane.kind === 'none' && <p className="muted mail-hint">Select a request.</p>}
          {pane.kind === 'new' && (
            <NewTicket
              onCancel={closePane}
              onCreated={(t) => {
                setPane({ kind: 'read', id: t.id });
                void load();
              }}
            />
          )}
          {pane.kind === 'read' && <Thread key={pane.id} id={pane.id} onBack={closePane} onChanged={() => void load()} />}
        </section>
      </div>
    </div>
  );
}
