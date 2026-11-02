// Shared setup for the tribe tests: players, Town Hall shortcuts, tribes created through the public API.

import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import {
  villagePoints,
  type BuildingId,
  type MyTribeResponse,
  type Recruitment,
  type SendResponse,
} from '@clanfire/engine';
import { Client, HOUR, errorOf, makeApp, ok, register, trainRaiders, type Clock } from './helpers.ts';

export type App = FastifyInstance;

export interface P {
  c: Client;
  id: number;
  name: string;
}

let ipCounter = 0;
/** A fresh client IP per player: registration is rate-limited per IP. */
export const nextIp = (): string => {
  ipCounter += 1;
  return `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export async function newPlayer(app: App, name: string): Promise<P> {
  const c = await register(app, name, nextIp());
  return { c, id: (await c.state()).player.id, name };
}

/** Set a building level straight in the database (tests that are not about building). */
export function setBuilding(app: App, playerId: number, building: BuildingId, level: number): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(playerId)[0];
  assert.ok(v, 'player has a village');
  v.state.buildings[building] = level;
  store.saveVillage(v.id, v.state, villagePoints(v.state));
}

export const setHall = (app: App, playerId: number, level: number): void => setBuilding(app, playerId, 'hall', level);

export async function found(
  p: P,
  name: string,
  tag: string,
  recruitment: Recruitment = 'open',
  description?: string,
): Promise<MyTribeResponse> {
  const body = description === undefined ? { name, tag, recruitment } : { name, tag, recruitment, description };
  const res = await p.c.post('/api/tribes', body);
  ok(res, 201);
  return res.json<MyTribeResponse>();
}

/** A new player with a Town Hall of level 3 who founds a tribe. */
export async function newLeader(app: App, username: string, tribeName: string, tag: string, recruitment: Recruitment = 'open'): Promise<P & { tribeId: number }> {
  const p = await newPlayer(app, username);
  setHall(app, p.id, 3);
  const res = await found(p, tribeName, tag, recruitment);
  assert.ok(res.tribe);
  return { ...p, tribeId: res.tribe.id };
}

/** A new tribeless player. */
export const newMember = newPlayer;

export async function myTribe(p: P): Promise<MyTribeResponse> {
  const res = await p.c.get('/api/tribe');
  ok(res);
  return res.json<MyTribeResponse>();
}

export async function join(p: P, tribeId: number): Promise<MyTribeResponse> {
  const res = await p.c.post(`/api/tribes/${tribeId}/join`);
  ok(res);
  return res.json<MyTribeResponse>();
}

/** `member` joins the leader's (open) tribe; returns the player. */
export async function addMember(app: App, leader: P & { tribeId: number }, username: string): Promise<P> {
  const m = await newPlayer(app, username);
  await join(m, leader.tribeId);
  return m;
}

/** Leader invites, the invitee accepts. */
export async function inviteAndAccept(leader: P, invitee: P): Promise<MyTribeResponse> {
  const inv = await leader.c.post('/api/tribe/invites', { username: invitee.name });
  ok(inv, 201);
  const id = inv.json<MyTribeResponse>().invites.find((i) => i.username === invitee.name)?.id;
  assert.ok(id !== undefined, 'invitation listed');
  const res = await invitee.c.post(`/api/invites/${id}/accept`);
  ok(res);
  return res.json<MyTribeResponse>();
}

/** A player row without a village or a login: for filling a tribe up to its cap quickly. */
export function fillerPlayer(app: App, name: string, t: number): number {
  return app.ctx.store.insertPlayer(name, 'x', t, 0);
}

/** A tribe made straight in the database (led by a filler player) -- the other side of a diplomacy test. */
export function fillerTribe(app: App, name: string, tag: string, t: number): { tribeId: number; leaderId: number } {
  const ts = app.ctx.store.tribes;
  const leaderId = fillerPlayer(app, `lead_${tag.toLowerCase()}`, t);
  const tribeId = ts.insertTribe(name, tag, '', 'invite', t);
  ts.insertMember(leaderId, tribeId, 'leader', t);
  return { tribeId, leaderId };
}

export function count(app: App, table: string, where = '1 = 1', ...params: Array<string | number>): number {
  const row = app.ctx.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as { n: number };
  return row.n;
}

/** Two raiders-ready players, each leading a tribe ([ALPHA] / [BRAVO]); Bob's beginner protection is over. */
export async function warSetup() {
  const { app, clock } = await makeApp();
  const bobReg = await newPlayer(app, 'bob');
  clock.advance(HOUR);
  const aliceReg = await newPlayer(app, 'alice');
  const vidA = await trainRaiders(aliceReg.c, clock, 14);
  const vb = await bobReg.c.village();
  const bobUntil = (await bobReg.c.state()).player.protectedUntil;
  clock.set(bobUntil);

  setHall(app, aliceReg.id, 3);
  setHall(app, bobReg.id, 3);
  const a = await found(aliceReg, 'Alpha Pack', 'ALPHA', 'invite');
  const b = await found(bobReg, 'Bravo Clan', 'BRAVO', 'invite');
  assert.ok(a.tribe && b.tribe);
  return {
    app,
    clock,
    alice: { ...aliceReg, tribeId: a.tribe.id },
    bob: { ...bobReg, tribeId: b.tribe.id },
    vidA,
    vb,
    send: (): ReturnType<Client['post']> => aliceReg.c.post(`/api/villages/${vidA}/send`, { x: vb.x, y: vb.y, units: { raider: 14 }, mission: 'attack' }),
  };
}

/** Propose a pact from `from` to `to` and accept it. */
export async function formPact(from: P, toTag: string, to: P, kind: 'ally' | 'nap'): Promise<MyTribeResponse> {
  const prop = await from.c.post('/api/tribe/diplomacy', { tag: toTag, kind });
  ok(prop, 201);
  const mine = await myTribe(to);
  const p = mine.proposals.find((x) => x.kind === kind && x.direction === 'incoming');
  assert.ok(p, 'incoming proposal listed');
  const res = await to.c.post(`/api/tribe/diplomacy/proposals/${p.id}/accept`);
  ok(res);
  return res.json<MyTribeResponse>();
}

export { errorOf, ok, type Clock, type SendResponse };
