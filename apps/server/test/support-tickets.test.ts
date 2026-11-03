// Support tickets: player side, staff queue and replies, internal notes, caps, rate limits and templates.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TICKETS_OPEN_MAX,
  TICKET_MSG_MIN_GAP_MS,
  TICKET_MSG_PER_MINUTE,
  TICKET_SUBJECT_MAX,
  type MessageTemplateDto,
  type StaffTicketDto,
  type StaffTicketListResponse,
  type TemplateListResponse,
  type TicketDto,
  type TicketListResponse,
} from '@clanfire/engine';
import { MINUTE, errorOf, makeApp, ok } from './helpers.ts';
import { auditRows, newStaff } from './staff-helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';

const GAP = TICKET_MSG_MIN_GAP_MS + 500;

const open = async (p: P, subject = 'Help', body = 'Something is wrong', category = 'bug'): Promise<TicketDto> => {
  const res = await p.c.post('/api/tickets', { category, subject, body });
  ok(res, 201);
  return res.json<TicketDto>();
};
const staffGet = async (s: P, id: number): Promise<StaffTicketDto> => {
  const res = await s.c.get(`/api/staff/tickets/${id}`);
  ok(res);
  return res.json<StaffTicketDto>();
};
const staffPost = (s: P, id: number, path: string, body: unknown) => s.c.post(`/api/staff/tickets/${id}/${path}`, body);

test('tickets: open, staff reply, player reads and answers, solved ticket reopens', async () => {
  const { app, clock } = await makeApp();
  const ann = await newPlayer(app, 'ann');
  const sue = await newStaff(app, 'sue', 'support');

  const t = await open(ann, '  Lost  ', '<b>Hi</b> there');
  assert.deepEqual([t.status, t.category, t.subject, t.openedByStaff, t.unread], ['open', 'bug', 'Lost', false, false]);
  assert.equal(t.messages[0]!.body, '<b>Hi</b> there');

  clock.advance(GAP);
  const replied = await staffPost(sue, t.id, 'messages', { body: 'Please send a screenshot.' });
  ok(replied, 201);
  assert.equal(replied.json<StaffTicketDto>().status, 'pending', 'a staff reply waits for the player');

  let list = (await ann.c.get('/api/tickets')).json<TicketListResponse>();
  assert.equal(list.unread, 1);
  assert.equal(list.tickets[0]!.unread, true);

  const read = (await ann.c.get(`/api/tickets/${t.id}`)).json<TicketDto>();
  assert.deepEqual(read.messages.map((m) => [m.isStaff, m.authorName]), [[false, 'ann'], [true, 'sue']]);
  list = (await ann.c.get('/api/tickets')).json<TicketListResponse>();
  assert.equal(list.unread, 0, 'reading marks it read');

  clock.advance(GAP);
  const answer = await ann.c.post(`/api/tickets/${t.id}/messages`, { body: 'Here it is' });
  ok(answer, 201);
  assert.equal(answer.json<TicketDto>().status, 'open', 'the player answered: back to open');

  clock.advance(GAP);
  ok(await staffPost(sue, t.id, 'status', { status: 'solved' }));
  clock.advance(GAP);
  assert.equal((await ann.c.post(`/api/tickets/${t.id}/messages`, { body: 'Still broken' })).json<TicketDto>().status, 'open', 'a reply reopens a solved ticket');

  ok(await ann.c.post(`/api/tickets/${t.id}/close`));
  clock.advance(GAP);
  errorOf(await ann.c.post(`/api/tickets/${t.id}/messages`, { body: 'More' }), 403, 'forbidden');
  assert.equal((await ann.c.get(`/api/tickets/${t.id}`)).json<TicketDto>().status, 'closed');
});

test('tickets: internal staff notes never reach the player; other players get not_found', async () => {
  const { app, clock } = await makeApp();
  const ann = await newPlayer(app, 'ann');
  const bob = await newPlayer(app, 'bob');
  const sue = await newStaff(app, 'sue', 'support');
  const t = await open(ann);
  clock.advance(GAP);
  const note = await staffPost(sue, t.id, 'messages', { body: 'SECRET internal note', internal: true });
  ok(note, 201);
  const afterNote = note.json<StaffTicketDto>();
  assert.equal(afterNote.status, 'open', 'an internal note changes nothing for the player');
  assert.equal(afterNote.messages.some((m) => m.internal && m.body.includes('SECRET')), true, 'staff see it');
  clock.advance(GAP);
  ok(await staffPost(sue, t.id, 'messages', { body: 'Public answer' }), 201);

  const seen = await ann.c.get(`/api/tickets/${t.id}`);
  assert.ok(!seen.body.includes('SECRET'), 'no leak in the ticket');
  assert.deepEqual(seen.json<TicketDto>().messages.map((m) => m.internal), [false, false]);
  assert.ok(!(await ann.c.get('/api/tickets')).body.includes('SECRET'));
  assert.ok(!(await ann.c.post(`/api/tickets/${t.id}/messages`, { body: 'thanks' })).body.includes('SECRET'));

  errorOf(await bob.c.get(`/api/tickets/${t.id}`), 404, 'not_found');
  errorOf(await bob.c.post(`/api/tickets/${t.id}/messages`, { body: 'hi' }), 404, 'not_found');
  errorOf(await bob.c.post(`/api/tickets/${t.id}/close`), 404, 'not_found');
  errorOf(await bob.c.get('/api/tickets/99999'), 404, 'not_found');
  assert.deepEqual((await bob.c.get('/api/tickets')).json<TicketListResponse>().tickets, []);
  assert.equal((await ann.c.get(`/api/tickets/${t.id}`)).json<TicketDto>().status, 'open', 'bob did not change anything (ann\'s own reply reopened it)');
});

test('tickets: staff area is invisible to everyone who is not staff', async () => {
  const { app } = await makeApp();
  const ann = await newPlayer(app, 'ann');
  const t = await open(ann);
  const anon = await newPlayer(app, 'visitor');
  anon.c.cookie = '';
  for (const c of [ann.c, anon.c]) {
    errorOf(await c.get('/api/staff/me'), 404, 'not_found');
    errorOf(await c.get('/api/staff/tickets'), 404, 'not_found');
    errorOf(await c.get(`/api/staff/tickets/${t.id}`), 404, 'not_found');
    errorOf(await c.post(`/api/staff/tickets/${t.id}/messages`, { body: 'x' }), 404, 'not_found');
    errorOf(await c.get('/api/staff/templates'), 404, 'not_found');
    errorOf(await c.get('/api/staff/audit'), 404, 'not_found');
    errorOf(await c.get('/api/staff/players?query=a'), 404, 'not_found');
    errorOf(await c.post('/api/staff/players/1/ban', { reason: 'x' }), 404, 'not_found');
  }
  assert.equal((await ann.c.state()).player.staffRole, null);
});

test('tickets: roles are re-read on every request, so a revoked staff member loses access at once', async () => {
  const { app } = await makeApp();
  const sue = await newStaff(app, 'sue', 'support');
  assert.equal((await sue.c.state()).player.staffRole, 'support');
  ok(await sue.c.get('/api/staff/me'));
  app.ctx.store.staff.setStaffRole(sue.id, null);
  errorOf(await sue.c.get('/api/staff/me'), 404, 'not_found');
});

test('tickets: cap of open tickets, closing frees a slot, rate limits and input validation', async () => {
  const { app, clock } = await makeApp();
  const ann = await newPlayer(app, 'ann');
  const ids: number[] = [];
  for (let i = 0; i < TICKETS_OPEN_MAX; i++) {
    ids.push((await open(ann, `Ticket ${i}`)).id);
    clock.advance(20_000); // stay under the per-minute message cap (each ticket counts as a message)
  }
  errorOf(await ann.c.post('/api/tickets', { category: 'bug', subject: 'One too many', body: 'x' }), 409, 'queue_full');
  ok(await ann.c.post(`/api/tickets/${ids[0]}/close`));
  await open(ann, 'Fits again');

  // Reply spam: gap between messages, then the per-minute cap.
  clock.advance(10 * MINUTE);
  const r1 = await ann.c.post(`/api/tickets/${ids[1]}/messages`, { body: 'one' });
  ok(r1, 201);
  errorOf(await ann.c.post(`/api/tickets/${ids[1]}/messages`, { body: 'too fast' }), 429, 'rate_limited');
  for (let i = 1; i < TICKET_MSG_PER_MINUTE; i++) {
    clock.advance(GAP);
    ok(await ann.c.post(`/api/tickets/${ids[1]}/messages`, { body: `m${i}` }), 201);
  }
  clock.advance(GAP);
  errorOf(await ann.c.post(`/api/tickets/${ids[1]}/messages`, { body: 'over the minute cap' }), 429, 'rate_limited');

  // Validation.
  clock.advance(10 * MINUTE);
  const bad = (b: unknown) => ann.c.post('/api/tickets', b);
  errorOf(await bad({ category: 'moderation', subject: 'x', body: 'y' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'nonsense', subject: 'x', body: 'y' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: '', body: 'y' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: '   ', body: 'y' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: 'x'.repeat(TICKET_SUBJECT_MAX + 1), body: 'y' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: 'x', body: '' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: 'x', body: 'a\u0000b' }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: 'x', body: 'y', extra: 1 }), 400, 'invalid_input');
  errorOf(await bad({ category: 'bug', subject: 'x' }), 400, 'invalid_input');
  errorOf(await ann.c.post(`/api/tickets/${ids[1]}/messages`, { body: 'y', internal: true }), 400, 'invalid_input');
  errorOf(await ann.c.get('/api/tickets/abc'), 400, 'invalid_input');
});

test('tickets: staff queue order, filters, paging and assignment rules', async () => {
  const { app, clock } = await makeApp();
  const sue = await newStaff(app, 'sue', 'support');
  const sam = await newStaff(app, 'sam', 'support');
  const mo = await newStaff(app, 'moe', 'moderator');
  const ann = await newPlayer(app, 'ann');
  const bob = await newPlayer(app, 'bob');
  const old = await open(ann, 'oldest', 'x', 'bug');
  clock.advance(MINUTE);
  const newer = await open(bob, 'newer', 'x', 'account');
  clock.advance(MINUTE);
  const urgent = await open(bob, 'urgent', 'x', 'payment');
  ok(await staffPost(sue, urgent.id, 'priority', { priority: 'high' }));
  ok(await staffPost(sue, old.id, 'messages', { body: 'We are on it' }), 201);

  const q = async (qs = ''): Promise<StaffTicketListResponse> => {
    const res = await sue.c.get(`/api/staff/tickets${qs}`);
    ok(res);
    return res.json<StaffTicketListResponse>();
  };
  assert.deepEqual((await q()).tickets.map((x) => x.subject), ['urgent', 'newer', 'oldest'], 'open before pending, high priority first, then oldest');
  assert.deepEqual((await q('?status=pending')).tickets.map((x) => x.subject), ['oldest']);
  assert.deepEqual((await q('?category=account')).tickets.map((x) => x.subject), ['newer']);
  assert.deepEqual((await q('?unassigned=1')).tickets.map((x) => x.subject).sort(), ['newer', 'oldest', 'urgent']);
  assert.equal((await q()).hasMore, false);
  errorOf(await sue.c.get('/api/staff/tickets?status=bogus'), 400, 'invalid_input');
  errorOf(await sue.c.get('/api/staff/tickets?x=1'), 400, 'invalid_input');

  // Support takes a ticket for themselves, but cannot give one away or take it for someone else.
  ok(await staffPost(sue, newer.id, 'assign', { assigneeId: sue.id }));
  errorOf(await staffPost(sue, newer.id, 'assign', { assigneeId: sam.id }), 403, 'forbidden');
  errorOf(await staffPost(sam, newer.id, 'assign', { assigneeId: null }), 403, 'forbidden');
  errorOf(await staffPost(mo, newer.id, 'assign', { assigneeId: ann.id }), 400, 'invalid_input'); // not a staff member
  assert.deepEqual((await q(`?assignee=${sue.id}`)).tickets.map((x) => x.subject), ['newer']);
  ok(await staffPost(mo, newer.id, 'assign', { assigneeId: sam.id }));
  assert.equal((await staffGet(mo, newer.id)).assignedName, 'sam');
  ok(await staffPost(sam, newer.id, 'assign', { assigneeId: null }));
  assert.equal((await staffGet(mo, newer.id)).assignedTo, null);

  assert.equal((await staffGet(sue, old.id)).player.username, 'ann');
  errorOf(await sue.c.get('/api/staff/tickets/99999'), 404, 'not_found');
  errorOf(await staffPost(sue, old.id, 'status', { status: 'weird' }), 400, 'invalid_input');
  errorOf(await staffPost(sue, old.id, 'priority', { priority: 'urgent' }), 400, 'invalid_input');
  errorOf(await staffPost(sue, old.id, 'messages', {}), 400, 'invalid_input');
  errorOf(await staffPost(sue, old.id, 'messages', { body: 'x', templateId: 99999 }), 404, 'not_found');

  // Audit rows for ticket changes.
  const actions = auditRows(app).map((r) => r.action);
  assert.ok(actions.includes('ticket_priority') && actions.includes('ticket_status') && actions.includes('ticket_assign'));
  const assigns = auditRows(app, 'ticket_assign');
  assert.equal(assigns.length, 3);
  assert.equal(assigns[0]!.actor_id, sue.id);
  assert.equal(assigns[0]!.actor_ip !== null, true);
  assert.equal(auditRows(app, 'ticket_status').find((r) => r.detail.includes(`#${old.id}`))?.detail, `ticket #${old.id}: open -> pending (with reply)`);
});

test('templates: everyone on staff reads them, only admins change them, replies render placeholders', async () => {
  const { app, clock } = await makeApp();
  const sue = await newStaff(app, 'sue', 'support');
  const mo = await newStaff(app, 'moe', 'moderator');
  const ad = await newStaff(app, 'ada', 'admin');
  const ann = await newPlayer(app, 'ann');

  const list = (await sue.c.get('/api/staff/templates')).json<TemplateListResponse>().templates;
  assert.ok(list.length >= 8, 'defaults are seeded');
  const keys = list.map((x) => x.key);
  for (const k of ['received', 'need-more-info', 'resolved', 'bug-acknowledged', 'account-security', 'warning-abuse', 'mute-notice', 'ban-notice']) assert.ok(keys.includes(k), k);
  assert.deepEqual(new Set(list.map((x) => x.kind)), new Set(['ticket', 'moderation']));

  const newTpl = { key: 'custom-1', title: 'Custom', kind: 'ticket', body: 'Hello {player} from {staff} about {ticket} ({category}) {unknown}' };
  errorOf(await sue.c.post('/api/staff/templates', newTpl), 403, 'forbidden');
  errorOf(await mo.c.post('/api/staff/templates', newTpl), 403, 'forbidden');
  const created = await ad.c.post('/api/staff/templates', newTpl);
  ok(created, 201);
  const tpl = created.json<MessageTemplateDto>();
  assert.equal(tpl.updatedBy, ad.id);
  errorOf(await ad.c.post('/api/staff/templates', newTpl), 400, 'invalid_input'); // key in use
  errorOf(await ad.c.post('/api/staff/templates', { ...newTpl, key: 'Bad Key' }), 400, 'invalid_input');
  errorOf(await ad.c.post('/api/staff/templates', { ...newTpl, key: 'k2', kind: 'other' }), 400, 'invalid_input');
  errorOf(await ad.c.post('/api/staff/templates', { ...newTpl, key: 'k3', body: '' }), 400, 'invalid_input');
  errorOf(await ad.c.post('/api/staff/templates', { ...newTpl, key: 'k4', extra: 1 }), 400, 'invalid_input');
  errorOf(await mo.c.put(`/api/staff/templates/${tpl.id}`, { title: 'x' }), 403, 'forbidden');
  errorOf(await mo.c.delete(`/api/staff/templates/${tpl.id}`), 403, 'forbidden');

  const t = await open(ann, 'Billing', 'help', 'payment');
  clock.advance(GAP);
  // A template alone: rendered, with only the known placeholders replaced.
  const r1 = (await staffPost(sue, t.id, 'messages', { templateId: tpl.id })).json<StaffTicketDto>();
  assert.equal(r1.messages.at(-1)!.body, `Hello ann from sue about #${t.id} (payment) {unknown}`);
  assert.equal(r1.messages.at(-1)!.templateId, tpl.id);
  // Both: the typed text wins, the template is still recorded.
  const r2 = (await staffPost(sue, t.id, 'messages', { templateId: tpl.id, body: 'Own words' })).json<StaffTicketDto>();
  assert.equal(r2.messages.at(-1)!.body, 'Own words');
  assert.equal(r2.messages.at(-1)!.templateId, tpl.id);

  // Edit and delete are audited; the defaults can be edited too.
  const updated = await ad.c.put(`/api/staff/templates/${tpl.id}`, { title: 'Renamed', body: 'Hi {player}' });
  ok(updated);
  assert.equal(updated.json<MessageTemplateDto>().title, 'Renamed');
  errorOf(await ad.c.put(`/api/staff/templates/${tpl.id}`, { key: 'other' }), 400, 'invalid_input');
  ok(await ad.c.delete(`/api/staff/templates/${tpl.id}`), 204);
  errorOf(await ad.c.delete(`/api/staff/templates/${tpl.id}`), 404, 'not_found');
  assert.deepEqual(auditRows(app).filter((r) => r.action.startsWith('template_')).map((r) => r.action), ['template_create', 'template_update', 'template_delete']);
  const after = (await ann.c.get(`/api/tickets/${t.id}`)).json<TicketDto>();
  assert.equal(after.messages.at(-1)!.templateId, null, 'deleting a template only clears the reference; the sent text stays');
  assert.equal(after.messages.at(-1)!.body, 'Own words');
});

test('tickets: a player can read the app state and still has the staffRole field only for staff', async () => {
  const { app } = await makeApp();
  const mo = await newStaff(app, 'moe', 'moderator');
  assert.equal((await mo.c.state()).player.staffRole, 'moderator');
  const me = await mo.c.get('/api/staff/me');
  ok(me);
  assert.deepEqual(me.json(), { staffRole: 'moderator', username: 'moe' });
});

export type { App };
