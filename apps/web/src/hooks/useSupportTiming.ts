import { useMemo } from 'react';
import type { MapVillageDto } from '@clanfire/engine';
import { useGame } from '../game.ts';
import { attacksOn, knownAttacks } from '../incoming.ts';
import { supportTimingLines } from '../supportTiming.ts';
import type { SupportTimingLine } from '../supportTiming.ts';
import { useAlertFeed } from './useAlertFeed.ts';

/**
 * "Will my help arrive in time?" lines for the support form: the attacks the player may know about on the target village (an own village from
 * `movements`; a tribe-mate's from GET /api/tribe/alerts, fetched only while a tribe-mate's village is the target and the player is in a tribe)
 * against the engine travel time of the chosen troops. Empty when there is no attack, no army, or the mission is not support.
 */
export function useSupportTiming(target: Pick<MapVillageDto, 'id' | 'kind' | 'relation'> | null, active: boolean, travelMs: number): SupportTimingLine[] {
  const { movements, villages, player, now } = useGame();
  const mate = active && !!player.tribe && target?.kind === 'player' && target.relation === 'tribe';
  const feed = useAlertFeed(mate);
  const ownIds = useMemo(() => new Set(villages.map((v) => v.id)), [villages]);
  const targetId = active && target && target.id > 0 ? target.id : null;
  const attacks = useMemo(
    () => (targetId === null ? [] : attacksOn(knownAttacks(movements, mate ? feed.alerts : null, ownIds), targetId)),
    [movements, feed.alerts, ownIds, targetId, mate],
  );
  return useMemo(() => (attacks.length === 0 ? [] : supportTimingLines(travelMs, now, attacks)), [attacks, travelMs, now]);
}
