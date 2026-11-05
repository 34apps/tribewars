// HTTP API contract between apps/server and apps/web. Both sides import these types.
// JSON over HTTPS, session in an HttpOnly cookie. Errors: non-2xx with ApiError body.

import type { AchievementProgress, PlayerStatsDto } from './achievements.ts';
import type { SiteKind } from './config.ts';
import type { WorldConfig } from './world-config.ts';
import type {
  BuildingLevels,
  Coords,
  Mission,
  DiplomacyKind,
  GameErrorCode,
  PlayerRelation,
  Recruitment,
  Resources,
  SiegeHit,
  TribeAction,
  TribeRole,
  Units,
  VillageRanks,
  VillageState,
  WorldSettings,
} from './types.ts';
import type {
  MessageReportCategory,
  MessageReportKind,
  MessageReportStatus,
  StaffRole,
  TemplateKind,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from './staff.ts';

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
  /** The player reported (Settings) that someone else plays from the same household/connection. */
  householdShared: boolean;
  /** Set until the player dismisses the news that villages of theirs were abandoned after a long absence; else null. */
  abandonedNotice: AbandonedNoticeDto | null;
  /** This account may use the test-mode endpoints (server env SANDBOX_USERS). Shows the Test mode card in Settings. */
  sandbox: boolean;
  /** Staff role of this account (support / moderator / admin), else null. Lets the client show a staff entry. */
  staffRole?: StaffRole | null;
}

// POST /api/sandbox/max   (no body) -> 200 GameStateResponse. Every village of the player: all buildings at max level, full
//   stores, SANDBOX_ARMY_PER_UNIT of each unit, queues cleared. 403 `forbidden` unless the account is in SANDBOX_USERS.
// POST /api/sandbox/reset (no body) -> 200 GameStateResponse. Every village of the player back to a fresh starting village
//   (start levels/resources, no troops, no queues; own outgoing movements and own stationed support are removed).
//   Works at any time. World speed is unchanged. 403 `forbidden` unless the account is in SANDBOX_USERS.
// POST /api/sandbox/warp {seconds: 0..3600} -> 200 GameStateResponse. The player's movements due later arrive in `seconds`.
// POST /api/sandbox/clear-army (no body) -> 200 GameStateResponse. Removes my own troops at home in every village of mine.
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
  /** Feasts this village may still hold (engine feastAllowance at serverTime). Max 0 without a Banner Hall. */
  feastAllowance: FeastAllowanceDto;
  /** Present while this village's hearth is out (somebody struck it and holds it); `state.hearth` has the raw clock. */
  hearth?: HearthInfoDto;
}

/**
 * The hearth of a village that is out (docs/GAME_DESIGN.md 18.2). Everything is computed by the server at serverTime; the
 * client only counts down to `endsAt` / `failsAt`. On the map (`MapVillageDto.hearth`) everybody sees the clock and the
 * claimant's name, like the grey ring on the map; `occupierPopulation` is only sent on the owner's own village.
 */
export interface HearthInfoDto {
  /** Name of the player holding the claim (the occupiers' owner). */
  claimBy: string;
  claimById: number;
  /** When the hearth went out (ms). */
  outAt: number;
  /** True while the occupiers are strong enough (>= minPopulation) and the hold clock runs. */
  running: boolean;
  /** When the village changes owner if the clock keeps running (ms); null while it is paused. */
  endsAt: number | null;
  /** Hold time left at serverTime (ms); while paused, what is left once it runs again. */
  holdMsLeft: number;
  /** When the claim fails if the occupiers stay under the minimum (ms); null while running. */
  failsAt: number | null;
  /** Occupiers needed to keep the clock running (HOLD_MIN_POPULATION). */
  minPopulation: number;
  /** Population of the claimant's occupiers standing there now. Only on the owner's own village, never on the map. */
  occupierPopulation?: number;
}

/** Feast limit of one village (engine `feastAllowance`). */
export interface FeastAllowanceDto {
  /** FEAST_DAILY_PER_LEVEL * Banner Hall level. */
  max: number;
  used: number;
  left: number;
  /** When the open window ends (ms), or null when no window is open (the next Feast starts one). */
  windowEnd: number | null;
}

// ---- Renown (docs/GAME_DESIGN.md section 18.2) ----------------------------------------------
// GameStateResponse.renown carries the player's Renown. All numbers are integers, floored (the server may store fractions).
// POST /api/villages/:id/feast  body FeastRequest -> 200 FeastResponse
//   Needs Banner Hall level 1 (409 requirements_not_met), FEAST_COST * count in the village (409 not_enough_resources) and
//   count <= feastAllowance.left (409 queue_full). Server: settle, applyFeast, add `renown` to the player's total, all in one
//   transaction; the village row also stores `feast` (window). 400 invalid_input for a bad count.
// GET  /api/rankings/renown -> 200 RenownRankingResponse (signed in; top 100 by Renown earned (total, not balance), ties share a rank)

export interface RenownInfo {
  /** Everything earned so far (the Renown ranking uses it). Never goes down. */
  total: number;
  /** Spent on villages (and reserved for Chieftains in training). */
  spent: number;
  /** total - spent: what can be spent now. */
  balance: number;
  /** What the next village costs (villageRenownCost(villages)). */
  nextVillageCost: number;
  /** Villages owned now. */
  villages: number;
  /**
   * Chieftain ledger (step 2, section 18.2). `spent` already contains `reserved`: the Renown held by Chieftains that are queued,
   * at home, away or standing as occupiers. Each Chieftain's share is reserved / chieftains (the average); it is released when he
   * founds or takes a village and half comes back (CHIEFTAIN_RENOWN_REFUND_SHARE) when he dies. Cancelling a queued batch gives
   * its Renown back in full. Sent by GET /api/state; absent in older responses.
   */
  reserved?: number;
  /** Renown the next Chieftain reserves: villageRenownPrice(villages, chieftains). Needs balance >= this to train one. */
  chieftainPrice?: number;
  /** Chieftains the player has now: queued + at home + away + standing as occupiers, in all villages. */
  chieftains?: number;
}

export interface FeastRequest {
  /** Whole number, 1 or more. */
  count: number;
}

export interface FeastResponse {
  village: OwnVillageDto;
  renown: RenownInfo;
  /** Renown this Feast gave (count * FEAST_RENOWN). */
  gained: number;
}

export interface RenownRankDto {
  /** 1-based; players with equal Renown share the rank (1, 2, 2, 4). */
  rank: number;
  playerId: number;
  username: string;
  tribe: { id: number; tag: string } | null;
  villages: number;
  /** Renown earned in total (floored). */
  renown: number;
  villageX: number;
  villageY: number;
}

export interface RenownRankingResponse {
  players: RenownRankDto[];
  /** The caller's own row, also when outside the top 100. */
  me: RenownRankDto | null;
  total: number;
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
 * A `found` movement (and the return of a failed one) goes to a free tile: its `target` has villageId 0, the name "New village",
 * the tile's x/y and no owner. `occupy` goes to the cold village of the sender's own claim and stays there as occupiers.
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
  /** The player's Renown (section 18.2). */
  renown: RenownInfo;
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
// POST /api/villages/:id/cancel-build  body CancelBuildRequest -> 200 CancelResponse (newest job only; 80% back)
// POST /api/villages/:id/cancel-train  body CancelTrainRequest -> 200 CancelResponse (80% of the untrained rest back)
// POST /api/villages/:id/cancel-research  body CancelResearchRequest -> 200 CancelResponse (80% back; the next queued research starts)
// POST /api/villages/:id/send   body SendRequest  -> 201 SendResponse
// POST /api/villages/:id/rename body RenameVillageRequest -> 200 OwnVillageDto (owner only; 404 not_found for villages you do not own)
// GET  /api/villages  -> 200 VillageListResponse (every village of the caller, light: no full state)
// Several villages (step 2): everything above is per village (queues, stock, troops). A send from village A to village B of the same
// player is allowed for `support` (the troops stand in B as a contingent and can be recalled) and, for resources, `ship`.
// Support troops (section 12):
// POST /api/stationed/:id/recall     body RecallRequest -> 201 { movement: MovementDto }  (owner of the troops)
// POST /api/stationed/:id/send-back  -> 201 { movement: MovementDto }  (owner of the host village; all units)

export interface BuildRequest {
  building: string; // BuildingId; validated server-side
}

export interface CancelBuildRequest {
  index: number; // position in buildQueue; must be the newest (last) job
}

export interface CancelResearchRequest {
  index: number; // position in researchQueue (0 = running)
}

export interface CancelTrainRequest {
  building: string; // 'barracks' | 'stables' | 'bannerhall'
  index: number; // position in that building's queue
}

export interface CancelResponse {
  village: OwnVillageDto;
  /** What came back (CANCEL_REFUND_PERCENT of the cost). */
  refund: Resources;
  /** Cancelling a Chieftain batch only: the Renown that came back in full (the batch's reservation). Absent otherwise. */
  renownRefund?: number;
}

/** POST /api/villages/:id/rename */
export interface RenameVillageRequest {
  /** 1 to 30 characters: letters, digits, spaces and ' . _ -. */
  name: string;
}

/** One row of GET /api/villages. */
export interface VillageListItemDto extends Coords {
  id: number;
  name: string;
  points: number;
  /** 'out' while a claimant holds the cold village (see `OwnVillageDto.hearth`). */
  hearth: 'lit' | 'out';
  /** When the village changes owner if the hold clock keeps running; null when lit or paused. */
  holdEndsAt: number | null;
  /** Stock settled to serverTime, floored. */
  resources: Resources;
  /** An attack is on the way to this village. */
  incomingAttack: boolean;
  /** Arrival of the soonest incoming attack, else null. */
  nextAttackAt: number | null;
  /** The village cannot be attacked before this time (founded or restarted), else null. */
  protectedUntil: number | null;
}

export interface VillageListResponse {
  serverTime: number;
  villages: VillageListItemDto[];
}

// Training a Chieftain (unit 'chieftain', Banner Hall level 1): the same train route. On top of the resources the server reserves
// Renown (sum of villageRenownPrice(villages, others + i) per Chieftain) in the same transaction: 409 not_enough_resources
// ("Not enough Renown") when `renown.balance` is short. See RenownInfo for the ledger.
export interface TrainRequest {
  unit: string; // UnitId; validated server-side
  count: number;
}

// Drillyard (docs/GAME_DESIGN.md section 15), all -> 200 OwnVillageDto (owner only; time is the server's):
// POST /api/villages/:id/research  body ResearchRequest -> queues a research (cost paid now; queue size MAX_RESEARCH_QUEUE)
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
  /** Target tile; a village must stand there (except for `found`, where the tile must be free). */
  units: Partial<Units>;
  /**
   * attack (default rules; with 1-3 Chieftains it is a Strike attempt on an abandoned village: no loot, and if the battle is won
   * and enough Chieftains live the hearth goes out and the survivors stay as occupiers), scout (Pathfinders only), support
   * (tribe-mates, allies and your own other villages), found (exactly one Chieftain, the rest is the escort and becomes the
   * garrison; x/y is a free build site, 400 invalid_target otherwise; re-checked on arrival, when the Chieftain walks home with a
   * `found_failed` report if the tile was taken or the village limit is reached) or occupy (own troops, no Chieftain, to the cold
   * village of your own claim; 400 invalid_target when you hold no claim there).
   */
  mission: Mission;
  /**
   * Boulder Slings only (docs/GAME_DESIGN.md 18.9): the building (a BuildingId; names are public, levels are not) they lower after a
   * won attack. Optional: left out, the engine draws one at random on arrival. Only allowed on an `attack` that carries Boulder Slings
   * (400 invalid_input otherwise, and for an unknown id). It is NOT checked against the target village (that would reveal what it
   * has): a building that is not there simply takes no damage, which the battle report shows.
   */
  targetBuilding?: string;
  /** Test mode only (accounts on the sandbox list; others get `forbidden`): fixed seconds for the way out. 0 = arrives at once. */
  travelSeconds?: number;
  /** Test mode only: fixed seconds for the way home after the battle. */
  returnSeconds?: number;
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
  /** Under beginner, founding or restart protection (players only). */
  protected: boolean;
  /**
   * Present while the hearth is out (grey ring): the claimant and the hold clock, the same for everybody. Never the occupiers'
   * numbers. Not safe: `protected` stays false for a cold village.
   */
  hearth?: HearthInfoDto;
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
  /**
   * battle = attack (or called off); scout = scouting mission; support = support turned back on arrival; shipment = resources
   * delivered / received; village = Strike, Hold, Found and Taken events (`ReportDto.village`).
   */
  type: 'battle' | 'scout' | 'support' | 'shipment' | 'village';
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
  /** The Wall as it counted in the battle (after the Log Rams' during-the-battle hit); null when hidden from a wiped-out attacker. */
  wallLevel: number | null;
  /** Loot is always full: what the surviving units carry, up to the stock above the Vault. */
  loot: Resources;
  /**
   * Renown the report owner earned from this battle (attacker, defender or support owner; absent or 0 when none, e.g. forbidden
   * pair, under RENOWN_MIN_BATTLE_VALUE, or nothing left in the daily pair window). Floored for display.
   */
  renownGained?: number;
  /**
   * Buildings the attacker's siege units lowered (docs/GAME_DESIGN.md 18.9), Log Ram first; on a win and on a (close) loss. Absent on
   * reports saved before siege and when no siege unit was sent. The Wall line runs from the level BEFORE the battle to the level after
   * the during-the-battle and after-the-battle steps; `wallLevel` above is the Wall as it counted in the battle (after the during hit).
   * An attacker whose army was wiped out only sees the Wall hits (nothing else of the defence).
   */
  siege?: SiegeHit[];
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

/**
 * What happened to a village's hearth or ownership (step 2). `side` is 'attack' for the claimant / founder, 'defense' for the owner.
 *  - struck: your attack put the hearth out (claimant). `holdEndsAt` is when it is yours if the clock keeps running (null = paused).
 *  - hearth_out: your village's hearth was put out (owner; `claimBy` names the claimant).
 *  - taken: the hold ended and the village is yours (claimant; `overflow` = troops that did not fit and went home).
 *  - lost: your village changed owner (previous owner; `units` = troops that were away and are disbanded).
 *  - founded: a new village stands at the tile (founder; `overflow` as for taken).
 *  - found_failed: the Chieftain found the tile taken / the village limit reached and walked home (`reason`).
 *  - claim_failed: the claim ended without taking the village (claimant; `reason`), occupiers go home (`units`).
 *  - relit: the claim ended and the hearth burns again (owner).
 */
export interface VillageReportData {
  kind: 'struck' | 'hearth_out' | 'taken' | 'lost' | 'founded' | 'found_failed' | 'claim_failed' | 'relit';
  /** The village concerned; for found_failed a tile (villageId 0, name "New village"). */
  village: VillageRefDto;
  holdEndsAt?: number | null;
  claimBy?: string;
  reason?: 'tile_taken' | 'village_limit' | 'time' | 'relit' | 'replaced' | 'no_room' | 'no_claim';
  units?: Units;
  overflow?: Units;
}

/** Exactly one of battle / scout / support / shipment / village is set, matching `type`. */
export interface ReportDto extends ReportSummaryDto {
  battle: BattleReportData | null;
  scout: ScoutReportData | null;
  support: SupportReportData | null;
  shipment: ShipmentReportData | null;
  village: VillageReportData | null;
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
  /** Renown earned in total, floored (public, like points) and the rank by it (ties share a rank). */
  renown: number;
  renownRank: number;
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

/**
 * A village of a tribe member whose hearth is out (docs/GAME_DESIGN.md 18.2, step 4). Same information as the map shows to
 * everybody (claimant name, clock); never the occupiers' numbers and never what the attack carried. `hearth.occupierPopulation`
 * is only set when the viewer owns the village.
 */
export interface TribeHoldDto {
  village: VillageRefDto;
  hearth: HearthInfoDto;
}

export interface TribeAlertsResponse {
  alerts: TribeAlertDto[];
  /** Cold villages of members (hearth out) with the hold clock, soonest end first. Shown on the alert list at the moment of the strike. */
  holds: TribeHoldDto[];
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

// ---- Support, reports and staff tools ------------------------------------------------------------------------
// Player side (signed in; own data only, anything else is 404 not_found):
//   POST /api/tickets                 body CreateTicketRequest -> 201 TicketDto
//   GET  /api/tickets                 -> TicketListResponse (own tickets, last updated first; `unread` = tickets with a staff reply not yet read)
//   GET  /api/tickets/:id             -> TicketDto (internal staff notes are never included; marks the ticket read)
//   POST /api/tickets/:id/messages    body TicketReplyRequest -> 201 TicketDto (reopens a solved ticket; 403 forbidden when closed)
//   POST /api/tickets/:id/close       -> TicketDto
//   POST /api/reports                 body CreateMessageReportRequest -> 201 MessageReportReceipt
//     The reported player is derived on the server from the message; the reporter must be able to see it (else 404).
// Muted players (see StaffPlayerDetailDto.mutedUntil) get 403 `forbidden` on mail, tribe chat, forum posts and tribe texts,
// but can still use tickets.
// Staff side (every route re-reads the caller's role; not signed in or not staff = 404 not_found; too low a role = 403 forbidden):
//   GET  /api/staff/me                                  support+  -> StaffMeResponse
//   GET  /api/staff/players?query=                      support+  -> StaffPlayerListResponse (max PLAYER_SEARCH_MAX)
//   GET  /api/staff/players/:id                         support+  -> StaffPlayerDetailDto (IPs for moderator+ only; audited)
//   POST /api/staff/players/:id/mute|unmute|ban|unban|warn  moderator+  bodies MuteRequest / ModerationNoteRequest / BanRequest / WarnRequest -> StaffPlayerDetailDto
//   GET  /api/staff/audit?player=&action=&before=&limit=  moderator+  -> AuditListResponse
//   GET  /api/staff/reports?status=&category=&before=     moderator+  -> StaffReportListResponse
//   GET  /api/staff/reports/:id                         moderator+  -> StaffReportDto
//   POST /api/staff/reports/:id/resolve                 moderator+  body ResolveReportRequest -> StaffReportDto
//   GET  /api/staff/tickets?status=&category=&assignee=&unassigned=&offset=  support+ -> StaffTicketListResponse
//   GET  /api/staff/tickets/:id                         support+  -> StaffTicketDto
//   POST /api/staff/tickets/:id/messages|assign|status|priority  support+  -> StaffTicketDto
//   GET  /api/staff/templates                           support+  -> TemplateListResponse
//   POST /api/staff/templates, PUT|DELETE /api/staff/templates/:id  admin  -> MessageTemplateDto / 204
// Staff roles are granted only with the server CLI (apps/server/src/admin.ts), never over HTTP.

export interface StaffMeResponse {
  staffRole: StaffRole;
  username: string;
}

export interface CreateTicketRequest {
  category: TicketCategory;
  subject: string;
  body: string;
}

export interface TicketReplyRequest {
  body: string;
}

export interface TicketMessageDto {
  id: number;
  authorId: number | null;
  authorName: string;
  isStaff: boolean;
  /** Staff-only note. Only ever present in staff DTOs. */
  internal: boolean;
  body: string;
  templateId: number | null;
  createdAt: number;
}

export interface TicketSummaryDto {
  id: number;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  openedByStaff: boolean;
  createdAt: number;
  updatedAt: number;
  /** A staff message the player has not read yet. */
  unread: boolean;
}

export interface TicketDto extends TicketSummaryDto {
  messages: TicketMessageDto[];
}

export interface TicketListResponse {
  tickets: TicketSummaryDto[];
  unread: number;
}

export interface CreateMessageReportRequest {
  kind: MessageReportKind;
  /** Mail id, forum post id or tribe chat message id. Not used for kind `player`. */
  refId?: number;
  /** Kind `player` only. */
  username?: string;
  category: MessageReportCategory;
  note?: string;
}

export interface MessageReportReceipt {
  id: number;
  status: MessageReportStatus;
}

export interface StaffPlayerSummaryDto {
  id: number;
  username: string;
  createdAt: number;
  lastActive: number;
  staffRole: StaffRole | null;
  bannedAt: number | null;
  mutedUntil: number | null;
}

export interface StaffPlayerListResponse {
  players: StaffPlayerSummaryDto[];
}

export interface AuditEntryDto {
  id: number;
  at: number;
  actorId: number | null;
  actorName: string | null;
  actorIp: string | null;
  action: string;
  targetPlayerId: number | null;
  targetName: string | null;
  detail: string;
}

export interface AuditListResponse {
  entries: AuditEntryDto[];
  nextBefore: number | null;
}

export interface StaffPlayerDetailDto extends StaffPlayerSummaryDto {
  banReason: string | null;
  muteReason: string | null;
  /** Moderator and admin only; empty for support. */
  ips: Array<{ ip: string; firstSeen: number; lastSeen: number }>;
  openReportsAgainst: number;
  ticketCount: number;
  recentAudit: AuditEntryDto[];
}

/** Optional formal notice sent with a moderation action: opens a staff-initiated ticket with the rendered template and/or extra text. */
export interface ModerationNotice {
  templateId?: number;
  extra?: string;
}

export interface MuteRequest extends ModerationNotice {
  minutes: number;
  reason: string;
}

export interface BanRequest extends ModerationNotice {
  reason: string;
}

export interface WarnRequest extends ModerationNotice {
  reason?: string;
}

export interface ModerationNoteRequest {
  reason?: string;
}

export interface StaffReportDto {
  id: number;
  kind: MessageReportKind;
  refId: number | null;
  reporterId: number;
  reporterName: string;
  reportedPlayerId: number;
  reportedName: string;
  /** Copy of the text at report time (evidence survives deletion). Empty for kind `player`. */
  snapshot: string;
  category: MessageReportCategory;
  note: string;
  status: MessageReportStatus;
  handledBy: number | null;
  handledAt: number | null;
  resolutionNote: string;
  createdAt: number;
}

export interface StaffReportListResponse {
  reports: StaffReportDto[];
  nextBefore: number | null;
}

export interface ResolveReportRequest {
  status: 'actioned' | 'dismissed';
  resolutionNote?: string;
}

export interface StaffTicketSummaryDto extends TicketSummaryDto {
  playerId: number;
  playerName: string;
  assignedTo: number | null;
  assignedName: string | null;
  lastStaffMessageAt: number | null;
}

export interface StaffTicketListResponse {
  tickets: StaffTicketSummaryDto[];
  hasMore: boolean;
}

export interface StaffTicketDto extends StaffTicketSummaryDto {
  messages: TicketMessageDto[];
  player: StaffPlayerSummaryDto;
}

export interface StaffTicketReplyRequest {
  body?: string;
  templateId?: number;
  /** Staff-only note, hidden from the player. */
  internal?: boolean;
  /** Default after a public reply: `pending`. */
  status?: TicketStatus;
}

export interface AssignTicketRequest {
  assigneeId: number | null;
}

export interface TicketStatusRequest {
  status: TicketStatus;
}

export interface TicketPriorityRequest {
  priority: TicketPriority;
}

export interface MessageTemplateDto {
  id: number;
  key: string;
  title: string;
  kind: TemplateKind;
  /** May contain {player} {staff} {ticket} {category}. */
  body: string;
  updatedBy: number | null;
  updatedAt: number;
}

export interface TemplateListResponse {
  templates: MessageTemplateDto[];
}

export interface TemplateRequest {
  key: string;
  title: string;
  kind: TemplateKind;
  body: string;
}

export type UpdateTemplateRequest = Partial<Omit<TemplateRequest, 'key'>>;

// ---- Domination win condition and world end (docs/GAME_DESIGN.md, "Winning the world") -------------------------------------
// GET /api/domination -> 200 DominationStatusDto (signed in; read-only: the stored streak and peak only change in the server's own
//   lazy evaluation, at most every DOMINATION_EVAL_INTERVAL_MINUTES / speed)
// GET /api/world-end  -> 200 { ended: WorldEndDto | null } (signed in)
// Once the world has ended, every POST/PUT/PATCH/DELETE under /api is refused with 403 `forbidden` ("This world has ended.") except
// sign-in/out, mail, support tickets and message reports, staff tools, tribe chat and the tribe forum. Troops already marching still arrive.

/** The world's domination rule in real days (already divided by the world speed). */
export interface DominationSettingsDto {
  minAgeDays: number;
  winShare: number;
  streakDays: number;
  activeDays: number;
  /** The configured minimum; the effective one (also counting a share of the peak) is DominationStatusDto.minActivePlayers. */
  minActivePlayers: number;
}

export interface DominationTribeDto {
  tribeId: number;
  name: string;
  tag: string;
  /** Points of all villages owned by the tribe's members. */
  points: number;
  /** points / totalPoints, 0..1. */
  share: number;
}

export type WorldEndKind = 'domination' | 'manual';

export interface FinalTribeDto {
  rank: number;
  tribeId: number;
  name: string;
  tag: string;
  points: number;
  members: number;
  villages: number;
}

export interface FinalPlayerDto {
  rank: number;
  playerId: number;
  name: string;
  points: number;
  villages: number;
  tribeTag: string | null;
}

export interface WorldEndDto {
  endedAt: number;
  kind: WorldEndKind;
  /** The winning tribe (null for a manual end without winner). Name and tag as they were when the world ended. */
  winner: { tribeId: number; name: string; tag: string } | null;
  reason: string;
  /** Final rankings, frozen at the end (top WORLD_END_DTO_ROWS of each; the database keeps WORLD_END_STORED_ROWS). */
  finalTribes: FinalTribeDto[];
  finalPlayers: FinalPlayerDto[];
}

export interface WorldEndResponse {
  ended: WorldEndDto | null;
}

export interface DominationStatusDto {
  settings: DominationSettingsDto;
  now: number;
  /** Real days since the world was created. */
  worldAgeDays: number;
  /** Real days the world must be old (settings.minAgeDays). */
  minAgeDays: number;
  ageOk: boolean;
  /** Players active within settings.activeDays, not banned, not test accounts; accounts sharing an IP count once. */
  activePlayers: number;
  /** Highest activePlayers seen so far (only grows). */
  peakActivePlayers: number;
  /** Effective minimum: max(settings.minActivePlayers, ceil(minPeakShare x peak)). */
  minActivePlayers: number;
  playersOk: boolean;
  /** The tribe with the most village points (null when no player owns a village). */
  leader: DominationTribeDto | null;
  topTribes: DominationTribeDto[];
  /** Points of all villages owned by players (abandoned villages do not count). */
  totalPoints: number;
  /** Share (0..1) the leader needs. */
  winShare: number;
  /** All three conditions hold right now. */
  qualifies: boolean;
  /** When the running streak began (server clock, ms), else null. */
  streakStartedAt: number | null;
  /** Real days the streak has run (1 decimal; 0 when none). */
  streakDays: number;
  /** Real days the streak must run to win. */
  streakDaysNeeded: number;
  /** Plain-language reasons why the world does not count yet (empty when it does). */
  reasons: string[];
  ended: WorldEndDto | null;
}

// ---- Map sites: Great Fire and Fire Shrines (docs/GAME_DESIGN.md 18.4b "Step 5") -------------------------------------
// GET /api/sites -> 200 SitesResponse (signed in). Sites are targeted with the normal send routes (attack / support to the site's tile).

export interface SiteHolderDto {
  tribeId: number;
  name: string;
  tag: string;
}

export interface SiteDto {
  /** Stable id: 1 = Great Fire, 2-9 Fire Shrines. */
  id: number;
  kind: SiteKind;
  x: number;
  y: number;
  /** Awake once the world is old enough (SHRINE_WAKE_DAYS / speed): bigger bonus and a doubled militia. */
  awake: boolean;
  holder: SiteHolderDto | null;
  /** Population standing on the site now: the holder's stationed troops, or the militia of a neutral site. */
  garrison: number;
  /** Most population that can be stationed there. */
  maxPopulation: number;
  /** The site cannot be attacked before this time (server clock, ms) after a capture, else null. */
  calmUntil: number | null;
  /** Renown bonus (0.04 = +4%) this site gives every member of its holder now. */
  bonus: number;
  /** The signed-in player's own population stationed there. */
  mine: number;
  /** The signed-in player's contingents standing there, one per home village (for the recall buttons). Absent = none. */
  myContingents?: SiteContingentDto[];
}

/** Troops of one of the player's villages standing at a site. */
export interface SiteContingentDto {
  villageId: number;
  villageName: string;
  units: Units;
  arrivedAt: number;
}

/** POST /api/sites/:id/recall (signed in, owner of the troops): brings the village's troops at that site home; `units` omitted = all. -> 201 MovementResponse. */
export interface SiteRecallRequest {
  villageId: number;
  units?: Partial<Units>;
}

export interface SitesResponse {
  sites: SiteDto[];
  /** When the dormant shrines wake (server clock, ms); in the past when they already did. */
  wakesAt: number;
  /** The Renown bonus (0.1 = +10%, capped) the signed-in player's tribe gets from all sites it holds; 0 without a tribe. */
  myBonus: number;
}

// ---- live updates (WebSocket GET /api/live) -----------------------------------------------------------------------
// Push-only "something changed" hints. The client never sends game commands over the socket; on a hint it refetches
// through the normal GET endpoints. Hints carry no data.

/**
 * What changed: game = state/villages/movements/incoming; reports; mail; chat = tribe chat; tribe = tribe info + alerts;
 * world = the world ended (refetch GET /api/world-end), sent to every socket together with `game`.
 */
export type LiveTopic = 'game' | 'reports' | 'mail' | 'chat' | 'tribe' | 'world' | 'notifications';
export const LIVE_TOPICS: readonly LiveTopic[] = ['game', 'reports', 'mail', 'chat', 'tribe', 'world', 'notifications'];

// ---- Notifications (GAME_DESIGN 18.10) ---------------------------------------------------------
// GET  /api/notifications       -> 200 NotificationsResponse (newest first, at most 100)
// POST /api/notifications/read  body NotificationsReadRequest -> 200 NotificationsResponse (marks those ids, or all when `ids` is absent)
// A row is created for the target's owner when an attack / support / shipment to one of their villages is SENT; scouts and returns
// never make one; a cancel inside the cancel window deletes it. Never carries the unit list. Live topic: 'notifications'.

export type NotificationKind = 'incoming_attack' | 'incoming_support' | 'incoming_resources';

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  movementId: number;
  /** The sender's village (what the defender sees on an incoming movement). */
  origin: VillageRefDto;
  /** My village that is the target. */
  target: VillageRefDto;
  /** When it was sent, and when it arrives. */
  departAt: number;
  arriveAt: number;
  createdAt: number;
  read: boolean;
}

export interface NotificationsResponse {
  notifications: NotificationDto[];
  unread: number;
}

export interface NotificationsReadRequest {
  ids?: number[];
}

/** Server -> client text frames (JSON). */
export type LiveMessage = { type: 'hello' } | { type: 'hint'; topics: LiveTopic[] } | { type: 'pong' };

/** Server close codes (the browser sees them as CloseEvent.code). */
export const LIVE_CLOSE_SESSION_ENDED = 4401; // logout, ban or expiry: do not reconnect until signed in again
export const LIVE_CLOSE_TOO_MANY = 4429; // too many sockets for this session/IP: back off
export const LIVE_CLOSE_BAD_MESSAGE = 4400; // the client sent something other than ping, too big, or too fast

// ---- worlds (docs/MULTI_WORLD.md) ---------------------------------------------------------------------------------
// Each world is its own server process. Every route answers under /w/<worldId>/api/... as well as /api/...
// (the old path stays for the current world, dev and tests). One web build serves all worlds: it reads /w/<id>/ from the page URL.

export const DEFAULT_WORLD_ID = 'w1';
/** World ids: letters, digits and dash only, 1-32 characters. They appear in URLs and cookie paths. */
export const WORLD_ID_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/**
 * The `/w/<id>` prefix of a page path, or '' when the path has none (dev, preview, the old single-world URLs).
 * The web client puts this in front of `/api` ("/w/w1/api"); the server strips it again.
 */
export function worldPrefixOf(pathname: string): string {
  const m = /^\/w\/([A-Za-z0-9-]{1,32})(?:[/?#]|$)/.exec(pathname);
  return m ? `/w/${m[1]}` : '';
}

// GET /w/<id>/api/world/info (and /api/world/info) -> 200 WorldInfoResponse. Public; nothing private.
export interface WorldInfoResponse {
  id: string;
  name: string;
  /** World speed (1 = normal pace). */
  speed: number;
  /** When this world's database was created, ISO 8601 UTC. */
  startedAt: string;
  /** True when the world only accepts entry passes from the lobby (LOBBY_PUBLIC_KEY set): its own register/login are off. */
  lobby: boolean;
  /** True once the world has ended (a tribe won or the operator ended it): the world is frozen, see GET /api/world-end. Absent on older servers. */
  ended?: boolean;
}

// GET /w/<id>/api/world/config (and /api/world/config) -> 200 WorldConfigResponse. Public, read-only, no sign-in: the rules of this
// world (docs/GAME_DESIGN.md "Per-world settings"). Contains no secrets: no seed, keys, paths or player data. Changes are made only with the
// operator's admin tool (`config-set`), never over HTTP.
export interface WorldConfigResponse {
  id: string;
  name: string;
  /** True once the world has opened (first player or `world-open`): then only `editableAfterOpen` settings can still change. */
  open: boolean;
  /** When it opened, ISO 8601 UTC; null while it has not. */
  openedAt: string | null;
  /** Map size and layout, fixed when the world is created. */
  map: { radius: number; layout: 'scattered' | 'expanding' };
  /** Every rule of this world. Durations in hours/days are at speed 1: divide by `config.pace.speed` for real time. */
  config: WorldConfig;
  /** Settings the operator may still change after the world has opened. */
  editableAfterOpen: string[];
}

// ---- lobby: one account, many worlds (docs/MULTI_WORLD.md) ---------------------------------------------------------
// The lobby (apps/lobby) owns accounts, passwords, lobby sessions, the multi-account IP guard and the world list.
// It answers under /lobby/api/... (cookie `tw_lobby`, Path=/lobby/). Errors use ApiError like every other route.
//
//   POST /lobby/api/auth/register  body LobbyAuthRequest -> 201 LobbyMeResponse (sets cookie)
//   POST /lobby/api/auth/login     body LobbyAuthRequest -> 200 LobbyMeResponse (sets cookie)
//   POST /lobby/api/auth/logout    -> 204 (clears cookie)
//   POST /lobby/api/auth/logout-all (signed in) -> 204 (ends every lobby session of the account; worlds follow within LOBBY_WORLD_SESSION_MS)
//   POST /lobby/api/auth/change-password body LobbyChangePasswordRequest -> 200 LobbyMeResponse (new session; all other sessions end)
//   GET  /lobby/api/auth/me       -> 200 LobbyMeResponse (account null when signed out)
//   GET  /lobby/api/worlds         -> 200 LobbyWorldsResponse (signed in)
//   POST /lobby/api/worlds/:id/enter (empty body {}, signed in) -> 200 EnterWorldResponse; 403 forbidden when banned or the world is closed
//   GET  /lobby/api/health         -> 200 { ok: true }
//
// Entering a world: the client POSTs the pass to the world (same origin, so the world's session cookie is set):
//   POST /w/<id>/api/auth/enter  body EnterPassRequest -> 200 MeResponse (sets the world session cookie)
// Only worlds started with LOBBY_PUBLIC_KEY accept it (404 otherwise); such worlds refuse their own register/login (403 forbidden).

export const LOBBY_PREFIX = '/lobby';
export const LOBBY_SESSION_COOKIE = 'tw_lobby';

/** True when a page or request path is the lobby's ("/lobby", "/lobby/", "/lobby/api/..."). */
export function isLobbyPath(pathname: string): boolean {
  return pathname === LOBBY_PREFIX || pathname.startsWith(`${LOBBY_PREFIX}/`);
}

export type WorldStatus = 'open' | 'full' | 'closed' | 'finished';
export const WORLD_STATUSES: readonly WorldStatus[] = ['open', 'full', 'closed', 'finished'];
export function isWorldStatus(v: unknown): v is WorldStatus {
  return v === 'open' || v === 'full' || v === 'closed' || v === 'finished';
}

/** Change the password (also the way out of `password_change_required`). The current password is checked like at sign-in. */
export interface LobbyChangePasswordRequest {
  username: string;
  password: string;
  newPassword: string;
}

export interface LobbyAuthRequest {
  /** 3-20 chars: letters, digits, underscore. Case-insensitive unique. Same rules as the old world accounts. */
  username: string;
  /** New passwords: 10-128 chars, not among the most common passwords, not containing the username. Sign-in accepts older ones. */
  password: string;
  /** Register only: chieftain portrait id; the world uses it when it first creates this account's player. */
  chieftain?: string;
}

export interface LobbyAccountDto {
  id: number;
  username: string;
  chieftain: string;
  /** Staff role of the account; worlds copy it onto the player at every entry. */
  staffRole: StaffRole | null;
}

export interface LobbyMeResponse {
  account: LobbyAccountDto | null;
}

export interface LobbyWorldDto {
  id: string;
  name: string;
  /** 'full' = no new players (returning ones can still enter); 'closed' = nobody enters; 'finished' = the world ended (read-only, still enterable to see the results). */
  status: WorldStatus;
  /** Public URL path of the world's page, always "/..../" (e.g. "/w/w1/"). The world's API is `${path}api/...`. */
  path: string;
}

export interface LobbyWorldsResponse {
  worlds: LobbyWorldDto[];
}

export interface EnterWorldResponse {
  /** Signed entry pass (see EntryPassClaims). Single use, valid for ENTRY_PASS_TTL_MS. Never put it in a URL. */
  pass: string;
  /** The world's page path (same as LobbyWorldDto.path). */
  path: string;
  /** When the pass expires, ms since epoch. */
  expiresAt: number;
}

export interface EnterPassRequest {
  pass: string;
}

// ---- entry pass format ----
// pass = base64url(JSON(EntryPassClaims)) + "." + base64url(Ed25519 signature)
// The signature is over the UTF-8 bytes of ENTRY_PASS_DOMAIN + "\n" + <the base64url payload part exactly as sent>.
// The lobby signs with the private key from env LOBBY_SIGNING_KEY; a world verifies with LOBBY_PUBLIC_KEY.
// Keys travel as base64 of DER: private = PKCS#8, public = SPKI. kid = first 16 hex chars of SHA-256(public SPKI DER).

export const ENTRY_PASS_TTL_MS = 60_000;
/** Worlds refuse passes whose lifetime (exp - iat) is longer than this, whatever the signer says. */
export const ENTRY_PASS_MAX_LIFETIME_MS = 120_000;
/** Allowed clock difference between lobby and world (iat may be this far in the future). */
export const ENTRY_PASS_CLOCK_SKEW_MS = 10_000;
export const ENTRY_PASS_DOMAIN = 'clanfire-entry-pass-v1';

export interface EntryPassClaims {
  /** Format version, 1. */
  v: 1;
  /** Key id of the signing key. */
  kid: string;
  /** Lobby account id. */
  aid: number;
  /** Lobby username (used as the player name when the world first creates the player). */
  name: string;
  /** World id this pass is for; any other world refuses it. */
  wid: string;
  /** Chieftain portrait id the account chose. */
  chn: string;
  /** Staff role of the account or null. */
  role: StaffRole | null;
  /** Issued at / expires at, ms since epoch. */
  iat: number;
  exp: number;
  /** 22+ random url-safe characters, never reused. */
  nonce: string;
}
