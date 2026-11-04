// Shared setup for the Renown tests (docs/GAME_DESIGN.md section 18.2). Levels and stock are written straight into the
// database; `renownPaid` is moved with them unless a test wants the Renown for those levels to be paid.

import assert from 'node:assert/strict';
import { villagePoints, type BuildingId, type BuildingLevels, type Resources } from '@clanfire/engine';
import type { App, P } from './tribe-helpers.ts';

/** Set building levels (and optionally the stock) of the player's first village. `paid`: also mark the levels as already paid. */
export function setVillage(app: App, playerId: number, opts: { levels?: Partial<BuildingLevels>; resources?: Partial<Resources>; paid?: boolean }): void {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(playerId)[0];
  assert.ok(v, 'player has a village');
  for (const [b, level] of Object.entries(opts.levels ?? {})) {
    v.state.buildings[b as BuildingId] = level;
    if (opts.paid !== false && v.state.renownPaid) v.state.renownPaid[b as BuildingId] = Math.max(v.state.renownPaid[b as BuildingId], level);
  }
  if (opts.resources) v.state.resources = { ...v.state.resources, ...opts.resources };
  store.saveVillage(v.id, v.state, villagePoints(v.state));
}

/** Everything the player has earned (fractions kept), straight from the database. */
export const renownOf = (app: App, p: P | number): number => app.ctx.store.getPlayer(typeof p === 'number' ? p : p.id)?.renownTotal ?? 0;

/** Overwrite the stored Renown total (ranking tests). */
export function setRenown(app: App, playerId: number, total: number): void {
  app.ctx.store.db.prepare('UPDATE players SET renown_total = ? WHERE id = ?').run(total, playerId);
}

export interface PairRow {
  earner_id: number;
  opponent: string;
  window_start: number;
  value: number;
}

export function pairRows(app: App, earnerId?: number): PairRow[] {
  const db = app.ctx.store.db;
  const rows = earnerId === undefined ? db.prepare('SELECT * FROM renown_pairs ORDER BY earner_id, opponent').all() : db.prepare('SELECT * FROM renown_pairs WHERE earner_id = ? ORDER BY opponent').all(earnerId);
  return rows as unknown as PairRow[];
}

export const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
