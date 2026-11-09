// The desktop Mail page inside the fixed 1440 x 900 frame (owner-approved picture mix-mail2-1440): one row per person on the left
// (All / Unread, paging instead of scrolling), the letters with the chosen person on the right as a thread (the one place that
// scrolls), a reply box at the bottom, and a compose form for new mail. Phones keep MailView.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { MAIL_BODY_MAX, MAIL_SUBJECT_MAX } from '@clanfire/engine';
import type { MailConversationDto, MailDto, MyTribeResponse, PlayerProfileDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { ChieftainAvatar } from '../../art/Chieftain.tsx';
import { Icon } from '../../art/Icon.tsx';
import { ReportButton } from '../../components/supportBits.tsx';
import { formatAgo, formatCoords } from '../../format.ts';
import { useGame } from '../../game.ts';
import { useLiveTopic } from '../../hooks/useLive.tsx';
import { Dialog } from '../army/FrameArmy.tsx';
import { Chev } from '../village/FrameParts.tsx';
import { pageSlice, paging } from '../reports/frame-reports-logic.ts';
import { MAIL_PEOPLE_PER_PAGE, ROLE_LABEL, filterConversations, lastMailLabel, letterTime, replySubject, searchCandidates, seenLabel, sortConversations, threadItems, threadOrder } from './frame-mail-logic.ts';
import type { Candidate, MailFilter } from './frame-mail-logic.ts';
import '../../frame-mail.css';

/** Same small set as the phone's compose form. */
const EMOJI = ['😀', '😂', '🙂', '😉', '😎', '😢', '😡', '👍', '👏', '🙏', '🔥', '⚔️', '🛡️', '🏹', '💰', '🎉'];
const THREAD_BATCH = 30;
/** The server lists 20 people per page; read this many pages at most. */
const MAX_LIST_PAGES = 10;

/** The draft nonce already opened, so a remount does not reopen the same compose form. */
let consumedDraft = 0;

const charCount = (s: string): number => [...s].length;

// Profiles already fetched (portrait, village link). Shared by the list rows and the header.
const profiles = new Map<number, PlayerProfileDto>();
const profileWaiters = new Set<() => void>();

function useProfile(playerId: number | null): PlayerProfileDto | null {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    profileWaiters.add(fn);
    return () => void profileWaiters.delete(fn);
  }, []);
  useEffect(() => {
    if (playerId === null || profiles.has(playerId)) return;
    api
      .playerProfile(playerId)
      .then((p) => {
        profiles.set(playerId, p);
        profileWaiters.forEach((f) => f());
      })
      .catch(() => undefined);
  }, [playerId]);
  return playerId === null ? null : (profiles.get(playerId) ?? null);
}

function Face({ conv, size }: { conv: Pick<MailConversationDto, 'playerId' | 'player'>; size: number }) {
  const p = profiles.get(conv.playerId);
  return p ? (
    <ChieftainAvatar id={p.chieftain} size={size} className="frm-av" />
  ) : (
    <span className="frm-av frm-ini" style={{ width: size, height: size }} aria-hidden="true">
      {[...conv.player][0]?.toUpperCase() ?? '?'}
    </span>
  );
}

// ---- List ------------------------------------------------------------------------------------------------------------

function ListPanel({
  all,
  filter,
  setFilter,
  unread,
  page,
  setPage,
  selected,
  onSelect,
  onNew,
  now,
  error,
  retry,
}: {
  all: MailConversationDto[] | null;
  filter: MailFilter;
  setFilter: (f: MailFilter) => void;
  unread: number;
  page: number;
  setPage: (p: number) => void;
  selected: number | null;
  onSelect: (c: MailConversationDto) => void;
  onNew: () => void;
  now: number;
  error: string | null;
  retry: () => void;
}) {
  const filtered = useMemo(() => filterConversations(all ?? [], filter), [all, filter]);
  const pg = paging(filtered.length, page, MAIL_PEOPLE_PER_PAGE);
  const rows = pageSlice(filtered, pg.page, MAIL_PEOPLE_PER_PAGE);
  // Fetch the portraits of the people on show (cached; a failure just keeps the initial).
  const [, bump] = useState(0);
  useEffect(() => {
    for (const c of rows) {
      if (profiles.has(c.playerId)) continue;
      api
        .playerProfile(c.playerId)
        .then((p) => {
          profiles.set(c.playerId, p);
          bump((n) => n + 1);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((c) => c.playerId).join(',')]);
  return (
    <section className="fv-pn frm-list" aria-label="People">
      <div className="frm-top">
        <div className="frm-seg" role="group" aria-label="Show">
          <button type="button" className={`frm-sg${filter === 'all' ? ' on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          <button type="button" className={`frm-sg${filter === 'unread' ? ' on' : ''}`} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread
            {unread > 0 && <i aria-label={`${unread} unread`}>{unread}</i>}
          </button>
        </div>
        <span className="fv-sp" />
        <button type="button" className="fv-btn fv-btn-g" onClick={onNew}>
          <Icon name="mail" size={18} /> New mail
        </button>
      </div>
      <div className="frm-rows">
        {error && (
          <p className="form-error frm-pad" role="alert">
            {error}{' '}
            <button type="button" className="fv-lk" onClick={retry}>
              Retry
            </button>
          </p>
        )}
        {all === null && !error && <p className="fv-empty frm-pad">Loading…</p>}
        {all !== null && filtered.length === 0 && <p className="fv-empty frm-pad">{all.length === 0 ? 'No mail yet. Write to someone with New mail.' : 'Nothing unread.'}</p>}
        {rows.map((c) => {
          const sel = selected === c.playerId;
          return (
            <button key={c.playerId} type="button" className={`frm-rr${sel ? ' sel' : ''}${c.unread > 0 && !sel ? ' unr' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => onSelect(c)}>
              <Face conv={c} size={42} />
              <span className="frm-rb">
                <span className="frm-rl">
                  <b>{c.player}</b>
                  <span className="frm-rt">{formatAgo(c.lastAt, now)}</span>
                </span>
                <span className="frm-rp">
                  {c.lastFromMe ? 'You: ' : ''}
                  {c.lastPreview || c.lastSubject || '(no text)'}
                </span>
              </span>
              {c.unread > 0 && <i className="frm-cnt" aria-label={`${c.unread} unread`}>{c.unread}</i>}
            </button>
          );
        })}
      </div>
      <div className="frm-pgr">
        <span className="fv-mut">{pg.total === 0 ? '0 people' : `${pg.from}–${pg.to} of ${pg.total} people`}</span>
        <span className="fv-sp" />
        <button type="button" className="fv-pg" aria-label="Previous people" disabled={pg.page <= 0} onClick={() => setPage(pg.page - 1)}>
          <Chev flip size={16} />
        </button>
        <button type="button" className="fv-pg" aria-label="More people" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>
          <Chev size={16} />
        </button>
      </div>
    </section>
  );
}

// ---- Thread ----------------------------------------------------------------------------------------------------------

function Thread({ conv, onChanged, onDeleted }: { conv: MailConversationDto; onChanged: () => void; onDeleted: () => void }) {
  const { player, now, refresh, toast, showOnMap } = useGame();
  const [mails, setMails] = useState<MailDto[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  /** What to do with the scroll position after the next render: go to the bottom, or keep the view where it was. */
  const pending = useRef<'bottom' | { height: number } | null>(null);
  const id = conv.playerId;
  const profile = useProfile(id);

  const loadNewest = useCallback(
    async (initial: boolean) => {
      try {
        const res = await api.mailThread(id, undefined, THREAD_BATCH);
        setMails((cur) => {
          const el = scroller.current;
          const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          const merged = threadOrder(cur, res.mails);
          if (initial || (nearBottom && merged.length !== cur.length)) pending.current = 'bottom';
          return merged;
        });
        if (initial) setNextBefore(res.nextBefore);
        setError(null);
        setLoaded(true);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [id],
  );

  useEffect(() => {
    setMails([]);
    setNextBefore(null);
    setLoaded(false);
    setBody('');
    void loadNewest(true);
  }, [id, loadNewest]);
  useLiveTopic('mail', () => void loadNewest(false));

  useLayoutEffect(() => {
    const el = scroller.current;
    const p = pending.current;
    if (!el || !p) return;
    el.scrollTop = p === 'bottom' ? el.scrollHeight : el.scrollHeight - p.height;
    pending.current = null;
  }, [mails]);

  // Opening a thread with unread letters (or new ones arriving while it is open) marks them read.
  useEffect(() => {
    if (!loaded || conv.unread === 0) return;
    api
      .markConversationRead(id)
      .then(() => {
        onChanged();
        void refresh();
      })
      .catch(() => undefined);
  }, [loaded, conv.unread, id, onChanged, refresh]);

  // The reply subject follows the newest letter's subject.
  const lastSubject = mails[mails.length - 1]?.subject ?? conv.lastSubject;
  useEffect(() => {
    setSubject(replySubject(lastSubject));
  }, [id, lastSubject]);

  const loadOlder = async () => {
    if (nextBefore === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.mailThread(id, nextBefore, THREAD_BATCH);
      pending.current = { height: scroller.current?.scrollHeight ?? 0 };
      setMails((cur) => threadOrder(res.mails, cur));
      setNextBefore(res.nextBefore);
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    } finally {
      setLoadingOlder(false);
    }
  };
  const onScroll = () => {
    const el = scroller.current;
    if (el && el.scrollTop < 40 && nextBefore !== null && !loadingOlder) void loadOlder();
  };

  const bodyLen = charCount(body);
  const canSend = !busy && body.trim() !== '' && bodyLen <= MAIL_BODY_MAX && charCount(subject) <= MAIL_SUBJECT_MAX;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const sent = await api.sendMail({ to: conv.player, subject: subject.trim(), body });
      pending.current = 'bottom';
      setMails((cur) => threadOrder(cur, [sent]));
      setBody('');
      onChanged();
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteConversation(id);
      setConfirmDelete(false);
      void refresh();
      onDeleted();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => threadItems(mails, now, player.id), [mails, now, player.id]);
  const village = profile?.villages[0];

  return (
    <section className="fv-pn frm-detail" aria-label={`Mail with ${conv.player}`}>
      <div className="frm-dh">
        <Face conv={conv} size={52} />
        <div className="frm-dt">
          <h2>{conv.player}</h2>
          <span className="frm-ds">
            {village ? (
              <button type="button" className="fv-lk" onClick={() => showOnMap(village.x, village.y)} title="Open on map">
                {village.name} ({formatCoords(village.x, village.y)})
              </button>
            ) : (
              <span className="fv-mut">{profile ? 'No villages' : ' '}</span>
            )}
            {profile?.tribe && <span className="frm-tag">{profile.tribe.tag}</span>}
            {profile && profile.villageCount > 0 && <span className="fv-mut">· {profile.villageCount} {profile.villageCount === 1 ? 'village' : 'villages'}</span>}
          </span>
        </div>
        <span className="fv-sp" />
        <button type="button" className="fv-btn frm-del" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete conversation
        </button>
      </div>
      <div className="frm-th" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Letters">
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button type="button" className="fv-lk" onClick={() => void loadNewest(mails.length === 0)}>
              Retry
            </button>
          </p>
        )}
        {!loaded && !error && <p className="fv-empty">Loading…</p>}
        {loaded && mails.length === 0 && !error && <p className="fv-empty">No letters yet. Write the first one below.</p>}
        {loadingOlder && <p className="fv-empty frm-older">Loading older letters…</p>}
        {items.map((it) =>
          it.kind === 'day' ? (
            <div key={it.key} className="frm-day">
              <span>{it.label}</span>
            </div>
          ) : (
            <article key={it.key} className={`frm-ltr${it.mine ? ' mine' : ''}`}>
              <div className="frm-lh">
                {it.showSubject ? <b>{it.mail.subject}</b> : <span />}
                <span className="frm-lt">
                  {it.mine ? 'You · ' : ''}
                  {letterTime(it.mail.createdAt)}
                </span>
              </div>
              {/* Plain text only: React escapes it; line breaks come from CSS. */}
              <p className="frm-lb">{it.mail.body}</p>
              {!it.mine && <ReportButton kind="mail" refId={it.mail.id} about={`mail from ${it.mail.from}`} className="frm-rep" />}
            </article>
          ),
        )}
      </div>
      <form className="frm-reply" onSubmit={(e) => void send(e)}>
        <div className="frm-rbox">
          <label className="frm-subj">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MAIL_SUBJECT_MAX * 2} aria-label="Subject" />
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Write to ${conv.player}…`} aria-label="Message" rows={2} />
        </div>
        <div className="frm-rside">
          <span className={`frm-count${bodyLen > MAIL_BODY_MAX ? ' over' : ''}`} aria-live="polite">
            {bodyLen} / {MAIL_BODY_MAX}
          </span>
          <button type="submit" className="fv-btn fv-btn-g" disabled={!canSend}>
            <Icon name="mail" size={18} /> {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
      {confirmDelete && (
        <Dialog title="Delete conversation?" onClose={() => setConfirmDelete(false)}>
          <div className="frm-conf">
            <p>
              This removes every letter with <b>{conv.player}</b> from your mailbox. They keep their copy. It cannot be undone.
            </p>
            <div className="frm-conf-b">
              <button type="button" className="fv-btn" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button type="button" className="fv-btn frm-del" disabled={busy} onClick={() => void remove()}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

// ---- Compose ---------------------------------------------------------------------------------------------------------

const RECENT_SHOWN = 5;
const TRIBE_SHOWN = 5;

function Pick({ name, tag, face, sub, subOnline, right, onPick }: { name: string; tag?: string | null; face: ReactNode; sub?: string | null; subOnline?: boolean; right?: ReactNode; onPick: () => void }) {
  return (
    <button type="button" className="frm-pk" onClick={onPick}>
      {face}
      <span className="frm-pkb">
        <b>{name}</b>
        {sub && <span className={`frm-pks${subOnline ? ' on' : ''}`}>{sub}</span>}
      </span>
      {right ?? (tag ? <span className="frm-tag">{tag}</span> : null)}
    </button>
  );
}

/** Middle column: search any player, recent conversations, my tribe. A click hands the name to the "To" field. */
function WhoPicker({ conversations, now, onPick }: { conversations: MailConversationDto[]; now: number; onPick: (name: string) => void }) {
  const { player } = useGame();
  const [q, setQ] = useState('');
  const [ranked, setRanked] = useState<Candidate[]>([]);
  const [tribe, setTribe] = useState<MyTribeResponse | null>(null);
  const [tribePage, setTribePage] = useState(0);
  const [, bump] = useState(0);
  const rankingLoaded = useRef(false);

  useEffect(() => {
    let dead = false;
    api
      .myTribe()
      .then((r) => !dead && setTribe(r))
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);
  // The top-100 ranking is the only player list the client has; it loads when the player starts typing.
  useEffect(() => {
    if (q.trim() === '' || rankingLoaded.current) return;
    rankingLoaded.current = true;
    api
      .playerRanking()
      .then((r) => setRanked(r.players.map((p) => ({ playerId: p.playerId, name: p.username, tag: p.tribe?.tag ?? null }))))
      .catch(() => (rankingLoaded.current = false));
  }, [q]);

  const members = useMemo(() => (tribe?.tribe?.memberList ?? []).filter((m) => m.playerId !== player.id), [tribe, player.id]);
  const recent = conversations.slice(0, RECENT_SHOWN);
  const pool = useMemo<Candidate[]>(() => {
    const tagOf = (id: number) => profiles.get(id)?.tribe?.tag ?? null;
    return [
      ...conversations.map((c) => ({ playerId: c.playerId, name: c.player, tag: tagOf(c.playerId) })),
      ...members.map((m) => ({ playerId: m.playerId, name: m.username, tag: tribe?.tribe?.tag ?? null })),
      ...ranked,
    ];
  }, [conversations, members, ranked, tribe]);
  const results = useMemo(() => searchCandidates(q, pool, player.username), [q, pool, player.username]);

  // Portraits for the conversation rows (cached; the initial stays on failure).
  useEffect(() => {
    for (const c of recent) {
      if (profiles.has(c.playerId)) continue;
      api
        .playerProfile(c.playerId)
        .then((p) => {
          profiles.set(c.playerId, p);
          bump((n) => n + 1);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent.map((c) => c.playerId).join(',')]);

  const pages = Math.max(1, Math.ceil(members.length / TRIBE_SHOWN));
  const shownMembers = members.slice((tribePage % pages) * TRIBE_SHOWN, (tribePage % pages) * TRIBE_SHOWN + TRIBE_SHOWN);
  const searching = q.trim() !== '';
  const tag = tribe?.tribe?.tag;

  return (
    <section className="fv-pn frm-who" aria-label="Who to write to">
      <div className="fv-ph">
        <h2>Who to write to</h2>
      </div>
      <label className="frm-sr">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4.5 4.5" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player" aria-label="Search any player" maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      {searching ? (
        <div className="frm-pkl">
          <h3 className="frm-sh">Matches</h3>
          {results.length === 0 && <p className="fv-empty frm-pad">No player called "{q.trim()}" among the people the game lists here. You can still type the exact name in To.</p>}
          {results.map((c) => (
            <Pick
              key={c.playerId}
              name={c.name}
              tag={c.tag}
              face={<Face conv={{ playerId: c.playerId, player: c.name }} size={36} />}
              onPick={() => {
                setQ('');
                onPick(c.name);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="frm-pkl">
          <h3 className="frm-sh">Recent conversations</h3>
          {recent.length === 0 && <p className="fv-empty frm-pad">No conversations yet.</p>}
          {recent.map((c) => (
            <Pick
              key={c.playerId}
              name={c.player}
              sub={lastMailLabel(formatAgo(c.lastAt, now))}
              tag={profiles.get(c.playerId)?.tribe?.tag ?? null}
              right={profiles.has(c.playerId) && !profiles.get(c.playerId)?.tribe ? <span className="fv-mut">no tribe</span> : undefined}
              face={<Face conv={c} size={36} />}
              onPick={() => onPick(c.player)}
            />
          ))}
          {tag && (
            <>
              <h3 className="frm-sh">
                Your tribe · {tag}
                {pages > 1 && (
                  <button type="button" className="fv-lk frm-all" onClick={() => setTribePage((n) => n + 1)}>
                    All {members.length} <Chev size={14} />
                  </button>
                )}
              </h3>
              {shownMembers.map((m) => {
                const seen = seenLabel(m, (ts) => formatAgo(ts, now));
                return (
                  <Pick
                    key={m.playerId}
                    name={m.username}
                    sub={seen?.text ?? null}
                    subOnline={seen?.online}
                    face={<ChieftainAvatar id={m.chieftain} size={36} className="frm-av" />}
                    right={<span className={`frm-role r-${m.role}`}>{ROLE_LABEL[m.role] ?? m.role}</span>}
                    onPick={() => onPick(m.username)}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Compose({ initialTo, initialSubject, conversations, now, onSent }: { initialTo: string; initialSubject: string; conversations: MailConversationDto[]; now: number; onSent: (m: MailDto) => void }) {
  const { toast } = useGame();
  const [picked, setPicked] = useState<string | null>(initialTo.trim() === '' ? null : initialTo.trim());
  const [typed, setTyped] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const to = (picked ?? typed).trim();
  const bodyLen = charCount(body);
  const canSend = !busy && to !== '' && body.trim() !== '' && bodyLen <= MAIL_BODY_MAX && charCount(subject) <= MAIL_SUBJECT_MAX;
  const pickedConv = conversations.find((c) => c.player.toLowerCase() === (picked ?? '').toLowerCase());
  const pickedTag = pickedConv ? (profiles.get(pickedConv.playerId)?.tribe?.tag ?? null) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const sent = await api.sendMail({ to, subject: subject.trim(), body });
      toast(`Sent to ${sent.to}.`);
      onSent(sent);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
      setBusy(false);
    }
  };
  return (
    <>
      <WhoPicker
        conversations={conversations}
        now={now}
        onPick={(name) => {
          setPicked(name);
          setTyped('');
        }}
      />
      <section className="fv-pn frm-detail frm-form" aria-label="New mail">
        <div className="fv-ph">
          <h2>New mail</h2>
        </div>
        <form className="frm-cmp" onSubmit={(e) => void submit(e)}>
          <div className="frm-f">
            <span id="frm-to-l">To</span>
            {picked ? (
              <div className="frm-to" aria-labelledby="frm-to-l">
                <span className="frm-chip">
                  {pickedConv ? <Face conv={pickedConv} size={26} /> : null}
                  <b>{picked}</b>
                  {pickedTag && <span className="frm-tag">{pickedTag}</span>}
                  <button type="button" className="frm-chx" aria-label={`Remove ${picked}`} onClick={() => setPicked(null)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
                    </svg>
                  </button>
                </span>
              </div>
            ) : (
              <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Player name, or pick one from the list" aria-labelledby="frm-to-l" />
            )}
          </div>
          <label className="frm-f">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MAIL_SUBJECT_MAX * 2} />
          </label>
          <label className="frm-f frm-fgrow">
            <span>Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="frm-emo" role="group" aria-label="Add an emoji">
            {EMOJI.map((em) => (
              <button key={em} type="button" className="frm-eb" aria-label={`Add ${em}`} onClick={() => setBody((b) => b + em)}>
                {em}
              </button>
            ))}
          </div>
          <div className="frm-cfoot">
            <span className={`frm-count${bodyLen > MAIL_BODY_MAX ? ' over' : ''}`} aria-live="polite">
              {bodyLen} / {MAIL_BODY_MAX}
            </span>
            <button type="submit" className="fv-btn fv-btn-g" disabled={!canSend}>
              <Icon name="mail" size={18} /> {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

// ---- The page --------------------------------------------------------------------------------------------------------

export function FrameMail() {
  const { unreadMail, now, mailDraft, refresh } = useGame();
  const [all, setAll] = useState<MailConversationDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MailFilter>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; key: number } | null>(null);
  const [unread, setUnread] = useState(0);

  const loadList = useCallback(async () => {
    try {
      const out: MailConversationDto[] = [];
      let total = 0;
      for (let p = 0; p < MAX_LIST_PAGES; p++) {
        const res = await api.mailConversations(p);
        out.push(...res.conversations);
        total = res.total;
        setUnread(res.unread);
        if (out.length >= total || res.conversations.length === 0) break;
      }
      setAll(sortConversations(out));
      setListError(null);
    } catch (e) {
      setListError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadList();
  }, [loadList, unreadMail]);
  useLiveTopic('mail', () => void loadList());

  // A draft from Reply, a profile or a ranking row opens the compose form once.
  useEffect(() => {
    if (!mailDraft || mailDraft.nonce === consumedDraft) return;
    consumedDraft = mailDraft.nonce;
    setCompose({ to: mailDraft.to, subject: mailDraft.subject, key: mailDraft.nonce });
  }, [mailDraft]);

  // Open the newest conversation when nothing (or something no longer listed) is open.
  useEffect(() => {
    if (all === null || compose) return;
    if (selected !== null && all.some((c) => c.playerId === selected)) return;
    setSelected(all[0]?.playerId ?? null);
    setPage(0);
  }, [all, selected, compose]);

  const conv = all?.find((c) => c.playerId === selected) ?? null;
  const onChanged = useCallback(() => void loadList(), [loadList]);
  const onFilter = (f: MailFilter) => {
    setFilter(f);
    setPage(0);
  };

  return (
    <div className="frm">
      <ListPanel
        all={all}
        filter={filter}
        setFilter={onFilter}
        unread={unread}
        page={page}
        setPage={setPage}
        selected={compose ? null : selected}
        onSelect={(c) => {
          setCompose(null);
          setSelected(c.playerId);
        }}
        onNew={() => setCompose({ to: '', subject: '', key: Date.now() })}
        now={now}
        error={listError}
        retry={() => void loadList()}
      />
      {compose ? (
        <Compose
          key={compose.key}
          initialTo={compose.to}
          initialSubject={compose.subject}
          conversations={all ?? []}
          now={now}
          onSent={(m) => {
            void refresh();
            void loadList().then(() => {
              setSelected(m.toId);
              setCompose(null);
            });
          }}
        />
      ) : conv ? (
        <Thread
          key={conv.playerId}
          conv={conv}
          onChanged={onChanged}
          onDeleted={() => {
            setAll((cur) => cur?.filter((c) => c.playerId !== conv.playerId) ?? cur);
            setSelected(null);
            void loadList();
          }}
        />
      ) : (
        <section className="fv-pn frm-detail" aria-label="Mail">
          <div className="fv-ph">
            <h2>Mail</h2>
          </div>
          <p className="fv-empty frm-pad">{all === null ? 'Loading…' : all.length === 0 ? 'No mail yet. Letters you send and receive will show here, one thread per person.' : 'Pick a person.'}</p>
        </section>
      )}
    </div>
  );
}
