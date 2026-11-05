// Shared setup for the domination / world-end tests. World speed is 10 (TEST_WORLD), so with the rule below:
//   minimum age 1 day, streak 12 hours, "active" = played in the last 16.8 hours, evaluation interval 90 s.
// Everything is driven by the test clock and direct database writes; nothing waits for real time.

import assert from 'node:assert/strict';
import { DOMINATION_DEFAULTS, type DominationSettings } from '@clanfire/engine';
import type { BuildAppOptions } from '../src/app.ts';
import type { DominationEvaluation } from '@clanfire/engine';
import { HOUR, makeApp, type Clock } from './helpers.ts';
import { addMember, newLeader, newPlayer, type App, type P } from './tribe-helpers.ts';
import { unprotect } from './warfare-helpers.ts';

export const DAY = 24 * HOUR;
/** Rule used by most tests (days at speed 1; the world runs at speed 10). */
export const RULE: DominationSettings = { minAgeDays: 10, minActivePlayers: 2, minPeakShare: 0.3, winShare: 0.75, streakDays: 5, activeDays: 7 };
export const MIN_AGE_MS = DAY; // 10 days / 10
export const STREAK_MS = 12 * HOUR; // 5 days / 10
export const ACTIVE_MS = 16.8 * HOUR; // 7 days / 10
export const EVAL_INTERVAL_MS = 90_000; // 15 min / 10

export interface DomWorld {
  app: App;
  clock: Clock;
  t0: number;
  alice: P & { tribeId: number };
  amy: P;
  bob: P & { tribeId: number };
  lou: P;
}

/**
 * ALPHA: alice (leader), amy. BRAVO: bob (leader). lou: no tribe. All unprotected. Created at `t0`, when the world starts.
 * Every village keeps whatever points it has until a test sets them with `setPts`.
 */
export async function domWorld(rule: Partial<DominationSettings> = {}, opts: Partial<BuildAppOptions> = {}): Promise<DomWorld> {
  const { app, clock } = await makeApp({ ...opts, world: { domination: { ...RULE, ...rule } } });
  const t0 = clock.now();
  const alice = await newLeader(app, 'alice', 'Alpha Pack', 'ALPHA', 'open');
  const amy = await addMember(app, alice, 'amy');
  const bob = await newLeader(app, 'bob', 'Bravo Clan', 'BRAVO', 'open');
  const lou = await newPlayer(app, 'lou');
  unprotect(app, alice, amy, bob, lou);
  return { app, clock, t0, alice, amy, bob, lou };
}

/** Set the points of each player's first village straight in the database. Unnamed players keep their points. */
export function setPts(w: DomWorld, pts: Partial<Record<'alice' | 'amy' | 'bob' | 'lou', number>>): void {
  for (const [name, points] of Object.entries(pts)) {
    const p = w[name as 'alice'];
    const v = w.app.ctx.store.villagesOfPlayer(p.id)[0];
    assert.ok(v, `${name} has a village`);
    w.app.ctx.store.setPoints(v.id, points ?? 0);
  }
}

/** The common starting position: alice and lou are the only ones with points (alice's tribe holds 75%). */
export function setExact75(w: DomWorld): void {
  setPts(w, { alice: 7500, amy: 0, bob: 0, lou: 2500 });
}

/** Everybody played "now" (last_active), then the given players are made stale (a month ago). */
export function touchAll(app: App, t: number, stale: readonly number[] = []): void {
  const db = app.ctx.store.db;
  db.prepare('UPDATE players SET last_active = ?').run(t);
  for (const id of stale) db.prepare('UPDATE players SET last_active = ? WHERE id = ?').run(t - 30 * DAY, id);
}

/** Players without a village or a login, for the active-player count. Returns their ids. */
export function fillers(app: App, n: number, t: number, prefix = 'fill'): number[] {
  return Array.from({ length: n }, (_, i) => app.ctx.store.insertPlayer(`${prefix}${i}`, 'x', t, 0));
}

/** Jump the clock to `t`, mark everybody active (except `stale`), and force one evaluation at `t`. */
export function ev(w: Pick<DomWorld, 'app' | 'clock'>, t: number, stale: readonly number[] = []): DominationEvaluation {
  w.clock.set(t);
  touchAll(w.app, t, stale);
  const e = w.app.ctx.domination.evaluate(t, true);
  assert.ok(e, 'the evaluation ran (the world had not ended)');
  return e;
}

export const auditRows = (app: App, action: string): Array<{ action: string; actor_id: number | null; actor_ip: string | null; target_player: number | null; detail: string; at: number }> =>
  app.ctx.store.db.prepare('SELECT at, action, actor_id, actor_ip, target_player, detail FROM audit_log WHERE action = ? ORDER BY id').all(action) as never;

export const worldSettingsJson = (app: App): Record<string, unknown> => JSON.parse(app.ctx.store.getMeta('world_settings') ?? '{}') as Record<string, unknown>;

export { DOMINATION_DEFAULTS };
