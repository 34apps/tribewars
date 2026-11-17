// The numbers behind a report title (ReportDigest in packages/engine/src/api.ts), worked out from the stored report when it is read.
// Pure: nothing is stored, so reports saved before the digest existed have it too. Missing fields count as 0 / null, never as an error.

import { UNIT_IDS, emptyUnits, type BattleReportData, type ReportDigest, type ScoutReportData, type SendAgainDto, type Units } from '@clanfire/engine';
import type { ReportBody, ReportSide } from './store.ts';

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Sum of a unit map; 0 for anything that is not one (old or hand-edited JSON). */
function sumUnits(u: unknown): number {
  if (typeof u !== 'object' || u === null) return 0;
  const raw = u as Record<string, unknown>;
  let total = 0;
  for (const id of UNIT_IDS) total += count(raw[id]);
  return total;
}

function sumResources(r: unknown): number {
  if (typeof r !== 'object' || r === null) return 0;
  return Object.values(r as Record<string, unknown>).reduce<number>((a, n) => a + count(n), 0);
}

const isCoord = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function fullUnits(u: unknown): Units {
  const out = emptyUnits();
  if (typeof u === 'object' && u !== null) for (const id of UNIT_IDS) out[id] = count((u as Record<string, unknown>)[id]);
  return out;
}

function again(mission: 'attack' | 'scout', fromVillageId: unknown, to: { x?: unknown; y?: unknown; name?: unknown } | undefined, units: Units): SendAgainDto | null {
  if (typeof fromVillageId !== 'number' || !to || !isCoord(to.x) || !isCoord(to.y)) return null;
  if (sumUnits(units) <= 0) return null;
  return { fromVillageId, x: to.x, y: to.y, mission, units, targetName: typeof to.name === 'string' ? to.name : '' };
}

function battleDigest(side: ReportSide, b: BattleReportData): ReportDigest {
  const loot = sumResources(b.loot);
  if (side === 'attack') {
    return {
      loot: b.outcome === 'called_off' ? 0 : loot,
      sent: sumUnits(b.attackerUnits),
      lost: sumUnits(b.attackerLosses),
      again: again('attack', b.attacker?.villageId, b.defender, fullUnits(b.attackerUnits)),
    };
  }
  // defense / support: the defending force is the owner's own troops plus the support that fought; hidden (null) when the report hides it.
  const hidden = b.defenderUnits === null || b.defenderUnits === undefined;
  return {
    loot,
    sent: hidden ? null : sumUnits(b.defenderUnits) + sumUnits(b.supportUnits),
    lost: b.defenderLosses === null || b.defenderLosses === undefined ? null : sumUnits(b.defenderLosses) + sumUnits(b.supportLosses),
    again: null,
  };
}

function scoutDigest(side: ReportSide, s: ScoutReportData): ReportDigest {
  const sent = count(s.scoutsSent);
  const units = emptyUnits();
  units.pathfinder = sent;
  return { loot: 0, sent, lost: count(s.scoutsLost), again: side === 'attack' ? again('scout', s.scout?.villageId, s.target, units) : null };
}

/** The digest of a report body, or undefined for shipment, support and village reports (nothing to summarise). */
export function reportDigest(side: ReportSide, body: ReportBody): ReportDigest | undefined {
  if (body.type === 'battle') return battleDigest(side, body.battle);
  if (body.type === 'scout') return scoutDigest(side, body.scout);
  return undefined;
}
