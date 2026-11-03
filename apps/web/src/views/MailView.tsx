import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MAIL_BODY_MAX, MAIL_SUBJECT_MAX } from '@clanfire/engine';
import type { MailBox, MailDto, MailSummaryDto } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { formatAgo } from '../format.ts';
import { useGame } from '../game.ts';
import { ReportButton } from '../components/supportBits.tsx';

/** A small fixed set; each button appends its emoji to the end of the text. */
const EMOJI = ['😀', '😂', '🙂', '😉', '😎', '😢', '😡', '👍', '👏', '🙏', '🔥', '⚔️', '🛡️', '🏹', '💰', '🎉'];

/** The draft nonce already opened, so a remount does not reopen the same compose form. */
let consumedDraft = 0;

const charCount = (s: string): number => [...s].length;

type Pane = { kind: 'none' } | { kind: 'read'; id: number } | { kind: 'compose'; to: string; subject: string };

function Compose({ initialTo, initialSubject, onSent, onCancel }: { initialTo: string; initialSubject: string; onSent: () => void; onCancel: () => void }) {
  const { toast } = useGame();
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyLen = charCount(body);
  const canSend = !busy && to.trim() !== '' && body.trim() !== '' && bodyLen <= MAIL_BODY_MAX && charCount(subject) <= MAIL_SUBJECT_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const sent = await api.sendMail({ to: to.trim(), subject: subject.trim(), body });
      toast(`Mail sent to ${sent.to}.`);
      onSent();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mail-compose" onSubmit={(e) => void submit(e)}>
      <button type="button" className="btn btn-small mail-back" onClick={onCancel}>
        ← Back
      </button>
      <h2 className="card-title">New mail</h2>
      <label className="field">
        To (player name)
        <input value={to} onChange={(e) => setTo(e.target.value)} maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        Subject <span className="hint">(optional)</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MAIL_SUBJECT_MAX * 2} />
      </label>
      <label className="field">
        Message
        <textarea className="input textarea mail-body-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="mail-emoji" role="group" aria-label="Add an emoji">
        {EMOJI.map((em) => (
          <button key={em} type="button" className="btn btn-icon mail-emoji-btn" aria-label={`Add ${em}`} onClick={() => setBody((b) => b + em)}>
            {em}
          </button>
        ))}
      </div>
      <div className="mail-compose-foot">
        <span className={`muted${bodyLen > MAIL_BODY_MAX ? ' loss' : ''}`} aria-live="polite">
          {bodyLen} / {MAIL_BODY_MAX}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

function Reader({ id, box, onBack, onReply, onDeleted, onRead }: { id: number; box: MailBox; onBack: () => void; onReply: (m: MailDto) => void; onDeleted: () => void; onRead: (id: number) => void }) {
  const { refresh, toast, composeMail } = useGame();
  const [mail, setMail] = useState<MailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMail(null);
    setError(null);
    api
      .mail(id)
      .then((m) => {
        if (cancelled) return;
        setMail(m);
        if (box === 'inbox') {
          onRead(id);
          void refresh();
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiRequestError && e.code === 'not_found' ? 'This message no longer exists.' : errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, box, onRead, refresh]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteMail(id);
      void refresh();
      onDeleted();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
      setBusy(false);
    }
  };

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
      {!mail && !error && <p className="muted">Loading…</p>}
      {mail && (
        <>
          <h2 className="card-title mail-subject">{mail.subject || '(no subject)'}</h2>
          <p className="muted mail-meta">
            From <strong>{mail.from}</strong> to <strong>{mail.to}</strong> · {new Date(mail.createdAt).toLocaleString()}
          </p>
          {/* Plain text only: React escapes it; line breaks come from CSS. */}
          <div className="mail-text">{mail.body}</div>
          <div className="mail-actions">
            {box === 'inbox' ? (
              <button type="button" className="btn btn-primary" onClick={() => onReply(mail)}>
                Reply
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => composeMail(mail.to)}>
                Write again
              </button>
            )}
            {box === 'inbox' && <ReportButton kind="mail" refId={mail.id} about={`mail from ${mail.from}`} className="btn" />}
            <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => void remove()}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function MailView() {
  const { unreadMail, now, mailDraft, refresh, toast } = useGame();
  const [box, setBox] = useState<MailBox>('inbox');
  const [list, setList] = useState<MailSummaryDto[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ kind: 'none' });
  const [loadingMore, setLoadingMore] = useState(false);
  const boxRef = useRef(box);
  boxRef.current = box;

  const loadList = useCallback(async (which: MailBox) => {
    try {
      const res = await api.mailList(which);
      if (boxRef.current !== which) return;
      setList(res.mails);
      setNextBefore(res.nextBefore);
      setListError(null);
    } catch (e) {
      if (boxRef.current === which) setListError(errorMessage(e));
    }
  }, []);

  // Load on open, on switching boxes, and whenever the unread count changes (new mail arrived).
  useEffect(() => {
    void loadList(box);
  }, [loadList, box, unreadMail]);

  // A draft from Reply, a profile or a ranking row opens the compose form once.
  useEffect(() => {
    if (!mailDraft || mailDraft.nonce === consumedDraft) return;
    consumedDraft = mailDraft.nonce;
    setPane({ kind: 'compose', to: mailDraft.to, subject: mailDraft.subject });
  }, [mailDraft]);

  const switchBox = (b: MailBox) => {
    if (b === box) return;
    setList(null);
    setNextBefore(null);
    setPane({ kind: 'none' });
    setBox(b);
  };

  const loadMore = async () => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    try {
      const res = await api.mailList(box, nextBefore);
      setList((cur) => [...(cur ?? []), ...res.mails]);
      setNextBefore(res.nextBefore);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = useCallback((id: number) => setList((cur) => cur?.map((m) => (m.id === id ? { ...m, read: true } : m)) ?? cur), []);
  const closePane = useCallback(() => setPane({ kind: 'none' }), []);
  const selected = pane.kind === 'read' ? pane.id : null;

  return (
    <div className="page">
      <h1 className="page-title">Mail</h1>
      <div className={`mail${pane.kind !== 'none' ? ' has-pane' : ''}`}>
        <section className="card mail-list-card" aria-label="Mailbox">
          <div className="mail-toolbar">
            <div className="segmented mail-boxes" role="group" aria-label="Mailbox">
              <button type="button" className={`segment${box === 'inbox' ? ' is-active' : ''}`} aria-pressed={box === 'inbox'} onClick={() => switchBox('inbox')}>
                Inbox{unreadMail > 0 ? ` (${unreadMail})` : ''}
              </button>
              <button type="button" className={`segment${box === 'sent' ? ' is-active' : ''}`} aria-pressed={box === 'sent'} onClick={() => switchBox('sent')}>
                Sent
              </button>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setPane({ kind: 'compose', to: '', subject: '' })}>
              New mail
            </button>
          </div>
          {listError && (
            <p className="form-error" role="alert">
              {listError}{' '}
              <button className="link" onClick={() => void loadList(box)}>
                Retry
              </button>
            </p>
          )}
          {list === null && !listError && <p className="muted">Loading…</p>}
          {list !== null && list.length === 0 && <p className="muted">{box === 'inbox' ? 'Your inbox is empty.' : 'You have not sent any mail yet.'}</p>}
          {list !== null && list.length > 0 && (
            <ul className="mail-list">
              {list.map((m) => {
                const unread = !m.read;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`mail-item${unread ? ' is-unread' : ''}${selected === m.id ? ' is-selected' : ''}`}
                      aria-current={selected === m.id ? 'true' : undefined}
                      onClick={() => setPane({ kind: 'read', id: m.id })}
                    >
                      <span className="mail-line">
                        <span className="mail-who">
                          {unread && <span className="dot" role="img" aria-label="Unread" />}
                          {box === 'inbox' ? m.from : `To ${m.to}`}
                        </span>
                        <span className="muted mail-when">{formatAgo(m.createdAt, now)}</span>
                      </span>
                      <span className="mail-subject-line">{m.subject || '(no subject)'}</span>
                      <span className="muted mail-preview">{m.preview}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {nextBefore !== null && (
            <button type="button" className="btn btn-block mail-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? 'Loading…' : 'Older mail'}
            </button>
          )}
        </section>
        <section className="card mail-pane" aria-label="Message">
          {pane.kind === 'none' && <p className="muted mail-hint">Pick a message to read it, or write a new one.</p>}
          {pane.kind === 'read' && (
            <Reader
              id={pane.id}
              box={box}
              onBack={closePane}
              onRead={markRead}
              onReply={(m) => {
                const re = m.subject.startsWith('Re: ') ? m.subject : `Re: ${m.subject}`.trim();
                setPane({ kind: 'compose', to: m.from, subject: [...re].slice(0, MAIL_SUBJECT_MAX).join('') });
              }}
              onDeleted={() => {
                closePane();
                void loadList(box);
              }}
            />
          )}
          {pane.kind === 'compose' && (
            <Compose
              key={`${pane.to}|${pane.subject}`}
              initialTo={pane.to}
              initialSubject={pane.subject}
              onCancel={closePane}
              onSent={() => {
                closePane();
                void refresh();
                void loadList(box);
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
