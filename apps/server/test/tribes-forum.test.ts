// Per-member rights (leader grants) and the tribe forum: docs/GAME_DESIGN.md section 11.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ForumBoardDto,
  ForumBoardsResponse,
  ForumPostDto,
  ForumThreadResponse,
  ForumThreadsResponse,
  MyTribeResponse,
  TribeMemberDto,
} from '@clanfire/engine';
import { FORUM_EDIT_WINDOW_MS, FORUM_POSTS_PER_THREAD, FORUM_THREADS_KEEP } from '@clanfire/engine';
import { HOUR, MINUTE, makeApp } from './helpers.ts';
import { addMember, count, errorOf, inviteAndAccept, myTribe, newLeader, newPlayer, ok, type App, type P } from './tribe-helpers.ts';

const GAP = 4000; // above the 3 s minimum between posts

async function setup() {
  const { app, clock } = await makeApp();
  const lead = await newLeader(app, 'lena', 'Forum Folk', 'FORUM');
  const officer = await addMember(app, lead, 'olga');
  ok(await lead.c.post(`/api/tribe/members/${officer.id}/role`, { role: 'officer' }));
  const mem = await addMember(app, lead, 'mika');
  const mem2 = await addMember(app, lead, 'milo');
  const outsider = await newPlayer(app, 'otto');
  return { app, clock, lead, officer, mem, mem2, outsider };
}

const grant = (leader: P, target: P, grants: string[]) => leader.c.put(`/api/tribe/members/${target.id}/permissions`, { grants });
const boards = async (p: P): Promise<ForumBoardDto[]> => {
  const res = await p.c.get('/api/tribe/forum/boards');
  ok(res);
  return res.json<ForumBoardsResponse>().boards;
};
const boardNamed = async (p: P, name: string): Promise<ForumBoardDto> => {
  const b = (await boards(p)).find((x) => x.name === name);
  assert.ok(b, `board ${name}`);
  return b;
};
const rights = async (p: P) => (await myTribe(p)).rights;

describe('per-member grants', () => {
  it('a grant adds the right and removing it takes it away, for every grantable right', async () => {
    const { app, lead, mem, mem2 } = await setup();
    const target = await newPlayer(app, 'tara'); // for invite
    assert.ok(!(await rights(mem)).includes('invite'));
    // invite
    errorOf(await mem.c.post('/api/tribe/invites', { username: target.name }), 403, 'forbidden');
    ok(await grant(lead, mem, ['invite', 'handle_applications', 'kick', 'diplomacy', 'edit_settings', 'forum_manage', 'forum_moderate']));
    const r = await rights(mem);
    for (const a of ['invite', 'handle_applications', 'kick', 'diplomacy', 'edit_settings', 'forum_manage', 'forum_moderate']) assert.ok(r.includes(a as never), a);
    ok(await mem.c.post('/api/tribe/invites', { username: target.name }), 201);
    ok(await mem.c.post('/api/tribe/settings', { description: 'hello' }));
    assert.equal((await myTribe(mem)).applications.length, 0);
    ok(await mem.c.post('/api/tribe/members/' + mem2.id + '/kick')); // plain members can be removed
    // revoke
    ok(await grant(lead, mem, []));
    assert.deepEqual(await rights(mem), ['chat']);
    errorOf(await mem.c.post('/api/tribe/invites', { username: 'nobody' }), 403, 'forbidden');
    errorOf(await mem.c.post('/api/tribe/settings', { description: 'x' }), 403, 'forbidden');
    errorOf(await mem.c.post('/api/tribe/diplomacy', { tag: 'ZZ', kind: 'enemy' }), 403, 'forbidden');
  });

  it('the kick grant never reaches officers or the leader; diplomacy and applications follow the grant', async () => {
    const { app, lead, officer, mem, mem2 } = await setup();
    ok(await grant(lead, mem, ['kick']));
    errorOf(await mem.c.post(`/api/tribe/members/${officer.id}/kick`), 403, 'forbidden');
    errorOf(await mem.c.post(`/api/tribe/members/${lead.id}/kick`), 403, 'forbidden');
    ok(await mem.c.post(`/api/tribe/members/${mem2.id}/kick`));
    // handle_applications
    const open = await newLeader(app, 'ora', 'Apply Folk', 'APPLY', 'application');
    const helper = await addMemberViaInvite(app, open, 'hans');
    const applicant = await newPlayer(app, 'anna');
    ok(await applicant.c.post(`/api/tribes/${open.tribeId}/apply`, { message: 'hi' }), 201);
    errorOf(await helper.c.post('/api/tribe/applications/1/accept'), 403, 'forbidden');
    ok(await grant(open, helper, ['handle_applications']));
    const apps = (await myTribe(helper)).applications;
    assert.equal(apps.length, 1);
    ok(await helper.c.post(`/api/tribe/applications/${apps[0]?.id}/accept`));
    assert.equal((await myTribe(applicant)).tribe?.id, open.tribeId);
  });

  it('only the leader sets grants; leader-only rights and bad input are refused', async () => {
    const { lead, officer, mem } = await setup();
    errorOf(await grant(mem, mem, ['kick']), 403, 'forbidden');
    errorOf(await grant(officer, mem, ['kick']), 403, 'forbidden');
    for (const bad of [['disband'], ['set_roles'], ['transfer_leadership'], ['chat'], ['kick', 'kick'], ['nope']]) {
      errorOf(await grant(lead, mem, bad), 400, 'invalid_input');
    }
    errorOf(await lead.c.put(`/api/tribe/members/${mem.id}/permissions`, {}), 400, 'invalid_input');
    errorOf(await grant(lead, lead, ['kick']), 400, 'invalid_target');
    errorOf(await grant(lead, { ...mem, id: 99999 }, ['kick']), 404, 'not_found');
    assert.deepEqual(await rights(mem), ['chat']);
  });

  it('returns the member with grants, logs the change, shows grants to members only, clears them on leaving', async () => {
    const { app, lead, mem, outsider } = await setup();
    const res = await grant(lead, mem, ['kick', 'invite']);
    ok(res);
    const dto = res.json<TribeMemberDto>();
    assert.equal(dto.playerId, mem.id);
    assert.deepEqual(dto.grants, ['invite', 'kick']);
    const mine = await myTribe(lead);
    assert.deepEqual(mine.tribe?.memberList.find((m) => m.playerId === mem.id)?.grants, ['invite', 'kick']);
    assert.ok(mine.events.some((e) => e.text.includes('mika') && e.text.includes('invite')));
    // public view of the tribe carries no grants
    const pub = await outsider.c.get(`/api/tribes/${mine.tribe?.id}`);
    ok(pub);
    assert.equal(pub.json<{ memberList: TribeMemberDto[] }>().memberList.some((m) => m.grants !== undefined), false);
    // leave and re-join: the grants are gone
    ok(await mem.c.post('/api/tribe/leave'));
    ok(await mem.c.post(`/api/tribes/${mine.tribe?.id}/join`));
    assert.deepEqual(await rights(mem), ['chat']);
    assert.equal(count(app, 'tribe_members', "grants <> '[]'"), 0);
  });
});

async function addMemberViaInvite(app: App, leader: P, name: string): Promise<P> {
  const p = await newPlayer(app, name);
  await inviteAndAccept(leader, p);
  return p;
}

describe('forum visibility and rules', () => {
  it('default boards exist; outsiders get not_found; the Leadership board is hidden from plain members', async () => {
    const { lead, officer, mem, outsider } = await setup();
    assert.deepEqual((await boards(mem)).map((b) => b.name), ['Announcements', 'General']);
    assert.deepEqual((await boards(lead)).map((b) => b.name), ['Announcements', 'General', 'Leadership']);
    assert.equal((await boards(officer)).length, 3);
    errorOf(await outsider.c.get('/api/tribe/forum/boards'), 404, 'not_found');
    const secret = await boardNamed(lead, 'Leadership');
    ok(await lead.c.post(`/api/tribe/forum/boards/${secret.id}/threads`, { title: 'Plans', body: 'secret 🔥' }), 201);
    errorOf(await mem.c.get(`/api/tribe/forum/boards/${secret.id}/threads`), 404, 'not_found');
    errorOf(await outsider.c.get(`/api/tribe/forum/boards/${secret.id}/threads`), 404, 'not_found');
    errorOf(await mem.c.post(`/api/tribe/forum/boards/${secret.id}/threads`, { title: 'x', body: 'y' }), 404, 'not_found');
    // a member with forum_moderate sees it
    ok(await grant(lead, mem, ['forum_moderate']));
    assert.equal((await boards(mem)).length, 3);
    const list = await mem.c.get(`/api/tribe/forum/boards/${secret.id}/threads`);
    ok(list);
    assert.equal(list.json<ForumThreadsResponse>().threads[0]?.title, 'Plans');
  });

  it('thread, reply, emoji round trip, edit window, delete, pin, lock', async () => {
    const { clock, lead, mem, mem2 } = await setup();
    const general = await boardNamed(mem, 'General');
    const made = await mem.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'Hello 👋', body: 'First post 😀\nsecond line <b>x</b>' });
    ok(made, 201);
    const t = made.json<ForumThreadResponse>();
    assert.equal(t.thread.title, 'Hello 👋');
    assert.equal(t.posts[0]?.body, 'First post 😀\nsecond line <b>x</b>'); // stored as plain text
    // control characters are refused
    clock.advance(GAP);
    errorOf(await mem.c.post(`/api/tribe/forum/threads/${t.thread.id}/posts`, { body: 'bad\u0000' }), 400, 'invalid_input');
    // reply by another member
    const rep = await mem2.c.post(`/api/tribe/forum/threads/${t.thread.id}/posts`, { body: 'Reply 🎉' });
    ok(rep, 201);
    const post = rep.json<ForumPostDto>();
    assert.equal(post.author, 'milo');
    assert.equal(post.canEdit, true);
    // only the author edits, within the window
    errorOf(await mem.c.put(`/api/tribe/forum/posts/${post.id}`, { body: 'hijack' }), 403, 'forbidden');
    ok(await mem2.c.put(`/api/tribe/forum/posts/${post.id}`, { body: 'Edited 🎉' }));
    clock.advance(FORUM_EDIT_WINDOW_MS + 1000);
    errorOf(await mem2.c.put(`/api/tribe/forum/posts/${post.id}`, { body: 'late' }), 403, 'forbidden');
    // members cannot pin, lock or delete threads; they delete only their own posts
    errorOf(await mem.c.put(`/api/tribe/forum/threads/${t.thread.id}`, { pinned: true }), 403, 'forbidden');
    errorOf(await mem.c.delete(`/api/tribe/forum/threads/${t.thread.id}`), 403, 'forbidden');
    errorOf(await mem.c.delete(`/api/tribe/forum/posts/${post.id}`), 403, 'forbidden');
    // moderator pins and locks
    ok(await lead.c.put(`/api/tribe/forum/threads/${t.thread.id}`, { pinned: true, locked: true }));
    clock.advance(GAP);
    errorOf(await mem2.c.post(`/api/tribe/forum/threads/${t.thread.id}/posts`, { body: 'more' }), 403, 'forbidden');
    const listed = (await mem.c.get(`/api/tribe/forum/boards/${general.id}/threads`)).json<ForumThreadsResponse>();
    assert.equal(listed.threads[0]?.pinned, true);
    assert.equal(listed.threads[0]?.locked, true);
    // moderator deletes a post; deleting the first post deletes the thread
    ok(await lead.c.delete(`/api/tribe/forum/posts/${post.id}`), 204);
    const after = (await mem.c.get(`/api/tribe/forum/threads/${t.thread.id}`)).json<ForumThreadResponse>();
    assert.equal(after.thread.postCount, 1);
    ok(await mem.c.delete(`/api/tribe/forum/posts/${t.posts[0]?.id}`), 204);
    errorOf(await mem.c.get(`/api/tribe/forum/threads/${t.thread.id}`), 404, 'not_found');
  });

  it('Announcements only takes new threads from the leadership; replies are open', async () => {
    const { clock, lead, mem } = await setup();
    const ann = await boardNamed(mem, 'Announcements');
    assert.equal(ann.canPost, false);
    errorOf(await mem.c.post(`/api/tribe/forum/boards/${ann.id}/threads`, { title: 'x', body: 'y' }), 403, 'forbidden');
    const made = await lead.c.post(`/api/tribe/forum/boards/${ann.id}/threads`, { title: 'News', body: 'Hear ye' });
    ok(made, 201);
    clock.advance(GAP);
    ok(await mem.c.post(`/api/tribe/forum/threads/${made.json<ForumThreadResponse>().thread.id}/posts`, { body: 'nice' }), 201);
  });

  it('boards: manage right needed; limits, rename, visibility, delete cascades', async () => {
    const { app, lead, mem } = await setup();
    errorOf(await mem.c.post('/api/tribe/forum/boards', { name: 'Mine' }), 403, 'forbidden');
    ok(await grant(lead, mem, ['forum_manage']));
    const created = await mem.c.post('/api/tribe/forum/boards', { name: 'War room', visibility: 'leadership', postRule: 'leadership' });
    ok(created, 201);
    const b = created.json<ForumBoardDto>();
    assert.equal(b.visibility, 'leadership');
    ok(await mem.c.put(`/api/tribe/forum/boards/${b.id}`, { name: 'Camp', visibility: 'members' }));
    assert.equal((await boardNamed(lead, 'Camp')).visibility, 'members');
    errorOf(await mem.c.post('/api/tribe/forum/boards', { name: '   ' }), 400, 'invalid_input');
    errorOf(await mem.c.post('/api/tribe/forum/boards', { name: 'x'.repeat(41) }), 400, 'invalid_input');
    for (let i = 0; i < 4; i++) ok(await lead.c.post('/api/tribe/forum/boards', { name: `B${i}` }), 201); // 3 defaults + Camp + 4 = 8
    errorOf(await lead.c.post('/api/tribe/forum/boards', { name: 'One too many' }), 409, 'requirements_not_met');
    ok(await lead.c.post(`/api/tribe/forum/boards/${b.id}/threads`, { title: 't', body: 'p' }), 201);
    assert.equal(count(app, 'forum_posts'), 1);
    ok(await mem.c.delete(`/api/tribe/forum/boards/${b.id}`), 204);
    assert.equal(count(app, 'forum_threads'), 0);
    assert.equal(count(app, 'forum_posts'), 0);
  });

  it('unread dot and the forumUnread badge follow new posts and clear when the thread is opened', async () => {
    const { clock, lead, mem } = await setup();
    const general = await boardNamed(lead, 'General');
    clock.advance(GAP); // posts after members joined count as new
    const made = await lead.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'Hi', body: 'there' });
    ok(made, 201);
    const id = made.json<ForumThreadResponse>().thread.id;
    clock.advance(GAP);
    assert.equal((await mem.c.state()).forumUnread, 1);
    assert.equal((await myTribe(mem)).forumUnread, 1);
    assert.equal((await boardNamed(mem, 'General')).unread, 1);
    assert.equal((await lead.c.state()).forumUnread, 0); // own thread
    ok(await mem.c.get(`/api/tribe/forum/threads/${id}`));
    assert.equal((await mem.c.state()).forumUnread, 0);
    clock.advance(GAP);
    ok(await mem.c.post(`/api/tribe/forum/threads/${id}/posts`, { body: 'hello' }), 201);
    assert.equal((await lead.c.state()).forumUnread, 1);
    // a leadership-board thread does not count for plain members
    const secret = await boardNamed(lead, 'Leadership');
    clock.advance(GAP);
    ok(await lead.c.post(`/api/tribe/forum/boards/${secret.id}/threads`, { title: 's', body: 's' }), 201);
    assert.equal((await mem.c.state()).forumUnread, 0);
  });

  it('a removed member loses access but their posts stay with their name; disband removes the forum', async () => {
    const { app, clock, lead, mem } = await setup();
    const general = await boardNamed(mem, 'General');
    const made = await mem.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'Mine', body: 'body' });
    ok(made, 201);
    const id = made.json<ForumThreadResponse>().thread.id;
    ok(await lead.c.post(`/api/tribe/members/${mem.id}/kick`));
    errorOf(await mem.c.get(`/api/tribe/forum/threads/${id}`), 404, 'not_found');
    errorOf(await mem.c.get('/api/tribe/forum/boards'), 404, 'not_found');
    errorOf(await mem.c.post(`/api/tribe/forum/threads/${id}/posts`, { body: 'x' }), 404, 'not_found');
    const t = (await lead.c.get(`/api/tribe/forum/threads/${id}`)).json<ForumThreadResponse>();
    assert.equal(t.posts[0]?.author, 'mika');
    assert.equal(count(app, 'forum_reads', 'player_id = ?', mem.id), 0);
    clock.advance(HOUR);
    // the others leave first; the last leader disbanding clears every forum table
    ok(await lead.c.post('/api/tribe/disband'));
    for (const table of ['forum_boards', 'forum_threads', 'forum_posts']) assert.equal(count(app, table), 0, table);
  });

  it('rate limits, post cap per thread, and the thread cap per board (oldest unpinned dropped)', async () => {
    const { app, clock, lead, mem } = await setup();
    const general = await boardNamed(mem, 'General');
    ok(await mem.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'a', body: 'b' }), 201);
    errorOf(await mem.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'a2', body: 'b' }), 429, 'rate_limited'); // too fast
    // a full thread refuses replies (filled in the database to keep the test quick)
    const threadId = (await mem.c.get(`/api/tribe/forum/boards/${general.id}/threads`)).json<ForumThreadsResponse>().threads[0]?.id as number;
    app.ctx.store.db.prepare('UPDATE forum_threads SET post_count = ? WHERE id = ?').run(FORUM_POSTS_PER_THREAD, threadId);
    clock.advance(GAP);
    errorOf(await lead.c.post(`/api/tribe/forum/threads/${threadId}/posts`, { body: 'one more' }), 409, 'requirements_not_met');
    // thread cap: fill the board with old threads, then add one more; the oldest unpinned goes
    const fs = app.ctx.store.forum;
    const first = fs.insertThread(general.id, (await myTribe(lead)).tribe?.id as number, lead.id, 'old 0', 1);
    fs.insertPost(first, lead.id, 'x', 1);
    for (let i = 1; i < FORUM_THREADS_KEEP - 1; i++) fs.insertPost(fs.insertThread(general.id, (await myTribe(lead)).tribe?.id as number, lead.id, `old ${i}`, i + 1), lead.id, 'x', i + 1);
    assert.equal(fs.threadCountOf(general.id), FORUM_THREADS_KEEP);
    clock.advance(GAP);
    ok(await lead.c.post(`/api/tribe/forum/boards/${general.id}/threads`, { title: 'newest', body: 'n' }), 201);
    assert.equal(fs.threadCountOf(general.id), FORUM_THREADS_KEEP);
    assert.equal(count(app, 'forum_threads', 'id = ?', first), 0);
    void MINUTE;
  });
});
