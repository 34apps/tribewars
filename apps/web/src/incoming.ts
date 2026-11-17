// Incoming attacks a player is allowed to know about, and the "does my help arrive in time" check.
// Pure helpers (no I/O); the page, the support form and the tests share them. Nothing here reveals more than the server sends:
// own attacks come from `state.movements` (units hidden), tribe-mates' from GET /api/tribe/alerts (Watchtower fields only).
import type { MovementDto, TribeAlertDto, UnitId, VillageRefDto, WatchtowerSizeBand } from '@clanfire/engine';

export interface KnownAttack {
  movementId: number;
  /** The village being hit. */
  target: VillageRefDto;
  attacker: VillageRefDto;
  attackerTribeTag: string | null;
  departAt: number;
  arriveAt: number;
  /** True when the target is one of the viewer's own villages. */
  own: boolean;
  /** Watchtower fields; absent below the level that shows them (or when the viewer has no tribe). */
  sizeBand?: WatchtowerSizeBand;
  slowestUnit?: UnitId;
  sizeAbout?: number;
}

/**
 * Own incoming attacks (from `movements`) merged with the tribe's alert list (by movement id: the alert adds the attacker's tribe tag and
 * the Watchtower fields; alerts on other members' villages are kept as `own: false`). Sorted by landing time, then id.
 */
export function knownAttacks(movements: MovementDto[], alerts: TribeAlertDto[] | null, ownVillageIds: ReadonlySet<number>): KnownAttack[] {
  const byId = new Map<number, KnownAttack>();
  for (const m of movements) {
    if (m.direction !== 'incoming' || m.kind !== 'attack') continue;
    byId.set(m.id, {
      movementId: m.id,
      target: m.target,
      attacker: m.origin,
      attackerTribeTag: null,
      departAt: m.departAt,
      arriveAt: m.arriveAt,
      own: true,
    });
  }
  for (const a of alerts ?? []) {
    const own = ownVillageIds.has(a.target.villageId);
    const prev = byId.get(a.movementId);
    byId.set(a.movementId, {
      movementId: a.movementId,
      target: a.target,
      attacker: a.attacker,
      attackerTribeTag: a.attackerTribeTag,
      departAt: a.departAt,
      arriveAt: a.arriveAt,
      own: prev?.own ?? own,
      ...(a.sizeBand !== undefined ? { sizeBand: a.sizeBand } : {}),
      ...(a.slowestUnit !== undefined ? { slowestUnit: a.slowestUnit } : {}),
      ...(a.sizeAbout !== undefined ? { sizeAbout: a.sizeAbout } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => a.arriveAt - b.arriveAt || a.movementId - b.movementId);
}

/** The attacks on one village (own or a tribe-mate's), soonest first. */
export function attacksOn(attacks: KnownAttack[], villageId: number): KnownAttack[] {
  return attacks.filter((a) => a.target.villageId === villageId);
}

export interface ArrivalVerdict {
  /** True when the help lands strictly before the attack (the same millisecond counts as too late: the order of two landings in one ms is not the sender's to count on). */
  inTime: boolean;
  /** Absolute gap in ms between the two landings. */
  gapMs: number;
}

/** Compare the help's landing time with an attack's. Both are server-clock ms. */
export function arrivalVerdict(helpArrivesAt: number, attackLandsAt: number): ArrivalVerdict {
  return { inTime: helpArrivesAt < attackLandsAt, gapMs: Math.abs(attackLandsAt - helpArrivesAt) };
}
