// The Chat sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-chat-1440.png): one wide panel; only the
// message list scrolls (it stays pinned to the newest message), the input stays at the bottom. Same endpoints and refresh as tribe/Chat.tsx.

import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_CHAT_MESSAGE_MAX } from '@clanfire/engine';
import type { ChatMessageDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { ReportButton } from '../../components/supportBits.tsx';
import { useGame } from '../../game.ts';
import { CharCount, PlainText } from '../../tribe/bits.tsx';
import { atEnd, chatClock } from './frame-tribe-logic.ts';
import { useChatFeed } from './FrameTribeOverview.tsx';

const Message = memo(function Message({ m, own, minute }: { m: ChatMessageDto; own: boolean; minute: number }) {
  return (
    <div className="frt-cm">
      <ChieftainAvatar id={m.chieftain} size={42} className="frt-av" />
      <span className="frt-mt">
        <span className="frt-mn">
          <b>{own ? 'You' : m.username}</b>
          <span>{chatClock(m.createdAt, minute)}</span>
        </span>
        <PlainText className="frt-cx" text={m.text} />
      </span>
      {!own && <ReportButton kind="chat" refId={m.id} about={`a message by ${m.username}`} className="fv-lk frt-rep" />}
    </div>
  );
});

export function FrameTribeChat() {
  const { player, now } = useGame();
  const minute = Math.floor(now / 60_000) * 60_000;
  const { messages, error, merge } = useChatFeed();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef(0);

  // Keep the view on the newest message unless the player scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !messages) return;
    const added = messages.length - prevCount.current;
    prevCount.current = messages.length;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((n) => n + added);
  }, [messages]);

  const trimmed = text.trim();
  const over = [...trimmed].length > TRIBE_CHAT_MESSAGE_MAX;
  async function send(e: FormEvent) {
    e.preventDefault();
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
  const jump = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  };
  return (
    <section className="fv-pn frt-chatp" aria-label="Tribe chat">
      <div className="fv-ph frt-ph">
        <h2>Tribe chat</h2>
        <span className="fv-sp" />
        <span className="fv-mut">all members</span>
      </div>
      <div className="frt-chw">
        <div
          className="frt-cl"
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Messages"
          tabIndex={0}
          onScroll={() => {
            const el = listRef.current;
            if (!el) return;
            stick.current = atEnd(el);
            if (stick.current) setUnseen(0);
          }}
        >
          {messages === null && <p className="fv-empty">{error ? `${error} Retrying…` : 'Loading…'}</p>}
          {messages !== null && messages.length === 0 && <p className="fv-empty">No messages yet. Say hello to the tribe.</p>}
          {messages?.map((m) => (
            <Message key={m.id} m={m} own={m.playerId === player.id} minute={minute} />
          ))}
        </div>
        {unseen > 0 && (
          <button type="button" className="fv-btn frt-new-msgs" onClick={jump}>
            {unseen} new ↓
          </button>
        )}
      </div>
      <form className="frt-ci" onSubmit={(e) => void send(e)}>
        <label className="visually-hidden" htmlFor="frt-chat-full">Message</label>
        <input
          id="frt-chat-full"
          value={text}
          placeholder="Message"
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setSendError(null);
          }}
        />
        {trimmed.length > TRIBE_CHAT_MESSAGE_MAX * 0.8 && <CharCount value={text} max={TRIBE_CHAT_MESSAGE_MAX} />}
        <button type="submit" className="fv-btn fv-btn-g" disabled={!trimmed || over || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
        {(sendError || over || (messages !== null && error)) && (
          <span className="form-error frt-ce" role="alert">
            {over ? `Too long (max ${TRIBE_CHAT_MESSAGE_MAX}).` : (sendError ?? 'Reconnecting…')}
          </span>
        )}
      </form>
    </section>
  );
}
