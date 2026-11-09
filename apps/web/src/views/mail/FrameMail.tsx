// The desktop Mail page inside the fixed 1440 x 900 frame (owner-approved picture mix-mail2-1440): one row per person on the left
// (All / Unread, paging instead of scrolling), the letters with the chosen person on the right as a thread (the one place that
// scrolls), a reply box at the bottom, and a compose form for new mail. Phones keep MailView.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MAIL_BODY_MAX, MAIL_SUBJECT_MAX } from '@clanfire/engine';
import type { MailConversationDto, MailDto, PlayerProfileDto } from '@clanfire/engine';
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
import { MAIL_PEOPLE_PER_PAGE, filterConversations, letterTime, replySubject, sortConversations, threadItems, threadOrder } from './frame-mail-logic.ts';
import type { MailFilter } from './frame-mail-logic.ts';
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

function Compose({ initialTo, initialSubject, names, onSent }: { initialTo: string; initialSubject: string; names: string[]; onSent: (m: MailDto) => void }) {
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
      toast(`Sent to ${sent.to}.`);
      onSent(sent);
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' });
      setBusy(false);
    }
  };
  return (
    <section className="fv-pn frm-detail" aria-label="New mail">
      <div className="fv-ph">
        <h2>New mail</h2>
      </div>
      <form className="frm-cmp" onSubmit={(e) => void submit(e)}>
        <label className="frm-f">
          <span>To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} maxLength={64} list="frm-names" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Player name" />
          <datalist id="frm-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
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
  const names = useMemo(() => (all ?? []).map((c) => c.player), [all]);
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
          names={names}
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
