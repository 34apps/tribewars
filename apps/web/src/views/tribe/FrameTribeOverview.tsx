// The Overview sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe2-1440.png): Alerts and About on the
// left, the latest Forum threads in the middle, Tribe chat on the right, and three slim summary lines at the bottom.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { TRIBE_CHAT_KEEP, TRIBE_CHAT_MESSAGE_MAX, canTribe } from '@clanfire/engine';
import type { ChatMessageDto, ForumThreadSummaryDto, TribeAlertDto, TribeHoldDto, TribeProjectRunDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { formatAgo, formatChatTime, formatClock, formatDate, formatDuration, formatInt } from '../../format.ts';
import { useGame } from '../../game.ts';
import { pollMs } from '../../hooks/live.ts';
import { useLiveConnected, useLiveTopic } from '../../hooks/useLive.tsx';
import { PlainText, RECRUITMENT_NAME } from '../../tribe/bits.tsx';
import { useTribe } from '../../tribe/context.ts';
import type { MemberProps } from '../../tribe/context.ts';
import { SettingsForm } from '../../tribe/Overview.tsx';
import { alertCount, sortHolds } from '../../villages.ts';
import { Dialog } from '../army/FrameArmy.tsx';
import { Chev, pluralUnit } from '../village/FrameParts.tsx';
import { OVERVIEW_ALERTS, OVERVIEW_CHAT, alertDetail, diplomacyLine, formatHms, latestThreads, projectsLine, topMember } from './frame-tribe-logic.ts';

export type TribeSection = 'alerts' | 'overview' | 'members' | 'diplomacy' | 'projects' | 'recruit' | 'chat' | 'forum' | 'log';

const ALERT_POLL_MS = 10_000;

/** Attacks and cold villages of the tribe, like the Alerts section (same endpoint, same refresh rules). */
function useAlertFeed() {
  const { tribeAlerts } = useGame();
  const [alerts, setAlerts] = useState<TribeAlertDto[] | null>(null);
  const [holds, setHolds] = useState<TribeHoldDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const applied = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const res = await api.tribeAlerts();
      if (my < applied.current) return;
      applied.current = my;
      setAlerts([...res.alerts].sort((a, b) => a.arriveAt - b.arriveAt));
      setHolds(sortHolds(res.holds ?? []));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, tribeAlerts]);
  const every = pollMs(ALERT_POLL_MS, useLiveConnected());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, every);
    return () => window.clearInterval(id);
  }, [load, every]);
  useLiveTopic('tribe', () => void load());
  return { alerts, holds, error, retry: () => void load() };
}

function AlertsPanel({ onOpen }: { onOpen: (s: TribeSection) => void }) {
  const { now, villages, showOnMap, viewMovement } = useGame();
  const { alerts, holds, error, retry } = useAlertFeed();
  const count = alertCount(alerts, holds);
  const attacks = alerts ?? [];
  const shownAttacks = attacks.slice(0, OVERVIEW_ALERTS);
  const shownHolds = holds.slice(0, Math.max(0, OVERVIEW_ALERTS - shownAttacks.length));
  const more = count - shownAttacks.length - shownHolds.length;
  return (
    <section className="fv-pn frt-alerts" aria-label="Alerts">
      <div className="fv-ph frt-ph">
        <h2>Alerts</h2>
        {count > 0 && <span className="frt-cnt is-red" aria-label={`${count} alerts`}>{count}</span>}
        <span className="fv-sp" />
        <button type="button" className="fv-lk" onClick={() => onOpen('alerts')}>
          {more > 0 ? `All alerts (+${more})` : 'All alerts'} <Chev />
        </button>
      </div>
      <div className="frt-als">
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button type="button" className="fv-lk" onClick={retry}>
              Retry
            </button>
          </p>
        )}
        {alerts === null && !error && <p className="fv-empty" role="status">Loading…</p>}
        {alerts !== null && count === 0 && <p className="fv-empty frt-quiet">No attacks on the way. All quiet.</p>}
        {shownAttacks.map((a) => {
          const mine = villages.some((v) => v.id === a.target.villageId);
          const owner = mine ? 'you' : (a.target.ownerName ?? 'member');
          const left = a.arriveAt - now;
          const detail = alertDetail(a, (u) => pluralUnit(u));
          return (
            <button
              key={a.movementId}
              type="button"
              className="frt-al"
              onClick={() => (mine ? viewMovement(a.movementId) : showOnMap(a.target.x, a.target.y))}
              aria-label={`Attack on ${owner}, ${a.target.name}, lands ${formatClock(a.arriveAt, now)}`}
            >
              <span className="frt-tg">Attack</span>
              <span className="frt-alt">
                <b>On {owner} · {a.target.name}</b>
                <small>
                  {a.attacker.ownerName ?? 'unknown'}
                  {a.attackerTribeTag ? ` [${a.attackerTribeTag}]` : ''}
                  {detail ? ` · ${detail}` : ''}
                </small>
              </span>
              <span className="frt-alc">
                <span className="frt-cd">{left > 0 ? formatDuration(left) : 'landing…'}</span>
                <small>lands {formatClock(a.arriveAt, now)}</small>
              </span>
            </button>
          );
        })}
        {shownHolds.map((h) => {
          const mine = villages.some((v) => v.id === h.village.villageId);
          return (
            <button key={h.village.villageId} type="button" className="frt-al" onClick={() => showOnMap(h.village.x, h.village.y)}>
              <span className="frt-tg">Hearth out</span>
              <span className="frt-alt">
                <b>{mine ? 'You' : (h.village.ownerName ?? 'Member')} · {h.village.name}</b>
                <small>The village is held by an occupier</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AboutPanel({ tribe, role }: MemberProps) {
  const [open, setOpen] = useState(false);
  const canEdit = canTribe(role, 'edit_settings');
  const has = tribe.description.trim() !== '';
  return (
    <section className="fv-pn frt-about" aria-label="About">
      <div className="fv-ph frt-ph">
        <h2>About</h2>
        <span className="fv-sp" />
        {(has || canEdit) && (
          <button type="button" className="fv-lk" onClick={() => setOpen(true)}>
            {has ? 'Read more' : 'Write one'} <Chev />
          </button>
        )}
      </div>
      {has ? <p className="frt-ab">{tribe.description}</p> : <p className="fv-empty frt-ab">No description yet.</p>}
      {open && (
        <Dialog title={`About ${tribe.name}`} onClose={() => setOpen(false)}>
          <div className="frt-aboutd">
            {!canEdit && (has ? <PlainText text={tribe.description} /> : <p className="muted">No description.</p>)}
            <dl className="facts">
              <div><dt>Recruitment</dt><dd>{RECRUITMENT_NAME[tribe.recruitment]}</dd></div>
              <div><dt>Founded</dt><dd>{formatDate(tribe.createdAt)}</dd></div>
            </dl>
            {canEdit && <SettingsForm tribe={tribe} role={role} />}
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** The newest threads over all boards (boards and threads are the ones the caller may see). */
function useLatestThreads(unread: number) {
  const [threads, setThreads] = useState<ForumThreadSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const { boards } = await api.forumBoards();
      const lists = await Promise.all(boards.slice(0, 8).map((b) => api.forumThreads(b.id, 0).then((r) => r.threads)));
      setThreads(latestThreads(lists.flat()));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, unread]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);
  return { threads, error };
}

function ForumPanel({ onOpen }: { onOpen: (s: TribeSection) => void }) {
  const { now } = useGame();
  const { data } = useTribe();
  const { threads, error } = useLatestThreads(data.forumUnread);
  return (
    <section className="fv-pn frt-forum" aria-label="Forum">
      <div className="fv-ph frt-ph">
        <h2>Forum</h2>
        {data.forumUnread > 0 && <span className="frt-cnt">{data.forumUnread} new</span>}
        <span className="fv-sp" />
        <button type="button" className="fv-lk" onClick={() => onOpen('forum')}>
          Open <Chev />
        </button>
      </div>
      {error && <p className="form-error frt-pad" role="alert">{error}</p>}
      {threads === null && !error && <p className="fv-empty frt-pad" role="status">Loading…</p>}
      {threads !== null && threads.length === 0 && <p className="fv-empty frt-pad">No threads yet. Start one in the Forum.</p>}
      <div className="frt-ths">
        {threads?.map((t) => (
          <button key={t.id} type="button" className="frt-th" onClick={() => onOpen('forum')}>
            {t.unread ? <span className="frt-dot" aria-label="New posts" /> : <span className="frt-nod" aria-hidden="true" />}
            <span className="frt-tht">
              <b>{t.title}</b>
              <small>
                {t.author} · {t.postCount} {t.postCount === 1 ? 'post' : 'posts'} · {formatAgo(t.lastPostAt, now)}
              </small>
            </span>
            <Chev size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** The last chat messages and a way to send one: the same endpoints and refresh rules as the Chat section. */
function useChatFeed() {
  const [messages, setMessages] = useState<ChatMessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
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
  const fetchNow = useCallback(
    async (initial: boolean) => {
      try {
        const res = await api.chat(initial ? undefined : lastId.current || undefined);
        if (initial) setMessages(res.messages);
        else merge(res.messages);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [merge],
  );
  useEffect(() => {
    void fetchNow(true);
  }, [fetchNow]);
  const every = pollMs(5000, useLiveConnected());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void fetchNow(false);
    }, every);
    return () => window.clearInterval(id);
  }, [fetchNow, every]);
  useLiveTopic('chat', () => void fetchNow(false));
  return { messages, error, merge };
}

function ChatPanel({ onOpen }: { onOpen: (s: TribeSection) => void }) {
  const { now } = useGame();
  const { messages, error, merge } = useChatFeed();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const trimmed = text.trim();
  const over = [...trimmed].length > TRIBE_CHAT_MESSAGE_MAX;
  const minute = Math.floor(now / 60_000) * 60_000;
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || over || sending) return;
    setSending(true);
    setSendError(null);
    try {
      merge([await api.sendChat(trimmed)]);
      setText('');
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }
  const shown = (messages ?? []).slice(-OVERVIEW_CHAT);
  return (
    <section className="fv-pn frt-chat" aria-label="Tribe chat">
      <div className="fv-ph frt-ph">
        <h2>Tribe chat</h2>
        <span className="fv-sp" />
        <button type="button" className="fv-lk" onClick={() => onOpen('chat')}>
          Open <Chev />
        </button>
      </div>
      <div className="frt-msgs" role="log" aria-live="polite" aria-label="Latest messages">
        {messages === null && <p className="fv-empty">{error ? `${error} Retrying…` : 'Loading…'}</p>}
        {messages !== null && messages.length === 0 && <p className="fv-empty">No messages yet. Say hello to the tribe.</p>}
        {shown.map((m) => (
          <div key={m.id} className="frt-msg">
            <ChieftainAvatar id={m.chieftain} size={38} className="frt-av" />
            <span className="frt-mt">
              <span className="frt-mn">
                <b>{m.username}</b>
                <span>{formatChatTime(m.createdAt, minute)}</span>
              </span>
              <span className="frt-mx">{m.text}</span>
            </span>
          </div>
        ))}
      </div>
      <form className="frt-ci" onSubmit={(e) => void send(e)}>
        <label className="visually-hidden" htmlFor="frt-chat-input">Message to the tribe</label>
        <input
          id="frt-chat-input"
          value={text}
          placeholder="Write to the tribe…"
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setSendError(null);
          }}
        />
        <button type="submit" className="fv-btn fv-btn-g" disabled={!trimmed || over || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
        {(sendError || over) && <span className="form-error frt-ce" role="alert">{over ? `Too long (max ${TRIBE_CHAT_MESSAGE_MAX}).` : sendError}</span>}
      </form>
    </section>
  );
}

function SummaryRow({ onOpen, tribe }: { onOpen: (s: TribeSection) => void; tribe: MemberProps['tribe'] }) {
  const { now } = useGame();
  const { data } = useTribe();
  const [running, setRunning] = useState<TribeProjectRunDto | null>(null);
  useEffect(() => {
    let off = false;
    api
      .tribeProjects()
      .then((r) => !off && setRunning(r.running))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [tribe.projectLevels]);
  const waiting = data.proposals.filter((p) => p.direction === 'incoming').length;
  const top = topMember(tribe.memberList);
  const items: Array<[TribeSection, string, string]> = [
    ['diplomacy', 'Diplomacy', diplomacyLine(tribe.relations, waiting)],
    ['projects', 'Projects', projectsLine(running, running ? formatHms(running.endsAt - now) : '', tribe.projectLevels)],
    ['members', 'Top member', top ? `${top.username} · ${formatInt(top.points)} points` : 'no members'],
  ];
  return (
    <div className="frt-sum">
      {items.map(([k, label, line]) => (
        <button key={k} type="button" className="frt-sm" onClick={() => onOpen(k)}>
          <span className="fv-up">{label}</span>
          <span className="frt-smt">{line}</span>
          <span className="fv-sp" />
          <Chev size={14} />
        </button>
      ))}
    </div>
  );
}

export function FrameTribeOverview({ tribe, role, onOpen }: MemberProps & { onOpen: (s: TribeSection) => void }) {
  return (
    <div className="frt-ov">
      <div className="frt-ovtop">
        <div className="frt-col frt-col-l">
          <AlertsPanel onOpen={onOpen} />
          <AboutPanel tribe={tribe} role={role} />
        </div>
        <ForumPanel onOpen={onOpen} />
        <ChatPanel onOpen={onOpen} />
      </div>
      <SummaryRow onOpen={onOpen} tribe={tribe} />
    </div>
  );
}
