// Ranking routes (contract: packages/engine/src/api.ts). Signed-in players only; reads only public data.

import type { FastifyInstance } from 'fastify';
import {
  GameError,
  achievementProgress,
  type PlayerProfileDto,
  type PlayerRankDto,
  type PlayerRankingResponse,
  type RenownRankDto,
  type RenownRankingResponse,
} from '@clanfire/engine';
import type { AppContext } from '../context.ts';
import { playerOf, requireAuth } from './auth.ts';

const RANKING_LIMIT = 100;

/** Top players by points; ties share the rank (1, 2, 2, 4). The caller's own row is always included. */
function playerRanking(ctx: AppContext, meId: number): PlayerRankingResponse {
  let prevPoints = -1;
  let prevRank = 0;
  const all: PlayerRankDto[] = ctx.store.playerRanking().map((r, i) => {
    const rank = r.points === prevPoints ? prevRank : i + 1;
    prevPoints = r.points;
    prevRank = rank;
    return {
      rank,
      playerId: r.id,
      username: r.username,
      tribe: r.tribeId !== null && r.tribeTag !== null ? { id: r.tribeId, tag: r.tribeTag } : null,
      villages: r.villages,
      points: r.points,
      villageX: r.mainX,
      villageY: r.mainY,
    };
  });
  return { players: all.slice(0, RANKING_LIMIT), me: all.find((p) => p.playerId === meId) ?? null, total: all.length };
}

/**
 * Top players by Renown earned in total (not the spendable balance); ties share the rank (1, 2, 2, 4), judged on the
 * whole number shown. Same set of players as the points ranking (everyone with a village). The caller's row is always included.
 */
function renownRanking(ctx: AppContext, meId: number): RenownRankingResponse {
  let prevRenown = -1;
  let prevRank = 0;
  const all: RenownRankDto[] = ctx.store.renownRanking().map((r, i) => {
    const renown = Math.floor(r.renown + 1e-9);
    const rank = renown === prevRenown ? prevRank : i + 1;
    prevRenown = renown;
    prevRank = rank;
    return {
      rank,
      playerId: r.id,
      username: r.username,
      tribe: r.tribeId !== null && r.tribeTag !== null ? { id: r.tribeId, tag: r.tribeTag } : null,
      villages: r.villages,
      renown,
      villageX: r.mainX,
      villageY: r.mainY,
    };
  });
  return { players: all.slice(0, RANKING_LIMIT), me: all.find((p) => p.playerId === meId) ?? null, total: all.length };
}

const PROFILE_VILLAGE_LIMIT = 50;

/** Public profile: same data the map and rankings already show. Players without a village are not ranked, so 404. */
function playerProfile(ctx: AppContext, id: number, now: number): PlayerProfileDto {
  const rank = playerRanking(ctx, id).me;
  const player = ctx.store.getPlayer(id);
  if (!rank || !player) throw new GameError('not_found', 'Player not found.');
  const renownRow = renownRanking(ctx, id).me;
  const villages = ctx.store
    .villagesOfPlayer(id)
    .sort((a, b) => b.points - a.points || a.id - b.id);
  const stats = ctx.store.getStats(id);
  return {
    playerId: id,
    username: player.username,
    chieftain: player.chieftain,
    rank: rank.rank,
    points: rank.points,
    renown: renownRow?.renown ?? 0,
    renownRank: renownRow?.rank ?? rank.rank,
    tribe: ctx.store.tribes.playerTribe(id),
    joinedAt: player.createdAt,
    protectedNow: player.protectedUntil > now,
    villages: villages.slice(0, PROFILE_VILLAGE_LIMIT).map((v) => ({ id: v.id, name: v.name, x: v.x, y: v.y, points: v.points })),
    villageCount: villages.length,
    stats,
    achievements: achievementProgress(stats),
  };
}

export function rankingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/players/:id',
    { onRequest: requireAuth(ctx), schema: { params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^[0-9]{1,15}$' } } } } },
    async (req): Promise<PlayerProfileDto> => playerProfile(ctx, Number((req.params as { id: string }).id), req.nowMs),
  );
  app.get('/api/rankings/players', { onRequest: requireAuth(ctx) }, async (req): Promise<PlayerRankingResponse> => playerRanking(ctx, playerOf(req).id));
  app.get('/api/rankings/renown', { onRequest: requireAuth(ctx) }, async (req): Promise<RenownRankingResponse> => renownRanking(ctx, playerOf(req).id));
}
