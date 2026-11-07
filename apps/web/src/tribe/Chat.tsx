import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { TRIBE_CHAT_KEEP, TRIBE_CHAT_MESSAGE_MAX } from '@clanfire/engine';
import type { ChatMessageDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { formatChatTime } from '../format.ts';
import { useGame } from '../game.ts';
import { ReportButton } from '../components/supportBits.tsx';
import { pollMs } from '../hooks/live.ts';
import { useLiveConnected, useLiveTopic } from '../hooks/useLive.tsx';
import { CharCount, PlainText } from './bits.tsx';

const POLL_MS = 5000;
/** Within this many px of the bottom counts as "at the bottom": new messages keep the view pinned. */
const STICK_PX = 48;

/** One message. Memoised: `minute` changes once a minute, so a long history is not re-rendered every second. */
const ChatMessage = memo(function ChatMessage({ m, own, minute }: { m: ChatMessageDto; own: boolean; minute: number }) {
  return (
    <div className={`chat-row${own ? ' is-own' : ''}`}>
      <ChieftainAvatar id={m.chieftain} size={36} className="chat-avatar" />
      <div className={`chat-msg${own ? ' is-own' : ''}`}>
        <div className="chat-meta">
          <strong>{own ? 'You' : m.username}</strong>
          <span>{formatChatTime(m.createdAt, minute)}</span>
        </div>
        <PlainText text={m.text} />
        {!own && <ReportButton kind="chat" refId={m.id} about={`a message by ${m.username}`} className="btn btn-small chat-report" />}
      </div>
    </div>
  );
});

/**
 * Loads the last messages when opened, then polls `?after=<last id>` every 5 s. The component only exists while the
 * Chat section is on screen, so polling stops the moment the player leaves it (and pauses while the page is hidden).
 */
export function Chat() {
  const { player, now } = useGame();
  const minute = Math.floor(now / 60_000) * 60_000;
  const [messages, setMessages] = useState<ChatMessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef(0);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((cur) => {
      const base = cur ?? [];
      const seen = new Set(base.map((m) => m.id));
      const add = incoming.filter((m) => !seen.has(m.id));
      if (add.length === 0) return cur ?? base;
      return [...base, ...add].sort((a, b) => a.id - b.id).slice(-TRIBE_CHAT_KEEP);
    });
  }, []);

  useEffect(() => {
    lastId.current = messages && messages.length > 0 ? (messages[messages.length - 1]?.id ?? 0) : 0;
  }, [messages]);

  const fetchNewer = useRef<() => void>(() => undefined);
  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    let again = false;
    const fetchMessages = async (initial: boolean) => {
      if (inflight) {
        again = !initial; // a hint that lands mid-request must not be lost
        return;
      }
      inflight = true;
      try {
        const res = await api.chat(initial ? undefined : lastId.current || undefined);
        if (cancelled) return;
        if (initial) setMessages(res.messages);
        else merge(res.messages);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        inflight = false;
        if (again && !cancelled) {
          again = false;
          // Let the merged messages update lastId first.
          window.setTimeout(() => void fetchMessages(false), 50);
        }
      }
    };
    fetchNewer.current = () => void fetchMessages(false);
    void fetchMessages(true);
    const onVisible = () => {
      if (!document.hidden) void fetchMessages(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [merge]);

  // Safety poll: every 5 s, or every 60 s while live updates are connected (a 'chat' hint fetches right away).
  const pollEvery = pollMs(POLL_MS, useLiveConnected());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) fetchNewer.current();
    }, pollEvery);
    return () => window.clearInterval(id);
  }, [pollEvery]);
  useLiveTopic('chat', () => fetchNewer.current());

  // Keep the view pinned to the newest message unless the player scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !messages) return;
    const added = messages.length - prevCount.current;
    prevCount.current = messages.length;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [messages]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (stick.current) setUnseen(0);
  }

  function jumpToEnd() {
    const el = listRef.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  }

  const trimmed = text.trim();
  const over = [...trimmed].length > TRIBE_CHAT_MESSAGE_MAX;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!trimmed || over || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const msg = await api.sendChat(trimmed);
      stick.current = true;
      merge([msg]);
      setText('');
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a keyboard; on touch screens Enter is a new line and the button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <h2 id="chat-title" className="card-title">Tribe chat</h2>
      <div className="chat-wrap">
        <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages" tabIndex={0}>
          {messages === null && <p className="muted">{error ? `${error} Retrying…` : 'Loading…'}</p>}
          {messages !== null && messages.length === 0 && <p className="muted">No messages.</p>}
          {messages?.map((m) => (
            <ChatMessage key={m.id} m={m} own={m.playerId === player.id} minute={minute} />
          ))}
        </div>
        {unseen > 0 && (
          <button className="btn btn-small chat-new" onClick={jumpToEnd}>
            {unseen} new ↓
          </button>
        )}
      </div>
      {messages !== null && error && <p className="form-error small" role="status">Reconnecting…</p>}
      <form className="chat-form" onSubmit={(e) => void send(e)}>
        <label className="visually-hidden" htmlFor="chat-input">Message</label>
        <textarea
          id="chat-input"
          className="input textarea chat-input"
          rows={2}
          value={text}
          placeholder="Message"
          onChange={(e) => {
            setText(e.target.value);
            setSendError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-primary" type="submit" disabled={!trimmed || over || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      <div className="form-row">
        <CharCount value={text} max={TRIBE_CHAT_MESSAGE_MAX} />
        {sendError && <span className="form-error small" role="alert">{sendError}</span>}
      </div>
    </section>
  );
}
