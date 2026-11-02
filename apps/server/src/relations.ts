// How one player relates to another through tribes and diplomacy (map colours, attack rules).

import type { DiplomacyKind, PlayerRelation } from '@clanfire/engine';
import type { TribeStore } from './tribe-store.ts';

export interface RelationInfo {
  relation: PlayerRelation;
  /** Set for ally / nap / enemy relations (the pact or war that makes up the relation). */
  kind: DiplomacyKind | null;
  /** The other player's tribe tag, when they have one. */
  tag: string | null;
  /** For an ally/NAP serving its cancellation notice: when it stops protecting. */
  endsAt: number | null;
}

/** How `otherId` relates to `viewerId`, evaluated at time `at`. Two membership lookups + at most one relation lookup. */
export function relationBetweenPlayers(tribes: TribeStore, viewerId: number, otherId: number, at: number): RelationInfo {
  if (viewerId === otherId) return { relation: 'self', kind: null, tag: null, endsAt: null };
  const mine = tribes.membership(viewerId);
  const theirs = tribes.membership(otherId);
  const tag = theirs?.tribeTag ?? null;
  if (!mine || !theirs) return { relation: 'neutral', kind: null, tag, endsAt: null };
  if (mine.tribeId === theirs.tribeId) return { relation: 'tribe', kind: null, tag, endsAt: null };
  const rel = tribes.relationBetween(mine.tribeId, theirs.tribeId, at);
  if (!rel) return { relation: 'neutral', kind: null, tag, endsAt: null };
  return { relation: rel.kind, kind: rel.kind, tag, endsAt: rel.endsAt };
}

/**
 * A viewer's side of the diplomatic picture, loaded once per request (the map has up to ~3700 villages;
 * nothing per village hits the database).
 */
export class RelationViewer {
  constructor(
    readonly playerId: number,
    readonly tribeId: number | null,
    private readonly kinds: ReadonlyMap<number, DiplomacyKind>,
  ) {}

  /** The relation to a village owner given the owner's tribe id (null = tribeless). */
  relationTo(ownerId: number, ownerTribeId: number | null): PlayerRelation {
    if (ownerId === this.playerId) return 'self';
    if (this.tribeId === null || ownerTribeId === null) return 'neutral';
    if (ownerTribeId === this.tribeId) return 'tribe';
    return this.kinds.get(ownerTribeId) ?? 'neutral';
  }
}

export function loadRelationViewer(tribes: TribeStore, playerId: number, at: number): RelationViewer {
  const mine = tribes.membership(playerId);
  return new RelationViewer(playerId, mine?.tribeId ?? null, mine ? tribes.relationKindsOf(mine.tribeId, at) : new Map());
}
