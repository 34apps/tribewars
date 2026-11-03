// Tribe forum (docs/GAME_DESIGN.md section 11). Members of the tribe only; anything the caller may not see is
// not_found. Every mutation runs in one transaction (Store.tx) and re-checks membership and rights inside it.
// Text goes through the same sanitiser as mail and chat; the client renders it as text.

import {
  FORUM_BOARDS_MAX,
  FORUM_BOARD_NAME_MAX,
  FORUM_EDIT_WINDOW_MS,
  FORUM_MIN_GAP_MS,
  FORUM_PAGE_SIZE,
  FORUM_PER_HOUR,
  FORUM_PER_MINUTE,
  FORUM_POSTS_PER_THREAD,
  FORUM_POST_MAX,
  FORUM_THREADS_KEEP,
  FORUM_THREAD_TITLE_MAX,
  GameError,
  canTribe,
  seesLeadershipBoards,
  type CreateBoardRequest,
  type ForumBoardDto,
  type ForumBoardsResponse,
  type ForumPostDto,
  type ForumPostRule,
  type ForumThreadResponse,
  type ForumThreadSummaryDto,
  type ForumThreadsResponse,
  type ForumVisibility,
  type UpdateBoardRequest,
  type UpdateThreadRequest,
} from '@clanfire/engine';
import type { BoardRow, PostRow, ThreadRow } from './forum-store.ts';
import { assertNotMuted } from './mute.ts';
import type { PlayerRow, Store } from './store.ts';
import { cleanText, len } from './tribe-service.ts';
import type { MembershipRow } from './tribe-store.ts';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const MAX_TRACKED = 5000;

/** Per-member spam guard in memory (threads and replies together): a minimum gap, a per-minute and a per-hour cap. */
class ForumLimiter {
  private readonly recent = new Map<number, number[]>();

  allow(playerId: number, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((x) => x > now - HOUR);
    const last = times[times.length - 1];
    const lastMinute = times.filter((x) => x > now - MINUTE).length;
    if ((last !== undefined && now - last < FORUM_MIN_GAP_MS) || lastMinute >= FORUM_PER_MINUTE || times.length >= FORUM_PER_HOUR) {
      this.recent.set(playerId, times);
      return false;
    }
    if (this.recent.size >= MAX_TRACKED && !this.recent.has(playerId)) this.sweep(now);
    times.push(now);
    this.recent.set(playerId, times);
    return true;
  }

  private sweep(now: number): void {
    for (const [id, times] of this.recent) {
      const last = times[times.length - 1];
      if (last === undefined || last <= now - HOUR) this.recent.delete(id);
    }
  }
}

const notFound = (what: string): GameError => new GameError('not_found', `That ${what} does not exist.`);
const invalid = (message: string): GameError => new GameError('invalid_input', message);

export class ForumService {
  private readonly limiter = new ForumLimiter();

  constructor(private readonly store: Store) {}

  private get fs() {
    return this.store.forum;
  }

  // ---- guards ------------------------------------------------------------------------------------

  /** Non-members learn nothing: not_found, like a missing board. */
  private member(player: PlayerRow): MembershipRow {
    const m = this.store.tribes.membership(player.id);
    if (!m) throw notFound('forum');
    return m;
  }

  /** For reports: a post (with its thread title) only if the caller may read it; otherwise not_found. */
  postVisibleTo(player: PlayerRow, postId: number): { post: PostRow; title: string } {
    const m = this.member(player);
    const post = this.postFor(m, postId);
    const { thread } = this.threadFor(m, post.threadId);
    return { post, title: thread.title };
  }

  private leadership(m: MembershipRow): boolean {
    return seesLeadershipBoards(m.role, m.grants);
  }

  private visible(m: MembershipRow, b: BoardRow): boolean {
    return b.tribeId === m.tribeId && (b.visibility === 'members' || this.leadership(m));
  }

  private boardFor(m: MembershipRow, id: number): BoardRow {
    const b = this.fs.board(id, m.playerId);
    if (!b || !this.visible(m, b)) throw notFound('board');
    return b;
  }

  private threadFor(m: MembershipRow, id: number): { thread: ThreadRow; board: BoardRow } {
    const thread = this.fs.thread(id, m.playerId);
    const board = thread ? this.fs.board(thread.boardId, m.playerId) : null;
    if (!thread || !board || !this.visible(m, board)) throw notFound('thread');
    return { thread, board };
  }

  private require(m: MembershipRow, action: 'forum_manage' | 'forum_moderate'): void {
    if (!canTribe(m.role, action, m.grants)) {
      throw new GameError('forbidden', action === 'forum_manage' ? "You don't have the right to manage the forum boards." : "You don't have the right to moderate the forum.");
    }
  }

  private text(raw: string, what: string, max: number, min = 1): string {
    const s = cleanText(raw, what);
    const n = len(s);
    if (n < min || n > max) throw invalid(`${what} needs ${min} to ${max} characters.`);
    return s;
  }

  private throttle(playerId: number, t: number): void {
    if (!this.limiter.allow(playerId, t)) throw new GameError('rate_limited', 'You are posting too fast. Please slow down.');
  }

  // ---- reads -------------------------------------------------------------------------------------

  boards(player: PlayerRow, t: number): ForumBoardsResponse {
    const m = this.member(player);
    // Tribes made before the forum existed (or emptied) get the default boards on first visit.
    if (this.fs.boardCount(m.tribeId) === 0) this.store.tx(() => this.fs.createDefaultBoards(m.tribeId, t));
    return { boards: this.fs.boards(m.tribeId, player.id).filter((b) => this.visible(m, b)).map((b) => this.boardDto(m, b)) };
  }

  threads(player: PlayerRow, boardId: number, page: number): ForumThreadsResponse {
    const m = this.member(player);
    const board = this.boardFor(m, boardId);
    const rows = this.fs.threads(board.id, player.id, FORUM_PAGE_SIZE + 1, page * FORUM_PAGE_SIZE);
    return { board: this.boardDto(m, board), threads: rows.slice(0, FORUM_PAGE_SIZE).map(threadDto), page, hasMore: rows.length > FORUM_PAGE_SIZE };
  }

  /** Opening a thread marks it read for the caller. */
  thread(player: PlayerRow, threadId: number, page: number, t: number): ForumThreadResponse {
    const m = this.member(player);
    const { thread, board } = this.threadFor(m, threadId);
    this.fs.markRead(player.id, thread.id, t);
    const rows = this.fs.posts(thread.id, FORUM_PAGE_SIZE + 1, page * FORUM_PAGE_SIZE);
    return {
      thread: { ...threadDto(thread), unread: false },
      board: this.boardDto(m, board),
      posts: rows.slice(0, FORUM_PAGE_SIZE).map((p) => this.postDto(m, p, thread, t)),
      page,
      hasMore: rows.length > FORUM_PAGE_SIZE,
    };
  }

  // ---- boards (forum_manage) ---------------------------------------------------------------------

  createBoard(player: PlayerRow, body: CreateBoardRequest, t: number): ForumBoardDto {
    const name = this.text(body.name, 'The board name', FORUM_BOARD_NAME_MAX);
    return this.store.tx(() => {
      const m = this.member(player);
      this.require(m, 'forum_manage');
      if (this.fs.boardCount(m.tribeId) >= FORUM_BOARDS_MAX) {
        throw new GameError('requirements_not_met', `A tribe can have at most ${FORUM_BOARDS_MAX} boards. Delete one first.`);
      }
      const id = this.fs.insertBoard(m.tribeId, name, body.visibility ?? 'members', body.postRule ?? 'members', t);
      return this.boardDto(m, this.boardFor(m, id));
    });
  }

  updateBoard(player: PlayerRow, boardId: number, body: UpdateBoardRequest): ForumBoardDto {
    if (body.name === undefined && body.visibility === undefined && body.postRule === undefined) throw invalid('Nothing to change.');
    const name = body.name === undefined ? null : this.text(body.name, 'The board name', FORUM_BOARD_NAME_MAX);
    return this.store.tx(() => {
      const m = this.member(player);
      this.require(m, 'forum_manage');
      const b = this.boardFor(m, boardId);
      const visibility: ForumVisibility = body.visibility ?? b.visibility;
      const postRule: ForumPostRule = body.postRule ?? b.postRule;
      this.fs.updateBoard(b.id, name ?? b.name, visibility, postRule);
      return this.boardDto(m, this.boardFor(m, b.id));
    });
  }

  deleteBoard(player: PlayerRow, boardId: number): void {
    this.store.tx(() => {
      const m = this.member(player);
      this.require(m, 'forum_manage');
      this.fs.deleteBoard(this.boardFor(m, boardId).id);
    });
  }

  // ---- threads and posts -------------------------------------------------------------------------

  createThread(player: PlayerRow, boardId: number, rawTitle: string, rawBody: string, t: number): ForumThreadResponse {
    assertNotMuted(player, t);
    const title = this.text(rawTitle, 'The title', FORUM_THREAD_TITLE_MAX);
    const body = this.text(rawBody, 'The post', FORUM_POST_MAX);
    const id = this.store.tx(() => {
      const m = this.member(player);
      const board = this.boardFor(m, boardId);
      if (board.postRule === 'leadership' && !this.leadership(m)) {
        throw new GameError('forbidden', 'Only the leadership can start threads on this board.');
      }
      this.throttle(player.id, t);
      if (this.fs.threadCountOf(board.id) >= FORUM_THREADS_KEEP) {
        const old = this.fs.oldestUnpinned(board.id);
        if (old === null) throw new GameError('requirements_not_met', 'This board is full of pinned threads. Unpin one first.');
        this.fs.deleteThread(old);
      }
      const threadId = this.fs.insertThread(board.id, m.tribeId, player.id, title, t);
      this.fs.insertPost(threadId, player.id, body, t);
      this.fs.refreshThread(threadId, t);
      this.fs.markRead(player.id, threadId, t);
      return threadId;
    });
    return this.thread(player, id, 0, t);
  }

  reply(player: PlayerRow, threadId: number, rawBody: string, t: number): ForumPostDto {
    assertNotMuted(player, t);
    const body = this.text(rawBody, 'The post', FORUM_POST_MAX);
    return this.store.tx(() => {
      const m = this.member(player);
      const { thread } = this.threadFor(m, threadId);
      if (thread.locked) throw new GameError('forbidden', 'This thread is locked.');
      if (thread.postCount >= FORUM_POSTS_PER_THREAD) {
        throw new GameError('requirements_not_met', `This thread is full (${FORUM_POSTS_PER_THREAD} posts). Start a new one.`);
      }
      this.throttle(player.id, t);
      const id = this.fs.insertPost(thread.id, player.id, body, t);
      this.fs.refreshThread(thread.id, t);
      this.fs.markRead(player.id, thread.id, t);
      const post = this.fs.post(id);
      if (!post) throw notFound('post');
      return this.postDto(m, post, { ...thread, postCount: thread.postCount + 1 }, t);
    });
  }

  editPost(player: PlayerRow, postId: number, rawBody: string, t: number): ForumPostDto {
    assertNotMuted(player, t);
    const body = this.text(rawBody, 'The post', FORUM_POST_MAX);
    return this.store.tx(() => {
      const m = this.member(player);
      const post = this.postFor(m, postId);
      const { thread } = this.threadFor(m, post.threadId);
      if (!this.mayEdit(m, post, thread, t)) {
        throw new GameError('forbidden', 'You can only edit your own posts, within 15 minutes of writing them.');
      }
      this.fs.editPost(post.id, body, t);
      const updated = this.fs.post(post.id);
      if (!updated) throw notFound('post');
      return this.postDto(m, updated, thread, t);
    });
  }

  /** Own post, or any post with forum_moderate. Deleting the first post removes the whole thread. */
  deletePost(player: PlayerRow, postId: number): void {
    this.store.tx(() => {
      const m = this.member(player);
      const post = this.postFor(m, postId);
      const { thread } = this.threadFor(m, post.threadId);
      if (post.authorId !== player.id && !canTribe(m.role, 'forum_moderate', m.grants)) {
        throw new GameError('forbidden', 'You can only delete your own posts.');
      }
      if (post.id === post.firstId) {
        this.fs.deleteThread(thread.id);
      } else {
        this.fs.deletePost(post.id);
        this.fs.refreshThread(thread.id, thread.createdAt);
      }
    });
  }

  updateThread(player: PlayerRow, threadId: number, body: UpdateThreadRequest): ForumThreadSummaryDto {
    if (body.pinned === undefined && body.locked === undefined) throw invalid('Nothing to change.');
    return this.store.tx(() => {
      const m = this.member(player);
      const { thread } = this.threadFor(m, threadId);
      this.require(m, 'forum_moderate');
      this.fs.setThreadFlags(thread.id, body.pinned ?? thread.pinned, body.locked ?? thread.locked);
      const row = this.fs.thread(thread.id, player.id);
      if (!row) throw notFound('thread');
      return threadDto(row);
    });
  }

  deleteThread(player: PlayerRow, threadId: number): void {
    this.store.tx(() => {
      const m = this.member(player);
      const { thread } = this.threadFor(m, threadId);
      this.require(m, 'forum_moderate');
      this.fs.deleteThread(thread.id);
    });
  }

  // ---- internals ---------------------------------------------------------------------------------

  private postFor(m: MembershipRow, id: number): PostRow & { tribeId: number; firstId: number } {
    const post = this.fs.post(id);
    if (!post || post.tribeId !== m.tribeId) throw notFound('post');
    return post;
  }

  /** The author within the edit window, or (their own posts) a moderator at any time. Locked threads: moderators only. */
  private mayEdit(m: MembershipRow, post: PostRow, thread: ThreadRow, t: number): boolean {
    if (post.authorId !== m.playerId) return false;
    const mod = canTribe(m.role, 'forum_moderate', m.grants);
    if (thread.locked && !mod) return false;
    return mod || t - post.createdAt <= FORUM_EDIT_WINDOW_MS;
  }

  private boardDto(m: MembershipRow, b: BoardRow): ForumBoardDto {
    return {
      id: b.id,
      name: b.name,
      visibility: b.visibility,
      postRule: b.postRule,
      position: b.position,
      threadCount: b.threadCount,
      unread: b.unread,
      canPost: b.postRule === 'members' || this.leadership(m),
    };
  }

  private postDto(m: MembershipRow, p: PostRow, thread: ThreadRow, t: number): ForumPostDto {
    return {
      id: p.id,
      threadId: p.threadId,
      authorId: p.authorId,
      author: p.author,
      body: p.body,
      createdAt: p.createdAt,
      editedAt: p.editedAt,
      canEdit: this.mayEdit(m, p, thread, t),
      canDelete: p.authorId === m.playerId || canTribe(m.role, 'forum_moderate', m.grants),
    };
  }
}

function threadDto(r: ThreadRow): ForumThreadSummaryDto {
  return {
    id: r.id,
    boardId: r.boardId,
    title: r.title,
    authorId: r.authorId,
    author: r.author,
    pinned: r.pinned,
    locked: r.locked,
    createdAt: r.createdAt,
    lastPostAt: r.lastPostAt,
    postCount: r.postCount,
    unread: r.unread,
  };
}
