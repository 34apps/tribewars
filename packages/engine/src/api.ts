// HTTP API contract between apps/server and apps/web. Both sides import these types.
// JSON over HTTPS, session in an HttpOnly cookie. Errors: non-2xx with ApiError body.

import type { Coords, GameErrorCode, Resources, Units, VillageState, WorldSettings } from './types.ts';

export interface ApiError {
  error: GameErrorCode;
  message: string;
}

// ---- Auth ------------------------------------------------------------------
// POST /api/auth/register  body AuthRequest -> 201 MeResponse (sets cookie; creates the player's village)
// POST /api/auth/login     body AuthRequest -> 200 MeResponse (sets cookie)
// POST /api/auth/logout    -> 204 (clears cookie)
// GET  /api/auth/me        -> 200 MeResponse (player null when signed out)

export interface AuthRequest {
  /** 3-20 chars: letters, digits, underscore. Case-insensitive unique. */
  username: string;
  /** 8-128 chars. */
  password: string;
}

export interface PlayerDto {
  id: number;
  username: string;
  /** Attacks on this player's villages are refused until this time. 0 = not protected. */
  protectedUntil: number;
}

export interface MeResponse {
  player: PlayerDto | null;
}

// ---- Game state --------------------------------------------------------------
// GET /api/state -> 200 GameStateResponse
// The client ticks resources and queues locally by calling settleVillage(village.state, serverNow)
// where serverNow = Date.now() + (serverTime - Date.now() at fetch). Poll every ~10 s and after actions.

export interface OwnVillageDto extends Coords {
  id: number;
  name: string;
  /** Settled to serverTime. */
  state: VillageState;
}

export interface VillageRefDto extends Coords {
  villageId: number;
  name: string;
  /** null for abandoned villages. */
  ownerName: string | null;
}

/**
 * origin/target follow the direction of travel: for an attack, origin = attacker's home and
 * target = attacked village; for a return, origin = the raided village and target = home.
 */
export interface MovementDto {
  id: number;
  kind: 'attack' | 'return';
  /** outgoing = sent from or returning to one of my villages; incoming = an attack on one of my villages. */
  direction: 'outgoing' | 'incoming';
  origin: VillageRefDto;
  target: VillageRefDto;
  departAt: number;
  arriveAt: number;
  /** Only for outgoing movements; hidden for incoming attacks. */
  units: Units | null;
  /** Only on outgoing returns. */
  loot: Resources | null;
}

export interface GameStateResponse {
  serverTime: number;
  settings: WorldSettings;
  player: PlayerDto;
  /** v1 has exactly one village per player; array keeps room for more. */
  villages: OwnVillageDto[];
  movements: MovementDto[];
  unreadReports: number;
}

// ---- Village actions -----------------------------------------------------------
// POST /api/villages/:id/build  body BuildRequest -> 200 OwnVillageDto
// POST /api/villages/:id/train  body TrainRequest -> 200 OwnVillageDto
// POST /api/villages/:id/send   body SendRequest  -> 201 SendResponse

export interface BuildRequest {
  building: string; // BuildingId; validated server-side
}

export interface TrainRequest {
  unit: string; // UnitId; validated server-side
  count: number;
}

export interface SendRequest extends Coords {
  /** Target tile; a village must stand there. */
  units: Partial<Units>;
}

export interface SendResponse {
  village: OwnVillageDto;
  movement: MovementDto;
}

// ---- Map ---------------------------------------------------------------------------
// GET /api/map?x=<left>&y=<top>&w=<width>&h=<height>  (w,h <= MAP_MAX_SPAN) -> 200 MapResponse
// Terrain is not sent: the client computes terrainAt(x, y, settings.seed) itself.

export const MAP_MAX_SPAN = 61;

export type MapVillageKind = 'own' | 'player' | 'abandoned';

export interface MapVillageDto extends Coords {
  id: number;
  name: string;
  kind: MapVillageKind;
  ownerName: string | null;
  /** Sum of building levels; drives the icon size. */
  points: number;
  /** Under beginner protection (players only). */
  protected: boolean;
}

export interface MapResponse {
  villages: MapVillageDto[];
}

// ---- Reports -------------------------------------------------------------------------
// GET /api/reports           -> 200 ReportListResponse (newest first, max 50)
// GET /api/reports/:id       -> 200 ReportDto (marks it read)

export interface ReportSummaryDto {
  id: number;
  createdAt: number;
  /** e.g. "Raid on Abandoned village (12|-40)". */
  title: string;
  /** attack = I attacked; defense = I was attacked. */
  side: 'attack' | 'defense';
  /** From the report owner's point of view. */
  won: boolean;
  read: boolean;
}

export interface BattleReportData {
  attacker: VillageRefDto;
  defender: VillageRefDto;
  attackerWon: boolean;
  luck: number;
  attackPower: number;
  defensePower: number;
  attackerUnits: Units;
  attackerLosses: Units;
  /** Hidden (null) from the attacker if no attacker survived. */
  defenderUnits: Units | null;
  defenderLosses: Units | null;
  wallLevel: number | null;
  loot: Resources;
}

export interface ReportDto extends ReportSummaryDto {
  battle: BattleReportData;
}

export interface ReportListResponse {
  reports: ReportSummaryDto[];
}
