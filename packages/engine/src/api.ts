// HTTP API contract between apps/server and apps/web. Both sides import these types.
// JSON over HTTPS, session in an HttpOnly cookie. Errors: non-2xx with ApiError body.

import type { AchievementProgress, PlayerStatsDto } from './achievements.ts';
import type {
  BuildingLevels,
  Coords,
  Mission,
  DiplomacyKind,
  GameErrorCode,
  PlayerRelation,
  Recruitment,
  Resources,
  TribeAction,
  TribeRole,
  Units,
  VillageRanks,
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

export interface AbandonedNoticeDto {
  /** How many of the player's villages were abandoned while they were away. */
  villages: number;
  /** How many days away that takes at this world speed (30 at speed 1). */
  idleDays: number;
}

// POST /api/me/abandoned-notice/dismiss (no body) -> 200 MeResponse. Clears PlayerDto.abandonedNotice (own account only).

export interface PlayerDto {
  id: number;
  username: string;
  /** Attacks on this player's villages are refused until this time. 0 = not protected. */
  protectedUntil: number;
  /** The player's tribe, or null. */
  tribe: PlayerTribeDto | null;
  /** Chosen chieftain portrait id (CHIEFTAINS in config.ts). */
  chieftain: string;
  /** Premium subscriber: longer build queue (buildQueueLimit in config.ts). */
  premium: boolean;
  /** The player reported (Settings) that someone else plays from the same household/connection. */
  householdShared: boolean;
  /** Set until the player dismisses the news that villages of theirs were abandoned after a long absence; else null. */
  abandonedNotice: AbandonedNoticeDto | null;
  /** This account may use the test-mode endpoints (server env SANDBOX_USERS). Shows the Test mode card in Settings. */
  sandbox: boolean;
}

// POST /api/sandbox/max   (no body) -> 200 GameStateResponse. Every village of the player: all buildings at max level, full
//   stores, SANDBOX_ARMY_PER_UNIT of each unit, queues cleared. 403 `forbidden` unless the account is in SANDBOX_USERS.
// POST /api/sandbox/reset (no body) -> 200 GameStateResponse. Every village of the player back to a fresh starting village
//   (start levels/resources, no troops, no queues; own outgoing movements and own stationed support are removed).
//   Works at any time. World speed is unchanged. 403 `forbidden` unless the account is in SANDBOX_USERS.
// POST /api/sandbox/warp {seconds: 0..3600} -> 200 GameStateResponse. The player's movements due later arrive in `seconds`.
// POST /api/sandbox/clear-abandoned (no body) -> 200 GameStateResponse. Every abandoned village's garrison is emptied
//   (it slowly refills through growth steps). 403 `forbidden` unless the account is in SANDBOX_USERS.

/** POST /api/me/household -> 200 MeResponse */
export interface HouseholdRequest {
  shared: boolean;
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
  kind: Mission | 'return' | 'shipment';
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
  /** Only on outgoing returns (the loot, or a turned-back shipment's cargo). */
  loot: Resources | null;
  /** Cargo of a `shipment`; visible to sender and receiver. null for every other kind. */
  resources: Resources | null;
  /** Server time (ms) until which the sender may still cancel this movement; null if it cannot be cancelled (not mine, a return, window over). */
  cancellableUntil: number | null;
}

// POST /api/movements/:id/cancel -> 201 { movement: MovementDto }  (sender only, within CANCEL_WINDOW_MS of departure;
//   the troops/cargo return in the time already travelled; the response is the new return movement)

export interface GameStateResponse {
  serverTime: number;
  settings: WorldSettings;
  player: PlayerDto;
  /** v1 has exactly one village per player; array keeps room for more. */
  villages: OwnVillageDto[];
  movements: MovementDto[];
  unreadReports: number;
  /** Unread mails in my inbox (badge on the Mail tab). */
  unreadMail: number;
  /** Tribe forum threads with posts the player hasn't opened yet (0 when tribeless). */
  forumUnread: number;
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

// Drillyard (docs/GAME_DESIGN.md section 15), all -> 200 OwnVillageDto (owner only; time is the server's):
// POST /api/villages/:id/research  body ResearchRequest -> starts the one research job (cost paid now)
// POST /api/villages/:id/rank      body RankRequest     -> buys the next rank of a track (instant)
// POST /api/villages/:id/respec    body RankRequest     -> resets a track to rank 0 (gold fee, points return)
export interface ResearchRequest {
  unit: string; // UnitId
}

export interface RankRequest {
  unit: string; // UnitId
  track: string; // RankTrack
}

export interface SendRequest extends Coords {
  /** Target tile; a village must stand there. */
  units: Partial<Units>;
  /** attack (default rules), scout (Pathfinders only) or support (tribe-mates and allies only). */
  mission: Mission;
}

/**
 * POST /api/villages/:id/ship  body SendShipmentRequest -> 201 SendShipmentResponse
 * Resources travel from my village to a village of mine, a tribe-mate or an ally (section 13).
 */
export interface SendShipmentRequest extends Coords {
  /** Amounts per resource (whole numbers); omitted ones count as 0. */
  resources: Partial<Resources>;
}

export interface SendShipmentResponse {
  village: OwnVillageDto;
  movement: MovementDto;
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
  side: 'attack' | 'defense' | 'support' | 'shipment';
  /** battle = attack (or called off); scout = scouting mission; support = support turned back on arrival; shipment = resources delivered / received. */
  type: 'battle' | 'scout' | 'support' | 'shipment';
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
  intel: ScoutIntel | null;
}

/**
 * Layers of a successful scout, by the sending village's Keen rank (docs/GAME_DESIGN.md section 15, SCOUT_INTEL_KEEN).
 * A layer the rank does not reach is null. Reports saved before Keen tiers have every layer and no `keen`.
 */
export interface ScoutIntel {
  /** Keen rank that produced this report (0-5). */
  keen?: number;
  resources: Resources;
  /** Troops at home, own + stationed support. Rough (rounded) when `troopsApprox`. */
  troops: Units | null;
  troopsApprox?: boolean;
  wallLevel: number | null;
  buildings: BuildingLevels | null;
  /** The defending village's unit ranks; top tier only. */
  ranks?: VillageRanks | null;
  drillyardLevel?: number | null;
}

export interface SupportReportData {
  /** Why the support didn't stay. v1: the target stopped being a tribe-mate or ally while they marched. */
  reason: 'relation_changed';
  home: VillageRefDto;
  host: VillageRefDto;
  units: Units;
}

/** A shipment that arrived. The sender sees it as `sent`, the receiver as `received` (same data). */
export interface ShipmentReportData {
  role: 'sent' | 'received';
  from: VillageRefDto;
  to: VillageRefDto;
  /** What left the sender. */
  resources: Resources;
  /** What fitted into the receiver's storehouse. */
  stored: Resources;
  /** What was lost because the storehouse was full (resources - stored). */
  lost: Resources;
}

/** Exactly one of battle / scout / support / shipment is set, matching `type`. */
export interface ReportDto extends ReportSummaryDto {
  battle: BattleReportData | null;
  scout: ScoutReportData | null;
  support: SupportReportData | null;
  shipment: ShipmentReportData | null;
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

// ---- Rankings ----------------------------------------------------------------------------
//   GET /api/rankings/players -> 200 PlayerRankingResponse (signed in; top 100 by points desc, ties share a rank)
//   GET /api/players/:id      -> 200 PlayerProfileDto (signed in; 404 for unknown or village-less players);
//     includes `stats` (PlayerStatsDto counters) and `achievements` (AchievementProgress[]); read-only, no write endpoint
// Tribe ranking: GET /api/tribes (TribeSummaryDto.rank).

export interface PlayerRankDto {
  /** 1-based; players with equal points share the rank (1, 2, 2, 4). */
  rank: number;
  playerId: number;
  username: string;
  tribe: { id: number; tag: string } | null;
  villages: number;
  /** Sum of the player's village points. */
  points: number;
  /** Their biggest village, for "show on map". */
  villageX: number;
  villageY: number;
}

/** Public profile of a player: only what anyone can already see on the map and in the rankings. */
export interface PlayerProfileDto {
  playerId: number;
  username: string;
  chieftain: string;
  /** Rank by points among all players (ties share a rank). */
  rank: number;
  points: number;
  tribe: { id: number; name: string; tag: string; role: TribeRole } | null;
  /** When the account was created (server clock, ms). */
  joinedAt: number;
  /** Beginner protection still active. */
  protectedNow: boolean;
  /** Their villages, biggest first (at most 50). */
  villages: { id: number; name: string; x: number; y: number; points: number }[];
  /** Total villages owned (can exceed the list). */
  villageCount: number;
  /** Lifetime counters (server-counted; docs/GAME_DESIGN.md section 16). */
  stats: PlayerStatsDto;
  /** Progress for every achievement in ACHIEVEMENTS order: tier 0-3, current value, next threshold (null at gold). */
  achievements: AchievementProgress[];
}

export interface PlayerRankingResponse {
  players: PlayerRankDto[];
  /** The caller's own row, also when outside the top 100. */
  me: PlayerRankDto | null;
  /** Players ranked in total. */
  total: number;
}

export interface TribeSummaryDto {
  id: number;
  name: string;
  tag: string;
  members: number;
  /** Sum of members' points. */
  points: number;
  /** Villages owned by all members together. */
  villages: number;
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
  /** Individual rights the leader granted on top of the role. Only filled in the caller's own tribe view, else omitted. */
  grants?: TribeAction[];
  /** Last request time (ms, accurate to the 5-minute write interval). Only with the `view_activity` right, else omitted. */
  lastActive?: number;
  /** Active within ONLINE_WINDOW_MS. Only with the `view_activity` right, else omitted. */
  online?: boolean;
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
  /** Everything the caller may do: role defaults plus explicit grants ([] when tribeless). The server re-checks each one. */
  rights: TribeAction[];
  /** Forum threads with new posts since the caller last opened them (0 when tribeless). */
  forumUnread: number;
}

export interface SetGrantsRequest {
  grants: TribeAction[];
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

// ---- Mail --------------------------------------------------------------------------
// Player-to-player messages, plain text and emoji only (never markup). Each side deletes its own copy.
// GET    /api/mail?box=inbox|sent&before=<id> -> 200 MailListResponse (30 per page, newest first, body preview only)
// GET    /api/mail/:id                        -> 200 MailDto (the recipient reading it marks it read)
// POST   /api/mail  body SendMailRequest      -> 201 MailDto
// DELETE /api/mail/:id                        -> 204 (hides it for the caller only); not_found for strangers

export type MailBox = 'inbox' | 'sent';

export interface MailSummaryDto {
  id: number;
  fromId: number;
  from: string;
  toId: number;
  to: string;
  subject: string;
  /** First characters of the body. */
  preview: string;
  createdAt: number;
  /** Always true for mail you sent. */
  read: boolean;
}

export interface MailDto extends MailSummaryDto {
  body: string;
}

export interface MailListResponse {
  mails: MailSummaryDto[];
  /** Pass as `before` to get the next page; null on the last page. */
  nextBefore: number | null;
  unread: number;
}

export interface SendMailRequest {
  /** Recipient username (case-insensitive). */
  to: string;
  subject: string;
  body: string;
}

// ---- Tribe forum ---------------------------------------------------------------------------
// Members of the tribe only (everyone else, and everything they may not see, is not_found). Text and emoji only.
// PUT    /api/tribe/members/:playerId/permissions body SetGrantsRequest -> 200 TribeMemberDto (leader only;
//        replaces the member's explicit grants; only TRIBE_GRANTABLE rights; not for the leader's own row)
// GET    /api/tribe/forum/boards                 -> 200 ForumBoardsResponse (boards the caller may see)
// POST   /api/tribe/forum/boards  body CreateBoardRequest -> 201 ForumBoardDto            (forum_manage)
// PUT    /api/tribe/forum/boards/:id body UpdateBoardRequest -> 200 ForumBoardDto          (forum_manage)
// DELETE /api/tribe/forum/boards/:id             -> 204 (threads and posts go with it)    (forum_manage)
// GET    /api/tribe/forum/boards/:id/threads?page=0 -> 200 ForumThreadsResponse (pinned first, then latest post)
// POST   /api/tribe/forum/boards/:id/threads body CreateThreadRequest -> 201 ForumThreadResponse
// GET    /api/tribe/forum/threads/:id?page=0     -> 200 ForumThreadResponse (marks the thread read)
// PUT    /api/tribe/forum/threads/:id body UpdateThreadRequest -> 200 ForumThreadSummaryDto  (forum_moderate)
// DELETE /api/tribe/forum/threads/:id            -> 204                                    (forum_moderate)
// POST   /api/tribe/forum/threads/:id/posts body ReplyRequest -> 201 ForumPostDto
// PUT    /api/tribe/forum/posts/:id body EditPostRequest -> 200 ForumPostDto
// DELETE /api/tribe/forum/posts/:id              -> 204 (own post or forum_moderate; deleting the first post deletes the thread)

export type ForumVisibility = 'members' | 'leadership';
export type ForumPostRule = 'members' | 'leadership';

export interface ForumBoardDto {
  id: number;
  name: string;
  /** Who may see the board. */
  visibility: ForumVisibility;
  /** Who may start new threads (replies need only visibility and an unlocked thread). */
  postRule: ForumPostRule;
  position: number;
  threadCount: number;
  /** Threads with posts newer than the caller's last visit. */
  unread: number;
  /** Whether the caller may start a thread here. */
  canPost: boolean;
}

export interface ForumBoardsResponse {
  boards: ForumBoardDto[];
}

export interface ForumThreadSummaryDto {
  id: number;
  boardId: number;
  title: string;
  authorId: number;
  author: string;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  lastPostAt: number;
  postCount: number;
  unread: boolean;
}

export interface ForumThreadsResponse {
  board: ForumBoardDto;
  threads: ForumThreadSummaryDto[];
  page: number;
  hasMore: boolean;
}

export interface ForumPostDto {
  id: number;
  threadId: number;
  authorId: number;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ForumThreadResponse {
  thread: ForumThreadSummaryDto;
  board: ForumBoardDto;
  posts: ForumPostDto[];
  page: number;
  hasMore: boolean;
}

export interface CreateBoardRequest {
  name: string;
  visibility?: ForumVisibility;
  postRule?: ForumPostRule;
}

export interface UpdateBoardRequest {
  name?: string;
  visibility?: ForumVisibility;
  postRule?: ForumPostRule;
}

export interface CreateThreadRequest {
  title: string;
  body: string;
}

export interface ReplyRequest {
  body: string;
}

export interface EditPostRequest {
  body: string;
}

export interface UpdateThreadRequest {
  pinned?: boolean;
  locked?: boolean;
}
