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
  'bannerhall',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];
/** Level per building; 0 = not built. */
export type BuildingLevels = Record<BuildingId, number>;

export const UNIT_IDS = ['pikeman', 'guard', 'raider', 'outrider', 'knight', 'pathfinder', 'chieftain', 'logram', 'boulder'] as const;
export type UnitId = (typeof UNIT_IDS)[number];
export type UnitClass = 'infantry' | 'cavalry';
/**
 * Unit counts. Every UnitId is always present (0 when none) to keep arithmetic simple.
 * Data saved before a unit existed lacks its key: pass loaded states through `normalizeVillage`
 * (and loose unit maps through `normalizeUnits`) before use.
 */
export type Units = Record<UnitId, number>;

/** What a troop movement is for (docs/GAME_DESIGN.md section 12). */
export const MISSIONS = ['attack', 'scout', 'support', 'found', 'occupy'] as const;
export type Mission = (typeof MISSIONS)[number];

/** Buildings that train units. */
export const TRAINING_BUILDING_IDS = ['barracks', 'stables', 'bannerhall'] as const;
export type TrainingBuildingId = (typeof TRAINING_BUILDING_IDS)[number];

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
  cost: Resources;
  /** Training time per unit in seconds at speed 1 with the training building at level 1. */
  trainTimeSec: number;
  building: TrainingBuildingId;
  /** Buildings (and levels) required to train this unit. Always includes `building`. */
  requires: Partial<Record<BuildingId, number>>;
  /** If set, the unit must be researched once per village (Drillyard level needed to START the research). */
  research?: { drillyard: number; cost: Resources; timeSec: number };
  /**
   * Siege units only (docs/GAME_DESIGN.md 18.9): after a won attack the survivors lower a building. `target` 'wall' = always the
   * Wall; 'chosen' = the building the sender picked (random if none). `power` = siege points per surviving unit; `maxLevels` =
   * most levels this kind lowers in one attack.
   */
  siege?: { target: 'wall' | 'chosen'; power: number; maxLevels: number };
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
  /** Multiplies production and divides all durations. 1 = normal pace. */
  speed: number;
  /** World spans x and y from -radius to +radius (inclusive). */
  radius: number;
  /** Abandoned villages per map tile at world creation (e.g. 0.02 = 1 per 50 tiles). */
  npcDensity: number;
  /** New player villages can't be attacked for this many hours (divided by speed). */
  protectionHours: number;
  /**
   * 'scattered' (default): abandoned villages everywhere at world creation, players land anywhere.
   * 'expanding': a populated disc grows from the centre; each new player lands at its edge and brings
   * abandoned villages around them.
   */
  layout?: 'scattered' | 'expanding';
  /**
   * Domination win condition of this world (docs/GAME_DESIGN.md, "Winning the world"). Written whole at world creation;
   * databases created before it have none and use DOMINATION_DEFAULTS. Always read through `mergeDominationSettings`.
   */
  domination?: Partial<DominationSettings>;
  /**
   * The world's complete rules (world-config.ts): set by the server from the stored per-world config. The flat fields above
   * (speed, npcDensity, protectionHours, domination) always equal the matching config values. Absent in tests
   * and old callers: `worldRules(settings)` then returns the defaults.
   */
  config?: import('./world-config.ts').WorldConfig;
}

/** Per-world domination rule. Durations are in days at speed 1 and are divided by the world speed like every other duration. */
export interface DominationSettings {
  /** The world must be this old before a tribe can win. */
  minAgeDays: number;
  /** Fewest active players needed (the effective minimum is also at least `minPeakShare` of the peak). */
  minActivePlayers: number;
  /** The effective player minimum is at least this share (0..1) of the peak number of active players. */
  minPeakShare: number;
  /** Share (0.5..1) of all player-owned village points a tribe must hold. */
  winShare: number;
  /** The tribe must keep the share (with every other condition) for this many days. */
  streakDays: number;
  /** A player counts as active when they played within this many days. */
  activeDays: number;
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
  /**
   * Build pointer: how far along its build order the village is (one per building it started, plus the ones it skipped). Named
   * growthSteps since the timer era; states saved then keep working (the pointer just carries on). See GAME_DESIGN.md section 8.
   */
  growthSteps: number;
  /** When the village became abandoned (informational; it no longer drives growth). */
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
  /**
   * Building levels whose Renown was already paid (docs/GAME_DESIGN.md section 18.2). Absent on old saved states:
   * `normalizeVillage` then fills in each building's start level (everything above it pays once). See renown.ts.
   */
  renownPaid?: BuildingLevels;
  /** Feast limit window: starts at the first Feast, resets after FEAST_WINDOW_HOURS / speed. See renown.ts. */
  feast?: { windowStart: number; count: number };
  /**
   * Defender Renown (renown.ts `collectDefenderRenown`): time it was last paid up to and the stationed defence at that time.
   * Absent on old saved states and abandoned villages; the first collection only sets it.
   */
  defenceMark?: { at: number; strength: number };
  /**
   * Present while the hearth is out (docs/GAME_DESIGN.md 18.2, hearth.ts): somebody struck this village and holds it.
   * Absent = lit. Only abandoned villages can be struck in step 2.
   */
  hearth?: HearthState;
  /** No Strike on this village before this time (set at a change of owner); raids are still allowed. Absent = no lock. */
  lockUntil?: number;
  /** No attack of any kind before this time (a newly founded village, a restarted player). Absent = none. */
  protectedUntil?: number;
}

/** The "hearth is out" state of a village (hearth.ts). */
export interface HearthState {
  status: 'out';
  /** Player id of the claimant (the occupiers' owner). */
  claimBy: number;
  /** When the hearth went out. */
  outAt: number;
  /** Hold time still to run, in ms (world speed already applied). */
  holdMs: number;
  /** Set while the clock runs (occupiers >= HOLD_MIN_POPULATION): the time `holdMs` was last brought up to date. null = paused. */
  runningSince: number | null;
  /** Set while the occupiers are under the minimum: since when. null = enough occupiers. */
  underSince: number | null;
}

export interface Coords {
  x: number;
  y: number;
}

export type Terrain = 'grass' | 'forest' | 'hills' | 'mountain' | 'lake';
export const TERRAINS: readonly Terrain[] = ['grass', 'forest', 'hills', 'mountain', 'lake'];

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
  /** Saved troop groups: the player already has the maximum (HTTP 409). */
  | 'group_limit'
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
  /** Deterministic luck: same seed, same result. The server mixes in a secret (see battleSeed), so nobody can predict it. */
  seed: number;
  /**
   * Luck to use instead of the seeded draw, clamped to +-BATTLE_LUCK. ONLY the client battle simulator sets it; the server never
   * does. The seed still drives everything else (random siege target), so the rest of the battle is unchanged.
   */
  fixedLuck?: number;
  /** True: nothing is looted even on a win (Strike attempts, relief attacks, map sites). Default false: loot is always full. */
  noLoot?: boolean;
  /**
   * Building the Boulder Slings were told to hit (a BuildingId, picked by the sender). Absent = random among the buildings that
   * can still drop, drawn from `seed`. Never checked against the village: the server must not reveal what a village has.
   */
  siegeTarget?: BuildingId | null;
}

/** One building a siege kind lowered (or tried to) after a won battle. `from === to` means nothing was there to hit or the points fell short. */
export interface SiegeHit {
  unit: UnitId;
  building: BuildingId;
  from: number;
  to: number;
  /** The sender picked no building, so the engine drew one. */
  random?: boolean;
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
  /**
   * Buildings lowered by siege units, in order (Log Ram first); [] when nobody sieged. The Log Ram hit runs from the pre-battle Wall
   * to the Wall after both steps (during + after); applies on a win and on a loss. Applied by applyBattleToDefender.
   */
  siege?: SiegeHit[];
  /** The Wall level the defence used in this battle (after the Log Rams' during-the-battle hit). */
  wallDuring: number;
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
