// Badges from a finished world (docs/GAME_DESIGN.md 18.1 "Badges"). Pure rules: the server collects the players at the end
// moment and stores the result once (world_end_badges); the lobby copies it to accounts. Badges give no power.

import { BADGE_ACTIVE_DAYS, BADGE_COUNT_MAX, BADGE_MIN_DAYS, BADGE_TOP_PLAYERS } from './config.ts';
import { BADGE_KINDS, type BadgeKind, type BadgeSummaryDto, type WorldBadgeDto } from './api.ts';
import { MS_PER_HOUR } from './util.ts';

const MS_PER_DAY = 24 * MS_PER_HOUR;

/** One player as it stands at the world's end. */
export interface BadgePlayerInput {
  playerId: number;
  /** When the player joined this world (ms). */
  createdAt: number;
  /** Last authenticated request (ms), null if never. */
  lastActive: number | null;
  banned: boolean;
  /** Test-mode (sandbox) account. */
  test: boolean;
  /** Villages owned at the end. */
  villages: number;
  tribeId: number | null;
  /** When the player joined that tribe (ms), null without a tribe. */
  tribeJoinedAt: number | null;
}

export interface WorldEndBadgeInput {
  endedAt: number;
  /** World speed: the day limits are divided by it like every other duration. */
  speed: number;
  /** The winning tribe; null (a manual end without winner) means no tribe badges at all. */
  winnerTribeId: number | null;
  /** Final tribe ranking, best first. */
  finalTribes: { rank: number; tribeId: number }[];
  /** Final player ranking (ties share a rank). */
  finalPlayers: { rank: number; playerId: number }[];
  players: BadgePlayerInput[];
}

export interface WorldEndBadge extends WorldBadgeDto {
  playerId: number;
}

/**
 * Who earns what when a world ends. Every badge needs: not banned, not a test account, in the world for BADGE_MIN_DAYS and
 * played within BADGE_ACTIVE_DAYS before the end (both ÷ speed). Tribe badges (only when there is a winner): 'champion' for the
 * winning tribe, 'second_tribe' / 'third_tribe' for the next two tribes of the final ranking, each needing BADGE_MIN_DAYS in that
 * tribe. 'top10': final player rank 1..BADGE_TOP_PLAYERS (place = rank). 'veteran': still owned a village. Several can stack.
 * Output order: by playerId, then BADGE_KINDS order.
 */
export function worldEndBadges(input: WorldEndBadgeInput): WorldEndBadge[] {
  const speed = input.speed > 0 ? input.speed : 1;
  const minMs = (BADGE_MIN_DAYS * MS_PER_DAY) / speed;
  const activeMs = (BADGE_ACTIVE_DAYS * MS_PER_DAY) / speed;
  const tribeBadge = new Map<number, BadgeKind>();
  if (input.winnerTribeId !== null) {
    tribeBadge.set(input.winnerTribeId, 'champion');
    const others = [...input.finalTribes].sort((a, b) => a.rank - b.rank).filter((t) => t.tribeId !== input.winnerTribeId);
    if (others[0]) tribeBadge.set(others[0].tribeId, 'second_tribe');
    if (others[1]) tribeBadge.set(others[1].tribeId, 'third_tribe');
  }
  const rankOf = new Map<number, number>();
  for (const p of input.finalPlayers) if (!rankOf.has(p.playerId)) rankOf.set(p.playerId, p.rank);

  const out: WorldEndBadge[] = [];
  const players = [...input.players].sort((a, b) => a.playerId - b.playerId);
  for (const p of players) {
    if (p.banned || p.test) continue;
    if (p.createdAt > input.endedAt - minMs) continue;
    if (p.lastActive === null || p.lastActive < input.endedAt - activeMs) continue;
    const earned: WorldBadgeDto[] = [];
    if (p.tribeId !== null && p.tribeJoinedAt !== null && p.tribeJoinedAt <= input.endedAt - minMs) {
      const kind = tribeBadge.get(p.tribeId);
      if (kind) earned.push({ badge: kind, place: null });
    }
    const rank = rankOf.get(p.playerId);
    if (rank !== undefined && rank >= 1 && rank <= BADGE_TOP_PLAYERS) earned.push({ badge: 'top10', place: rank });
    if (p.villages >= 1) earned.push({ badge: 'veteran', place: null });
    earned.sort((a, b) => BADGE_KINDS.indexOf(a.badge) - BADGE_KINDS.indexOf(b.badge));
    for (const e of earned) out.push({ playerId: p.playerId, ...e });
  }
  return out;
}

/** Per-kind summary (BADGE_KINDS order, kinds with none left out): how many, and the best (lowest) top10 place. */
export function summarizeBadges(list: readonly WorldBadgeDto[]): BadgeSummaryDto[] {
  const out: BadgeSummaryDto[] = [];
  for (const kind of BADGE_KINDS) {
    const mine = list.filter((b) => b.badge === kind);
    if (mine.length === 0) continue;
    const places = mine.map((b) => b.place).filter((x): x is number => typeof x === 'number');
    out.push({ badge: kind, count: Math.min(mine.length, BADGE_COUNT_MAX), bestPlace: kind === 'top10' && places.length > 0 ? Math.min(...places) : null });
  }
  return out;
}

/** Strict check of a `bdg` claim / stored summary; null when malformed (callers refuse the pass). */
export function parseBadgeSummary(v: unknown): BadgeSummaryDto[] | null {
  if (!Array.isArray(v) || v.length > BADGE_KINDS.length) return null;
  const seen = new Set<string>();
  const out: BadgeSummaryDto[] = [];
  for (const e of v) {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
    const { badge, count, bestPlace } = e as Record<string, unknown>;
    if (typeof badge !== 'string' || !(BADGE_KINDS as readonly string[]).includes(badge) || seen.has(badge)) return null;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > BADGE_COUNT_MAX) return null;
    if (badge === 'top10') {
      if (typeof bestPlace !== 'number' || !Number.isInteger(bestPlace) || bestPlace < 1 || bestPlace > BADGE_TOP_PLAYERS) return null;
    } else if (bestPlace !== null) return null;
    if (Object.keys(e as object).some((k) => k !== 'badge' && k !== 'count' && k !== 'bestPlace')) return null;
    seen.add(badge);
    out.push({ badge: badge as BadgeKind, count, bestPlace: bestPlace as number | null });
  }
  return out;
}
