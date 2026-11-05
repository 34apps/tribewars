// Domination win condition and world end (docs/GAME_DESIGN.md, "Winning the world"). The rules are in the engine
// (domination.ts); this file gathers the numbers from the database, keeps the streak start and the peak in the meta table,
// and freezes the world when a tribe wins. Nothing here runs on a timer: GameService.processDue calls `tick` after every
// batch of arrivals (every API request and the 1 s tick), and `tick` only does work once per evaluation interval.
// The streak is settled from its stored start time, so a server that was down still ends the world at the exact second.

import {
  WORLD_END_DTO_ROWS,
  WORLD_END_STORED_ROWS,
  dominationEvalIntervalMs,
  dominationRealDays,
  dominationActiveMs,
  evaluateDomination,
  mergeDominationSettings,
  type DominationEvaluation,
  type DominationSettings,
  type DominationStatusDto,
  type DominationStreak,
  type DominationTribeDto,
  type FinalPlayerDto,
  type FinalTribeDto,
  type WorldEndDto,
  type WorldEndKind,
  type WorldSettings,
} from '@clanfire/engine';
import type { GameService } from './game.ts';
import type { Store } from './store.ts';
import type { WorldEndRow } from './domination-store.ts';

const META_LAST_EVAL = 'domination_last_eval';
const META_PEAK = 'domination_peak_active';
const META_STREAK = 'domination_streak';
const DAY_MS = 86_400_000;

// ---- helpers that work on a Store alone (the operator tool uses them too) ---------------------------------------------

/**
 * The world's domination rule, read fresh from the database (so an operator change needs no restart): `config.domination` of the
 * stored `world_config`; a world without one (made before per-world settings) uses the legacy `world_settings.domination`.
 */
export function readDominationSettings(store: Store): DominationSettings {
  if (store.getWorldConfigRaw() !== null) return mergeDominationSettings(store.effectiveWorldConfig().domination);
  return mergeDominationSettings(store.getSettings()?.domination);
}

/**
 * Write the complete rule into `world_config` and mirror it into `world_settings.domination` (every other stored setting is kept),
 * and clear the streak. A world without a stored config gets one now (from its flat settings).
 */
export function writeDominationSettings(store: Store, next: DominationSettings): void {
  store.setWorldConfig({ ...store.effectiveWorldConfig(), domination: next });
  clearStreak(store);
}

export function readStreak(store: Store): DominationStreak | null {
  const raw = store.getMeta(META_STREAK);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DominationStreak> | null;
    return v && Number.isInteger(v.tribeId) && Number.isFinite(v.startedAt) ? { tribeId: v.tribeId as number, startedAt: v.startedAt as number } : null;
  } catch {
    return null;
  }
}

export function clearStreak(store: Store): void {
  store.setMeta(META_STREAK, '');
}

export function worldCreatedAt(store: Store, fallback: number): number {
  const created = Number(store.getMeta('world_created_at'));
  return Number.isFinite(created) && created > 0 ? created : fallback;
}

/** Active players: played within the window, not banned, not a test account; accounts that share an IP count once (connected IP groups). */
export function countActivePlayers(store: Store, now: number, d: DominationSettings, speed: number): number {
  const since = now - dominationActiveMs(d, speed);
  const sandbox = [...store.sandboxUsers];
  const ids = store.domination.activePlayerIds(since, sandbox);
  const parent = new Map<number, number>(ids.map((id) => [id, id]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    for (let c = x; c !== r; ) {
      const next = parent.get(c) as number;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const firstOnIp = new Map<string, number>();
  for (const { ip, playerId } of store.domination.activePlayerIps(since, sandbox)) {
    if (!parent.has(playerId)) continue;
    const first = firstOnIp.get(ip);
    if (first === undefined) firstOnIp.set(ip, playerId);
    else parent.set(find(playerId), find(first));
  }
  return new Set(ids.map(find)).size;
}

interface Gathered {
  settings: DominationSettings;
  createdAt: number;
  activePlayers: number;
  storedPeak: number;
  tribes: { tribeId: number; name: string; tag: string; points: number }[];
  totalPoints: number;
  streak: DominationStreak | null;
}

function gather(store: Store, speed: number, now: number): Gathered {
  const settings = readDominationSettings(store);
  const peak = Number(store.getMeta(META_PEAK));
  return {
    settings,
    createdAt: worldCreatedAt(store, now),
    activePlayers: countActivePlayers(store, now, settings, speed),
    storedPeak: Number.isFinite(peak) && peak > 0 ? peak : 0,
    tribes: store.tribes.ranking().map((t) => ({ tribeId: t.id, name: t.name, tag: t.tag, points: t.points })),
    totalPoints: store.domination.totalPlayerVillagePoints(),
    streak: readStreak(store),
  };
}

function evaluateWith(g: Gathered, speed: number, now: number): DominationEvaluation {
  return evaluateDomination({
    now,
    speed,
    worldCreatedAt: g.createdAt,
    settings: g.settings,
    activePlayers: g.activePlayers,
    peakActivePlayers: g.storedPeak,
    tribes: g.tribes,
    totalPoints: g.totalPoints,
    streak: g.streak,
  });
}

const round = (x: number, decimals: number): number => Math.round(x * 10 ** decimals) / 10 ** decimals;
const pctText = (share: number): string => `${Math.floor(share * 1000 + 1e-9) / 10}%`;

/** The final rankings as they stand now: all tribes (cap 200) and the best 200 players (ties share a rank, like the ranking screen). */
export function finalRankings(store: Store): { tribes: FinalTribeDto[]; players: FinalPlayerDto[] } {
  const tribes = store.tribes
    .ranking()
    .slice(0, WORLD_END_STORED_ROWS)
    .map((t, i): FinalTribeDto => ({ rank: i + 1, tribeId: t.id, name: t.name, tag: t.tag, points: t.points, members: t.members, villages: t.villages }));
  let prevPoints = -1;
  let prevRank = 0;
  const players = store
    .playerRanking()
    .slice(0, WORLD_END_STORED_ROWS)
    .map((p, i): FinalPlayerDto => {
      const rank = p.points === prevPoints ? prevRank : i + 1;
      prevPoints = p.points;
      prevRank = rank;
      return { rank, playerId: p.id, name: p.username, points: p.points, villages: p.villages, tribeTag: p.tribeTag };
    });
  return { tribes, players };
}

export interface EndWorldArgs {
  /** The moment of the end (for a domination win: the exact end of the streak). */
  at: number;
  kind: WorldEndKind;
  winner: { tribeId: number; name: string; tag: string } | null;
  reason: string;
  /** Who ended it, for the audit log: 'server' (domination) or 'cli' (operator). */
  actorIp: 'server' | 'cli';
}

/**
 * End the world: store the final rankings ONCE (a second call changes nothing and returns false), write the audit row and
 * tell every open socket. One transaction. The frozen rules are enforced by the request hook in app.ts and the caretaker.
 */
export function endWorld(store: Store, args: EndWorldArgs): boolean {
  return store.tx(() => {
    if (store.domination.getWorldEnd()) return false;
    const final = finalRankings(store);
    const inserted = store.domination.insertWorldEnd({
      endedAt: args.at,
      kind: args.kind,
      winnerTribeId: args.winner?.tribeId ?? null,
      winnerName: args.winner?.name ?? null,
      winnerTag: args.winner?.tag ?? null,
      reason: args.reason,
      finalTribes: final.tribes,
      finalPlayers: final.players,
    });
    if (!inserted) return false;
    store.audit({
      at: args.at,
      actorId: null,
      actorIp: args.actorIp,
      action: 'world_end',
      targetPlayer: null,
      detail: `${args.kind}${args.winner ? ` winner [${args.winner.tag}] ${args.winner.name}` : ''}: ${args.reason}`.slice(0, 500),
    });
    store.domination.emit({ kind: 'all', topics: ['world', 'game'] });
    return true;
  });
}

export function worldEndDto(row: WorldEndRow): WorldEndDto {
  return {
    endedAt: row.endedAt,
    kind: row.kind,
    winner: row.winnerTribeId !== null && row.winnerName !== null && row.winnerTag !== null ? { tribeId: row.winnerTribeId, name: row.winnerName, tag: row.winnerTag } : null,
    reason: row.reason,
    finalTribes: row.finalTribes.slice(0, WORLD_END_DTO_ROWS),
    finalPlayers: row.finalPlayers.slice(0, WORLD_END_DTO_ROWS),
  };
}

/** The status shown to players (and printed by the operator tool). Read-only: it writes nothing. */
export function dominationStatus(store: Store, world: Pick<WorldSettings, 'speed'>, now: number): DominationStatusDto {
  const speed = world.speed;
  const g = gather(store, speed, now);
  const ev = evaluateWith(g, speed, now);
  const days = dominationRealDays(g.settings, speed);
  const toDto = (t: { tribeId: number; name: string; tag: string; points: number; share: number }): DominationTribeDto => ({
    tribeId: t.tribeId,
    name: t.name,
    tag: t.tag,
    points: t.points,
    share: t.share,
  });
  // A streak "starts at the next evaluation" until the stored start says otherwise.
  const kept = ev.streak !== null && g.streak !== null && ev.streak.tribeId === g.streak.tribeId && ev.streak.startedAt === g.streak.startedAt;
  const streakStartedAt = kept && ev.streak ? ev.streak.startedAt : null;
  const end = store.domination.getWorldEnd();
  return {
    settings: { minAgeDays: days.minAgeDays, winShare: g.settings.winShare, streakDays: days.streakDays, activeDays: days.activeDays, minActivePlayers: g.settings.minActivePlayers },
    now,
    worldAgeDays: round(ev.worldAgeMs / DAY_MS, 2),
    minAgeDays: days.minAgeDays,
    ageOk: ev.ageOk,
    activePlayers: ev.activePlayers,
    peakActivePlayers: ev.peakActivePlayers,
    minActivePlayers: ev.minActivePlayers,
    playersOk: ev.playersOk,
    leader: ev.leader ? toDto(ev.leader) : null,
    topTribes: ev.topTribes.map(toDto),
    totalPoints: ev.totalPoints,
    winShare: g.settings.winShare,
    qualifies: ev.qualifies,
    streakStartedAt,
    streakDays: streakStartedAt === null ? 0 : round(Math.max(0, now - streakStartedAt) / DAY_MS, 1),
    streakDaysNeeded: round(ev.streakNeededMs / DAY_MS, 2),
    reasons: ev.reasons,
    ended: end ? worldEndDto(end) : null,
  };
}

// ---- the service -----------------------------------------------------------------------------------------------------

export class DominationService {
  private announced = false;

  constructor(
    private readonly store: Store,
    private readonly world: WorldSettings,
    game: GameService,
  ) {
    game.afterProcess = (now) => {
      this.evaluate(now);
    };
  }

  /** The effective rule (read from the database every time). */
  settings(): DominationSettings {
    return readDominationSettings(this.store);
  }

  ended(): WorldEndDto | null {
    const row = this.store.domination.getWorldEnd();
    return row ? worldEndDto(row) : null;
  }

  status(now: number): DominationStatusDto {
    return dominationStatus(this.store, this.world, now);
  }

  /**
   * Settle the domination streak. Throttled by the stored `domination_last_eval` to once per DOMINATION_EVAL_INTERVAL
   * (divided by speed); `force` skips the throttle (tests, operator). Peak, streak, the throttle stamp and a possible
   * win are written in one transaction. Returns the evaluation, or null when nothing ran (throttled or the world ended).
   */
  evaluate(now: number, force = false): DominationEvaluation | null {
    if (this.store.isWorldEnded()) {
      this.announceOnce(); // ended by the operator tool in another process: tell our players
      return null;
    }
    const last = Number(this.store.getMeta(META_LAST_EVAL));
    if (!force && Number.isFinite(last) && last > 0 && now >= last && now - last < dominationEvalIntervalMs(this.world.speed)) return null;
    return this.store.tx(() => {
      const g = gather(this.store, this.world.speed, now);
      const ev = evaluateWith(g, this.world.speed, now);
      this.store.setMeta(META_LAST_EVAL, String(now));
      if (ev.peakActivePlayers > g.storedPeak) this.store.setMeta(META_PEAK, String(ev.peakActivePlayers));
      this.store.setMeta(META_STREAK, ev.streak ? JSON.stringify(ev.streak) : '');
      if (ev.won && ev.leader && ev.wonAt !== null) {
        const days = round(ev.streakNeededMs / DAY_MS, 2);
        const reason = `${ev.leader.name} [${ev.leader.tag}] held ${pctText(ev.leader.share)} of all village points for ${days} days (needed ${pctText(g.settings.winShare)}).`;
        if (endWorld(this.store, { at: ev.wonAt, kind: 'domination', winner: { tribeId: ev.leader.tribeId, name: ev.leader.name, tag: ev.leader.tag }, reason, actorIp: 'server' })) {
          this.announced = true;
        }
      }
      return ev;
    });
  }

  /** The end was written by another process (the operator tool): tell our players once. A row we wrote ourselves was announced with it. */
  private announceOnce(): void {
    if (this.announced || this.store.domination.endedHere) return;
    this.announced = true;
    this.store.domination.emit({ kind: 'all', topics: ['world', 'game'] });
  }
}
