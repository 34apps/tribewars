// Fighter rankings (docs/GAME_DESIGN.md, "Fighter rankings"): labels, rows and the battle report lines shared by the desktop and phone pages.

import { useEffect, useState } from 'react';
import type { BattleReportData, FighterKind, FighterRankDto, FighterRankingResponse, FighterScope, StrikeOutcome } from '@clanfire/engine';
import { api, errorMessage } from './api.ts';
import { formatInt, formatLeft } from './format.ts';

export const FIGHTER_KINDS: Array<{ id: FighterKind; label: string }> = [
  { id: 'attacker', label: 'Attacker' },
  { id: 'defender', label: 'Defender' },
  { id: 'total', label: 'Total' },
];
export const FIGHTER_SCOPES: Array<{ id: FighterScope; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'tribes', label: 'Tribes' },
];
export const fighterKindLabel = (k: FighterKind): string => FIGHTER_KINDS.find((x) => x.id === k)?.label ?? k;

/** The listed rows, with the caller's own row added when it is outside the top 100 (the same rule as the other ranking lists). */
export function fighterRows(r: FighterRankingResponse): FighterRankDto[] {
  return r.me && !r.rows.some((x) => x.id === r.me!.id) ? [...r.rows, r.me] : r.rows;
}

/** Name, or tribe tag, contains the text (case-insensitive). */
export function searchFighters(rows: FighterRankDto[], query: string): FighterRankDto[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.tag?.toLowerCase().includes(q) ?? false)) : rows;
}

/** The two values that are not the chosen kind, for the small line under a name on a phone. */
export function otherFighterValues(r: FighterRankDto, kind: FighterKind): string {
  return FIGHTER_KINDS.filter((k) => k.id !== kind)
    .map((k) => `${k.label} ${formatInt(r[k.id])}`)
    .join(' · ');
}

/** Loads one list while `active`; changing scope or kind loads the other list (the old one stays hidden). */
export function useFighterRanking(active: boolean, scope: FighterScope, kind: FighterKind): { data: FighterRankingResponse | null; error: string | null } {
  const [data, setData] = useState<FighterRankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    api
      .fighterRanking(scope, kind)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [active, scope, kind]);
  return { data: data && data.scope === scope && data.kind === kind ? data : null, error };
}

/** "You defeated N people" (null when the report has no such number). */
export function destroyedLine(b: Pick<BattleReportData, 'defeatedPeople'>): string | null {
  return b.defeatedPeople !== undefined && b.defeatedPeople > 0 ? `You defeated ${formatInt(b.defeatedPeople)} ${b.defeatedPeople === 1 ? 'person' : 'people'}` : null;
}

const RENOWN_NOTE: Record<NonNullable<BattleReportData['renownNote']>, string> = {
  not_allowed: 'No Renown: fights against this opponent do not count',
  too_small: 'No Renown: the battle was too small',
  daily_cap: 'No Renown: you already earned the daily most from this opponent',
  small_target: 'No Renown: the opponent is much smaller than you',
  tiny: 'No Renown: too little to count',
};

/** Why this battle gave no Renown, when the server wrote a reason and none was earned. */
export function renownNoteLine(b: Pick<BattleReportData, 'renownGained' | 'renownNote'>): string | null {
  if ((b.renownGained ?? 0) > 0 || !b.renownNote) return null;
  return RENOWN_NOTE[b.renownNote] ?? null;
}

/** Under a lost attack's table when the fight was close and the defence was shown after all (BattleReportData.seenInLoss). */
export const LOST_SEEN_LINE = 'Your army fell, but saw what held the village.';

const STRIKE_REFUSED: Record<NonNullable<StrikeOutcome['reason']>, string> = {
  lost: 'the battle was not won',
  players_disabled: 'villages of players cannot be taken in this world',
  protected: 'the village is under protection',
  locked: 'the village was taken a short while ago and is locked',
  household: 'you share a connection with its owner',
};

/** Hold time as the report says it: "8 h" or "1 h 30 min" (never a clock). */
function holdText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** What the attacker's Chieftains did (BattleReportData.strike), in plain words; null for reports without one. */
export function strikeLine(strike: StrikeOutcome | undefined, now: number): string | null {
  if (!strike) return null;
  if (strike.result === 'struck') return `Hearth put out: hold the village for ${holdText(strike.holdMs ?? 0)}.`;
  if (strike.result === 'fell') return 'The Chieftain fell; nothing banked.';
  if (strike.result === 'refused') return `Not allowed: ${STRIKE_REFUSED[strike.reason ?? 'lost'] ?? 'this village cannot be struck'}.`;
  const have = strike.have ?? 0;
  const arrived = `Your ${have === 1 ? 'Chieftain' : 'Chieftains'} arrived: ${have} of ${strike.need} needed.`;
  const more = Math.max(1, strike.need - have);
  const left = (strike.endsAt ?? 0) - now;
  return left > 0
    ? `${arrived} Send ${more} more within ${formatLeft(left)} to put this village's hearth out.`
    : `${arrived} The time to send the rest has run out.`;
}
