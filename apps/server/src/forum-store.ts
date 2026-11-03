// SQL for the tribe forum: prepared statements with bound parameters only. Rules live in forum-service.ts.

import type { ForumPostRule, ForumVisibility } from '@clanfire/engine';
import { SqlBase, type Raw } from './sql.ts';

export interface BoardRow {
  id: number;
  tribeId: number;
  name: string;
  visibility: ForumVisibility;
  postRule: ForumPostRule;
  position: number;
  threadCount: number;
  /** Threads with posts newer than the viewer's read marker (0 unless loaded with a viewer). */
  unread: number;
}

export interface ThreadRow {
  id: number;
  boardId: number;
  tribeId: number;
  authorId: number;
  author: string;
  title: string;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  lastPostAt: number;
  postCount: number;
  unread: boolean;
}

export interface PostRow {
  id: number;
  threadId: number;
  authorId: number;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

/** A thread is unread for a viewer when its last post is newer than their marker (their join time when never opened). */
const UNREAD = 'e.last_post_at > COALESCE(r.last_read_at, m.joined_at)';

const BOARD_SQL = `
SELECT b.id, b.tribe_id, b.name, b.visibility, b.post_rule, b.position,
       (SELECT COUNT(*) FROM forum_threads x WHERE x.board_id = b.id) AS thread_count,
       (SELECT COUNT(*) FROM forum_threads e
          JOIN tribe_members m ON m.player_id = ?
          LEFT JOIN forum_reads r ON r.thread_id = e.id AND r.player_id = m.player_id
          WHERE e.board_id = b.id AND ${UNREAD}) AS unread
FROM forum_boards b`;

const THREAD_SQL = `
SELECT e.id, e.board_id, e.tribe_id, e.author_id, p.username, e.title, e.pinned, e.locked, e.created_at, e.last_post_at, e.post_count,
       (${UNREAD}) AS unread
FROM forum_threads e
JOIN players p ON p.id = e.author_id
LEFT JOIN tribe_members m ON m.player_id = ?
LEFT JOIN forum_reads r ON r.thread_id = e.id AND r.player_id = ?`;

function toBoard(r: Raw): BoardRow {
  return {
    id: r.id as number,
    tribeId: r.tribe_id as number,
    name: r.name as string,
    visibility: r.visibility as ForumVisibility,
    postRule: r.post_rule as ForumPostRule,
    position: r.position as number,
    threadCount: r.thread_count as number,
    unread: r.unread as number,
  };
}

function toThread(r: Raw): ThreadRow {
  return {
    id: r.id as number,
    boardId: r.board_id as number,
    tribeId: r.tribe_id as number,
    authorId: r.author_id as number,
    author: r.username as string,
    title: r.title as string,
    pinned: r.pinned === 1,
    locked: r.locked === 1,
    createdAt: r.created_at as number,
    lastPostAt: r.last_post_at as number,
    postCount: r.post_count as number,
    unread: Number(r.unread ?? 0) === 1,
  };
}

function toPost(r: Raw): PostRow {
  return {
    id: r.id as number,
    threadId: r.thread_id as number,
    authorId: r.author_id as number,
    author: r.username as string,
    body: r.body as string,
    createdAt: r.created_at as number,
    editedAt: (r.edited_at as number | null) ?? null,
  };
}

export class ForumStore extends SqlBase {
  // ---- boards ------------------------------------------------------------------------------------

  boards(tribeId: number, viewerId: number): BoardRow[] {
    return this.all(`${BOARD_SQL} WHERE b.tribe_id = ? ORDER BY b.position, b.id`, viewerId, tribeId).map(toBoard);
  }

  board(id: number, viewerId: number): BoardRow | null {
    const r = this.get(`${BOARD_SQL} WHERE b.id = ?`, viewerId, id);
    return r ? toBoard(r) : null;
  }

  boardCount(tribeId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM forum_boards WHERE tribe_id = ?', tribeId)?.n ?? 0);
  }

  insertBoard(tribeId: number, name: string, visibility: ForumVisibility, postRule: ForumPostRule, t: number): number {
    const pos = Number(this.get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM forum_boards WHERE tribe_id = ?', tribeId)?.n ?? 1);
    return this.run(
      'INSERT INTO forum_boards (tribe_id, name, visibility, post_rule, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      tribeId,
      name,
      visibility,
      postRule,
      pos,
      t,
    ).id;
  }

  /** Announcements (leadership starts threads), General, and a leadership-only board. */
  createDefaultBoards(tribeId: number, t: number): void {
    this.insertBoard(tribeId, 'Announcements', 'members', 'leadership', t);
    this.insertBoard(tribeId, 'General', 'members', 'members', t);
    this.insertBoard(tribeId, 'Leadership', 'leadership', 'members', t);
  }

  updateBoard(id: number, name: string, visibility: ForumVisibility, postRule: ForumPostRule): void {
    this.run('UPDATE forum_boards SET name = ?, visibility = ?, post_rule = ? WHERE id = ?', name, visibility, postRule, id);
  }

  /** Cascades to threads, posts and read markers. */
  deleteBoard(id: number): void {
    this.run('DELETE FROM forum_boards WHERE id = ?', id);
  }

  // ---- threads -----------------------------------------------------------------------------------

  /** Pinned first, then the latest post. */
  threads(boardId: number, viewerId: number, limit: number, offset: number): ThreadRow[] {
    return this.all(
      `${THREAD_SQL} WHERE e.board_id = ? ORDER BY e.pinned DESC, e.last_post_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      viewerId,
      viewerId,
      boardId,
      limit,
      offset,
    ).map(toThread);
  }

  thread(id: number, viewerId: number): ThreadRow | null {
    const r = this.get(`${THREAD_SQL} WHERE e.id = ?`, viewerId, viewerId, id);
    return r ? toThread(r) : null;
  }

  insertThread(boardId: number, tribeId: number, authorId: number, title: string, t: number): number {
    return this.run(
      'INSERT INTO forum_threads (board_id, tribe_id, author_id, title, created_at, last_post_at, post_count) VALUES (?, ?, ?, ?, ?, ?, 0)',
      boardId,
      tribeId,
      authorId,
      title,
      t,
      t,
    ).id;
  }

  setThreadFlags(id: number, pinned: boolean, locked: boolean): void {
    this.run('UPDATE forum_threads SET pinned = ?, locked = ? WHERE id = ?', pinned ? 1 : 0, locked ? 1 : 0, id);
  }

  deleteThread(id: number): void {
    this.run('DELETE FROM forum_threads WHERE id = ?', id);
  }

  threadCountOf(boardId: number): number {
    return Number(this.get('SELECT COUNT(*) AS n FROM forum_threads WHERE board_id = ?', boardId)?.n ?? 0);
  }

  /** The oldest thread (by last post) that is not pinned: the one dropped when a board is full. */
  oldestUnpinned(boardId: number): number | null {
    const r = this.get('SELECT id FROM forum_threads WHERE board_id = ? AND pinned = 0 ORDER BY last_post_at, id LIMIT 1', boardId);
    return r ? (r.id as number) : null;
  }

  /** Recompute post_count and last_post_at from the posts (after an insert or delete). */
  refreshThread(id: number, fallbackAt: number): void {
    this.run(
      `UPDATE forum_threads SET
         post_count = (SELECT COUNT(*) FROM forum_posts WHERE thread_id = ?),
         last_post_at = COALESCE((SELECT MAX(created_at) FROM forum_posts WHERE thread_id = ?), ?)
       WHERE id = ?`,
      id,
      id,
      fallbackAt,
      id,
    );
  }

  // ---- posts -------------------------------------------------------------------------------------

  posts(threadId: number, limit: number, offset: number): PostRow[] {
    return this.all(
      `SELECT f.id, f.thread_id, f.author_id, p.username, f.body, f.created_at, f.edited_at
       FROM forum_posts f JOIN players p ON p.id = f.author_id
       WHERE f.thread_id = ? ORDER BY f.id LIMIT ? OFFSET ?`,
      threadId,
      limit,
      offset,
    ).map(toPost);
  }

  post(id: number): (PostRow & { tribeId: number; firstId: number }) | null {
    const r = this.get(
      `SELECT f.id, f.thread_id, f.author_id, p.username, f.body, f.created_at, f.edited_at, e.tribe_id,
              (SELECT MIN(x.id) FROM forum_posts x WHERE x.thread_id = f.thread_id) AS first_id
       FROM forum_posts f JOIN players p ON p.id = f.author_id JOIN forum_threads e ON e.id = f.thread_id
       WHERE f.id = ?`,
      id,
    );
    return r ? { ...toPost(r), tribeId: r.tribe_id as number, firstId: r.first_id as number } : null;
  }

  insertPost(threadId: number, authorId: number, body: string, t: number): number {
    return this.run('INSERT INTO forum_posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', threadId, authorId, body, t).id;
  }

  editPost(id: number, body: string, t: number): void {
    this.run('UPDATE forum_posts SET body = ?, edited_at = ? WHERE id = ?', body, t, id);
  }

  deletePost(id: number): void {
    this.run('DELETE FROM forum_posts WHERE id = ?', id);
  }

  // ---- read markers ------------------------------------------------------------------------------

  markRead(playerId: number, threadId: number, t: number): void {
    this.run(
      `INSERT INTO forum_reads (player_id, thread_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT (player_id, thread_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
      playerId,
      threadId,
      t,
    );
  }

  /** Unread threads across the boards the viewer may see (leadership boards only when `seesLeadership`). */
  unreadCount(playerId: number, tribeId: number, seesLeadership: boolean): number {
    const r = this.get(
      `SELECT COUNT(*) AS n
       FROM forum_threads e
       JOIN forum_boards b ON b.id = e.board_id
       JOIN tribe_members m ON m.player_id = ?
       LEFT JOIN forum_reads r ON r.thread_id = e.id AND r.player_id = m.player_id
       WHERE e.tribe_id = ? AND (b.visibility = 'members' OR ? = 1) AND ${UNREAD}`,
      playerId,
      tribeId,
      seesLeadership ? 1 : 0,
    );
    return Number(r?.n ?? 0);
  }
}
