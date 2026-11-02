// HTTP API contract between apps/server and apps/web. Both sides import these types.
// JSON over HTTPS, session in an HttpOnly cookie. Errors: non-2xx with ApiError body.

import type {
  BuildingLevels,
  Coords,
  Mission,
  DiplomacyKind,
  GameErrorCode,
  PlayerRelation,
  Recruitment,
  Resources,
  TribeRole,
  Units,
  VillageState,
  WorldSettings,
} from './types.ts';

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
  /** Register only: chieftain portrait id; defaults to DEFAULT_CHIEFTAIN. */
  chieftain?: string;
}

// POST /api/me/chieftain  body { chieftain: string } -> 200 MeResponse (change portrait any time)
export interface ChieftainRequest {
  chieftain: string;
}

export interface PlayerDto {
  id: number;
  username: string;
  /** Attacks on this player's villages are refused until this time. 0 = not protected. */
  protectedUntil: number;
  /** The player's tribe, or null. */
  tribe: PlayerTribeDto | null;
  /** Chosen chieftain portrait id (CHIEFTAINS in config.ts). */
  chieftain: string;
}

export interface PlayerTribeDto {
  id: number;
  name: string;
  tag: string;
  role: TribeRole;
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
 * origin/target follow the direction of travel: for attack/scout/support, origin = the sender's home and
 * target = the destination; for a return, origin = where the troops were and target = home.
 */
export interface MovementDto {
  id: number;
  kind: Mission | 'return';
  /**
   * outgoing = sent from or returning to one of my villages; incoming = an attack or support coming
   * to one of my villages. Scout missions are never shown as incoming (they're stealthy).
   */
  direction: 'outgoing' | 'incoming';
  origin: VillageRefDto;
  target: VillageRefDto;
  departAt: number;
  arriveAt: number;
  /** Outgoing movements and incoming support show units; incoming attacks hide them (null). */
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
  /** Open tribe invitations addressed to me (badge on the Tribe tab). */
  tribeInvites: number;
  /** Incoming attacks on any member of my tribe, me included (badge on the Tribe tab). 0 when tribeless. */
  tribeAlerts: number;
  /** Support troops: others' troops stationed in my villages, and my troops stationed elsewhere. */
  stationed: { here: StationedDto[]; abroad: StationedDto[] };
}

/** A support contingent standing in someone else's village. */
export interface StationedDto {
  id: number;
  /** The village the troops come from (their owner's home). */
  home: VillageRefDto;
  /** The village they are defending. */
  host: VillageRefDto;
  units: Units;
  arrivedAt: number;
}

// ---- Village actions -----------------------------------------------------------
// POST /api/villages/:id/build  body BuildRequest -> 200 OwnVillageDto
// POST /api/villages/:id/train  body TrainRequest -> 200 OwnVillageDto
// POST /api/villages/:id/send   body SendRequest  -> 201 SendResponse
// Support troops (section 12):
// POST /api/stationed/:id/recall     body RecallRequest -> 201 { movement: MovementDto }  (owner of the troops)
// POST /api/stationed/:id/send-back  -> 201 { movement: MovementDto }  (owner of the host village; all units)

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
  /** attack (default rules), scout (Pathfinders only) or support (tribe-mates and allies only). */
  mission: Mission;
}

export interface RecallRequest {
  /** Units to bring home; omitted = all of them. */
  units?: Partial<Units>;
}

export interface MovementResponse {
  movement: MovementDto;
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
  /** Owner's tribe tag; null for abandoned villages and tribeless players. */
  tribeTag: string | null;
  /** Owner's tribe id (open it with GET /api/tribes/:id); null for abandoned villages and tribeless players. */
  tribeId: number | null;
  /** Owner's chieftain portrait id; null for abandoned villages. */
  ownerChieftain: string | null;
  /** Owner's relation to the viewer; null for abandoned villages. Drives map colours and the Send button. */
  relation: PlayerRelation | null;
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
  /** attack = I sent the troops; defense = my village was the target; support = my stationed troops were involved. */
  side: 'attack' | 'defense' | 'support';
  /** battle = attack (or called off); scout = scouting mission; support = support turned back on arrival. */
  type: 'battle' | 'scout' | 'support';
  /** From the report owner's point of view. Always false for a called-off attack. */
  won: boolean;
  read: boolean;
  /** Same meaning as `BattleReportData.outcome`; lets the list tell a called-off attack from a lost battle. */
  outcome: 'battle' | 'called_off';
}

export interface BattleReportData {
  /**
   * called_off: on arrival the target belonged to the attacker's tribe, an ally or a NAP partner, so no
   * battle happened and the troops turned back (powers 0, no losses, no loot, defender fields null).
   */
  outcome: 'battle' | 'called_off';
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
  /** Totals of all stationed support that fought (null when none, or hidden like defenderUnits). */
  supportUnits: Units | null;
  supportLosses: Units | null;
  wallLevel: number | null;
  loot: Resources;
}

export interface ScoutReportData {
  scout: VillageRefDto;
  target: VillageRefDto;
  success: boolean;
  scoutsSent: number;
  scoutsLost: number;
  /** Defending Pathfinders (own + support). Shown to the defender always; to the sender only on success. */
  defenderScouts: number | null;
  defenderScoutsLost: number;
  /** What the scouts saw — sender's report on success only; null otherwise. */
  intel: {
    resources: Resources;
    buildings: BuildingLevels;
    /** Troops at home, own + stationed support. */
    troops: Units;
    wallLevel: number;
  } | null;
}

export interface SupportReportData {
  /** Why the support didn't stay. v1: the target stopped being a tribe-mate or ally while they marched. */
  reason: 'relation_changed';
  home: VillageRefDto;
  host: VillageRefDto;
  units: Units;
}

/** Exactly one of battle / scout / support is set, matching `type`. */
export interface ReportDto extends ReportSummaryDto {
  battle: BattleReportData | null;
  scout: ScoutReportData | null;
  support: SupportReportData | null;
}

export interface ReportListResponse {
  reports: ReportSummaryDto[];
}

// ---- Tribes (docs/GAME_DESIGN.md section 11) -------------------------------------------
// Any signed-in player:
//   GET  /api/tribes?q=<name or tag>   -> 200 TribeListResponse (by points desc, max 100)
//   GET  /api/tribes/:id               -> 200 TribeDto
//   POST /api/tribes                   body CreateTribeRequest -> 201 MyTribeResponse (caller becomes leader)
//   POST /api/tribes/:id/join          -> 200 MyTribeResponse (recruitment 'open' only)
//   POST /api/tribes/:id/apply         body ApplyRequest -> 201 MyTribeResponse (recruitment 'application')
// Mine (the caller's own tribe; 409 not_in_tribe when tribeless unless noted):
//   GET  /api/tribe                    -> 200 MyTribeResponse (works when tribeless: tribe null)
//   POST /api/tribe/settings           body TribeSettingsRequest -> 200 MyTribeResponse
//   POST /api/tribe/invites            body InviteRequest -> 201 MyTribeResponse
//   POST /api/tribe/invites/:id/cancel -> 200 MyTribeResponse
//   POST /api/tribe/applications/:id/accept | /decline -> 200 MyTribeResponse
//   POST /api/tribe/members/:playerId/kick -> 200 MyTribeResponse
//   POST /api/tribe/members/:playerId/role  body RoleRequest -> 200 MyTribeResponse
//   POST /api/tribe/transfer           body TransferRequest -> 200 MyTribeResponse
//   POST /api/tribe/leave              -> 200 MyTribeResponse (tribe null)
//   POST /api/tribe/disband            -> 200 MyTribeResponse (tribe null)
//   POST /api/tribe/diplomacy          body DiplomacyRequest -> 201 MyTribeResponse
//   POST /api/tribe/diplomacy/proposals/:id/accept | /decline | /withdraw -> 200 MyTribeResponse
//   POST /api/tribe/diplomacy/relations/:id/cancel -> 200 MyTribeResponse
//   GET  /api/tribe/alerts             -> 200 TribeAlertsResponse (incoming attacks on members, soonest first)
//   GET  /api/tribe/chat?after=<messageId> -> 200 ChatResponse (oldest first; last 100 when no `after`)
//   POST /api/tribe/chat               body ChatRequest -> 201 ChatMessageDto
// The invited / applying player (works when tribeless):
//   POST /api/invites/:id/accept | /decline -> 200 MyTribeResponse
//   POST /api/applications/:id/withdraw     -> 200 MyTribeResponse

export interface TribeSummaryDto {
  id: number;
  name: string;
  tag: string;
  members: number;
  /** Sum of members' points. */
  points: number;
  recruitment: Recruitment;
  /** 1-based rank by points among all tribes. */
  rank: number;
}

export interface TribeListResponse {
  tribes: TribeSummaryDto[];
}

export interface TribeMemberDto {
  playerId: number;
  username: string;
  chieftain: string;
  role: TribeRole;
  points: number;
  /** Main village, for jumping to it on the map. */
  villageX: number;
  villageY: number;
  joinedAt: number;
}

export interface TribeRelationDto {
  /** Relation id (for cancel). */
  id: number;
  kind: DiplomacyKind;
  other: { id: number; name: string; tag: string };
  since: number;
  /** Set while a cancelled alliance/NAP serves its notice; it still protects until then. */
  endsAt: number | null;
  /** For enemy: true when my tribe declared it. */
  declaredByUs: boolean;
}

/** Public view of any tribe. */
export interface TribeDto extends TribeSummaryDto {
  description: string;
  createdAt: number;
  members: number;
  memberList: TribeMemberDto[];
  /** Active relations (incl. those serving notice). */
  relations: TribeRelationDto[];
}

export interface TribeInviteDto {
  id: number;
  tribe: { id: number; name: string; tag: string };
  playerId: number;
  username: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface TribeApplicationDto {
  id: number;
  tribe: { id: number; name: string; tag: string };
  playerId: number;
  username: string;
  /** Applicant's points when listed. */
  points: number;
  message: string;
  createdAt: number;
}

export interface DiplomacyProposalDto {
  id: number;
  kind: Exclude<DiplomacyKind, 'enemy'>;
  /** incoming = the other tribe proposed to us. */
  direction: 'incoming' | 'outgoing';
  other: { id: number; name: string; tag: string };
  createdAt: number;
}

export interface TribeEventDto {
  id: number;
  createdAt: number;
  /** Plain English sentence written by the server, e.g. "anna joined the tribe." */
  text: string;
}

export interface MyTribeResponse {
  /** null when the caller has no tribe. */
  tribe: TribeDto | null;
  /** The caller's role, or null. */
  role: TribeRole | null;
  /** Tribeless: invitations addressed to me. In a tribe: invitations my tribe has sent (officers+ only, else []). */
  invites: TribeInviteDto[];
  /** Tribeless: my open applications. In a tribe: applications to my tribe (officers+ only, else []). */
  applications: TribeApplicationDto[];
  /** Pending ally/NAP proposals to or from my tribe ([] when tribeless). */
  proposals: DiplomacyProposalDto[];
  /** Newest first, max 50 ([] when tribeless). */
  events: TribeEventDto[];
}

export interface CreateTribeRequest {
  name: string;
  tag: string;
  description?: string;
  recruitment: Recruitment;
}

export interface ApplyRequest {
  message: string;
}

export interface TribeSettingsRequest {
  description?: string;
  recruitment?: Recruitment;
}

export interface InviteRequest {
  username: string;
}

export interface RoleRequest {
  role: Exclude<TribeRole, 'leader'>;
}

export interface TransferRequest {
  playerId: number;
}

export interface DiplomacyRequest {
  /** The other tribe's tag (case-insensitive). */
  tag: string;
  kind: DiplomacyKind;
}

export interface ChatMessageDto {
  id: number;
  playerId: number;
  username: string;
  chieftain: string;
  text: string;
  createdAt: number;
}

export interface ChatResponse {
  messages: ChatMessageDto[];
}

export interface ChatRequest {
  text: string;
}

/** An attack on its way to a tribe member's village (scouts are not shown — they're stealthy). */
export interface TribeAlertDto {
  movementId: number;
  target: VillageRefDto;
  attacker: VillageRefDto;
  attackerTribeTag: string | null;
  departAt: number;
  arriveAt: number;
}

export interface TribeAlertsResponse {
  alerts: TribeAlertDto[];
}

// ---- Advisor (Mags the Tinker, AI tips) ----

/** Longest question a player may ask Mags (characters, after trimming). */
export const ADVISOR_QUESTION_MAX = 500;
/** Questions each player may ask Mags per rolling hour. */
export const ADVISOR_QUESTIONS_PER_HOUR = 20;

/** POST /api/advisor/ask */
export interface AdvisorAskRequest {
  question: string;
}

export interface AdvisorAskResponse {
  /** Mags's answer, plain text (no HTML, no markdown). */
  answer: string;
  /** Questions the player has left in the current rolling hour. */
  remaining: number;
}
