// Core data model shared by the server (authoritative) and the web client (previews).
// All times are milliseconds since the Unix epoch. All "per hour" values are at world speed 1
// unless a function says otherwise; the engine applies WorldSettings.speed.

export const RESOURCE_IDS = ['wood', 'food', 'iron', 'gold'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];
/** Resource amounts. Stored as floats (fractional production); show Math.floor() to players. */
export type Resources = Record<ResourceId, number>;

export const BUILDING_IDS = [
  'hall',
  'lumber',
  'farm',
  'mine',
  'goldmine',
  'storehouse',
  'barracks',
  'stables',
  'wall',
  'vault',
  'market',
  'drillyard',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
/** Level per building; 0 = not built. */
export type BuildingLevels = Record<BuildingId, number>;

export const UNIT_IDS = ['pikeman', 'guard', 'raider', 'outrider', 'knight', 'pathfinder'] as const;
export type UnitId = (typeof UNIT_IDS)[number];
export type UnitClass = 'infantry' | 'cavalry';
/**
 * Unit counts. Every UnitId is always present (0 when none) to keep arithmetic simple.
 * Data saved before a unit existed lacks its key: pass loaded states through `normalizeVillage`
 * (and loose unit maps through `normalizeUnits`) before use.
 */
export type Units = Record<UnitId, number>;

/** What a troop movement is for (docs/GAME_DESIGN.md section 12). */
export const MISSIONS = ['attack', 'scout', 'support'] as const;
export type Mission = (typeof MISSIONS)[number];

/** Buildings that train units. */
export type TrainingBuildingId = 'barracks' | 'stables';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  maxLevel: number;
  /** Level every new player village starts with. */
  startLevel: number;
  /** Other buildings (and levels) needed before level 1 can be started. */
  requires: Partial<Record<BuildingId, number>>;
  /** Cost of level 1; level L costs baseCost * costGrowth^(L-1), each resource rounded. */
  baseCost: Resources;
  costGrowth: number;
  /** Build time of level 1 in seconds at speed 1 with Town Hall level 1. */
  baseTimeSec: number;
  timeGrowth: number;
}

export interface UnitDef {
  id: UnitId;
  name: string;
  description: string;
  unitClass: UnitClass;
  attack: number;
  /** Defense against attacking infantry. */
  defenseInfantry: number;
  /** Defense against attacking cavalry. */
  defenseCavalry: number;
  /** Map tiles per hour at world speed 1. */
  speed: number;
  /** Resources one unit can carry home from a raid. */
  carry: number;
  /** Food eaten per hour at world speed 1 (counted while queued, at home and away). */
  upkeep: number;
  cost: Resources;
  /** Training time per unit in seconds at speed 1 with the training building at level 1. */
  trainTimeSec: number;
  building: TrainingBuildingId;
  /** Buildings (and levels) required to train this unit. Always includes `building`. */
  requires: Partial<Record<BuildingId, number>>;
  /** If set, the unit must be researched once per village (Drillyard level needed to START the research). */
  research?: { drillyard: number; cost: Resources; timeSec: number };
}

/** Training-point tracks (docs/GAME_DESIGN.md section 15). Keen is for the scout unit only. */
export const RANK_TRACKS = ['might', 'bulwark', 'keen'] as const;
export type RankTrack = (typeof RANK_TRACKS)[number];
/** Rank 0..RANK_MAX per track. */
export type UnitRanks = Record<RankTrack, number>;
export type VillageRanks = Partial<Record<UnitId, UnitRanks>>;

export interface ResearchJob {
  unit: UnitId;
  startAt: number;
  finishAt: number;
}

export interface WorldSettings {
  /** Seed for terrain and abandoned-village placement. */
  seed: number;
  /** Multiplies production/upkeep and divides all durations. 1 = normal pace. */
  speed: number;
  /** World spans x and y from -radius to +radius (inclusive). */
  radius: number;
  /** Abandoned villages per map tile at world creation (e.g. 0.02 = 1 per 50 tiles). */
  npcDensity: number;
  /** New player villages can't be attacked for this many hours (divided by speed). */
  protectionHours: number;
  /** Abandoned villages grow one step every this many hours (divided by speed). */
  npcGrowthHours: number;
  /**
   * 'scattered' (default): abandoned villages everywhere at world creation, players land anywhere.
   * 'expanding': a populated disc grows from the centre; each new player lands at its edge and brings
   * abandoned villages around them.
   */
  layout?: 'scattered' | 'expanding';
}

export interface BuildJob {
  building: BuildingId;
  targetLevel: number;
  startAt: number;
  finishAt: number;
}

export interface TrainJob {
  unit: UnitId;
  count: number;
  /** Units of this batch already moved into `troops`. */
  done: number;
  /** Time per unit in ms, fixed when the batch was queued. */
  perUnitMs: number;
  /** When the first unit of this batch starts training. */
  startAt: number;
}

export interface NpcInfo {
  /** 1 (weak) .. 5 (strong); sets starting levels and garrison size. */
  tier: number;
  /** Growth steps already applied (see GAME_DESIGN.md "Abandoned villages"). */
  growthSteps: number;
  /** Growth clock origin. */
  createdAt: number;
  /** Seed of this village's own growth order ('expanding' layout); absent = the fixed NPC_GROWTH_ORDER. */
  growthSeed?: number;
}

export interface VillageState {
  resources: Resources;
  /** Time `resources`, queues and troops were last brought up to date. */
  lastUpdate: number;
  buildings: BuildingLevels;
  /** Units at home (can defend and be sent). */
  troops: Units;
  /** Units currently out on a movement (still eat food). */
  away: Units;
  /** In order; at most MAX_BUILD_QUEUE entries. Costs already paid. */
  buildQueue: BuildJob[];
  /** Per training building, in order; at most MAX_TRAIN_QUEUE batches each. Costs paid. */
  trainQueues: Record<TrainingBuildingId, TrainJob[]>;
  /** Present only on abandoned (computer-run) villages. */
  npc?: NpcInfo;
  /** Units researched in this village (units without a `research` rule are always allowed). */
  researched?: UnitId[];
  /** Research queue: [0] is running, the rest wait and start one after another; cost already paid. */
  researchQueue?: ResearchJob[];
  /** Bought ranks per unit (Drillyard Training Points). */
  ranks?: VillageRanks;
}

export interface Coords {
  x: number;
  y: number;
}

export type Terrain = 'grass' | 'forest' | 'hills' | 'mountain' | 'lake';

// ---- Tribes (docs/GAME_DESIGN.md section 11) ----

export const TRIBE_ROLES = ['leader', 'officer', 'member'] as const;
export type TribeRole = (typeof TRIBE_ROLES)[number];

/** open = anyone joins at once; application = players apply, officers decide; invite = invitations only. */
export const RECRUITMENT_MODES = ['open', 'application', 'invite'] as const;
export type Recruitment = (typeof RECRUITMENT_MODES)[number];

/** ally and nap need both tribes to agree; enemy is declared by one side. */
export const DIPLOMACY_KINDS = ['ally', 'nap', 'enemy'] as const;
export type DiplomacyKind = (typeof DIPLOMACY_KINDS)[number];

/** How a player's village relates to the viewer, for map colours and attack rules. */
export type PlayerRelation = 'self' | 'tribe' | 'ally' | 'nap' | 'enemy' | 'neutral';

export type TribeAction =
  | 'edit_settings'
  | 'invite'
  | 'handle_applications'
  | 'kick'
  | 'set_roles'
  | 'transfer_leadership'
  | 'diplomacy'
  | 'disband'
  | 'chat'
  | 'forum_manage'
  | 'forum_moderate'
  | 'view_activity';

/** Result of a rule check. Server sends `reason` to the client as an error code. */
export type CheckResult<T> = ({ ok: true } & T) | { ok: false; reason: GameErrorCode; message: string };

export type GameErrorCode =
  | 'invalid_input'
  | 'max_level'
  | 'requirements_not_met'
  | 'not_enough_resources'
  | 'exceeds_storage'
  | 'queue_full'
  | 'too_late'
  | 'not_enough_food'
  | 'population_full'
  | 'not_enough_troops'
  | 'no_troops'
  | 'invalid_target'
  | 'target_protected'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'rate_limited'
  | 'username_taken'
  | 'tribe_name_taken'
  | 'tribe_full'
  | 'already_in_tribe'
  | 'not_in_tribe'
  /** Unexpected server failure (HTTP 500). Never thrown by the engine. */
  | 'advisor_unavailable'
  /** Lobby sign-in: the password was right but no longer meets the password rules; choose a new one (HTTP 403). */
  | 'password_change_required'
  | 'internal_error';

export class GameError extends Error {
  readonly code: GameErrorCode;
  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export interface BattleInput {
  attackerUnits: Units;
  /** Defender village, already settled to the battle time. */
  defender: VillageState;
  /** Support contingents stationed at the defender village (other players' troops); they fight too. */
  support?: Units[];
  /** Ranks of the attacking army's home village (Might applies). Omitted = no bonus. */
  attackerRanks?: VillageRanks;
  /** Ranks of the defender village (Bulwark applies to its own troops). */
  defenderRanks?: VillageRanks;
  /** Home-village ranks per support contingent, same order as `support` (Bulwark applies). */
  supportRanks?: Array<VillageRanks | undefined>;
  /** Deterministic luck: same seed, same result. */
  seed: number;
}

export interface BattleResult {
  attackerWon: boolean;
  /** -0.1 .. +0.1, applied to attack power. */
  luck: number;
  attackPower: number;
  defensePower: number;
  attackerLosses: Units;
  attackerSurvivors: Units;
  /** Defender units at home that took part (the village's own troops). */
  defenderUnits: Units;
  defenderLosses: Units;
  /** Losses per support contingent, same order as `BattleInput.support` ([] when none). */
  supportLosses: Units[];
  /** Resources taken from the defender (0s when the attacker lost). */
  loot: Resources;
}

export interface ScoutInput {
  /** Pathfinders sent. */
  scouts: number;
  /** Pathfinders at the target: the village's own at home plus stationed support. */
  defenderScouts: number;
  /** Sender's Keen multiplier (keenMultiplier of the sending village's ranks). Default 1. */
  scoutMultiplier?: number;
  /** Defender's total scout strength: each defending Pathfinder times its own village's Keen multiplier. Default = defenderScouts. */
  defenderStrength?: number;
}

export interface ScoutResult {
  success: boolean;
  /** Pathfinders the sender lost (all of them on failure). */
  scoutLosses: number;
  /** Defending pathfinders lost (0 on success: they were outnumbered and hid). */
  defenderScoutLosses: number;
}
