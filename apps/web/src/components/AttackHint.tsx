import { useMemo } from 'react';
import type { MapVillageDto, Units } from '@clanfire/engine';
import { attackHint } from '../attackHint.ts';
import { useGame } from '../game.ts';
import { useIntel } from '../hooks/useIntel.ts';
import { AttackHintView, hintTarget } from './hintViews.tsx';
import './attack-hint.css';

/**
 * Attack form: "do I have enough?" from my own newest report on the target (GET /api/intel/:id, cached 60 s), judged with the real battle rules.
 * `active` = the mission is attack and it is not a relief attack. `morale` is the factor the form shows (1 = none). Shows nothing while loading.
 */
export function AttackHint({ target, active, chosen, morale }: { target: MapVillageDto | null; active: boolean; chosen: Units; morale: number }) {
  const { now, live, settings } = useGame();
  const ok = active && hintTarget(target);
  const { intel } = useIntel(ok && target ? target.id : null);
  const abandoned = target?.kind === 'abandoned';
  const spare = Math.max(0, (live.troops.raider ?? 0) - chosen.raider);
  const key = JSON.stringify(chosen);
  const hint = useMemo(
    () => (ok && intel ? attackHint({ intel, attacker: chosen, now, abandoned, morale, attackerRanks: live.ranks, spareRaiders: spare, settings }) : null),
    // `now` only sets the age text, which is computed from the report time on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ok, intel, key, abandoned, morale, live.ranks, spare, settings],
  );
  if (!hint) return null;
  return <AttackHintView hint={hint} now={now} />;
}
