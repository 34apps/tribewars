// Shared setup for the several-villages tests (docs/GAME_DESIGN.md 18.2, step 2): strong villages, a cleared abandoned
// target, free tiles and the Chieftain Renown ledger. Everything is put into the database directly; these tests are not about
// training or building.

import assert from 'node:assert/strict';
import {
  checkFoundTarget,
  emptyUnits,
  generateSites,
  isNearSite,
  markRenownPaid,
  maxOutVillage,
  settleVillage,
  villagePoints,
  type ReportDto,
  type Units,
  type VillageReportData,
} from '@clanfire/engine';
import { makeApp, ok, type Clock } from './helpers.ts';
import { newPlayer, type App, type P } from './tribe-helpers.ts';
import type { VillageRecord } from '../src/store.ts';
import { report, reports, unprotect } from './warfare-helpers.ts';

export type { App, P };

/** A new, unprotected player (attacking players and being attacked both need that). */
export async function player(app: App, name: string): Promise<P> {
  const p = await newPlayer(app, name);
  unprotect(app, p);
  return p;
}

/** Fill the player's `index`-th village: every building maxed, full stores, exactly `troops` at home (Chieftains included). Returns the village id. */
export function strongHome(app: App, clock: Clock, p: P, troops: Partial<Units>, index = 0): number {
  const store = app.ctx.store;
  const v = store.villagesOfPlayer(p.id)[index];
  assert.ok(v, 'player has that village');
  const st = markRenownPaid(maxOutVillage(settleVillage(v.state, clock.now(), app.ctx.settings), clock.now()));
  st.troops = { ...emptyUnits(), ...troops };
  st.away = emptyUnits();
  store.saveVillage(v.id, st, villagePoints(st));
  return v.id;
}

/** The abandoned village closest to `from`, with its garrison removed so any army wins at once. */
export function clearedTarget(app: App, from: VillageRecord): VillageRecord {
  const store = app.ctx.store;
  let best: VillageRecord | null = null;
  let bestD = Infinity;
  for (const id of store.abandonedVillageIds()) {
    const v = store.getVillage(id);
    if (!v) continue;
    const d = Math.hypot(v.x - from.x, v.y - from.y);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  assert.ok(best, 'the world has abandoned villages');
  best.state.troops = emptyUnits();
  store.saveVillage(best.id, best.state, villagePoints(best.state));
  return store.getVillage(best.id) as VillageRecord;
}

export const homeOf = (app: App, p: P, index = 0): VillageRecord => {
  const v = app.ctx.store.villagesOfPlayer(p.id)[index];
  assert.ok(v, 'player has that village');
  return v;
};

/** The nearest free build site (engine rule) to the player's first village. */
export function freeTileNear(app: App, p: P): { x: number; y: number } {
  const store = app.ctx.store;
  const s = app.ctx.settings;
  const home = homeOf(app, p);
  const sites = generateSites(s.seed, s.radius);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let x = -s.radius; x <= s.radius; x++) {
    for (let y = -s.radius; y <= s.radius; y++) {
      if (!checkFoundTarget({ x, y }, s, (px, py) => store.villageExistsAt(px, py)).ok) continue;
      if (isNearSite(x, y, sites)) continue; // no village near a map site

      const d = Math.hypot(x - home.x, y - home.y);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  assert.ok(best, 'the test world has a free build site');
  return best;
}

/** Renown ledger straight from the database. */
export function ledger(app: App, p: P): { total: number; spent: number; reserved: number } {
  const row = app.ctx.store.getPlayer(p.id);
  assert.ok(row);
  return { total: row.renownTotal, spent: row.renownSpent, reserved: row.renownReserved };
}

/** War Chest straight from the database: spendable gold and the part reserved by Chieftains. */
export function chestOf(app: App, p: P): { gold: number; reserved: number } {
  const row = app.ctx.store.getPlayer(p.id);
  assert.ok(row);
  return { gold: row.chestGold, reserved: row.chestReserved };
}

/** Put gold straight into the player's War Chest (tests that train Chieftains need it). */
export function fillChest(app: App, p: P, gold: number): void {
  app.ctx.store.depositChest(p.id, gold);
}

/** The ledger invariants that must hold after any event: nothing negative, and the reservation is part of what was spent. */
export function assertLedgerSane(app: App, p: P): void {
  const l = ledger(app, p);
  assert.ok(l.spent >= -1e-9, `spent never negative (${l.spent})`);
  assert.ok(l.reserved >= -1e-9, `reserved never negative (${l.reserved})`);
  assert.ok(l.reserved <= l.spent + 1e-9, `reserved (${l.reserved}) is part of spent (${l.spent})`);
}

/** Give `n` Chieftains a reservation of `each` Renown (as if they had been trained): total, spent and reserved go up together. */
export function reserveFor(app: App, p: P, n: number, each: number): void {
  app.ctx.store.addRenown(p.id, n * each + 1000);
  app.ctx.store.reserveRenown(p.id, n * each);
  // The chest gold they reserved too (same average share), so the chest ledger moves with the Renown one.
  app.ctx.store.depositChest(p.id, n * each * 2);
  app.ctx.store.reserveChest(p.id, n * each * 2);
}

export const villagesOf = (app: App, p: P): VillageRecord[] => app.ctx.store.villagesOfPlayer(p.id);

/** Newest village-type reports of the player, opened, newest first. */
export async function villageReports(p: P): Promise<Array<ReportDto & { village: VillageReportData }>> {
  const out: Array<ReportDto & { village: VillageReportData }> = [];
  for (const r of await reports(p)) {
    if (r.type !== 'village') continue;
    const full = await report(p, r.id);
    assert.ok(full.village, 'village report has its body');
    out.push(full as ReportDto & { village: VillageReportData });
  }
  return out;
}

/** Run everything due up to `t` (the clock jumps there first). */
export function runTo(app: App, clock: Clock, t: number): void {
  clock.set(t);
  app.ctx.game.processDue(clock.now());
}

export { makeApp, ok, newPlayer };
