// Shared pieces of the support screens: labels, the message thread and the "Report" dialog.

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MESSAGE_REPORT_CATEGORIES, REPORT_NOTE_MAX } from '@clanfire/engine';
import type { MessageReportCategory, MessageReportKind, TicketCategory, TicketMessageDto, TicketPriority, TicketStatus } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  account: 'Account',
  bug: 'Bug or error',
  payment: 'Payment',
  report_player: 'Report a player',
  gameplay: 'Gameplay question',
  feedback: 'Feedback',
  other: 'Other',
  moderation: 'Moderation notice',
};

export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending: 'Waiting for player', solved: 'Solved', closed: 'Closed' };
export const PLAYER_STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', pending: 'Answered', solved: 'Solved', closed: 'Closed' };
export const PRIORITY_LABEL: Record<TicketPriority, string> = { normal: 'Normal', high: 'High' };

export const REPORT_CATEGORY_LABEL: Record<MessageReportCategory, string> = {
  spam: 'Spam',
  abuse: 'Abuse or insults',
  threats: 'Threats',
  cheating: 'Cheating',
  other: 'Other',
};

export const charCount = (s: string): number => [...s].length;

/** The conversation of a ticket. Bodies are untrusted text: React escapes them, line breaks come from CSS. */
export function TicketThread({ messages, viewerIsStaff }: { messages: TicketMessageDto[]; viewerIsStaff: boolean }) {
  return (
    <ol className="ticket-thread">
      {messages.map((m) => (
        <li key={m.id} className={`ticket-msg${m.isStaff ? ' is-staff' : ''}${m.internal ? ' is-internal' : ''}`}>
          <div className="ticket-msg-head">
            <strong>{m.isStaff && !viewerIsStaff ? `${m.authorName} (support)` : m.authorName}</strong>
            {m.internal && <span className="badge-inline">Internal note</span>}
            <span className="muted">{new Date(m.createdAt).toLocaleString()}</span>
          </div>
          <div className="mail-text">{m.body}</div>
        </li>
      ))}
    </ol>
  );
}

/** Small modal: pick a reason, add an optional note, send. Used from mail, tribe chat and forum posts. */
export function ReportDialog({
  kind,
  refId,
  username,
  about,
  onClose,
}: {
  kind: MessageReportKind;
  refId?: number;
  username?: string;
  /** Who or what is being reported, shown in the heading. */
  about: string;
  onClose: () => void;
}) {
  const { toast } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<MessageReportCategory>('abuse');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || charCount(note) > REPORT_NOTE_MAX) return;
    setBusy(true);
    setError(null);
    try {
      await api.reportMessage({
        kind,
        category,
        ...(refId === undefined ? {} : { refId }),
        ...(username === undefined ? {} : { username }),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(true);
      toast('Report sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="report-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <h2 id="report-dialog-title" className="card-title">Report {about}</h2>
      {done ? (
        <>
          <p>Report sent.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            Close
          </button>
        </>
      ) : (
        <form className="report-form" onSubmit={(e) => void submit(e)}>
          <label className="field">
            Reason
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as MessageReportCategory)}>
              {MESSAGE_REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {REPORT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Note <span className="hint">(optional)</span>
            <textarea className="input textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <span className={`muted${charCount(note) > REPORT_NOTE_MAX ? ' loss' : ''}`} aria-live="polite">
            {charCount(note)} / {REPORT_NOTE_MAX}
          </span>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="mail-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || charCount(note) > REPORT_NOTE_MAX}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** A "Report" button that opens the dialog. */
export function ReportButton({ kind, refId, about, className = 'btn btn-small' }: { kind: MessageReportKind; refId: number; about: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Report
      </button>
      {open && <ReportDialog kind={kind} refId={refId} about={about} onClose={() => setOpen(false)} />}
    </>
  );
}
