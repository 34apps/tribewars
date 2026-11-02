// Shared setup for the scouting / support / alert tests (docs/GAME_DESIGN.md section 12).
// Troops are put into villages straight in the database: these tests are not about training.

import assert from 'node:assert/strict';
import {
  emptyUnits,
  type GameStateResponse,
  type Mission,
  type MovementDto,
  type OwnVillageDto,
  type ReportDto,
  type ReportListResponse,
  type SendResponse,
  type StationedDto,
  type Units,
} from '@clanfire/engine';
import { errorOf, makeApp, ok, type Clock } from './helpers.ts';
import { addMember, newLeader, newPlayer, type App, type P } from './tribe-helpers.ts';

export type { App, P };

export const units = (partial: Partial<Units>): Units => ({ ...emptyUnits(), ...partial });

/** Add troops to a player's (only) village, at home. */
export function giveTroops(app: App, p: P, add: Partial<Units>): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[0];
  assert.ok(v, 'player has a village');
  for (const [u, n] of Object.entries(add)) v.state.troops[u as keyof Units] += n ?? 0;
  store.saveVillage(v.id, v.state, v.points);
}

/** End beginner protection (a protected player cannot be attacked or scouted). */
export function unprotect(app: App, ...players: P[]): void {
  for (const p of players) app.ctx.store.setProtectedUntil(p.id, 0);
}

export const village = (p: P): Promise<OwnVillageDto> => p.c.village();

/** `u` is loose on purpose: tests also send nonsense. */
export async function send(from: P, to: P | { x: number; y: number }, mission: Mission, u: object): Promise<ReturnType<P['c']['post']>> {
  const home = await village(from);
  const dest = 'c' in to ? await village(to) : to;
  return from.c.post(`/api/villages/${home.id}/send`, { x: dest.x, y: dest.y, units: u, mission });
}

/** Send and expect 201; returns the response body. */
export async function sendOk(from: P, to: P | { x: number; y: number }, mission: Mission, u: Partial<Units>): Promise<SendResponse> {
  const res = await send(from, to, mission, u);
  ok(res, 201);
  return res.json<SendResponse>();
}

export async function sendFails(from: P, to: P | { x: number; y: number }, mission: Mission, u: object, status: number, code: string): Promise<string> {
  const res = await send(from, to, mission, u);
  errorOf(res, status, code);
  return res.json<{ message: string }>().message;
}

export async function reports(p: P): Promise<ReportListResponse['reports']> {
  const res = await p.c.get('/api/reports');
  ok(res);
  return res.json<ReportListResponse>().reports;
}

export async function report(p: P, id: number): Promise<ReportDto> {
  const res = await p.c.get(`/api/reports/${id}`);
  ok(res);
  return res.json<ReportDto>();
}

/** The player's newest report, opened in full. */
export async function latestReport(p: P): Promise<ReportDto> {
  const first = (await reports(p))[0];
  assert.ok(first, 'player has a report');
  return report(p, first.id);
}

/** Send support from `from` to `to`, let it arrive, and return the stationed entry as `to` sees it. */
export async function stationSupport(app: App, clock: Clock, from: P, to: P, u: Partial<Units>): Promise<StationedDto> {
  giveTroops(app, from, u);
  const { movement } = await sendOk(from, to, 'support', u);
  clock.set(movement.arriveAt);
  const entry = (await to.c.state()).stationed.here.find((s) => s.home.ownerName === from.name);
  assert.ok(entry, 'support is stationed');
  return entry;
}

export const movementsOf = async (p: P): Promise<MovementDto[]> => (await p.c.state()).movements;
export const stateOf = (p: P): Promise<GameStateResponse> => p.c.state();

/**
 * Two tribes with unprotected players:
 *   ALPHA (open): alice (leader), amy (member), and the tribeless loner `lou`
 *   BRAVO (open): bob (leader), bea (member)
 * `nap`/`ally` helpers are left to the tests.
 */
export async function world() {
  const { app, clock } = await makeApp();
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  const bea = await addMember(app, bob, 'bea');
  const lou = await newPlayer(app, 'lou');
  unprotect(app, alice, amy, bob, bea, lou);
  return { app, clock, alice, amy, bob, bea, lou };
}
