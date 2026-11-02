// "Ask Mags": the player types a question, Mags the Tinker answers with an AI tip (POST /api/advisor/ask).
// Answers are plain text only. The last few exchanges live in component state for the session.

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ADVISOR_QUESTION_MAX } from '@clanfire/engine';
import { api, ApiRequestError } from '../../api.ts';
import { Mags } from '../../art/Mags.tsx';

const KEEP = 4;
const COUNTER_FROM = ADVISOR_QUESTION_MAX - 100;

interface Exchange {
  q: string;
  a: string;
  ok: boolean;
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    const code = String(e.code);
    if (code === 'rate_limited') return 'Phew, my brain gears need a rest. Ask me again in a little while.';
    if (code === 'invalid_input') return 'Hmm, that one did not fit in my head. Try a shorter question.';
  }
  return 'Mags is off fixing a windmill. Try again in a bit.';
}

export function AskMags({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Exchange[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const fieldId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // Keep the thinking line / newest answer in view (phone sheet: below the fold, behind the nav).
  useEffect(() => {
    if (busy || log.length) liveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [busy, log.length]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const res = await api.askMags(q);
      setLog((l) => [...l, { q, a: String(res.answer), ok: true }].slice(-KEEP));
      setRemaining(res.remaining);
      setText('');
    } catch (err) {
      setLog((l) => [...l, { q, a: friendlyError(err), ok: false }].slice(-KEEP));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  if (!open) {
    return (
      <button type="button" className={`askmags-toggle${compact ? ' compact' : ''}`} onClick={() => setOpen(true)} aria-expanded="false">
        <Mags size={32} />
        <span>Ask Mags a question</span>
      </button>
    );
  }

  const latest = log[log.length - 1];
  const older = log.slice(0, -1).reverse();

  return (
    <section className={`askmags${compact ? ' compact' : ''}`} aria-label="Ask Mags the Tinker">
      <div className="askmags-head">
        <span className="askmags-title">Ask Mags</span>
        <button type="button" className="askmags-close" onClick={() => setOpen(false)} aria-label="Hide Ask Mags">
          Hide
        </button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor={fieldId} className="askmags-label">
          Your question for Mags
        </label>
        <div className="askmags-row">
          <textarea
            id={fieldId}
            ref={inputRef}
            className="askmags-input"
            rows={2}
            value={text}
            maxLength={ADVISOR_QUESTION_MAX}
            placeholder="What should I build next?"
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            enterKeyHint="send"
          />
          <button type="submit" className="btn btn-teal askmags-send" disabled={busy || !text.trim()}>
            Ask
          </button>
        </div>
        {text.length >= COUNTER_FROM && (
          <div className="askmags-count" aria-hidden="true">
            {text.length} / {ADVISOR_QUESTION_MAX}
          </div>
        )}
      </form>
      <div aria-live="polite" className="askmags-live" ref={liveRef}>
        {busy && <p className="askmags-think">Mags is thinking…</p>}
        {latest && !busy && (
          <div className="askmags-answer">
            <Mags size={48} className="advisor-art" />
            <div className={`askmags-bubble${latest.ok ? '' : ' err'}`}>
              <div className="askmags-q">You: {latest.q}</div>
              <p>{latest.a}</p>
            </div>
          </div>
        )}
      </div>
      {remaining !== null && (
        <div className="askmags-left">
          {remaining} {remaining === 1 ? 'question' : 'questions'} left this hour
        </div>
      )}
      {older.length > 0 && (
        <ul className="askmags-older">
          {older.map((x, i) => (
            <li key={i}>
              <div className="askmags-q">You: {x.q}</div>
              <p>{x.a}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
