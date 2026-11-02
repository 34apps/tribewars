import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRIBE_MAX_ALLIES, TRIBE_MAX_NAPS, pactNoticeMs, type MyTribeResponse, type TribeDto } from '@tribewars/engine';
import { HOUR, errorOf, makeApp, ok } from './helpers.ts';
import { count, fillerTribe, formPact, inviteAndAccept, myTribe, newLeader, newPlayer, setHall, type P } from './tribe-helpers.ts';

const texts = async (p: P): Promise<string[]> => (await myTribe(p)).events.map((e) => e.text);

async function threeTribes() {
  const { app, clock } = await makeApp();
  const a = await newLeader(app, 'alpha_lead', 'Alpha Tribe', 'ALPHA', 'invite');
  const b = await newLeader(app, 'bravo_lead', 'Bravo Tribe', 'BRAVO', 'invite');
  const c = await newLeader(app, 'charlie_lead', 'Charlie Tribe', 'CHRLY', 'invite');
  return { app, clock, a, b, c };
}

test('ally / NAP: propose, withdraw, decline, accept; one pending proposal per pair; officers only', async () => {
  const { app, clock, a, b, c } = await threeTribes();
  // An officer and a plain member in ALPHA.
  const officer = await newPlayer(app, 'alpha_officer');
  const member = await newPlayer(app, 'alpha_member');
  await inviteAndAccept(a, officer);
  await inviteAndAccept(a, member);
  ok(await a.c.post(`/api/tribe/members/${officer.id}/role`, { role: 'officer' }));

  const propose = (p: P, tag: string, kind: string) => p.c.post('/api/tribe/diplomacy', { tag, kind });
  errorOf(await propose(member, 'BRAVO', 'ally'), 403, 'forbidden');
  errorOf(await propose(officer, 'NOPE', 'ally'), 404, 'not_found');
  errorOf(await propose(officer, 'alpha', 'ally'), 400, 'invalid_target');
  errorOf(await propose(officer, 'BRAVO', 'friend'), 400, 'invalid_input');
  errorOf(await a.c.post('/api/tribe/diplomacy', { tag: 'BRAVO' }), 400, 'invalid_input');
  errorOf(await a.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'ally', extra: 1 }), 400, 'invalid_input');

  // An officer proposes (lower-case tag works); both sides see it, from their own point of view.
  const sent = await propose(officer, 'bravo', 'ally');
  ok(sent, 201);
  const out = sent.json<MyTribeResponse>().proposals;
  assert.deepEqual(out.map((p) => [p.kind, p.direction, p.other.tag, p.other.name, p.createdAt]), [['ally', 'outgoing', 'BRAVO', 'Bravo Tribe', clock.now()]]);
  const incoming = (await myTribe(b)).proposals;
  assert.deepEqual(incoming.map((p) => [p.kind, p.direction, p.other.tag]), [['ally', 'incoming', 'ALPHA']]);
  assert.equal((await myTribe(member)).proposals.length, 1, 'every member sees pending proposals');
  assert.equal((await myTribe(c)).proposals.length, 0);
  assert.deepEqual((await texts(a))[0], 'alpha_officer proposed an alliance with [BRAVO].');
  assert.deepEqual((await texts(b))[0], '[ALPHA] proposed an alliance with us.');
  const proposalId = incoming[0]?.id ?? 0;

  // Only one pending proposal per pair, whoever sent it and whatever the kind.
  errorOf(await propose(a, 'BRAVO', 'ally'), 409, 'requirements_not_met');
  errorOf(await propose(a, 'BRAVO', 'nap'), 409, 'requirements_not_met');
  const crossed = await propose(b, 'ALPHA', 'nap');
  errorOf(crossed, 409, 'requirements_not_met');
  assert.match(crossed.json<{ message: string }>().message, /already sent you/);

  // Only the addressed tribe accepts / declines; only the proposer withdraws.
  errorOf(await a.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/accept`), 404, 'not_found');
  errorOf(await a.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/decline`), 404, 'not_found');
  errorOf(await c.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/accept`), 404, 'not_found');
  errorOf(await c.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/withdraw`), 404, 'not_found');
  errorOf(await b.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/withdraw`), 404, 'not_found');
  errorOf(await member.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/withdraw`), 403, 'forbidden');

  // Withdraw: gone for both.
  const withdrawn = await a.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/withdraw`);
  ok(withdrawn);
  assert.deepEqual(withdrawn.json<MyTribeResponse>().proposals, []);
  assert.deepEqual((await myTribe(b)).proposals, []);
  assert.equal((await texts(a))[0], 'alpha_lead withdrew the alliance proposal to [BRAVO].');
  assert.equal((await texts(b))[0], '[ALPHA] withdrew their alliance proposal.');
  errorOf(await a.c.post(`/api/tribe/diplomacy/proposals/${proposalId}/withdraw`), 404, 'not_found');

  // Decline.
  ok(await propose(a, 'BRAVO', 'nap'), 201);
  const napProposal = (await myTribe(b)).proposals[0];
  assert.equal(napProposal?.kind, 'nap');
  const declined = await b.c.post(`/api/tribe/diplomacy/proposals/${napProposal?.id}/decline`);
  ok(declined);
  assert.deepEqual(declined.json<MyTribeResponse>().proposals, []);
  assert.equal((await texts(a))[0], '[BRAVO] declined our non-aggression pact proposal.');
  assert.equal((await texts(b))[0], 'bravo_lead declined the non-aggression pact proposal from [ALPHA].');
  assert.equal(count(app, 'tribe_relations'), 0);

  // Accept: one relation, shown on both sides (and publicly), nothing pending any more.
  ok(await propose(a, 'BRAVO', 'ally'), 201);
  const open = (await myTribe(b)).proposals[0];
  const accepted = await b.c.post(`/api/tribe/diplomacy/proposals/${open?.id}/accept`);
  ok(accepted);
  const mine = accepted.json<MyTribeResponse>();
  assert.deepEqual(mine.proposals, []);
  assert.deepEqual(mine.tribe?.relations.map((r) => [r.kind, r.other.tag, r.since, r.endsAt, r.declaredByUs]), [['ally', 'ALPHA', clock.now(), null, false]]);
  assert.deepEqual((await myTribe(a)).tribe?.relations.map((r) => [r.kind, r.other.tag, r.endsAt]), [['ally', 'BRAVO', null]]);
  assert.equal((await texts(b))[0], 'bravo_lead accepted the alliance with [ALPHA].');
  assert.equal((await texts(a))[0], '[BRAVO] accepted our alliance proposal.');
  const pub = (await c.c.get(`/api/tribes/${a.tribeId}`)).json<TribeDto>();
  assert.deepEqual(pub.relations.map((r) => [r.kind, r.other.tag]), [['ally', 'BRAVO']]);
  assert.equal((await myTribe(c)).tribe?.relations.length, 0);
  errorOf(await a.c.post(`/api/tribe/diplomacy/proposals/${open?.id}/accept`), 404, 'not_found');

  // Already allied: no second alliance, but a NAP can replace it (accepting replaces whatever the pair had).
  errorOf(await propose(a, 'BRAVO', 'ally'), 409, 'requirements_not_met');
  ok(await propose(a, 'BRAVO', 'nap'), 201);
  const nap = (await myTribe(b)).proposals[0];
  ok(await b.c.post(`/api/tribe/diplomacy/proposals/${nap?.id}/accept`));
  assert.equal(count(app, 'tribe_relations'), 1, 'one row per pair');
  assert.deepEqual((await myTribe(a)).tribe?.relations.map((r) => r.kind), ['nap']);
  await app.close();
});

test('limits: allies and NAPs count active relations plus pending outgoing proposals', async () => {
  const { app, clock, a, b } = await threeTribes();
  const t = clock.now();
  const others = Array.from({ length: 14 }, (_, i) => fillerTribe(app, `Filler ${i}`, `F${i}`, t));
  const propose = (tag: string, kind: string) => a.c.post('/api/tribe/diplomacy', { tag, kind });
  assert.deepEqual([TRIBE_MAX_ALLIES, TRIBE_MAX_NAPS], [3, 10]);

  // Allies: one active + two pending reach the cap of three.
  app.ctx.store.tribes.insertRelation(a.tribeId, others[0]?.tribeId ?? 0, 'ally', null, t, null);
  ok(await propose('F1', 'ally'), 201);
  ok(await propose('F2', 'ally'), 201);
  errorOf(await propose('F3', 'ally'), 409, 'requirements_not_met');
  // NAPs have their own, larger budget.
  ok(await propose('F3', 'nap'), 201);
  // A withdrawn proposal frees the slot.
  const f1 = (await myTribe(a)).proposals.find((p) => p.other.tag === 'F1');
  ok(await a.c.post(`/api/tribe/diplomacy/proposals/${f1?.id}/withdraw`));
  ok(await propose('F4', 'ally'), 201);
  errorOf(await propose('F5', 'ally'), 409, 'requirements_not_met');

  // NAPs: ten in total (active + pending).
  const nap = (tag: string) => propose(tag, 'nap');
  for (let i = 5; i < 5 + 6; i++) ok(await nap(`F${i}`), 201); // F3 + F5..F10 = 7 pending
  app.ctx.store.tribes.insertRelation(a.tribeId, others[11]?.tribeId ?? 0, 'nap', null, t, null);
  app.ctx.store.tribes.insertRelation(a.tribeId, others[1]?.tribeId ?? 0, 'nap', null, t, null); // replaces nothing: F1 has no relation yet
  assert.equal((await myTribe(a)).proposals.filter((p) => p.kind === 'nap').length, 7);
  ok(await nap('F0'), 201); // F0 is allied; a NAP proposal is a different kind: 7 pending + 2 active + this one = 10
  errorOf(await nap('F12'), 409, 'requirements_not_met');

  // Accepting also needs room on the accepting side: BRAVO already has three allies.
  for (let i = 0; i < 3; i++) app.ctx.store.tribes.insertRelation(b.tribeId, others[i + 6]?.tribeId ?? 0, 'ally', null, t, null);
  const chuck = await newLeader(app, 'chuck', 'Chuck Tribe', 'CHUCK', 'invite');
  ok(await chuck.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'ally' }), 201);
  const pending = (await myTribe(b)).proposals.find((p) => p.other.tag === 'CHUCK');
  const full = await b.c.post(`/api/tribe/diplomacy/proposals/${pending?.id}/accept`);
  errorOf(full, 409, 'requirements_not_met');
  assert.match(full.json<{ message: string }>().message, /at most 3/);
  assert.equal(count(app, 'tribe_proposals', 'id = ?', pending?.id ?? 0), 1, 'a refused accept changes nothing');
  // Free a slot and it works.
  app.ctx.store.db.prepare('DELETE FROM tribe_relations WHERE tribe_a = ? OR tribe_b = ?').run(others[6]?.tribeId ?? 0, others[6]?.tribeId ?? 0);
  ok(await b.c.post(`/api/tribe/diplomacy/proposals/${pending?.id}/accept`));
  assert.deepEqual((await myTribe(chuck)).tribe?.relations.map((r) => [r.kind, r.other.tag]), [['ally', 'BRAVO']]);
  await app.close();
});

test('enemy: declared at once, visible to both, either side cancels; refused during a pact', async () => {
  const { app, clock, a, b, c } = await threeTribes();
  const officer = await newPlayer(app, 'bravo_officer');
  await inviteAndAccept(b, officer);
  ok(await b.c.post(`/api/tribe/members/${officer.id}/role`, { role: 'officer' }));
  const declare = (p: P, tag: string) => p.c.post('/api/tribe/diplomacy', { tag, kind: 'enemy' });

  const res = await declare(a, 'BRAVO');
  ok(res, 201);
  const mine = res.json<MyTribeResponse>().tribe?.relations ?? [];
  assert.deepEqual(mine.map((r) => [r.kind, r.other.tag, r.declaredByUs, r.endsAt, r.since]), [['enemy', 'BRAVO', true, null, clock.now()]]);
  const theirs = (await myTribe(b)).tribe?.relations ?? [];
  assert.deepEqual(theirs.map((r) => [r.kind, r.other.tag, r.declaredByUs]), [['enemy', 'ALPHA', false]]);
  assert.equal(theirs[0]?.id, mine[0]?.id, 'one relation, seen from both sides');
  assert.equal((await texts(a))[0], 'alpha_lead declared [BRAVO] an enemy.');
  assert.equal((await texts(b))[0], '[ALPHA] declared us an enemy.');
  errorOf(await declare(a, 'BRAVO'), 409, 'requirements_not_met');
  errorOf(await declare(b, 'ALPHA'), 409, 'requirements_not_met');
  assert.equal((await myTribe(c)).tribe?.relations.length, 0);

  // Others cannot cancel it; either side can, at once.
  const id = mine[0]?.id ?? 0;
  errorOf(await c.c.post(`/api/tribe/diplomacy/relations/${id}/cancel`), 404, 'not_found');
  const ended = await officer.c.post(`/api/tribe/diplomacy/relations/${id}/cancel`);
  ok(ended);
  assert.deepEqual(ended.json<MyTribeResponse>().tribe?.relations, []);
  assert.deepEqual((await myTribe(a)).tribe?.relations, []);
  assert.equal((await texts(b))[0], 'bravo_officer ended the war with [ALPHA].');
  assert.equal((await texts(a))[0], '[BRAVO] ended the war with us.');
  errorOf(await a.c.post(`/api/tribe/diplomacy/relations/${id}/cancel`), 404, 'not_found');
  assert.equal(count(app, 'tribe_relations'), 0);

  // The other side may declare too (and the first one can then cancel it).
  const back = await declare(b, 'ALPHA');
  ok(back, 201);
  assert.equal(back.json<MyTribeResponse>().tribe?.relations[0]?.declaredByUs, true);
  assert.equal((await myTribe(a)).tribe?.relations[0]?.declaredByUs, false);
  ok(await a.c.post(`/api/tribe/diplomacy/relations/${back.json<MyTribeResponse>().tribe?.relations[0]?.id}/cancel`));

  // Declaring a war drops a pending proposal between the pair.
  ok(await a.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'ally' }), 201);
  ok(await declare(b, 'ALPHA'), 201);
  assert.equal(count(app, 'tribe_proposals'), 0);
  assert.equal((await myTribe(a)).proposals.length, 0);

  // A war can end in peace: accepting a pact replaces the enemy relation.
  ok(await a.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'nap' }), 201); // pacts can be proposed during a war
  const napProposal = (await myTribe(b)).proposals[0];
  ok(await b.c.post(`/api/tribe/diplomacy/proposals/${napProposal?.id}/accept`));
  assert.deepEqual((await myTribe(a)).tribe?.relations.map((r) => r.kind), ['nap']);
  assert.equal(count(app, 'tribe_relations'), 1);

  // No war while a pact is active ...
  const refused = await declare(a, 'BRAVO');
  errorOf(refused, 409, 'requirements_not_met');
  assert.match(refused.json<{ message: string }>().message, /non-aggression pact/);
  errorOf(await declare(b, 'ALPHA'), 409, 'requirements_not_met');
  // ... nor while it serves its notice.
  const rel = (await myTribe(a)).tribe?.relations[0];
  ok(await a.c.post(`/api/tribe/diplomacy/relations/${rel?.id}/cancel`));
  errorOf(await declare(a, 'BRAVO'), 409, 'requirements_not_met');
  errorOf(await declare(b, 'ALPHA'), 409, 'requirements_not_met');
  // ... but once the notice is over it is allowed.
  clock.advance(pactNoticeMs(app.ctx.settings));
  ok(await declare(a, 'BRAVO'), 201);
  assert.deepEqual((await myTribe(b)).tribe?.relations.map((r) => [r.kind, r.declaredByUs]), [['enemy', false]]);
  await app.close();
});

test('cancelling an ally or NAP starts a notice that still protects until it ends', async () => {
  const { app, clock, a, b, c } = await threeTribes();
  await formPact(a, 'BRAVO', b, 'ally');
  const notice = pactNoticeMs(app.ctx.settings);
  assert.equal(notice, (24 * HOUR) / app.ctx.settings.speed);
  const rel = (await myTribe(a)).tribe?.relations[0];
  assert.ok(rel);

  errorOf(await c.c.post(`/api/tribe/diplomacy/relations/${rel.id}/cancel`), 404, 'not_found');
  const t0 = clock.now();
  const res = await b.c.post(`/api/tribe/diplomacy/relations/${rel.id}/cancel`);
  ok(res);
  const endsAt = t0 + notice;
  assert.deepEqual(res.json<MyTribeResponse>().tribe?.relations.map((r) => [r.kind, r.endsAt]), [['ally', endsAt]]);
  assert.deepEqual((await myTribe(a)).tribe?.relations.map((r) => [r.kind, r.endsAt]), [['ally', endsAt]], 'both tribes see the countdown');
  assert.match((await texts(b))[0] ?? '', /^bravo_lead cancelled the alliance with \[ALPHA\]\. It still protects both tribes until 2026-06-01 \d\d:\d\d UTC\.$/);
  assert.match((await texts(a))[0] ?? '', /^\[BRAVO\] cancelled our alliance\. It still protects both tribes until /);

  // Cancelling twice (from either side) is refused; the end time does not move.
  errorOf(await b.c.post(`/api/tribe/diplomacy/relations/${rel.id}/cancel`), 409, 'requirements_not_met');
  clock.advance(60_000);
  errorOf(await a.c.post(`/api/tribe/diplomacy/relations/${rel.id}/cancel`), 409, 'requirements_not_met');
  assert.equal((await myTribe(a)).tribe?.relations[0]?.endsAt, endsAt);

  // During the notice the pact can be renewed by a new agreement: accepting replaces the relation.
  ok(await a.c.post('/api/tribe/diplomacy', { tag: 'BRAVO', kind: 'ally' }), 201);
  const renewal = (await myTribe(b)).proposals[0];
  ok(await b.c.post(`/api/tribe/diplomacy/proposals/${renewal?.id}/accept`));
  assert.equal((await myTribe(a)).tribe?.relations[0]?.endsAt, null);
  assert.equal(count(app, 'tribe_relations'), 1);

  // Cancel again and let the notice run out: until the last millisecond it is still listed ...
  const again = (await myTribe(a)).tribe?.relations[0];
  const t1 = clock.now();
  ok(await a.c.post(`/api/tribe/diplomacy/relations/${again?.id}/cancel`));
  clock.set(t1 + notice - 1);
  assert.equal((await myTribe(a)).tribe?.relations.length, 1);
  assert.equal(count(app, 'tribe_relations'), 1);
  // ... then it is ignored on read, deleted lazily and logged on both sides.
  clock.set(t1 + notice);
  assert.deepEqual((await myTribe(b)).tribe?.relations, []);
  assert.equal(count(app, 'tribe_relations'), 0);
  assert.equal((await texts(b))[0], 'Our alliance with [ALPHA] has ended.');
  assert.equal((await texts(a))[0], 'Our alliance with [BRAVO] has ended.');
  assert.deepEqual((await c.c.get(`/api/tribes/${a.tribeId}`)).json<TribeDto>().relations, []);
  errorOf(await a.c.post(`/api/tribe/diplomacy/relations/${again?.id}/cancel`), 404, 'not_found');

  // An expired row never blocks a new relation, even before anyone cleaned it up.
  const { app: app2, clock: clock2, a: a2, b: b2 } = await threeTribes();
  await formPact(a2, 'BRAVO', b2, 'nap');
  const nap = (await myTribe(a2)).tribe?.relations[0];
  ok(await a2.c.post(`/api/tribe/diplomacy/relations/${nap?.id}/cancel`));
  clock2.advance(pactNoticeMs(app2.ctx.settings));
  assert.equal(count(app2, 'tribe_relations'), 1, 'expired but not yet deleted');
  ok(await b2.c.post('/api/tribe/diplomacy', { tag: 'ALPHA', kind: 'enemy' }), 201);
  assert.equal(count(app2, 'tribe_relations'), 1);
  assert.deepEqual((await myTribe(a2)).tribe?.relations.map((r) => r.kind), ['enemy']);
  await app2.close();
  await app.close();
});

test('disbanding a tribe ends its relations and proposals and tells the other tribes', async () => {
  const { app, a, b, c } = await threeTribes();
  await formPact(a, 'BRAVO', b, 'ally');
  ok(await c.c.post('/api/tribe/diplomacy', { tag: 'ALPHA', kind: 'nap' }), 201);
  assert.equal(count(app, 'tribe_proposals'), 1);

  ok(await a.c.post('/api/tribe/disband'));
  assert.equal(count(app, 'tribe_relations'), 0);
  assert.equal(count(app, 'tribe_proposals'), 0);
  assert.deepEqual((await myTribe(b)).tribe?.relations, []);
  assert.deepEqual((await myTribe(c)).proposals, []);
  assert.equal((await texts(b))[0], '[ALPHA] was disbanded, so our alliance with them is over.');
  errorOf(await b.c.post('/api/tribe/diplomacy', { tag: 'ALPHA', kind: 'ally' }), 404, 'not_found');
  // The freed name and tag can be used again.
  const again = await newPlayer(app, 'newbie');
  setHall(app, again.id, 3);
  ok(await again.c.post('/api/tribes', { name: 'alpha tribe', tag: 'alpha', recruitment: 'open' }), 201);
  await app.close();
});
