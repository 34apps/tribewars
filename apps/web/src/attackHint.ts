// "You need N troops" hint of the attack form (pure; no React, no I/O). It runs the REAL battle (`simulate` in simulator.ts, which calls the
// engine's `resolveBattle`) on the player's own newest report on the target (GET /api/intel/:id) at the unlucky end, even and the lucky end.
// It is an estimate from old information: the real battle may go differently.

import { BATTLE_LUCK, UNITS, UNIT_IDS, emptyUnits } from '@clanfire/engine';
import type { Units, VillageIntelDto, VillageRanks, WorldSettings } from '@clanfire/engine';
import { formatInt } from './format.ts';
import { hasTroops, simulate, simulateAll, WALL_MAX } from './simulator.ts';
import type { SimSetup } from './simulator.ts';

/** Most extra Raiders the search looks for (a bigger gap says "more than ..."). */
export const MORE_RAIDERS_CAP = 200_000;

export type HintVerdict = 'win' | 'close' | 'lose';

export interface AttackHintInput {
  /** The server's answer for the target; null = not loaded yet (no hint). */
  intel: VillageIntelDto | null;
  /** The army that would be sent (counts, whole numbers). */
  attacker: Units;
  /** Server-synced now, ms. */
  now: number;
  /** The target is an abandoned village: no militia, the Wall only boosts the troops that stand there. */
  abandoned: boolean;
  /** Morale factor of this send (1 = none; the same number the form shows). */
  morale?: number;
  /** The sending village's ranks (Might). */
  attackerRanks?: VillageRanks;
  /** Raiders at home that are not in the army: the "more Raiders" answer is left out when it asks for more than that. undefined = no limit. */
  spareRaiders?: number;
  /** World settings (siege on/off). */
  settings?: Pick<WorldSettings, 'config'>;
}

export interface AttackHint {
  /** 'none': no usable report. 'blind': a scout exists but showed no troops. 'estimate': a report with troops. */
  kind: 'none' | 'blind' | 'estimate';
  /** null while no army is picked, or when there is no estimate. */
  verdict: HintVerdict | null;
  /** Own losses at even luck, as a share of the army, rounded to 5 (0..100); null when no army is picked or there is no estimate. */
  lossesPct: number | null;
  /** Smallest number of ADDITIONAL Raiders that wins at the unlucky end; null = not needed, or too many to say (see `moreRaidersOver`), or beyond what is at home. */
  moreRaiders: number | null;
  /** True when even `MORE_RAIDERS_CAP` more Raiders would not be enough. */
  moreRaidersOver: boolean;
  /** Raiders spare at the sending village (null when unknown), so the text can say how far off the player is. */
  raidersAtHome: number | null;
  /** Age of the report in ms at `input.now` (null without a report). */
  ageMs: number | null;
  /** When the report is from (server clock, ms); the text computes the age from it, so the hint need not be rebuilt every second. */
  at: number | null;
  source: 'scout' | 'battle' | null;
  /** The scout rounded the troop counts. */
  approx: boolean;
  /** The report did not show the Wall level (counted as 0). */
  wallUnknown: boolean;
}

const roundTo5 = (pct: number): number => Math.max(0, Math.min(100, Math.round(pct / 5) * 5));

const sum = (u: Units): number => UNIT_IDS.reduce((n, id) => n + u[id], 0);

function setupOf(i: AttackHintInput, attacker: Units): SimSetup {
  const intel = i.intel as VillageIntelDto;
  return {
    attacker,
    defender: intel.troops ?? emptyUnits(),
    support: emptyUnits(),
    wall: Math.max(0, Math.min(WALL_MAX, Math.floor(intel.wallLevel ?? 0))),
    ...(i.attackerRanks ? { attackerRanks: i.attackerRanks } : {}),
    defenderBulwark: 0,
    supportBulwark: 0,
    siegeTarget: null,
    targetLevel: 0,
    morale: (i.morale ?? 1) < 1,
    abandoned: i.abandoned,
  };
}

/**
 * The smallest number of extra Raiders on top of `attacker` that wins at bad luck (doubling, then a binary search over the real battle).
 * 0 = the army already wins there; null = not even `cap` more Raiders win.
 */
export function raidersToWin(setup: SimSetup, settings?: Pick<WorldSettings, 'config'>, cap = MORE_RAIDERS_CAP): number | null {
  const bad = -BATTLE_LUCK;
  const wins = (k: number): boolean => simulate({ ...setup, attacker: { ...setup.attacker, raider: setup.attacker.raider + k } }, bad, settings).result.attackerWon;
  if (wins(0)) return 0;
  let lo = 0; // known to lose
  let hi = 1;
  while (!wins(hi)) {
    lo = hi;
    if (hi >= cap) return null;
    hi = Math.min(cap, hi * 2);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wins(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The hint for one target and one army. Never throws; with no report it only says so. */
export function attackHint(i: AttackHintInput): AttackHint {
  const intel = i.intel;
  const base = { moreRaiders: null, moreRaidersOver: false, raidersAtHome: null, verdict: null, lossesPct: null } as const;
  if (!intel || intel.source === null || intel.at === null) {
    return { kind: 'none', ...base, ageMs: null, at: null, source: null, approx: false, wallUnknown: false };
  }
  const meta = { ageMs: Math.max(0, i.now - intel.at), at: intel.at, source: intel.source, approx: intel.troopsApprox, wallUnknown: intel.wallLevel === null };
  if (!intel.troops) return { kind: 'blind', ...base, ...meta };
  const attacker = { ...emptyUnits(), ...i.attacker };
  const picked = hasTroops(attacker);
  const setup = setupOf(i, attacker);

  let verdict: HintVerdict | null = null;
  let lossesPct: number | null = null;
  if (picked) {
    const [bad, even] = simulateAll(setup, i.settings);
    verdict = !even!.result.attackerWon ? 'lose' : bad!.result.attackerWon ? 'win' : 'close';
    lossesPct = roundTo5((sum(even!.result.attackerLosses) / sum(attacker)) * 100);
  }

  let moreRaiders: number | null = null;
  let moreRaidersOver = false;
  if (!picked || verdict !== 'win') {
    const k = raidersToWin(setup, i.settings);
    if (k === null) moreRaidersOver = true;
    else if (k > 0) moreRaiders = k;
  }
  return { kind: 'estimate', verdict, lossesPct, moreRaiders, moreRaidersOver, raidersAtHome: i.spareRaiders ?? null, ...meta };
}

export type HintTone = 'ok' | 'warn' | 'bad' | 'mut';

export interface AttackHintText {
  /** The verdict as a tag ("Should win"); null when there is none. */
  tag: { tone: HintTone; label: string } | null;
  /** Short lines in order: the first sits next to the tag (losses), then the Raiders needed, then how old the report is plus the caveat. */
  lines: string[];
}

export const HINT_CAVEAT = 'Estimate from old information: the village may have changed. The real battle may go differently.';

/** "just now", "12m ago", "5h ago", "36 days ago" (a report this old is shown in days, not as a date: the point is how stale it is). */
export function ageWords(diffMs: number): string {
  const diff = Math.max(0, diffMs);
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const d = Math.floor(diff / 86_400_000);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** "scouted 3h ago" / "from a battle 2 days ago". */
export function reportAge(h: Pick<AttackHint, 'source' | 'at'>, now: number): string {
  if (h.source === null || h.at === null) return '';
  const when = ageWords(now - h.at);
  return h.source === 'scout' ? `scouted ${when}` : `from a battle ${when}`;
}

const VERDICT: Record<HintVerdict, { tone: HintTone; label: string }> = {
  win: { tone: 'ok', label: 'Should win' },
  close: { tone: 'warn', label: 'Close: could go either way' },
  lose: { tone: 'bad', label: 'Would lose' },
};

/** Wording for the form: plain sentences, 3 or 4 short lines. */
export function attackHintText(h: AttackHint, now: number): AttackHintText {
  if (h.kind === 'none') return { tag: null, lines: ['Scout first to see what you need.'] };
  const age = reportAge(h, now);
  const ageSentence = age ? `${age.charAt(0).toUpperCase()}${age.slice(1)}.` : '';
  if (h.kind === 'blind') return { tag: null, lines: ['Your last scout could not count the troops: scout again with a higher Keen rank.', ageSentence].filter(Boolean) };
  const lines: string[] = [];
  if (h.verdict && h.lossesPct !== null) {
    lines.push(h.verdict === 'lose' ? `You would lose about ${h.lossesPct}% of your troops.` : `About ${h.lossesPct}% of your troops lost.`);
  }
  const more = h.verdict === null ? '' : 'more ';
  const have = h.raidersAtHome !== null && h.moreRaiders !== null && h.moreRaiders > h.raidersAtHome ? ` (${formatInt(h.raidersAtHome)} more at home)` : '';
  if (h.moreRaiders !== null) lines.push(`About ${formatInt(h.moreRaiders)} ${more}${UNITS.raider.name}s needed${have}.`);
  else if (h.moreRaidersOver) lines.push(`More than ${formatInt(MORE_RAIDERS_CAP)} ${more}${UNITS.raider.name}s needed.`);
  const meta = [ageSentence.replace(/\.$/, ''), h.approx ? 'troops were rounded' : '', h.wallUnknown ? 'Wall level unknown' : ''].filter(Boolean).join(' · ');
  lines.push(meta ? `${meta}. ${HINT_CAVEAT}` : HINT_CAVEAT);
  return { tag: h.verdict ? VERDICT[h.verdict] : null, lines };
}
