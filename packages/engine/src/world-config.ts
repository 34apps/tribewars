// Per-world rules (docs/GAME_DESIGN.md "Per-world settings", docs/MULTI_WORLD.md). One WorldConfig per world: written into the
// world's database when the world is created (defaults below, which equal the constants in config.ts), read by the engine through
// `worldRules(settings)`, published read-only at GET /api/world/config. Pure: no I/O. The server stores it and the admin tool edits it.
//
// How it reaches the rules: the server builds `WorldSettings` with `applyWorldConfig`, which sets the flat fields the engine always
// read (speed, npcDensity, protectionHours, domination) AND `settings.config` (the complete object). Engine code
// reads the flat fields where they exist and `worldRules(s)` for everything else. `WorldSettings` built by hand without `config`
// (tests, simulator) get the defaults, so nothing changes for them.

import {
  DEFAULT_WORLD,
  DOMINATION_DEFAULTS,
  DOMINATION_LIMITS,
  FOUND_PROTECTION_HOURS,
  HEARTH_PLAYERS_ENABLED,
  HOLD_FAIL_HOURS,
  HOLD_HOURS,
  FAIR_START,
  HOLD_HOURS_ABANDONED,
  MAX_BUILD_QUEUE,
  MAX_RESEARCH_QUEUE,
  MAX_TRAIN_QUEUE,
  NPC_BUILD_KEEP_SHARE,
  NPC_EXTRA_CHANCE,
  NPC_PER_NEWCOMER,
  NPC_RING_BASE,
  NPC_RING_EXTRA_CHANCE,
  NPC_START_RING_SCALE,
  NPC_MAX_LEVEL,
  NPC_START_GOLD_PER_TIER,
  NPC_START_RESOURCE_SHARE,
  RENOWN_VILLAGE_BASE,
  RENOWN_VILLAGE_GROWTH,
  RESTART_PROTECTION_HOURS,
  STRIKE_CHAIN_WINDOW_HOURS,
  STRIKE_LOCK_HOURS,
  TERRAIN_AMOUNT_DEFAULT,
  TRIBE_MAX_MEMBERS,
} from './config.ts';
import { mergeDominationSettings } from './domination.ts';
import type { CheckResult, DominationSettings, WorldSettings } from './types.ts';
import { fail } from './util.ts';

/** Bump when the shape changes in a way old stored objects cannot be read with `resolveWorldConfig`. */
export const WORLD_CONFIG_VERSION = 1;

export interface WorldConfig {
  version: number;
  pace: {
    /** Multiplies production and divides every duration (build, train, travel, protection, ...). 1 = normal pace. */
    speed: number;
    /** Extra multiplier on how fast troops and shipments walk, on top of `speed`. 1 = same as the world speed. */
    unitSpeed: number;
  };
  /** Hours at speed 1 (divided by the world speed). */
  protection: {
    /** A new player's first village cannot be attacked (and does not attack players) for this long. */
    beginnerHours: number;
    /** A founded village. */
    foundHours: number;
    /** A restart village after losing the last one. */
    restartHours: number;
  };
  /** Abandoned ("NPC") villages. */
  npc: {
    /** Abandoned villages per map tile at world creation (changing it later has no effect on a world that exists). */
    density: number;
    /** Abandoned villages build themselves up from their own stock (owner 2026-11-05). Off: they stay as created (tests, special worlds). */
    selfBuild: boolean;
    /** Share (0..0.9) of the storage cap an abandoned village keeps unspent of each resource it builds with (its reserve). */
    keepShare: number;
    /** Highest level an abandoned village builds to. */
    maxLevel: number;
    /** Share (0..1) of the storage cap that wood, food and iron start at. */
    startStockShare: number;
    /** Starting gold per tier. */
    startGoldPerTier: number;
    /** 'expanding' layout: abandoned villages every newcomer brings (0..8). Owner 2026-11-06: 2 on average. */
    perNewcomer: number;
    /** 'expanding' layout: chance (0..1) of one more per newcomer, rolled up to 3 times in a row. */
    extraChance: number;
    /** 'expanding' layout: scale (0..2) of the abandoned villages around the empty centre at world creation (1 = 8 + 14). */
    startRingScale: number;
  };
  terrain: {
    /** How much non-grass ground the map generator makes: 0 = flat grass only, 1 = the usual map, 1.5 = wilder. Fixed when the world is created. */
    amount: number;
  };
  /** Fair start: the open ground a new player's start spot (and a restart spot) needs. */
  start: {
    /** Radius in tiles of the square checked around the spot. */
    radius: number;
    /** At least this share of those tiles is buildable (not mountain or lake). */
    minOpenShare: number;
    /** At most this share is slow ground (forest, hills, mountain, lake). */
    maxSlowShare: number;
    /** Candidate spots tried before the best one found is taken (a registration never fails). */
    tries: number;
  };
  conquest: {
    /** Can player villages be struck and taken (abandoned villages always can). */
    playersCanBeConquered: boolean;
    /** Renown the 2nd village costs; the next costs `renownGrowth` times more each. */
    renownBase: number;
    renownGrowth: number;
    /** Chieftains of separate attacks on the same village count together if they arrive this close (hours at speed 1). */
    chainWindowHours: number;
    /** Hold clock after a Strike, hours at speed 1: player villages / abandoned villages. */
    holdHours: number;
    holdHoursAbandoned: number;
    /** A claim fails after the occupiers stay under the minimum this long (hours at speed 1). */
    holdFailHours: number;
    /** No new Strike on a village for this long after it changed owner (hours at speed 1). */
    lockHours: number;
  };
  /** Win condition (days at speed 1). Also kept in the flat `settings.domination`. */
  domination: DominationSettings;
  tribe: {
    maxMembers: number;
  };
  /** Optional rules. `morale`, `scavenging` and `paidSpeedups` are reserved: the flags exist and are published, the features are not built yet. */
  features: {
    /** Log Rams and Boulder Slings. Off: siege units cannot be trained and battles never lower buildings. */
    siege: boolean;
    /** Fire Shrines and the Great Fire on the map. Off: no sites are created or shown. */
    sites: boolean;
    morale: boolean;
    scavenging: boolean;
    paidSpeedups: boolean;
  };
  queues: {
    /** Build jobs per village. */
    build: number;
    /** Research jobs per village. */
    research: number;
    /** Training batches per building. */
    train: number;
  };
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  version: WORLD_CONFIG_VERSION,
  pace: { speed: DEFAULT_WORLD.speed, unitSpeed: 1 },
  protection: { beginnerHours: DEFAULT_WORLD.protectionHours, foundHours: FOUND_PROTECTION_HOURS, restartHours: RESTART_PROTECTION_HOURS },
  npc: {
    density: DEFAULT_WORLD.npcDensity,
    selfBuild: true,
    keepShare: NPC_BUILD_KEEP_SHARE,
    maxLevel: NPC_MAX_LEVEL,
    startStockShare: NPC_START_RESOURCE_SHARE,
    startGoldPerTier: NPC_START_GOLD_PER_TIER,
    perNewcomer: NPC_PER_NEWCOMER,
    extraChance: NPC_EXTRA_CHANCE,
    startRingScale: NPC_START_RING_SCALE,
  },
  terrain: { amount: TERRAIN_AMOUNT_DEFAULT },
  start: { radius: FAIR_START.radius, minOpenShare: FAIR_START.minOpenShare, maxSlowShare: FAIR_START.maxSlowShare, tries: FAIR_START.tries },
  conquest: {
    playersCanBeConquered: HEARTH_PLAYERS_ENABLED,
    renownBase: RENOWN_VILLAGE_BASE,
    renownGrowth: RENOWN_VILLAGE_GROWTH,
    chainWindowHours: STRIKE_CHAIN_WINDOW_HOURS,
    holdHours: HOLD_HOURS,
    holdHoursAbandoned: HOLD_HOURS_ABANDONED,
    holdFailHours: HOLD_FAIL_HOURS,
    lockHours: STRIKE_LOCK_HOURS,
  },
  domination: DOMINATION_DEFAULTS,
  tribe: { maxMembers: TRIBE_MAX_MEMBERS },
  features: { siege: true, sites: true, morale: false, scavenging: false, paidSpeedups: false },
  queues: { build: MAX_BUILD_QUEUE, research: MAX_RESEARCH_QUEUE, train: MAX_TRAIN_QUEUE },
};

export type ConfigUnit = 'x' | 'hours' | 'days' | 'tiles' | 'count' | 'share' | 'renown' | 'flag' | 'level';

/** One editable setting: its dotted path, range, and the words the "World rules" page and the admin tool use. */
export interface WorldConfigField {
  path: string;
  group: 'pace' | 'protection' | 'npc' | 'terrain' | 'start' | 'conquest' | 'domination' | 'tribe' | 'features' | 'queues';
  label: string;
  unit: ConfigUnit;
  kind: 'number' | 'boolean';
  min: number;
  max: number;
  integer: boolean;
  /** One plain sentence for players. */
  help: string;
}

const num = (path: string, group: WorldConfigField['group'], label: string, unit: ConfigUnit, min: number, max: number, integer: boolean, help: string): WorldConfigField => ({
  path,
  group,
  label,
  unit,
  kind: 'number',
  min,
  max,
  integer,
  help,
});
const flag = (path: string, label: string, help: string, group: WorldConfigField['group'] = 'features'): WorldConfigField => ({ path, group, label, unit: 'flag', kind: 'boolean', min: 0, max: 1, integer: false, help });
const dom = (key: keyof DominationSettings, label: string, unit: ConfigUnit, help: string): WorldConfigField =>
  num(`domination.${key}`, 'domination', label, unit, DOMINATION_LIMITS[key].min, DOMINATION_LIMITS[key].max, DOMINATION_LIMITS[key].integer, help);

/** Every setting, in display order. The single source for validation (`checkWorldConfigValue`), the admin tool and the web page. */
export const WORLD_CONFIG_FIELDS: readonly WorldConfigField[] = [
  num('pace.speed', 'pace', 'World speed', 'x', 0.01, 10_000, false, 'Scales production and waiting times.'),
  num('pace.unitSpeed', 'pace', 'Unit speed', 'x', 0.1, 100, false, 'Extra march and shipment speed.'),
  num('protection.beginnerHours', 'protection', 'Beginner protection', 'hours', 0, 720, false, 'New villages are safe this long.'),
  num('protection.foundHours', 'protection', 'Protection of a founded village', 'hours', 0, 720, false, 'Founded villages are safe this long.'),
  num('protection.restartHours', 'protection', 'Protection after a restart', 'hours', 0, 720, false, 'Safe time for a restart village.'),
  num('npc.density', 'npc', 'Abandoned-village density', 'share', 0, 0.2, false, 'Abandoned villages per tile at start.'),
  flag('npc.selfBuild', 'Abandoned villages build', 'They spend stock on building levels.', 'npc'),
  num('npc.keepShare', 'npc', 'Abandoned-village reserve', 'share', 0, 0.9, false, 'Storage share kept unspent when building.'),
  num('npc.maxLevel', 'npc', 'Abandoned-village top level', 'level', 1, 30, true, 'Highest building level they reach.'),
  num('npc.startStockShare', 'npc', 'Abandoned-village start stock', 'share', 0, 1, false, 'Starting stock, share of storage cap.'),
  num('npc.startGoldPerTier', 'npc', 'Abandoned-village start gold', 'count', 0, 10_000, true, 'Starting gold per tier.'),
  num('npc.perNewcomer', 'npc', 'Abandoned villages per new player', 'count', 0, 8, true, 'Abandoned villages each newcomer adds.'),
  num('npc.extraChance', 'npc', 'Chance of an extra abandoned village', 'share', 0, 1, false, 'Chance of one more (up to 3 rolls).'),
  num('npc.startRingScale', 'npc', 'Abandoned villages at the start', 'x', 0, 2, false, 'Start ring size (1 = 22 villages).'),
  num('terrain.amount', 'terrain', 'Amount of rough terrain', 'x', 0, 1.5, false, '0 flat, 1 usual, 1.5 wilder.'),
  num('start.radius', 'start', 'Fair start: radius', 'tiles', 1, 8, true, 'Tiles checked around a start spot.'),
  num('start.minOpenShare', 'start', 'Fair start: open ground', 'share', 0, 1, false, 'Minimum buildable share nearby.'),
  num('start.maxSlowShare', 'start', 'Fair start: slow ground', 'share', 0, 1, false, 'Maximum slow-ground share nearby.'),
  num('start.tries', 'start', 'Fair start: tries', 'count', 1, 500, true, 'Spots tried before taking the best.'),
  flag('conquest.playersCanBeConquered', 'Player villages can be taken', 'Off: only abandoned villages.', 'conquest'),
  num('conquest.renownBase', 'conquest', 'Renown for the 2nd village', 'renown', 1, 1_000_000, true, 'Price of the 2nd village.'),
  num('conquest.renownGrowth', 'conquest', 'Renown price growth per village', 'x', 1, 5, false, 'Price multiplier per extra village.'),
  num('conquest.chainWindowHours', 'conquest', 'Chieftain chain window', 'hours', 0, 48, false, 'Chieftains arriving this close count together.'),
  num('conquest.holdHours', 'conquest', 'Hold time, player village', 'hours', 0.1, 168, false, 'Hold needed after a Strike.'),
  num('conquest.holdHoursAbandoned', 'conquest', 'Hold time, abandoned village', 'hours', 0.1, 168, false, 'Same, abandoned village.'),
  num('conquest.holdFailHours', 'conquest', 'Hold failure time', 'hours', 0.1, 72, false, 'Claim fails after this long under minimum.'),
  num('conquest.lockHours', 'conquest', 'Lock after a change of owner', 'hours', 0, 720, false, 'No Strike this long after a change.'),
  dom('minAgeDays', 'World age before a win', 'days', 'Earliest day a tribe can win.'),
  dom('minActivePlayers', 'Active players needed', 'count', 'Fewest active players to win.'),
  dom('minPeakShare', 'Share of the peak', 'share', 'Active players as share of peak.'),
  dom('winShare', 'Share of the world to win', 'share', 'Village points a tribe must hold.'),
  dom('streakDays', 'Days to hold the share', 'days', 'Days the share must be kept.'),
  dom('activeDays', 'Activity window', 'days', 'Played within this many days.'),
  num('tribe.maxMembers', 'tribe', 'Tribe size limit', 'count', 1, 200, true, 'Most members in one tribe.'),
  flag('features.siege', 'Siege (Log Rams, Boulder Slings)', 'Siege can lower Wall and buildings.'),
  flag('features.sites', 'Fire Shrines and the Great Fire', 'Bonus sites on the map.'),
  flag('features.morale', 'Morale', 'Reserved: not built yet.'),
  flag('features.scavenging', 'Scavenging', 'Reserved: not built yet.'),
  flag('features.paidSpeedups', 'Paid speed-ups', 'Reserved: not built yet.'),
  num('queues.build', 'queues', 'Build queue', 'count', 1, 10, true, 'Build jobs per village.'),
  num('queues.research', 'queues', 'Research queue', 'count', 1, 10, true, 'Research jobs per village.'),
  num('queues.train', 'queues', 'Training queue', 'count', 1, 20, true, 'Training batches per building.'),
];

const FIELD_BY_PATH = new Map(WORLD_CONFIG_FIELDS.map((f) => [f.path, f]));
export const WORLD_CONFIG_PATHS: readonly string[] = WORLD_CONFIG_FIELDS.map((f) => f.path);

export const isWorldConfigPath = (p: unknown): p is string => typeof p === 'string' && FIELD_BY_PATH.has(p);
export const worldConfigField = (path: string): WorldConfigField | undefined => FIELD_BY_PATH.get(path);

/**
 * What the operator may still change after the world has opened (it never breaks running games): the win condition, the tribe
 * size, and the reserved feature flags. Everything else (speeds, protection, conquest, abandoned villages, siege, sites,
 * queues) is fixed when the world opens. Each change is audit-logged.
 */
export const WORLD_CONFIG_SAFE_AFTER_OPEN: readonly string[] = ['tribe.maxMembers', 'features.scavenging', 'features.paidSpeedups'];

export function isSafeAfterOpen(path: string): boolean {
  return path.startsWith('domination.') || WORLD_CONFIG_SAFE_AFTER_OPEN.includes(path);
}

/** One value checked against its range. Booleans must be `true`/`false`, numbers finite and in range (whole when required). */
export function checkWorldConfigValue(path: string, value: unknown): CheckResult<{ value: number | boolean }> {
  const f = FIELD_BY_PATH.get(path);
  if (!f) return fail('invalid_input', `Unknown setting "${path}".`);
  if (f.kind === 'boolean') {
    return typeof value === 'boolean' ? { ok: true, value } : fail('invalid_input', `${path} must be true or false.`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('invalid_input', `${path} must be a number.`);
  if (value < f.min || value > f.max) return fail('invalid_input', `${path} must be between ${f.min} and ${f.max}.`);
  if (f.integer && !Number.isInteger(value)) return fail('invalid_input', `${path} must be a whole number.`);
  return { ok: true, value };
}

/** Text from the command line ("12", "0.5", "true", "off") -> a value for the setting, checked. */
export function parseWorldConfigInput(path: string, text: string): CheckResult<{ value: number | boolean }> {
  const f = FIELD_BY_PATH.get(path);
  if (!f) return fail('invalid_input', `Unknown setting "${path}".`);
  const t = text.trim().toLowerCase();
  if (f.kind === 'boolean') {
    if (['true', 'on', 'yes', '1'].includes(t)) return { ok: true, value: true };
    if (['false', 'off', 'no', '0'].includes(t)) return { ok: true, value: false };
    return fail('invalid_input', `${path} must be on or off.`);
  }
  if (t === '') return fail('invalid_input', `${path} needs a number.`);
  return checkWorldConfigValue(path, Number(t));
}

type Bag = Record<string, Record<string, unknown>>;

export function getWorldConfigValue(config: WorldConfig, path: string): number | boolean | undefined {
  const [group, key] = path.split('.');
  const v = (config as unknown as Bag)[group ?? '']?.[key ?? ''];
  return typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
}

/** A copy of `config` with one setting changed (not range-checked: call `checkWorldConfigValue` first). */
export function setWorldConfigValue(config: WorldConfig, path: string, value: number | boolean): WorldConfig {
  const [group, key] = path.split('.');
  const copy = structuredClone(config) as unknown as Bag;
  if (group && key && copy[group]) copy[group][key] = value;
  return copy as unknown as WorldConfig;
}

/** A fresh copy of the defaults. */
export const defaultWorldConfig = (): WorldConfig => structuredClone(DEFAULT_WORLD_CONFIG);

/**
 * Stored or given settings (possibly missing, partial or damaged) -> a complete valid config. A missing or out-of-range value
 * falls back to `base` (the defaults unless given), so a config written by an older version simply gets today's value for
 * settings added later.
 */
export function resolveWorldConfig(raw: unknown, base: WorldConfig = DEFAULT_WORLD_CONFIG): WorldConfig {
  let out = structuredClone(base);
  const src = typeof raw === 'object' && raw !== null ? (raw as Bag) : {};
  for (const f of WORLD_CONFIG_FIELDS) {
    const [group, key] = f.path.split('.');
    const v = src[group ?? '']?.[key ?? ''];
    if (v !== undefined && checkWorldConfigValue(f.path, v).ok) out = setWorldConfigValue(out, f.path, v as number | boolean);
  }
  out.version = WORLD_CONFIG_VERSION;
  out.domination = mergeDominationSettings(out.domination);
  return out;
}

/** Same, but reports the first bad value instead of ignoring it (for the operator's input at world creation). */
export function checkWorldConfigInput(raw: unknown): CheckResult<{ config: WorldConfig }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('invalid_input', 'The world configuration must be an object.');
  const src = raw as Bag;
  for (const [group, bag] of Object.entries(src)) {
    if (group === 'version') continue;
    if (typeof bag !== 'object' || bag === null) return fail('invalid_input', `Unknown setting "${group}".`);
    for (const [key, v] of Object.entries(bag)) {
      const r = checkWorldConfigValue(`${group}.${key}`, v);
      if (!r.ok) return r;
    }
  }
  return { ok: true, config: resolveWorldConfig(raw) };
}

/** The config of a world that has none stored (created before per-world settings): defaults, with what the flat settings already said. */
export function worldConfigFromSettings(s: Partial<WorldSettings>): WorldConfig {
  const c = defaultWorldConfig();
  if (typeof s.speed === 'number') c.pace.speed = s.speed;
  if (typeof s.npcDensity === 'number') c.npc.density = s.npcDensity;
  if (typeof s.protectionHours === 'number') c.protection.beginnerHours = s.protectionHours;
  c.domination = mergeDominationSettings(s.domination);
  return c;
}

/**
 * Worlds that already exist keep the abandoned-village numbers and the map they were created with (owner 2026-11-06): a stored
 * config without these settings (or no stored config) reads them as below instead of the new defaults. New worlds store every value.
 */
export function withLegacyPlacement(config: WorldConfig): WorldConfig {
  const c = structuredClone(config);
  c.npc.perNewcomer = NPC_RING_BASE;
  c.npc.extraChance = NPC_RING_EXTRA_CHANCE;
  c.npc.startRingScale = 1;
  c.terrain.amount = 1;
  return c;
}

/** The settings the engine runs on: the flat fields it always read, set from the config, plus the config itself. */
export function applyWorldConfig(settings: WorldSettings, config: WorldConfig): WorldSettings {
  return {
    ...settings,
    speed: config.pace.speed,
    npcDensity: config.npc.density,
    protectionHours: config.protection.beginnerHours,
    domination: { ...config.domination },
    config,
  };
}

/** The flat part of the settings as stored in `world_settings` (no `config`: that is stored on its own). */
export function flatSettings(s: WorldSettings): WorldSettings {
  const { config: _config, ...rest } = s;
  return rest;
}

/** The rules of this world. Settings without a config (tests, simulator, old callers) run on the defaults. */
export const worldRules = (s: Pick<WorldSettings, 'config'> | undefined | null): WorldConfig => s?.config ?? DEFAULT_WORLD_CONFIG;

/** Speed for troops and shipments walking: world speed times unit speed. */
export const moveSpeed = (s: Pick<WorldSettings, 'speed' | 'config'>): number => s.speed * worldRules(s).pace.unitSpeed;
