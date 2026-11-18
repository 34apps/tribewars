// Fighter rankings (docs/GAME_DESIGN.md, "Fighter rankings"): labels, rows and the battle report lines shared by the desktop and phone pages.

import { useEffect, useState } from 'react';
import type { BattleReportData, FighterKind, FighterRankDto, FighterRankingResponse, FighterScope } from '@clanfire/engine';
import { api, errorMessage } from './api.ts';
import { formatInt } from './format.ts';

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

/** "You destroyed troops worth N" (null when the report has no such number). */
export function destroyedLine(b: Pick<BattleReportData, 'destroyedValue'>): string | null {
  return b.destroyedValue !== undefined && b.destroyedValue > 0 ? `You destroyed troops worth ${formatInt(b.destroyedValue)}` : null;
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
