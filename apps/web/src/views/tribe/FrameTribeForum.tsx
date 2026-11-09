// The Forum sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-forum-1440.png): boards, the threads of
// the picked board (6 to a page) and the open thread, whose posts scroll inside their pane with the reply box fixed at the bottom.
// Same endpoints and rights as the phone's Forum (tribe/Forum.tsx); the server decides who may do what.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FORUM_POST_MAX, FORUM_THREAD_TITLE_MAX } from '@clanfire/engine';
import type { ForumBoardDto, ForumPostDto, ForumThreadResponse, ForumThreadSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../../api.ts';
import { ReportButton } from '../../components/supportBits.tsx';
import { useGame } from '../../game.ts';
import { PlainText } from '../../tribe/bits.tsx';
import { useTribe } from '../../tribe/context.ts';
import { formatAgo } from '../../format.ts';
import { logTime, threadPaging, THREADS_PER_PAGE } from './frame-tribe-logic.ts';
import { PageButtons } from './frame-tribe-bits.tsx';

const EMOJI = ['😀', '😂', '👍', '🔥', '⚔️', '🛡️', '🎉', '❤️'];

function Emoji({ onPick }: { onPick: (e: string) => void }) {
  return (
    <span className="frt-emo">
      {EMOJI.map((em) => (
        <button key={em} type="button" aria-label={`Insert ${em}`} onClick={() => onPick(em)}>
          {em}
        </button>
      ))}
    </span>
  );
}

export function FrameTribeForum() {
  const { toast, player, now } = useGame();
  const { data } = useTribe();
  const can = (r: string) => (data.rights as string[]).includes(r);
  const [boards, setBoards] = useState<ForumBoardDto[] | null>(null);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [threads, setThreads] = useState<ForumThreadSummaryDto[]>([]);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [serverPage, setServerPage] = useState(0);
  const [page, setPage] = useState(0);
  const [thread, setThread] = useState<ForumThreadResponse | null>(null);
  const [posts, setPosts] = useState<ForumPostDto[]>([]);
  const [postsMore, setPostsMore] = useState(false);
  const [postPage, setPostPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [boardName, setBoardName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const toEnd = useRef(true);

  const fail = useCallback((e: unknown) => toast(errorMessage(e)), [toast]);
  const board = boards?.find((b) => b.id === boardId) ?? null;

  const loadThreads = useCallback(
    async (id: number, sp: number, append: boolean) => {
      try {
        const r = await api.forumThreads(id, sp);
        setThreads((cur) => (append ? [...cur, ...r.threads.filter((t) => !cur.some((c) => c.id === t.id))] : r.threads));
        setHasMoreThreads(r.hasMore);
        setServerPage(sp);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  const openThread = useCallback(
    async (id: number) => {
      try {
        const r = await api.forumThread(id, 0);
        setThread(r);
        setPosts(r.posts);
        setPostsMore(r.hasMore);
        setPostPage(0);
        setCreating(false);
        setEditing(null);
        setText('');
        toEnd.current = true;
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  const loadBoards = useCallback(async () => {
    try {
      const r = await api.forumBoards();
      setBoards(r.boards);
      return r.boards;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [fail]);
  const openBoard = useCallback(
    async (b: ForumBoardDto, openFirst: boolean) => {
      setBoardId(b.id);
      setPage(0);
      setCreating(false);
      setThread(null);
      setPosts([]);
      setEditing(null);
      setText('');
      try {
        const r = await api.forumThreads(b.id, 0);
        setThreads(r.threads);
        setHasMoreThreads(r.hasMore);
        setServerPage(0);
        const first = r.threads.find((t) => t.unread) ?? r.threads[0];
        if (openFirst && first) await openThread(first.id);
      } catch (e) {
        fail(e);
      }
    },
    [fail, openThread],
  );
  // First visit: the boards, then the board with new posts (else the first) and its newest thread.
  useEffect(() => {
    void loadBoards().then((bs) => {
      const first = bs?.find((b) => b.unread > 0) ?? bs?.[0];
      if (first) void openBoard(first, true);
    });
  }, [loadBoards, openBoard]);

  // The newest post is in view when a thread opens or after a reply.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && toEnd.current) {
      el.scrollTop = el.scrollHeight;
      toEnd.current = false;
    }
  }, [posts]);

  async function act(fn: () => Promise<unknown>, after: () => Promise<unknown> | void) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setText('');
      setTitle('');
      setEditing(null);
      await after();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const refreshAll = async (id: number) => {
    await openThread(id);
    if (boardId !== null) await loadThreads(boardId, 0, false);
    setPage(0);
    await loadBoards();
  };
  const loadMorePosts = async () => {
    if (!thread) return;
    try {
      const r = await api.forumThread(thread.thread.id, postPage + 1);
      setPostPage(postPage + 1);
      setPosts((cur) => [...cur, ...r.posts.filter((p) => !cur.some((c) => c.id === p.id))]);
      setPostsMore(r.hasMore);
    } catch (e) {
      fail(e);
    }
  };

  const tp = threadPaging(threads.length, page, hasMoreThreads);
  const shown = threads.slice(tp.page * THREADS_PER_PAGE, tp.page * THREADS_PER_PAGE + THREADS_PER_PAGE);
  const goPage = async (p: number) => {
    if (p > tp.page && tp.needsFetch && boardId !== null) await loadThreads(boardId, serverPage + 1, true);
    setPage(Math.max(0, p));
  };

  const t = thread?.thread ?? null;
  const textOk = text.trim() !== '';
  const post = () => {
    if (!textOk || busy) return;
    if (creating && board) void act(() => api.forumNewThread(board.id, title, text).then((r) => refreshAll(r.thread.id)), () => undefined);
    else if (editing !== null && t) void act(() => api.forumEditPost(editing, text), () => refreshAll(t.id));
    else if (t) void act(() => api.forumReply(t.id, text), async () => {
      toEnd.current = true;
      await openThread(t.id);
      if (boardId !== null) await loadThreads(boardId, 0, false);
    });
  };

  return (
    <div className="frt-fo">
      <section className="fv-pn frt-fb" aria-label="Boards">
        <div className="fv-ph frt-ph">
          <h2>Boards</h2>
        </div>
        {boards === null && <p className="fv-empty frt-pad" role="status">Loading…</p>}
        <div className="frt-bl">
          {(boards ?? []).map((b) => (
            <button key={b.id} type="button" className={`frt-bd${b.id === boardId ? ' on' : ''}`} aria-pressed={b.id === boardId} onClick={() => void openBoard(b, true)}>
              <span className="frt-bdt">
                <b>{b.name}</b>
                <small>
                  {b.threadCount} {b.threadCount === 1 ? 'thread' : 'threads'}
                  {b.visibility === 'leadership' ? ' · leaders' : ''}
                </small>
              </span>
              {b.unread > 0 && <span className="frt-dot" aria-label={`${b.unread} with new posts`} />}
            </button>
          ))}
        </div>
        {can('forum_manage') && (
          <form
            className="frt-nb"
            onSubmit={(e) => {
              e.preventDefault();
              if (boardName.trim()) void act(() => api.forumCreateBoard(boardName, 'members', 'members'), async () => { setBoardName(''); await loadBoards(); });
            }}
          >
            <input className="frt-in" value={boardName} maxLength={40} placeholder="New board name" aria-label="New board name" onChange={(e) => setBoardName(e.target.value)} />
            <button type="submit" className="fv-btn" disabled={boardName.trim() === '' || busy}>
              Add board
            </button>
          </form>
        )}
      </section>

      <section className="fv-pn frt-ft" aria-label="Threads">
        <div className="fv-ph frt-ph">
          <h2>{board?.name ?? 'Threads'}</h2>
          <span className="fv-sp" />
          {board?.canPost && (
            <button
              type="button"
              className="fv-btn fv-btn-g"
              onClick={() => {
                setCreating(true);
                setEditing(null);
                setText('');
                setTitle('');
              }}
            >
              New thread
            </button>
          )}
        </div>
        {board && threads.length === 0 && <p className="fv-empty frt-pad">No threads yet.{board.canPost ? '' : ' Leaders post here.'}</p>}
        <div className="frt-tl">
          {shown.map((th) => (
            <button key={th.id} type="button" className={`frt-trow${!creating && t?.id === th.id ? ' on' : ''}`} onClick={() => void openThread(th.id)}>
              <span className="frt-trt">
                <b>
                  {th.pinned && <span className="frt-flag">Pinned</span>}
                  {th.locked && <span className="frt-flag">Locked</span>}
                  <span className="frt-tti">{th.title}</span>
                </b>
                <small>
                  {th.author} · {th.postCount} {th.postCount === 1 ? 'post' : 'posts'} · {formatAgo(th.lastPostAt, now)}
                </small>
              </span>
              {th.unread && <span className="frt-dot" aria-label="New posts" />}
            </button>
          ))}
        </div>
        {(tp.page > 0 || tp.hasNext) && (
          <div className="frt-pgr">
            <span className="fv-mut">{tp.from}–{tp.to}{hasMoreThreads ? '+' : ''}</span>
            <span className="fv-sp" />
            <PageButtons page={tp.page} pages={tp.hasNext ? tp.page + 2 : tp.page + 1} onPage={(p) => void goPage(p)} label="threads" />
          </div>
        )}
      </section>

      <section className="fv-pn frt-fp" aria-label={creating ? 'New thread' : (t?.title ?? 'Thread')}>
        <div className="fv-ph frt-ph">
          <h2 className="frt-fh">{creating ? 'New thread' : (t?.title ?? 'Thread')}</h2>
          <span className="fv-sp" />
          {!creating && t && can('forum_moderate') && (
            <>
              <button type="button" className="fv-btn" disabled={busy} onClick={() => void act(() => api.forumUpdateThread(t.id, { pinned: !t.pinned }), () => refreshAll(t.id))}>
                {t.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button type="button" className="fv-btn" disabled={busy} onClick={() => void act(() => api.forumUpdateThread(t.id, { locked: !t.locked }), () => refreshAll(t.id))}>
                {t.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                className="fv-btn frt-del"
                disabled={busy}
                onClick={() =>
                  void act(() => api.forumDeleteThread(t.id), async () => {
                    setThread(null);
                    setPosts([]);
                    if (board) await openBoard(board, true);
                    await loadBoards();
                  })
                }
              >
                Delete
              </button>
            </>
          )}
        </div>
        {!creating && !t && <p className="fv-empty frt-pad">{board ? 'Pick a thread to read it.' : 'Pick a board.'}</p>}
        {creating && (
          <div className="frt-newt">
            <label className="frt-fld">
              <span className="frt-fl">Title</span>
              <input className="frt-in" value={title} maxLength={FORUM_THREAD_TITLE_MAX} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="frt-fld frt-grow">
              <span className="frt-fl">First post</span>
              <textarea className="frt-ta" value={text} maxLength={FORUM_POST_MAX} placeholder="First post" onChange={(e) => setText(e.target.value)} />
            </label>
            <Emoji onPick={(em) => setText((x) => x + em)} />
          </div>
        )}
        {!creating && t && (
          <div className="frt-posts" ref={listRef} tabIndex={0} aria-label="Posts">
            {posts.map((p) => (
              <article key={p.id} className="frt-po">
                <span className="frt-mt">
                  <span className="frt-mn">
                    <b>{p.author}</b>
                    <span>
                      {logTime(p.createdAt, now)}
                      {p.editedAt ? ' (edited)' : ''}
                    </span>
                    <span className="fv-sp" />
                    {p.canEdit && (
                      <button
                        type="button"
                        className="fv-lk frt-pl2"
                        onClick={() => {
                          setEditing(p.id);
                          setText(p.body);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {p.canDelete && (
                      <button type="button" className="fv-lk frt-pl2" disabled={busy} onClick={() => void act(() => api.forumDeletePost(p.id), () => refreshAll(t.id))}>
                        Delete
                      </button>
                    )}
                    {p.authorId !== player.id && <ReportButton kind="forum_post" refId={p.id} about={`a post by ${p.author}`} className="fv-lk frt-pl2" />}
                  </span>
                  <PlainText className="frt-cx" text={p.body} />
                </span>
              </article>
            ))}
            {postsMore && (
              <button type="button" className="fv-btn frt-more" onClick={() => void loadMorePosts()}>
                Show more posts
              </button>
            )}
          </div>
        )}
        {(creating || (t && !t.locked)) && (
          <form
            className="frt-ci frt-rb"
            onSubmit={(e) => {
              e.preventDefault();
              post();
            }}
          >
            {!creating && editing !== null && (
              <span className="frt-ce frt-editing">
                Editing your post.{' '}
                <button type="button" className="fv-lk" onClick={() => { setEditing(null); setText(''); }}>
                  Cancel edit
                </button>
              </span>
            )}
            {!creating && (
              <>
                <label className="visually-hidden" htmlFor="frt-reply">Write a reply</label>
                <input id="frt-reply" value={text} maxLength={FORUM_POST_MAX} placeholder="Write a reply" autoComplete="off" onChange={(e) => setText(e.target.value)} />
                <button type="button" className="fv-xb" aria-expanded={emoji} aria-label="Emoji" onClick={() => setEmoji((v) => !v)}>
                  😀
                </button>
              </>
            )}
            <button type="submit" className="fv-btn fv-btn-g" disabled={!textOk || busy || (creating && title.trim() === '')}>
              {creating ? 'Post thread' : editing !== null ? 'Save edit' : 'Post'}
            </button>
            {creating && (
              <button type="button" className="fv-btn" onClick={() => { setCreating(false); setText(''); setTitle(''); }}>
                Cancel
              </button>
            )}
            {emoji && !creating && <Emoji onPick={(em) => setText((x) => x + em)} />}
          </form>
        )}
        {!creating && t?.locked && <p className="frt-locked">This thread is locked.</p>}
      </section>
    </div>
  );
}
