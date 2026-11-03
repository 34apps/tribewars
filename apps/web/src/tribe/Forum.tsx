import { useCallback, useEffect, useState } from 'react';
import { FORUM_POST_MAX, FORUM_THREAD_TITLE_MAX } from '@clanfire/engine';
import type { ForumBoardDto, ForumPostDto, ForumThreadResponse, ForumThreadSummaryDto } from '@clanfire/engine';
import { api, errorMessage } from '../api.ts';
import { useGame } from '../game.ts';
import { ReportButton } from '../components/supportBits.tsx';
import { PlainText } from './bits.tsx';
import { useTribe } from './context.ts';

const EMOJI = ['😀', '😂', '👍', '🔥', '⚔️', '🛡️', '🎉', '❤️'];

/** Tribe forum: boards -> threads -> posts. Text and emoji only; the server decides who may do what. */
export function Forum() {
  const { toast, player } = useGame();
  const { data } = useTribe();
  const can = (r: string) => (data.rights as string[]).includes(r);
  const [boards, setBoards] = useState<ForumBoardDto[] | null>(null);
  const [board, setBoard] = useState<ForumBoardDto | null>(null);
  const [threads, setThreads] = useState<ForumThreadSummaryDto[]>([]);
  const [thread, setThread] = useState<ForumThreadResponse | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  const fail = useCallback((e: unknown) => toast(errorMessage(e)), [toast]);
  const loadBoards = useCallback(() => api.forumBoards().then((r) => setBoards(r.boards)).catch(fail), [fail]);
  const openBoard = useCallback(
    (b: ForumBoardDto) => api.forumThreads(b.id, 0).then((r) => { setBoard(r.board); setThreads(r.threads); }).catch(fail),
    [fail],
  );
  const openThread = useCallback((id: number) => api.forumThread(id, 0).then(setThread).catch(fail), [fail]);
  useEffect(() => { void loadBoards(); }, [loadBoards]);

  async function act(fn: () => Promise<unknown>, after: () => Promise<unknown> | void) {
    try {
      await fn();
      setText('');
      setTitle('');
      await after();
    } catch (e) {
      fail(e);
    }
  }

  const composer = (placeholder: string, withTitle: boolean, send: () => void) => (
    <form className="card" onSubmit={(e) => { e.preventDefault(); send(); }}>
      {withTitle && <input className="input" value={title} maxLength={FORUM_THREAD_TITLE_MAX} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />}
      <textarea className="input" rows={4} value={text} maxLength={FORUM_POST_MAX} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        {EMOJI.map((em) => <button type="button" key={em} className="btn btn-small" style={{ minHeight: 44, minWidth: 44 }} aria-label={`Insert ${em}`} onClick={() => setText((t) => t + em)}>{em}</button>)}
      </div>
      <button className="btn btn-primary" style={{ minHeight: 44 }} disabled={text.trim() === '' || (withTitle && title.trim() === '')}>Post</button>
    </form>
  );

  if (thread) {
    const t = thread.thread;
    const refresh = () => openThread(t.id);
    const back = () => { setThread(null); if (board) void openBoard(board); void loadBoards(); };
    return (
      <div className="forum">
        <button className="btn" style={{ minHeight: 44 }} onClick={back}>Back to {thread.board.name}</button>
        <h2>{t.pinned ? '📌 ' : ''}{t.locked ? '🔒 ' : ''}{t.title}</h2>
        {can('forum_moderate') && (
          <div className="row">
            <button className="btn" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumUpdateThread(t.id, { pinned: !t.pinned }), refresh)}>{t.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumUpdateThread(t.id, { locked: !t.locked }), refresh)}>{t.locked ? 'Unlock' : 'Lock'}</button>
            <button className="btn btn-danger-outline" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumDeleteThread(t.id), back)}>Delete thread</button>
          </div>
        )}
        {thread.posts.map((p: ForumPostDto) => (
          <article className="card" key={p.id}>
            <strong>{p.author}</strong> <span className="muted small">{new Date(p.createdAt).toLocaleString()}{p.editedAt ? ' (edited)' : ''}</span>
            <PlainText text={p.body} />
            <div className="row">
              {p.canEdit && <button className="btn btn-small" style={{ minHeight: 44 }} onClick={() => setText(p.body)}>Copy to edit</button>}
              {p.canEdit && text.trim() !== '' && <button className="btn btn-small" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumEditPost(p.id, text), refresh)}>Save as edit</button>}
              {p.authorId !== player.id && <ReportButton kind="forum_post" refId={p.id} about={`a post by ${p.author}`} className="btn btn-small btn-danger-outline" />}
              {p.canDelete && <button className="btn btn-small btn-danger-outline" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumDeletePost(p.id), refresh)}>Delete</button>}
            </div>
          </article>
        ))}
        {thread.hasMore && <p className="muted">Showing the first {thread.posts.length} posts.</p>}
        {t.locked ? <p className="muted">This thread is locked.</p> : composer('Write a reply', false, () => void act(() => api.forumReply(t.id, text), refresh))}
      </div>
    );
  }

  if (board) {
    return (
      <div className="forum">
        <button className="btn" style={{ minHeight: 44 }} onClick={() => { setBoard(null); void loadBoards(); }}>All boards</button>
        <h2>{board.name}</h2>
        <ul className="list">
          {threads.map((t) => (
            <li key={t.id}>
              <button className="btn" style={{ minHeight: 44, width: '100%', textAlign: 'left' }} onClick={() => void openThread(t.id)}>
                {t.unread ? '● ' : ''}{t.pinned ? '📌 ' : ''}{t.locked ? '🔒 ' : ''}{t.title} <span className="muted small">by {t.author}, {t.postCount} posts</span>
              </button>
            </li>
          ))}
        </ul>
        {threads.length === 0 && <p className="muted">No threads yet.</p>}
        {board.canPost
          ? composer('First post', true, () => void act(() => api.forumNewThread(board.id, title, text).then(setThread), () => undefined))
          : <p className="muted">Only the leadership starts threads here. You can reply to them.</p>}
        {can('forum_manage') && (
          <button className="btn btn-danger-outline" style={{ minHeight: 44 }} onClick={() => void act(() => api.forumDeleteBoard(board.id), () => { setBoard(null); return loadBoards(); })}>Delete board</button>
        )}
      </div>
    );
  }

  return (
    <div className="forum">
      {boards === null && <p className="muted" role="status">Loading forum…</p>}
      <ul className="list">
        {(boards ?? []).map((b) => (
          <li key={b.id}>
            <button className="btn" style={{ minHeight: 44, width: '100%', textAlign: 'left' }} onClick={() => void openBoard(b)}>
              {b.unread > 0 ? '● ' : ''}{b.name} <span className="muted small">{b.threadCount} threads{b.visibility === 'leadership' ? ', leadership only' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {can('forum_manage') && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void act(() => api.forumCreateBoard(title, 'members', 'members'), loadBoards); }}>
          <input className="input" value={title} maxLength={40} placeholder="New board name" onChange={(e) => setTitle(e.target.value)} />
          <button className="btn" style={{ minHeight: 44 }} disabled={title.trim() === ''}>Add board</button>
        </form>
      )}
    </div>
  );
}
