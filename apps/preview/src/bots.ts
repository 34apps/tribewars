// Computer players for the preview, so tribe features can be tried alone and the world grows with the human. Isolated on
// purpose:
//  - seedBots(): on a fresh world, 11 bot players in 3 bot tribes (made with the real TribeService, so they appear in the
//    ranking, map and tribe finder like anyone else). Ember Wardens (EMBR) is the human's home tribe: five bots of different
//    styles, one of them a newcomer who starts from zero like the human, and it sends the human an invitation;
//  - growth: every bot plays through the REAL services (build, train, research, Feast, War Chest, Chieftain, found) on a
//    cadence of ~20 game minutes per bot (staggered), following the build order of its style (copied from the balance
//    simulator, scripts/sim/balance.ts). Nothing is restocked: seeded villages start with an army and stores once;
//  - botTick(): reacts to the human with the real services (accept applications, answer diplomacy proposals, welcome
//    newcomers, invite a tribeless human) and keeps the map moving: raids and scouting missions on abandoned villages, an
//    attack by a rival tribe's bot on a bot village of the human's tribe every so often (so tribe alerts and "Send support"
//    can be tried), and a rare raid on the human's own village once protection is over, sized to the human's strength (a challenge,
//    never a wipe). Armies are sized with the real battle rules (a preview with the worst luck), so they grow with the bot.
// World-activity timers were tuned for a speed-25 world; they scale with the world speed (value * 25 / speed), reactions to
// the human stay short. Reactions are driven by timestamps already in the database, so they survive a page reload.

import {
  BATTLE_LUCK,
  BUILDINGS,
  BUILDING_IDS,
  FEAST_MAX_COUNT,
  RESOURCE_IDS,
  UNITS,
  UNIT_IDS,
  POP_PER_UNIT,
  buildingCost,
  canAfford,
  chestVillageCost,
  checkBuild,
  checkFeast,
  checkFoundTarget,
  checkResearch,
  checkTrain,
  createPlayerVillage,
  emptyResources,
  emptyUnits,
  feastPrice,
  findSpawnLocation,
  mulberry32,
  populationCap,
  populationUsage,
  protectionEndsAt,
  resolveBattle,
  settleVillage,
  storageCap,
  storageCapForLevel,
  travelTimeMs,
  villagePoints,
  villageRenownCost,
  worldRules,
} from '@clanfire/engine';
import type { BuildingId, ChieftainId, Mission, Recruitment, Resources, UnitId, Units, VillageState } from '@clanfire/engine';
import type { AppContext } from '../../server/src/context.ts';
import type { PlayerRow, VillageRecord } from '../../server/src/store.ts';

type StyleName = 'builder' | 'raider' | 'turtle' | 'balanced';

interface BotPlan {
  name: string;
  /** Town Hall level; the rest of the village is derived from it. */
  level: number;
  tribe: 'EMBR' | 'ASH' | 'MIST';
  role: 'leader' | 'officer' | 'member';
  /** Pathfinders this village keeps at home (only with Stables 1). They defend against enemy scouts and scout abandoned villages. */
  scouts?: number;
  /** Fixed portrait (CHIEFTAINS id), so the preview shows variety. */
  chieftain: ChieftainId;
  /** Build order, army mix and research this bot plays (STYLE_DEFS). */
  style: StyleName;
}

interface TribePlan {
  tag: 'EMBR' | 'ASH' | 'MIST';
  name: string;
  recruitment: Recruitment;
  description: string;
  chat: Array<[botIndexInTribe: number, text: string]>;
}

const TRIBES: TribePlan[] = [
  {
    tag: 'EMBR',
    name: 'Ember Wardens',
    recruitment: 'open',
    description: 'Farmers and defenders who keep the fires lit. Everyone is welcome, no activity pressure. We help new villages grow.',
    chat: [
      [0, 'Morning all. Lumber camps first, walls second, that is my advice for newcomers.'],
      [1, 'Raided an abandoned village near the lake today, nice haul of iron.'],
      [2, 'Anyone need a hand with their farm? Food is the real limit on troops.'],
    ],
  },
  {
    tag: 'ASH',
    name: 'Ashen Legion',
    recruitment: 'application',
    description: 'Raiders with a plan. We farm the abandoned villages in rotation and keep our borders quiet. Tell us why you want to join.',
    chat: [
      [0, 'Rotation reminder: do not hit the same abandoned village twice in an hour, it only grows back slowly.'],
      [1, 'Elk Riders carry 75 each. Worth the stables for the big villages.'],
      [2, 'Our alliance slots are still open if another tribe wants to talk.'],
    ],
  },
  {
    tag: 'MIST',
    name: 'Mist Rangers',
    recruitment: 'open',
    description: 'A small, friendly band from the misty hills. Open door: come in, say hello, grow with us.',
    chat: [
      [0, 'Quiet day in the hills. Good time to upgrade the storehouse.'],
      [1, 'Welcome to anyone passing through. Ask us anything.'],
    ],
  },
];

const BOTS: BotPlan[] = [
  // Home tribe of the human: a builder leader, a balanced officer, a raider, a turtle and a newcomer who starts from zero.
  { name: 'Brannoch', level: 13, tribe: 'EMBR', role: 'leader', scouts: 6, chieftain: 'brannoc', style: 'builder' },
  { name: 'Ysolde_K', level: 6, tribe: 'EMBR', role: 'officer', chieftain: 'ysra', style: 'balanced' },
  { name: 'Ironhart', level: 4, tribe: 'EMBR', role: 'member', chieftain: 'hild', style: 'raider' },
  { name: 'Hedda_Stone', level: 5, tribe: 'EMBR', role: 'member', chieftain: 'barley-tam', style: 'turtle' },
  { name: 'Pip_Newleaf', level: 0, tribe: 'EMBR', role: 'member', chieftain: 'wren', style: 'balanced' },
  { name: 'Tolvek', level: 10, tribe: 'ASH', role: 'leader', scouts: 8, chieftain: 'corwen', style: 'raider' },
  { name: 'Grimwald', level: 7, tribe: 'ASH', role: 'officer', scouts: 3, chieftain: 'old-orm', style: 'raider' },
  { name: 'Odalys', level: 5, tribe: 'ASH', role: 'member', chieftain: 'saffi', style: 'balanced' },
  { name: 'Mira_of_Vale', level: 6, tribe: 'MIST', role: 'leader', scouts: 2, chieftain: 'maelis', style: 'builder' },
  { name: 'Sable', level: 3, tribe: 'MIST', role: 'member', chieftain: 'khorza', style: 'turtle' },
];

// ---- Styles (simplified copy of STYLE_DEFS in scripts/sim/balance.ts; that file reads the disk, so it is not imported) ----

type Step = [BuildingId, number];
interface StyleDef {
  /** Strict priority list: the first entry below its target level is built next (waits for resources). */
  order: Step[];
  /** After the list: always raise the lowest of these. */
  tail: BuildingId[];
  /** Units to train; weights say how many of each per 100. */
  army: Array<{ unit: UnitId; weight: number }>;
  /** Share of the next building's cost kept back from training (0 = army first, 1 = building first). */
  reserve: number;
  /** Do not train before this day of the bot's life (unless its Town Hall is already 5+). */
  trainFromDay: number;
  research: UnitId[];
}

const ECO: Step[] = [['lumber', 4], ['farm', 4], ['longhouse', 4], ['mine', 4], ['storehouse', 3]];

const STYLE_DEFS: Record<StyleName, StyleDef> = {
  builder: {
    order: [
      ...ECO, ['hall', 3], ['lumber', 8], ['farm', 8], ['longhouse', 8], ['mine', 8], ['storehouse', 7], ['barracks', 1], ['vault', 2], ['hall', 5],
      ['goldmine', 3], ['lumber', 12], ['farm', 12], ['longhouse', 12], ['mine', 12], ['storehouse', 11], ['hall', 8], ['wall', 3], ['market', 3],
      ['barracks', 3], ['hall', 10], ['drillyard', 3], ['bannerhall', 1], ['stables', 1], ['goldmine', 8], ['lumber', 16],
      ['farm', 16], ['longhouse', 16], ['mine', 16], ['storehouse', 15], ['hall', 12], ['drillyard', 6], ['stables', 5], ['bannerhall', 2],
      ['wall', 10], ['vault', 8], ['market', 8], ['barracks', 8], ['drillyard', 9], ['stables', 8], ['bannerhall', 4],
    ],
    tail: ['lumber', 'farm', 'longhouse', 'mine', 'storehouse', 'hall', 'goldmine', 'bannerhall'],
    army: [{ unit: 'pikeman', weight: 78 }, { unit: 'guard', weight: 10 }, { unit: 'hearthwarden', weight: 7 }, { unit: 'knight', weight: 5 }],
    reserve: 1,
    trainFromDay: 4,
    research: ['guard', 'hearthwarden', 'knight'],
  },
  raider: {
    order: [
      ['lumber', 2], ['farm', 3], ['longhouse', 3], ['hall', 2], ['barracks', 2], ['mine', 3], ['storehouse', 3], ['farm', 5], ['longhouse', 5], ['lumber', 4],
      ['mine', 5], ['barracks', 4], ['farm', 7], ['longhouse', 7], ['storehouse', 5], ['hall', 5], ['lumber', 6], ['mine', 7], ['farm', 9], ['longhouse', 9],
      ['stables', 1], ['goldmine', 3], ['market', 2], ['hall', 7], ['drillyard', 2], ['storehouse', 6], ['bannerhall', 1], ['barracks', 6], ['wrightyard', 1],
      ['storehouse', 8], ['lumber', 8], ['mine', 9], ['farm', 11], ['longhouse', 11], ['hall', 8], ['market', 3], ['barracks', 8], ['goldmine', 6],
      ['lumber', 10], ['mine', 11], ['farm', 13], ['longhouse', 13], ['storehouse', 11], ['hall', 10],
    ],
    tail: ['farm', 'longhouse', 'lumber', 'mine', 'storehouse', 'barracks', 'hall'],
    army: [{ unit: 'raider', weight: 69 }, { unit: 'outrider', weight: 15 }, { unit: 'pikeman', weight: 10 }, { unit: 'pathfinder', weight: 3 }, { unit: 'logram', weight: 3 }],
    reserve: 0.8,
    trainFromDay: 2,
    research: ['outrider', 'logram'],
  },
  turtle: {
    order: [
      ['lumber', 3], ['farm', 4], ['longhouse', 4], ['hall', 2], ['barracks', 1], ['wall', 2], ['mine', 3], ['storehouse', 3], ['vault', 3],
      ['hall', 3], ['barracks', 3], ['wall', 5], ['farm', 6], ['longhouse', 6], ['lumber', 5], ['mine', 5], ['storehouse', 5], ['hall', 5],
      ['drillyard', 1], ['goldmine', 3], ['market', 2], ['hall', 7], ['storehouse', 6], ['drillyard', 2], ['bannerhall', 1], ['wall', 8],
      ['vault', 5], ['farm', 9], ['longhouse', 9], ['lumber', 8], ['mine', 8], ['storehouse', 8], ['hall', 8], ['market', 3], ['drillyard', 4], ['stables', 4],
      ['lumber', 11], ['farm', 12], ['longhouse', 12], ['mine', 11], ['storehouse', 11], ['hall', 10], ['wall', 12], ['wall', 15], ['vault', 8],
    ],
    tail: ['wall', 'farm', 'longhouse', 'lumber', 'mine', 'storehouse', 'hall'],
    army: [{ unit: 'pikeman', weight: 50 }, { unit: 'guard', weight: 38 }, { unit: 'hearthwarden', weight: 7 }, { unit: 'pathfinder', weight: 5 }],
    reserve: 0.9,
    trainFromDay: 2,
    research: ['guard', 'hearthwarden'],
  },
  balanced: {
    order: [
      ['lumber', 3], ['farm', 4], ['longhouse', 4], ['mine', 3], ['hall', 2], ['barracks', 2], ['storehouse', 3], ['lumber', 5], ['farm', 6], ['longhouse', 6],
      ['mine', 5], ['wall', 2], ['hall', 3], ['barracks', 3], ['vault', 2], ['storehouse', 5], ['farm', 8], ['longhouse', 8], ['lumber', 7],
      ['mine', 7], ['hall', 5], ['stables', 1], ['drillyard', 1], ['wall', 5], ['goldmine', 2], ['farm', 10], ['longhouse', 10], ['lumber', 9],
      ['mine', 9], ['storehouse', 8], ['market', 3], ['hall', 8], ['drillyard', 3], ['barracks', 5], ['stables', 3], ['farm', 12], ['longhouse', 12],
      ['lumber', 11], ['mine', 11], ['storehouse', 11], ['hall', 10], ['bannerhall', 1], ['goldmine', 5],
    ],
    tail: ['farm', 'longhouse', 'lumber', 'mine', 'storehouse', 'wall', 'hall'],
    army: [{ unit: 'raider', weight: 40 }, { unit: 'pikeman', weight: 40 }, { unit: 'outrider', weight: 10 }, { unit: 'guard', weight: 10 }],
    reserve: 0.8,
    trainFromDay: 1.5,
    research: ['guard', 'outrider'],
  },
};

// ---- Timers -------------------------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Reactions to the human stay short and are never scaled with the world speed. */
const ACCEPT_APPLICATION_AFTER_MS = 20_000;
const WELCOME_AFTER_MS = 3_000;
const INVITE_AFTER_MS = 30_000;
const WAR_CHECK_EVERY_MS = 5_000;
/** World activity below is written for a speed-25 world (the old preview) and scaled by 25 / speed (identical at speed 25). */
const TUNED_FOR_SPEED = 25;
const FIRST_RAID_MS = 75_000;
const RAID_EVERY_MS = 150_000;
const FIRST_SCOUT_MS = 40_000;
const SCOUT_EVERY_MS = 110_000;
/** First rival-tribe attack on the human's tribe-mates comes this long after the human joins a tribe with bot members. */
const FIRST_TRIBE_ATTACK_MS = 50_000;
// Attacks are real now (sized to win), so they come rarely: about every 8 game hours at speed 1, and the tribe's bots take turns being the target.
const TRIBE_ATTACK_EVERY_MS = 20 * MINUTE;
/** A bot raid on the human's own village: only after protection, never more often than this, sized to the human (humanRaidSize). */
const HUMAN_RAID_AFTER_PROTECTION_MS = 5 * MINUTE;
const HUMAN_RAID_EVERY_MS = 30 * MINUTE; // about every 12 game hours at speed 1
/** Raid on the human: at least this many raiders; otherwise points / HUMAN_RAID_POINTS_PER_RAIDER_FLOOR, never above points / ..._CAP and never above RAID_STRENGTH_SHARE of his defence. */
const HUMAN_RAID_MIN_RAIDERS = 6;
const HUMAN_RAID_POINTS_PER_RAIDER_FLOOR = 60;
const HUMAN_RAID_POINTS_PER_RAIDER_CAP = 20;
const HUMAN_RAID_DEFENCE_SHARE = 0.6;
/** Armies on abandoned villages: attack must beat the garrison by this factor in the worst luck, using at most this share of the units at home. */
const RAID_MARGIN = 2.2;
const RAID_MAX_SHARE = 0.7;
const RAID_MIN_UNITS = 5;
/** Tribe attacks on a bot village: a real fight (the attacker must still win by this factor), up to this share of its offence. */
const TRIBE_ATTACK_MARGIN = 1.4;
const TRIBE_ATTACK_MAX_SHARE = 0.85;
const TRIBE_ATTACK_MIN_UNITS = 10;
/** Units a bot attacks with. */
const OFFENCE_UNITS: readonly UnitId[] = ['outrider', 'raider'];
/** Troops may take at most this share of a village's population room (the rest stays free for buildings): while the style's build order still has steps / after it. */
const POP_TROOP_SHARE_BUILDING = 0.8;
const POP_TROOP_SHARE_DONE = 0.92;
/** A Feast only empties a storehouse that is filling up: it starts at this share of the cap and never takes a resource below the floor (troops need food, iron and wood). */
const FEAST_TRIGGER_SHARE = 0.6;
const FEAST_FLOOR_SHARE = 0.15;
/** One training batch: up to this many units per level of the training building (plus the base). */
const TRAIN_BATCH_BASE = 40;
const TRAIN_BATCH_PER_LEVEL = 12;
const MIN_WARNING_MS = 90_000;
const IDEAL_TRAVEL_MS = 5 * MINUTE;
/** Each bot plays one growth step this often (game time, not scaled: the villages themselves run at the world's speed). */
const GROW_EVERY_MS = 20 * MINUTE;
/** A bot says at most one thing in tribe chat per this long. */
const CHAT_COOLDOWN_MS = 3 * HOUR;
/** Bump when bots change in a way that existing saved worlds need to catch up with (see upgradeBots). 3 = growing bots, five EMBR bots, styles; 4 = no dead ends (population reserve, gold, endless build list), real-sized armies. */
const BOT_VERSION = 4;

/** A world-activity duration for this world's speed. */
const scaled = (ctx: AppContext, ms: number): number => (ms * TUNED_FOR_SPEED) / Math.max(1e-6, ctx.settings.speed);

const META_KEY = 'preview_bots';

interface BotMeta {
  /** playerId -> tribe tag */
  bots: Record<string, string>;
  /** tribe tag -> tribe id */
  tribes: Record<string, number>;
  /** Absent in worlds saved before warfare (version 1). */
  v?: number;
}

function loadMeta(ctx: AppContext): BotMeta | null {
  const raw = ctx.store.getMeta(META_KEY);
  return raw ? (JSON.parse(raw) as BotMeta) : null;
}

/** A bot village sized by Town Hall level, built directly as state (no waiting for construction). Level 0 = a normal new village. */
function botVillage(level: number, t: number): VillageState {
  const v = createPlayerVillage(t);
  if (level <= 0) return v;
  const set = (b: BuildingId, lvl: number): void => {
    v.buildings[b] = Math.max(0, Math.min(lvl, BUILDINGS[b].maxLevel));
  };
  set('hall', level);
  set('lumber', level + 1);
  set('farm', level + 2);
  set('longhouse', level + 2);
  set('mine', level);
  set('storehouse', level);
  set('barracks', level >= 2 ? Math.max(1, level - 3) : 0);
  set('wall', v.buildings.barracks >= 1 ? Math.max(0, level - 4) : 0);
  set('vault', level >= 2 ? Math.max(0, level - 4) : 0);
  set('goldmine', level >= 3 ? level - 3 : 0);
  set('stables', level >= 5 && v.buildings.barracks >= 3 ? level - 4 : 0);
  if (level >= 8) {
    // The big villages start with a Banner Hall (its requirements: Town Hall 7, Drillyard 2, Market 2, Storehouse 6).
    set('drillyard', 2);
    set('market', 2);
    set('bannerhall', level >= 10 ? 4 : 1);
  }
  return v;
}

/** One-time starting army and stores of a seeded village (afterwards the bot earns everything through the real rules). */
function startingStock(v: VillageState, scouts = 0): void {
  const level = v.buildings.hall;
  const want: Partial<Units> = {};
  for (const u of UNIT_IDS) {
    const def = UNITS[u];
    const ok = (Object.keys(def.requires) as BuildingId[]).every((b) => v.buildings[b] >= (def.requires[b] ?? 0));
    if (!ok) continue;
    want[u] =
      u === 'raider' ? level * 8 : u === 'pikeman' ? level * 6 : u === 'guard' ? level * 3 : u === 'outrider' ? level * 2 : u === 'hearthwarden' ? level : u === 'pathfinder' ? scouts : 0;
  }
  for (const u of UNIT_IDS) v.troops[u] = Math.max(v.troops[u], want[u] ?? 0);
  const cap = storageCapForLevel(v.buildings.storehouse);
  v.resources.wood = Math.max(v.resources.wood, cap * 0.6);
  v.resources.food = Math.max(v.resources.food, cap * 0.6);
  v.resources.iron = Math.max(v.resources.iron, cap * 0.6);
}

/** Insert one bot player and its village. A newcomer (level 0) gets the same beginner protection as a human. */
function createBot(ctx: AppContext, plan: BotPlan, rng: () => number, t: number): PlayerRow {
  const { store, settings } = ctx;
  // Bots cannot sign in: "bot" is not a valid password hash, so verifyPassword always refuses it.
  const id = store.insertPlayer(plan.name, 'bot', t, plan.level <= 0 ? protectionEndsAt(t, settings) : 0, plan.chieftain);
  const spot = findSpawnLocation((x, y) => store.villageExistsAt(x, y), rng, settings);
  const state = botVillage(plan.level, t);
  if (plan.level > 0) startingStock(state, plan.scouts);
  store.insertVillage(id, `${plan.name}'s village`, spot.x, spot.y, villagePoints(state), state);
  const row = store.getPlayer(id);
  if (!row) throw new Error('bot vanished after insert');
  return row;
}

export function seedBots(ctx: AppContext): void {
  if (loadMeta(ctx)) return;
  resetBotState();
  const { store, tribes, settings } = ctx;
  const t = ctx.now();
  const rng = mulberry32(settings.seed ^ 0x5bd1e995);
  const meta: BotMeta = { bots: {}, tribes: {}, v: BOT_VERSION };
  const rows = new Map<string, PlayerRow>();

  store.tx(() => {
    for (const bot of BOTS) {
      const row = createBot(ctx, bot, rng, t);
      rows.set(bot.name, row);
      meta.bots[String(row.id)] = bot.tribe;
    }
  });

  for (const plan of TRIBES) {
    const members = BOTS.filter((b) => b.tribe === plan.tag);
    const leader = rows.get(members.find((m) => m.role === 'leader')?.name ?? '');
    if (!leader) throw new Error(`tribe ${plan.tag} has no leader`);
    // Found as open so the others can join with the normal rules, then switch to the intended recruitment mode.
    tribes.found(leader, { name: plan.name, tag: plan.tag, description: plan.description, recruitment: 'open' }, t);
    const tribe = store.tribes.getTribeByTag(plan.tag);
    if (!tribe) throw new Error('tribe vanished after founding');
    meta.tribes[plan.tag] = tribe.id;
    for (const m of members) {
      const row = rows.get(m.name);
      if (!row || m.role === 'leader') continue;
      tribes.join(row, tribe.id, t);
      if (m.role === 'officer') tribes.setRole(leader, row.id, 'officer', t);
    }
    if (plan.recruitment !== 'open') tribes.updateSettings(leader, { recruitment: plan.recruitment }, t);
    // A little chat history, spread over the last half hour.
    plan.chat.forEach(([who, text], i) => {
      const speaker = rows.get(members[who]?.name ?? '');
      if (!speaker) return;
      try {
        tribes.chatPost(speaker, text, t - (plan.chat.length - i) * 7 * MINUTE);
      } catch {
        // chat is decoration; never block seeding
      }
    });
  }
  store.setMeta(META_KEY, JSON.stringify(meta));
}

// ---- state kept between ticks (resets with the page; everything here is a timer or a baseline, never game state) ----

let nextRaidAt = 0;
let nextScoutAt = 0;
let nextWarCheckAt = 0;
/** Next time the computer players' old reports are trimmed (once per game hour). */
let nextReportPruneAt = 0;
/** Human's tribe id -> when the next rival attack on that tribe's bot villages is due. */
const nextTribeAttackAt = new Map<number, number>();
/** Human player id -> do not try a raid on them before this (after a failed try). */
const nextHumanRaidTry = new Map<number, number>();
/** Bot player id -> when a rival last attacked it (the next target is the one hit longest ago). */
const lastTribeHit = new Map<number, number>();
/** Bot player id -> when its next growth step is due. Advanced by whole periods, so a skip never makes the bots fire together. */
const nextGrowAt = new Map<number, number>();

interface Memory {
  hall: number;
  villages: number;
  feasted: boolean;
  chiefs: number;
  nextChatAt: number;
}
const memory = new Map<number, Memory>();

/** Forget all timers (a new world; tests). */
export function resetBotState(): void {
  nextRaidAt = 0;
  nextScoutAt = 0;
  nextWarCheckAt = 0;
  nextReportPruneAt = 0;
  nextTribeAttackAt.clear();
  nextHumanRaidTry.clear();
  lastTribeHit.clear();
  nextGrowAt.clear();
  memory.clear();
}

interface Bot {
  player: PlayerRow;
  home: VillageRecord;
  /** All villages of the player (home first): armies leave from the one with the most offence. */
  villages: VillageRecord[];
  plan: BotPlan | undefined;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function loadBots(ctx: AppContext, meta: BotMeta): Bot[] {
  const out: Bot[] = [];
  for (const id of Object.keys(meta.bots).map(Number)) {
    const player = ctx.store.getPlayer(id);
    const villages = ctx.store.villagesOfPlayer(id);
    const home = villages[0];
    if (player && home) out.push({ player, home, villages, plan: BOTS.find((b) => b.name === player.username) });
  }
  return out;
}

/** A bot's home village settled to `t` (read only: nothing is saved). */
const homeNow = (ctx: AppContext, bot: Bot, t: number): VillageState => settleVillage(bot.home.state, t, ctx.settings);

/**
 * Existing saved worlds (built before the growing bots) keep their bots, which now just keep their old villages and grow from
 * them; the bots that are missing (Hedda_Stone, Pip_Newleaf) are added and join their tribe, if it still lets them in.
 */
function upgradeBots(ctx: AppContext, meta: BotMeta, t: number): void {
  const { store, tribes, settings } = ctx;
  const rng = mulberry32((settings.seed ^ 0x5bd1e995) + t);
  for (const plan of BOTS) {
    if (store.getPlayerByLowerName(plan.name.toLowerCase())) continue;
    const tribeId = meta.tribes[plan.tribe];
    if (tribeId === undefined) continue;
    try {
      const row = store.tx(() => createBot(ctx, plan, rng, t));
      meta.bots[String(row.id)] = plan.tribe;
      try {
        tribes.join(row, tribeId, t);
      } catch {
        // the tribe is closed or full now: the new bot plays on without one
      }
    } catch (err) {
      console.warn('bot upgrade failed for', plan.name, err);
    }
  }
  meta.v = BOT_VERSION;
  store.setMeta(META_KEY, JSON.stringify(meta));
}

// ---- growth: a bot plays its villages through the real services ----------------------------------------------

const levelWithQueue = (s: VillageState, b: BuildingId): number => s.buildings[b] + s.buildQueue.filter((j) => j.building === b).length;

/** The next level the style wants: the first entry of the order below its target, then the lowest of the tail. */
function wanted(def: StyleDef, s: VillageState): { building: BuildingId; level: number } | undefined {
  // An entry whose target is beyond the building's maximum is skipped (it would block the whole list for ever).
  for (const [b, lvl] of def.order) if (levelWithQueue(s, b) < Math.min(lvl, BUILDINGS[b].maxLevel)) return { building: b, level: levelWithQueue(s, b) + 1 };
  // After the list: the style's own buildings first, then every other building, always the one furthest from its maximum (no dead end).
  const open = BUILDING_IDS.filter((b) => levelWithQueue(s, b) < BUILDINGS[b].maxLevel);
  const rank = (b: BuildingId): number => (levelWithQueue(s, b) / BUILDINGS[b].maxLevel) * (def.tail.includes(b) ? 0.85 : 1);
  const b = open.sort((x, y) => rank(x) - rank(y))[0];
  return b ? { building: b, level: levelWithQueue(s, b) + 1 } : undefined;
}

/** Is the village still working through the style's build order (not yet in the open-ended part)? */
const inOrder = (def: StyleDef, s: VillageState): boolean => def.order.some(([b, lvl]) => levelWithQueue(s, b) < Math.min(lvl, BUILDINGS[b].maxLevel));

const nextBuildCost = (def: StyleDef, s: VillageState): Resources => {
  const w = wanted(def, s);
  return w && w.level <= BUILDINGS[w.building].maxLevel ? buildingCost(w.building, w.level) : emptyResources();
};

/** Gold the village keeps for itself: the next build that costs gold, research, and an Ember Guard batch for styles that train them. */
function goldToKeep(def: StyleDef, s: VillageState): number {
  const goldAt = (b: BuildingId): number => (levelWithQueue(s, b) + 1 <= BUILDINGS[b].maxLevel ? buildingCost(b, levelWithQueue(s, b) + 1).gold : 0);
  let first = 0;
  for (const [b, target] of def.order) {
    if (levelWithQueue(s, b) >= target) continue;
    first = goldAt(b);
    if (first > 0) break;
  }
  if (first <= 0) for (const b of def.tail) if ((first = goldAt(b)) > 0) break;
  let keep = Math.max(nextBuildCost(def, s).gold, first);
  const nextResearch = def.research.find((u) => !(s.researched ?? []).includes(u) && !(s.researchQueue ?? []).some((j) => j.unit === u));
  if (nextResearch) keep += UNITS[nextResearch].research?.cost.gold ?? 0;
  const knights = def.army.find((a) => a.unit === 'knight');
  if (knights) keep += Math.round((knights.weight / def.army.reduce((a, x) => a + x.weight, 0)) * 40) * UNITS.knight.cost.gold;
  return keep;
}

/**
 * How much of the next building's cost training and Feasts must leave untouched: the style's share, or all of it once the
 * building is within reach (80% of every resource). Without this a 90% reserve can settle at exactly 90% and never reach the cost.
 */
function reserveFactor(def: StyleDef, s: VillageState): number {
  const cost = nextBuildCost(def, s);
  return RESOURCE_IDS.every((id) => s.resources[id] >= cost[id] * 0.8) ? 1 : def.reserve;
}

const queuedOf = (s: VillageState, unit: UnitId): number => {
  const b = UNITS[unit].building;
  return s.trainQueues[b].reduce((n, j) => (j.unit === unit ? n + j.count - j.done : n), 0);
};

/** Chieftains alive, away or in training in these villages: each one is a future village. */
const chieftainsOutstanding = (states: VillageState[]): number => states.reduce((n, s) => n + s.troops.chieftain + s.away.chieftain + queuedOf(s, 'chieftain'), 0);

interface Milestones {
  feasts: number;
  chieftain: boolean;
}

/** What blocks the next Chieftain besides money: a storehouse too small for his cost, or no population room. */
function chiefBlock(ctx: AppContext, s: VillageState, t: number): BuildingId | undefined {
  const cap = storageCap(s);
  const cost = UNITS.chieftain.cost;
  if (RESOURCE_IDS.some((id) => cost[id] > cap)) return 'storehouse';
  const c = checkTrain(s, 'chieftain', 1, t, ctx.settings);
  if (!c.ok && c.reason === 'population_full') return 'longhouse';
  return undefined;
}

/** Queue builds from the style's order until the queue is full or money runs out. `hold` = what must stay untouched for a Chieftain. */
function buildSteps(ctx: AppContext, player: PlayerRow, vid: number, def: StyleDef, t: number, hold: Resources | null): void {
  for (let k = 0; k < 4; k++) {
    const s = settledState(ctx, vid, t);
    if (!s || s.hearth) return;
    let forced = false;
    let cur: BuildingId | undefined;
    if (hold) {
      cur = chiefBlock(ctx, s, t);
      forced = cur !== undefined;
    }
    cur ??= wanted(def, s)?.building;
    let queued = false;
    for (let guard = 0; cur && guard < 5; guard++) {
      const c = checkBuild(s, cur, t, ctx.settings);
      if (c.ok) {
        if (hold && !forced) {
          const cost = buildingCost(cur, levelWithQueue(s, cur) + 1);
          const need = emptyResources();
          for (const id of RESOURCE_IDS) need[id] = cost[id] + hold[id];
          if (!canAfford(s.resources, need)) break;
        }
        try {
          ctx.game.build(player, vid, cur, t);
          queued = true;
        } catch {
          // the real rules refused; try again next step
        }
        break;
      }
      if (c.reason === 'exceeds_storage' && cur !== 'storehouse') {
        cur = 'storehouse';
        forced = true;
      } else if (c.reason === 'population_full' && cur !== 'longhouse') {
        cur = 'longhouse';
        forced = true;
      } else if (c.reason === 'not_enough_resources' && cur !== 'goldmine' && s.buildings.goldmine < 1 && buildingCost(cur, levelWithQueue(s, cur) + 1).gold > s.resources.gold) {
        // Waiting for gold in a village that makes none would last for ever (a founded village has no Gold Mine yet): build the mine.
        cur = 'goldmine';
        forced = true;
      } else if (c.reason === 'requirements_not_met') {
        const reqs: Partial<Record<BuildingId, number>> = BUILDINGS[cur].requires;
        const need = (Object.keys(reqs) as BuildingId[]).find((r) => s.buildings[r] < (reqs[r] ?? 0));
        if (!need || need === cur) break;
        cur = need;
      } else break;
    }
    if (!queued) return;
  }
}

function researchStep(ctx: AppContext, player: PlayerRow, vid: number, def: StyleDef, t: number): void {
  const s = settledState(ctx, vid, t);
  if (!s || s.hearth) return;
  for (const u of def.research) {
    if ((s.researched ?? []).includes(u) || (s.researchQueue ?? []).some((j) => j.unit === u)) continue;
    if (checkResearch(s, u, t, ctx.settings).ok) {
      try {
        ctx.game.research(player, vid, u, t);
      } catch {
        // refused: next step
      }
    }
    return; // one research at a time, as the style's list goes
  }
}

/** Population room troops may still take: a share of the cap minus what buildings use (the rest stays free for building). Negative = over. */
function troopRoom(def: StyleDef, s: VillageState): number {
  const share = inOrder(def, s) ? POP_TROOP_SHARE_BUILDING : POP_TROOP_SHARE_DONE;
  const use = populationUsage(s);
  return Math.floor(populationCap(s) * share - use.buildings - use.troops);
}

/** Train the unit of the mix that is furthest behind its weight, from what the next building does not need. */
function trainStep(ctx: AppContext, player: PlayerRow, vid: number, def: StyleDef, t: number, days: number): void {
  const s = settledState(ctx, vid, t);
  if (!s || s.hearth) return;
  if (days < def.trainFromDay && s.buildings.hall < 5) return;
  const room = troopRoom(def, s);
  if (room < 1) return; // keep room for buildings (and, in an old world that is over its cap, wait for the Longhouse)
  const total = def.army.reduce((a, x) => a + x.weight, 0);
  const owned = (u: UnitId): number => s.troops[u] + s.away[u] + queuedOf(s, u);
  const wheel = [...def.army].sort((a, b) => (owned(a.unit) + 1) / (a.weight / total) - (owned(b.unit) + 1) / (b.weight / total));
  for (const { unit } of wheel) {
    const c1 = checkTrain(s, unit, 1, t, ctx.settings);
    if (!c1.ok && c1.reason === 'requirements_not_met') continue; // not trainable yet (building or research missing)
    if (POP_PER_UNIT[unit] > room) continue;
    const reserve = nextBuildCost(def, s);
    const factor = reserveFactor(def, s);
    const spare = emptyResources();
    for (const id of RESOURCE_IDS) spare[id] = Math.max(0, s.resources[id] - reserve[id] * factor);
    spare.food = Math.max(0, spare.food - storageCap(s) * 0.25); // never let troops eat the food stock down to nothing
    let n = Math.min(TRAIN_BATCH_BASE + TRAIN_BATCH_PER_LEVEL * s.buildings[UNITS[unit].building], Math.floor(room / POP_PER_UNIT[unit]));
    for (const id of RESOURCE_IDS) if (UNITS[unit].cost[id] > 0) n = Math.min(n, Math.floor(spare[id] / UNITS[unit].cost[id]));
    while (n >= 1) {
      const c = checkTrain(s, unit, n, t, ctx.settings);
      if (c.ok) {
        try {
          ctx.game.train(player, vid, unit, n, t);
        } catch {
          // refused: next step
        }
        return;
      }
      if (c.reason !== 'population_full') return;
      n = Math.floor(n / 2);
    }
    return; // saving up for the picked unit
  }
}

/** A Feast turns spare resources (what the next building and a Chieftain do not need) into Renown once the Banner Hall stands. */
function feastStep(ctx: AppContext, player: PlayerRow, vid: number, def: StyleDef, t: number, hold: Resources | null): number {
  const s = settledState(ctx, vid, t);
  if (!s || s.hearth || s.buildings.bannerhall < 1) return 0;
  // No daily limit any more (2026-11-18): the price is the brake. Like the sim players, a bot feasts only to empty a storehouse
  // that is filling up, and never touches what the next building (or a Chieftain he saves for) needs, so it keeps building. It also leaves a floor of every priced
  // resource for the army: before, a bot at its last building feasted its food away each step and could never train again.
  const cap = storageCap(s);
  const price = feastPrice(s.buildings.bannerhall);
  if (!RESOURCE_IDS.some((id) => price[id] > 0 && s.resources[id] >= cap * FEAST_TRIGGER_SHARE)) return 0;
  const reserve = nextBuildCost(def, s);
  const factor = reserveFactor(def, s);
  let n = FEAST_MAX_COUNT;
  for (const id of RESOURCE_IDS) {
    if (price[id] > 0) n = Math.min(n, Math.floor((s.resources[id] - Math.max(reserve[id] * factor, hold?.[id] ?? 0, cap * FEAST_FLOOR_SHARE)) / price[id]));
  }
  if (n < 1 || !checkFeast(s, n, t, ctx.settings).ok) return 0;
  try {
    ctx.game.feast(player, vid, n, t);
    return n;
  } catch {
    return 0;
  }
}

/** Pay the gold the village does not need itself into the War Chest. */
function chestStep(ctx: AppContext, player: PlayerRow, vid: number, def: StyleDef, t: number): void {
  const s = settledState(ctx, vid, t);
  if (!s || s.hearth) return;
  const spare = Math.floor(s.resources.gold - goldToKeep(def, s));
  if (spare < 1) return;
  try {
    ctx.game.depositChest(player, vid, spare, t);
  } catch {
    // refused: next step
  }
}

function settledState(ctx: AppContext, vid: number, t: number): VillageState | null {
  const v = ctx.store.getVillage(vid);
  return v ? settleVillage(v.state, t, ctx.settings) : null;
}

/** Free, buildable tiles in rings around a village, nearest first (the real rule, checkFoundTarget, decides). */
function foundTiles(ctx: AppContext, from: { x: number; y: number }, take: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (let d = 4; d <= 24 && out.length < take; d++) {
    for (let k = 0; k < 24 && out.length < take; k++) {
      const angle = 0.3 + (k * 2 * Math.PI) / 24;
      const p = { x: from.x + Math.round(d * Math.cos(angle)), y: from.y + Math.round(d * Math.sin(angle)) };
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (checkFoundTarget(p, ctx.settings, (x, y) => ctx.store.villageExistsAt(x, y)).ok) out.push(p);
    }
  }
  return out;
}

/** A Chieftain is home: he walks out with a small escort and founds a new village on free land (no conquest). */
function foundStep(ctx: AppContext, player: PlayerRow, holder: VillageRecord, t: number): boolean {
  const s = settledState(ctx, holder.id, t);
  if (!s || s.troops.chieftain < 1) return false;
  const send: Partial<Units> = { chieftain: 1 };
  let room = 30; // the escort becomes the new village's garrison
  for (const u of ['pikeman', 'guard', 'raider'] as UnitId[]) {
    const n = Math.min(s.troops[u], room);
    if (n > 0) send[u] = n;
    room -= n;
  }
  for (const tile of foundTiles(ctx, holder, 8)) {
    try {
      ctx.game.send(player, holder.id, tile.x, tile.y, send, 'found', t);
      return true;
    } catch {
      // too close to a site or taken meanwhile: next tile
    }
  }
  return false;
}

/**
 * One growth step of a bot: pay spare gold into the War Chest, train a Chieftain when Renown and chest allow, then in every
 * village build, research, train and feast, and finally send a home Chieftain to found a village. Everything goes through
 * ctx.game, so the real rules decide; a refusal just means "not now".
 */
function growBot(ctx: AppContext, bot: Bot, t: number): Milestones & { hall: number; villages: number; feasted: boolean } {
  const def = STYLE_DEFS[bot.plan?.style ?? 'balanced'];
  const { store } = ctx;
  const player = (): PlayerRow => store.getPlayer(bot.player.id) ?? bot.player;
  const days = (t - bot.player.createdAt) / DAY;
  const done: Milestones = { feasts: 0, chieftain: false };
  const villageIds = (): number[] => store.villagesOfPlayer(bot.player.id).map((v) => v.id);
  const states = (): VillageState[] => villageIds().flatMap((id) => settledState(ctx, id, t) ?? []);

  for (const vid of villageIds()) chestStep(ctx, player(), vid, def, t);

  // Chieftain: in the first village with a Banner Hall, one at a time, when Renown and the War Chest both allow.
  const owned = villageIds().length;
  const trainerId = villageIds().find((id) => {
    const s = settledState(ctx, id, t);
    return s !== null && s.buildings.bannerhall >= 1 && !s.hearth;
  });
  let hold: Resources | null = null;
  if (trainerId !== undefined && chieftainsOutstanding(states()) === 0) {
    const p = player();
    const renownOk = p.renownTotal - p.renownSpent >= villageRenownCost(owned, ctx.settings);
    const chestOk = p.chestGold >= chestVillageCost(owned, ctx.settings);
    if (renownOk && chestOk) {
      hold = { ...UNITS.chieftain.cost }; // save up: only builds that leave his cost untouched, no training, no Feast
      const s = settledState(ctx, trainerId, t);
      if (s && canAfford(s.resources, UNITS.chieftain.cost) && checkTrain(s, 'chieftain', 1, t, ctx.settings).ok) {
        try {
          ctx.game.train(p, trainerId, 'chieftain', 1, t);
          done.chieftain = true;
          hold = null;
        } catch {
          // refused: keep saving
        }
      }
    }
  }

  for (const vid of villageIds()) {
    const h = vid === trainerId ? hold : null;
    buildSteps(ctx, player(), vid, def, t, h);
    researchStep(ctx, player(), vid, def, t);
    done.feasts += feastStep(ctx, player(), vid, def, t, h);
    if (!h) trainStep(ctx, player(), vid, def, t, days);
  }

  for (const v of store.villagesOfPlayer(bot.player.id)) if (v.state.troops.chieftain >= 1 && foundStep(ctx, player(), v, t)) break;

  const after = states();
  return {
    ...done,
    hall: Math.max(0, ...after.map((s) => s.buildings.hall)),
    villages: villageIds().length,
    feasted: done.feasts > 0,
  };
}

// ---- chat milestones (cheap: a line only when something worth saying happened, at most one per bot per 3 game hours) ----

const LINES = {
  hall: (n: number): string[] => [
    `Town Hall level ${n} is done. Slow and steady.`,
    `Hall is up to ${n} now, more room for everything else.`,
    `Got the Town Hall to ${n} today. The builders earned their bread.`,
  ],
  feast: [
    'Held our first Feast in the Banner Hall. A full storehouse is better spent on Renown than left to overflow.',
    'First Feast done! Smells like roast boar and a little Renown.',
  ],
  chieftain: [
    'A Chieftain is in training at the Banner Hall. A new village is coming.',
    'Banner Hall is busy: a Chieftain is on the way, so we will have more land soon.',
  ],
  village: [
    'Founded a new village! A second hearth for the tribe.',
    'Our Chieftain lit a new hearth on free land. Come and see the map.',
  ],
};

function chatMilestone(ctx: AppContext, bot: Bot, res: ReturnType<typeof growBot>, t: number): boolean {
  const mem = memory.get(bot.player.id);
  const base: Memory = { hall: res.hall, villages: res.villages, feasted: res.feasted, chiefs: 0, nextChatAt: 0 };
  if (!mem) {
    memory.set(bot.player.id, base); // first look: only remember where the bot is
    return false;
  }
  let line: string | undefined;
  const salt = bot.player.id + res.hall + res.villages;
  const pickOf = (list: string[]): string => list[salt % list.length] as string;
  if (res.villages > mem.villages) line = pickOf(LINES.village);
  else if (res.chieftain) line = pickOf(LINES.chieftain);
  else if (!mem.feasted && res.feasted) line = pickOf(LINES.feast);
  else if (res.hall > mem.hall) line = pickOf(LINES.hall(res.hall));
  mem.hall = Math.max(mem.hall, res.hall);
  mem.villages = Math.max(mem.villages, res.villages);
  mem.feasted = mem.feasted || res.feasted;
  if (!line || t < mem.nextChatAt) return false;
  try {
    ctx.tribes.chatPost(bot.player, line, t);
    mem.nextChatAt = t + CHAT_COOLDOWN_MS;
    return true;
  } catch {
    return false; // no tribe, or rate-limited: skip
  }
}

/**
 * Run the growth steps that are due. Cheap when nothing is due (a few map lookups, no database work).
 * `budgetMs` caps the real time one call may spend (at least one bot always plays): at a high game speed every bot is due on
 * every tick, so the rest wait for the next tick instead of freezing the page (they keep their place in the queue).
 */
function growthTick(ctx: AppContext, meta: BotMeta, t: number, budgetMs: number): boolean {
  const ids = Object.keys(meta.bots).map(Number);
  const started = performance.now();
  let changed = false;
  const ready: Array<{ id: number; due: number }> = [];
  ids.forEach((id, i) => {
    const due = nextGrowAt.get(id);
    if (due === undefined) {
      nextGrowAt.set(id, t + Math.floor((i / ids.length) * GROW_EVERY_MS)); // staggered first steps
      return;
    }
    if (t >= due) ready.push({ id, due });
  });
  ready.sort((a, b) => a.due - b.due); // the longest-waiting bot first
  for (const { id, due } of ready) {
    if (changed && performance.now() - started > budgetMs) break;
    // Keep the bot's own rhythm: jump to the next slot after now, not to now + period.
    nextGrowAt.set(id, due + (Math.floor((t - due) / GROW_EVERY_MS) + 1) * GROW_EVERY_MS);
    const player = ctx.store.getPlayer(id);
    const home = ctx.store.villagesOfPlayer(id)[0];
    if (!player || !home) continue;
    const bot: Bot = { player, home, villages: [home], plan: BOTS.find((b) => b.name === player.username) };
    try {
      const res = ctx.store.tx(() => growBot(ctx, bot, t));
      chatMilestone(ctx, bot, res, t);
      changed = true;
    } catch (err) {
      console.warn('bot growth failed for', player.username, err);
    }
  }
  return changed;
}

// ---- raids, scouting and warfare ------------------------------------------------------------------------------

/** Has any movement of its own out (marching, or coming home): a busy bot is left alone. */
const isBusy = (ctx: AppContext, playerId: number): boolean => ctx.store.movementViewsForPlayer(playerId).some((m) => m.origin.ownerId === playerId);

const underAttack = (ctx: AppContext, playerId: number): boolean =>
  ctx.store.movementViewsForPlayer(playerId).some((m) => m.kind === 'attack' && m.target.ownerId === playerId);

/** Send on a mission from a village of the bot; false when the real rules refuse (pact, protection, troops away...). */
function trySend(ctx: AppContext, bot: Bot, fromVillageId: number, x: number, y: number, units: Partial<Units>, mission: Mission, t: number): boolean {
  try {
    ctx.game.send(bot.player, fromVillageId, x, y, units, mission, t);
    return true;
  } catch {
    return false;
  }
}

/** A few abandoned villages near a bot, nearest first. Bots leave the ones a player left with troops inside alone (they raid the Wall-only ones). */
function nearbyAbandoned(ctx: AppContext, home: { x: number; y: number }, take: number) {
  const R = 14;
  return ctx.store
    .mapVillages(home.x - R, home.x + R, home.y - R, home.y + R)
    .filter((m) => m.ownerId === null && !m.defended)
    .sort((a, b) => dist(a, home) - dist(b, home))
    .slice(0, take);
}

const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** The offensive units a village has at home (Elk Riders and Raiders). */
function offencePool(state: VillageState): Units {
  const pool = emptyUnits();
  for (const u of OFFENCE_UNITS) pool[u] = state.troops[u];
  return pool;
}
const poolSize = (pool: Partial<Units>): number => OFFENCE_UNITS.reduce((n, u) => n + (pool[u] ?? 0), 0);
const poolAttack = (pool: Partial<Units>): number => OFFENCE_UNITS.reduce((n, u) => n + (pool[u] ?? 0) * UNITS[u].attack, 0);

/** The village of this bot with the most offence at home (settled), and that offence. */
function strongestStriker(ctx: AppContext, bot: Bot, t: number): { village: VillageRecord; state: VillageState; pool: Units } | undefined {
  let best: { village: VillageRecord; state: VillageState; pool: Units } | undefined;
  for (const village of bot.villages) {
    const state = settleVillage(village.state, t, ctx.settings);
    if (state.hearth) continue;
    const pool = offencePool(state);
    if (!best || poolAttack(pool) > poolAttack(best.pool)) best = { village, state, pool };
  }
  return best && poolSize(best.pool) > 0 ? best : undefined;
}

interface ArmyPlan {
  units: Partial<Units>;
  travelMs: number;
  /** Loot the army can carry home. */
  carry: number;
  /** Preview with the worst luck. */
  attackPower: number;
  defencePower: number;
}

interface PlanOptions {
  /** The attack must beat the defence by this factor (worst luck). */
  margin: number;
  /** At most this share of the pool leaves home. */
  maxShare: number;
  min: number;
  /** Loot to carry: the army grows (up to maxShare) until it can carry this much. */
  carryWanted?: number;
}

/**
 * The smallest army out of `pool` that beats `target` by the margin in the worst luck (the real battle rules, a preview) and can carry
 * the wanted loot; if the loot is more than the allowed share can carry, the largest allowed army that still wins. Null when no
 * allowed army wins. Sized this way an army grows with the bot, and a bot never sends a handful against a rich village.
 */
function planArmy(ctx: AppContext, from: { x: number; y: number }, pool: Units, target: { pos: { x: number; y: number }; state: VillageState }, t: number, o: PlanOptions): ArmyPlan | null {
  const STEPS = 16;
  let fallback: ArmyPlan | null = null;
  for (let k = 1; k <= STEPS; k++) {
    const f = (k / STEPS) * o.maxShare;
    const units: Partial<Units> = {};
    let count = 0;
    for (const u of OFFENCE_UNITS) {
      const n = Math.floor(pool[u] * f);
      if (n > 0) {
        units[u] = n;
        count += n;
      }
    }
    if (count < o.min) continue;
    const travelMs = travelTimeMs(from, target.pos, { ...emptyUnits(), ...units }, ctx.settings);
    const arrival = settleVillage(target.state, t + travelMs, ctx.settings);
    const r = resolveBattle({ attackerUnits: { ...emptyUnits(), ...units }, defender: arrival, seed: 1, fixedLuck: -BATTLE_LUCK }, ctx.settings);
    if (!(r.attackPower > r.defensePower * o.margin)) continue;
    const carry = OFFENCE_UNITS.reduce((n, u) => n + (units[u] ?? 0) * UNITS[u].carry, 0);
    const plan: ArmyPlan = { units, travelMs, carry, attackPower: r.attackPower, defencePower: r.defensePower };
    if (carry >= (o.carryWanted ?? 0)) return plan;
    fallback = plan;
  }
  return fallback;
}

/** What a raid on this abandoned village can take at most: everything it holds (the Vault share is small next to what a big army carries). */
const lootableOf = (state: VillageState): number => RESOURCE_IDS.reduce((n, id) => n + Math.max(0, state.resources[id]), 0);

/**
 * Some bots send their offence at a nearby abandoned village. The army is sized by the real battle rules to win with a wide margin
 * and to carry what the village holds (never more than 70% of what the strongest village has at home), so raids grow with the army.
 */
function botRaid(ctx: AppContext, bots: Bot[], t: number): boolean {
  const idle = bots.filter((b) => !isBusy(ctx, b.player.id));
  let sent = 0;
  for (let tries = 0; tries < 4 && sent < 1 && idle.length > 0; tries++) {
    const bot = idle.splice(Math.floor(Math.random() * idle.length), 1)[0] as Bot;
    const striker = strongestStriker(ctx, bot, t);
    if (!striker || poolSize(striker.pool) < RAID_MIN_UNITS) continue;
    let best: { x: number; y: number; plan: ArmyPlan; score: number } | undefined;
    for (const target of nearbyAbandoned(ctx, striker.village, 5)) {
      const row = ctx.store.getVillage(target.id);
      if (!row) continue;
      const loot = lootableOf(settleVillage(row.state, t, ctx.settings));
      const plan = planArmy(ctx, striker.village, striker.pool, { pos: target, state: row.state }, t, {
        margin: RAID_MARGIN,
        maxShare: RAID_MAX_SHARE,
        min: RAID_MIN_UNITS,
        carryWanted: loot,
      });
      if (!plan) continue;
      const score = Math.min(plan.carry, loot) / Math.max(1, plan.travelMs); // loot per travel time
      if (!best || score > best.score) best = { x: target.x, y: target.y, plan, score };
    }
    if (best && trySend(ctx, bot, striker.village.id, best.x, best.y, best.plan.units, 'attack', t)) sent++;
  }
  return sent > 0;
}

/** A bot with Pathfinders scouts a nearby abandoned village (the report goes to the bot; this keeps the machinery busy). */
function botScout(ctx: AppContext, bots: Bot[], t: number): boolean {
  const bot = pick(bots.filter((b) => homeNow(ctx, b, t).troops.pathfinder >= 1 && !isBusy(ctx, b.player.id)));
  if (!bot) return false;
  const state = homeNow(ctx, bot, t);
  const target = pick(nearbyAbandoned(ctx, bot.home, 4));
  if (!target) return false;
  return trySend(ctx, bot, bot.home.id, target.x, target.y, { pathfinder: Math.min(state.troops.pathfinder, 2) }, 'attack', t); // an attack of Pathfinders only scouts
}

/** Every human player (anyone who is not a bot). */
function humanPlayers(ctx: AppContext, meta: BotMeta): PlayerRow[] {
  const rows = ctx.store.db.prepare('SELECT id FROM players ORDER BY id').all() as Array<{ id: number }>;
  return rows.filter((r) => !(String(r.id) in meta.bots)).flatMap((r) => ctx.store.getPlayer(r.id) ?? []);
}

interface Attack {
  bot: Bot;
  fromVillageId: number;
  units: Partial<Units>;
  travelMs: number;
}

/**
 * Idle bots outside `exclude` as possible attackers of `target`, best first. Each sends the smallest army of its strongest village's
 * Elk Riders and Raiders that beats the target by TRIBE_ATTACK_MARGIN in the worst luck (bots that cannot win stay at home). The
 * candidates are ranked by how close their travel time is to the ideal (~5 min at speed 25, scaled with the world speed; never
 * under ~90 s there, so the target's tribe has time to see the alert).
 */
function attacksOn(ctx: AppContext, bots: Bot[], exclude: Set<Bot>, target: { x: number; y: number; state: VillageState }, t: number): Attack[] {
  const out: Attack[] = [];
  for (const bot of bots) {
    if (exclude.has(bot) || isBusy(ctx, bot.player.id)) continue;
    const striker = strongestStriker(ctx, bot, t);
    if (!striker || poolSize(striker.pool) < TRIBE_ATTACK_MIN_UNITS) continue;
    const plan = planArmy(ctx, striker.village, striker.pool, { pos: target, state: target.state }, t, {
      margin: TRIBE_ATTACK_MARGIN,
      maxShare: TRIBE_ATTACK_MAX_SHARE,
      min: TRIBE_ATTACK_MIN_UNITS,
    });
    if (plan) out.push({ bot, fromVillageId: striker.village.id, units: plan.units, travelMs: plan.travelMs });
  }
  const ideal = scaled(ctx, IDEAL_TRAVEL_MS);
  const minWarning = scaled(ctx, MIN_WARNING_MS);
  const rank = (a: Attack): number => Math.abs(a.travelMs - ideal) + (a.travelMs < minWarning ? 2 * ideal : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * Tribe warfare for the human to watch: when the human is in a tribe that has bot members, a bot from another tribe
 * attacks a bot village of that tribe (the one hit longest ago, then the nearest to the human, that some rival can beat), every so often (tribe alerts appear;
 * "Send support" can be tried). The real rules apply: tribe-mates and allies of the attacker's tribe are refused and skipped, and so
 * are mates still under beginner protection.
 */
function tribeAttacks(ctx: AppContext, bots: Bot[], humans: PlayerRow[], t: number): boolean {
  let changed = false;
  const humanTribes = new Map<number, PlayerRow>();
  for (const h of humans) {
    const m = ctx.store.tribes.membership(h.id);
    if (m && !humanTribes.has(m.tribeId)) humanTribes.set(m.tribeId, h);
  }
  for (const tribeId of [...nextTribeAttackAt.keys()]) if (!humanTribes.has(tribeId)) nextTribeAttackAt.delete(tribeId);

  for (const [tribeId, human] of humanTribes) {
    const mates = bots.filter((b) => ctx.store.tribes.membership(b.player.id)?.tribeId === tribeId);
    if (mates.length === 0) continue;
    const due = nextTribeAttackAt.get(tribeId);
    if (due === undefined) {
      nextTribeAttackAt.set(tribeId, t + scaled(ctx, FIRST_TRIBE_ATTACK_MS));
      continue;
    }
    if (t < due) continue;
    nextTribeAttackAt.set(tribeId, t + scaled(ctx, TRIBE_ATTACK_EVERY_MS) * (0.8 + Math.random() * 0.4));

    const hv = ctx.store.villagesOfPlayer(human.id)[0];
    if (!hv) continue;
    const targets = mates
      .filter((m) => !underAttack(ctx, m.player.id) && !(m.home.ownerProtectedUntil > t))
      .sort((a, b) => (lastTribeHit.get(a.player.id) ?? 0) - (lastTribeHit.get(b.player.id) ?? 0) || dist(a.home, hv) - dist(b.home, hv));
    let done = false;
    for (const target of targets) {
      const row = ctx.store.getVillage(target.home.id);
      if (!row) continue;
      for (const a of attacksOn(ctx, bots, new Set(mates), { x: target.home.x, y: target.home.y, state: row.state }, t).slice(0, 4)) {
        if (trySend(ctx, a.bot, a.fromVillageId, target.home.x, target.home.y, a.units, 'attack', t)) {
          lastTribeHit.set(target.player.id, t);
          changed = true;
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  return changed;
}

/**
 * How many raiders a raid on a human village sends: a challenge, never a wipe. At least HUMAN_RAID_MIN_RAIDERS and about
 * points / 60 (a 700-point village sees 12), more only to stay near 60% of what his village defends with (so a defended village
 * beats it with room to spare), and never more than points / 20.
 */
export function humanRaidSize(humanPoints: number, defencePower: number): number {
  const floor = Math.max(HUMAN_RAID_MIN_RAIDERS, Math.ceil(humanPoints / HUMAN_RAID_POINTS_PER_RAIDER_FLOOR));
  const ceiling = Math.max(HUMAN_RAID_MIN_RAIDERS, Math.floor(humanPoints / HUMAN_RAID_POINTS_PER_RAIDER_CAP));
  const toDefence = Math.ceil((HUMAN_RAID_DEFENCE_SHARE * defencePower) / UNITS.raider.attack);
  return Math.min(ceiling, Math.max(floor, toDefence));
}

/**
 * A raid on a human village, rarely: only once beginner protection is over (and a while after it), then not more often than every
 * ~12 game hours at speed 1. Sized by humanRaidSize, from the nearest idle bot outside the human's tribe (at most 70% of its raiders, at least 6).
 * Never while protected; the server refuses that too.
 */
function humanRaids(ctx: AppContext, bots: Bot[], humans: PlayerRow[], t: number): boolean {
  let changed = false;
  for (const human of humans) {
    const hv = ctx.store.villagesOfPlayer(human.id)[0];
    if (!hv || hv.ownerProtectedUntil > t) continue;
    if ((nextHumanRaidTry.get(human.id) ?? 0) > t) continue;
    const key = `preview_human_raid_${human.id}`;
    const last = Number(ctx.store.getMeta(key) ?? Number.NaN);
    const dueAt = Number.isFinite(last)
      ? last + scaled(ctx, HUMAN_RAID_EVERY_MS) * (1 + (human.id % 3) * 0.15)
      : Math.max(human.protectedUntil, human.createdAt) + scaled(ctx, HUMAN_RAID_AFTER_PROTECTION_MS);
    if (t < dueAt || underAttack(ctx, human.id)) continue;

    const own = ctx.store.tribes.membership(human.id)?.tribeId;
    const friends = new Set(bots.filter((b) => own !== undefined && ctx.store.tribes.membership(b.player.id)?.tribeId === own));
    // What his village defends with (a one-raider preview gives the defence power), and his points.
    const humanState = settleVillage(hv.state, t, ctx.settings);
    const points = ctx.store.villagesOfPlayer(human.id).reduce((n, v) => n + villagePoints(v.state), 0);
    const probe = resolveBattle({ attackerUnits: { ...emptyUnits(), raider: 1 }, defender: humanState, seed: 1, fixedLuck: 0 }, ctx.settings);
    const want = humanRaidSize(points, probe.defensePower);
    let sent = false;
    const nearest = bots
      .filter((b) => !friends.has(b) && !isBusy(ctx, b.player.id))
      .sort((a, b) => dist(a.home, hv) - dist(b.home, hv))
      .slice(0, 4);
    for (const attacker of nearest) {
      const from = attacker.villages
        .map((v) => ({ v, raiders: settleVillage(v.state, t, ctx.settings).troops.raider }))
        .sort((a, b) => b.raiders - a.raiders)[0];
      // The raid is at most `want`, and never more than RAID_MAX_SHARE of the raiders the bot's strongest village has at home.
      const n = Math.min(want, Math.floor((from?.raiders ?? 0) * RAID_MAX_SHARE));
      if (!from || n < HUMAN_RAID_MIN_RAIDERS) continue;
      if (trySend(ctx, attacker, from.v.id, hv.x, hv.y, { raider: n }, 'attack', t)) {
        sent = true;
        break;
      }
    }
    if (sent) {
      ctx.store.setMeta(key, String(t));
      changed = true;
    } else {
      nextHumanRaidTry.set(human.id, t + 30_000); // pacts, busy bots or no army big enough: look again in a bit
    }
  }
  return changed;
}

/** The EMBR leader invites a human who has no tribe, once per human, shortly after they registered. */
function inviteHumans(ctx: AppContext, meta: BotMeta, humans: PlayerRow[], t: number): boolean {
  const tribeId = meta.tribes.EMBR;
  if (tribeId === undefined) return false;
  const leaderMember = ctx.store.tribes.members(tribeId).find((m) => m.role === 'leader');
  if (!leaderMember || !(String(leaderMember.playerId) in meta.bots)) return false; // a human leads it now
  const leader = ctx.store.getPlayer(leaderMember.playerId);
  if (!leader) return false;
  let changed = false;
  for (const h of humans) {
    const key = `preview_invited_${h.id}`;
    if (t - h.createdAt < INVITE_AFTER_MS || ctx.store.getMeta(key) !== null) continue;
    ctx.store.setMeta(key, String(t));
    if (ctx.store.tribes.membership(h.id)) continue;
    try {
      ctx.tribes.invite(leader, h.username, t);
      changed = true;
    } catch {
      // already invited or the tribe has too many open invitations: never mind
    }
  }
  return changed;
}

/** Newest reports each computer player keeps; nobody reads the rest and they were 75% of a long-running preview database. */
export const BOT_REPORTS_KEEP = 20;
const REPORT_PRUNE_EVERY_MS = 60 * 60_000;

/** Delete each computer player's reports beyond the newest BOT_REPORTS_KEEP. Never touches anyone else's. Returns rows deleted. */
export function pruneBotReports(ctx: AppContext, botIds: number[]): number {
  const stmt = ctx.store.db.prepare(
    `DELETE FROM reports WHERE player_id = ? AND id NOT IN
       (SELECT id FROM reports WHERE player_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
  );
  let n = 0;
  for (const id of botIds) n += Number(stmt.run(id, id, BOT_REPORTS_KEEP).changes);
  // Freed pages stay in the saved file until the database is compacted: do it when a lot is free (the first trim of an old world).
  if (n > 0) {
    try {
      const free = Number((ctx.store.db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count);
      const total = Number((ctx.store.db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count);
      if (free > 100 && free > total / 4) ctx.store.db.exec('VACUUM');
    } catch (err) {
      console.warn('database compaction skipped', err);
    }
  }
  return n;
}

/**
 * One bot step. Cheap when nothing is due. Returns true when it changed the world (so the caller can save).
 * `budgetMs` limits the growth work of this call (the live timer passes a small one; skipping ahead passes none).
 */
export function botTick(ctx: AppContext, budgetMs = Infinity): boolean {
  const meta = loadMeta(ctx);
  if (!meta) return false;
  const { store, tribes } = ctx;
  const t = ctx.now();
  let changed = false;
  const bot = (id: number): boolean => String(id) in meta.bots;

  if ((meta.v ?? 1) < BOT_VERSION) {
    upgradeBots(ctx, meta, t);
    changed = true;
  }

  for (const [tag, tribeId] of Object.entries(meta.tribes)) {
    const members = store.tribes.members(tribeId);
    const leaderMember = members.find((m) => m.role === 'leader');
    if (!leaderMember || !bot(leaderMember.playerId)) continue; // a human took over: bots stay out of it
    const leader = store.getPlayer(leaderMember.playerId);
    if (!leader) continue;

    // 1. Applications: accepted after ~20 s.
    for (const app of store.tribes.applicationsOfTribe(tribeId)) {
      if (t - app.createdAt < ACCEPT_APPLICATION_AFTER_MS) continue;
      try {
        tribes.acceptApplication(leader, app.id, t);
        changed = true;
      } catch {
        // tribe full or applicant joined elsewhere: leave it
      }
    }

    // 2. Diplomacy proposals to this tribe: answered after 20-30 s, mostly accepted (every 5th is declined).
    for (const p of store.tribes.proposalsOfTribe(tribeId)) {
      if (p.toTribeId !== tribeId) continue;
      const delay = 20_000 + (p.id % 3) * 5_000;
      if (t - p.createdAt < delay) continue;
      try {
        if (p.id % 5 === 4) tribes.declineProposal(leader, p.id, t);
        else tribes.acceptProposal(leader, p.id, t);
        changed = true;
      } catch {
        // e.g. over the alliance cap: it stays pending
      }
    }

    // 3. Welcome newcomers in chat, once each.
    const greeter = members.find((m) => bot(m.playerId) && m.role !== 'member') ?? leaderMember;
    for (const m of members) {
      if (bot(m.playerId) || t - m.joinedAt < WELCOME_AFTER_MS) continue;
      const key = `preview_welcomed_${m.playerId}`;
      if (store.getMeta(key) !== null) continue;
      const speaker = store.getPlayer(greeter.playerId);
      if (!speaker) continue;
      store.setMeta(key, String(t));
      try {
        const line = tag === 'ASH' ? `Welcome to the Legion, ${m.username}. Check the tribe log and pick a target from the map.` : `Welcome to ${tag}, ${m.username}! Shout here if you want a hand with building or raids.`;
        tribes.chatPost(speaker, line, t);
        changed = true;
      } catch {
        // rate-limited or similar: skip
      }
    }
  }

  // 4. The bots grow: each plays one step per ~20 game minutes (staggered).
  if (growthTick(ctx, meta, t, budgetMs)) changed = true;

  // 4b. Old bot reports are trimmed once per game hour (the database stays small in long, fast runs).
  if (t >= nextReportPruneAt) {
    nextReportPruneAt = t + REPORT_PRUNE_EVERY_MS;
    if (pruneBotReports(ctx, Object.keys(meta.bots).map(Number)) > 0) changed = true;
  }

  // 5. Keeping the map moving (timers scale with the world speed). Bots are loaded only when something is due.
  if (nextRaidAt === 0) {
    nextRaidAt = t + scaled(ctx, FIRST_RAID_MS);
    nextScoutAt = t + scaled(ctx, FIRST_SCOUT_MS);
  }
  if (t >= nextRaidAt || t >= nextScoutAt || t >= nextWarCheckAt) {
    const bots = loadBots(ctx, meta);
    if (t >= nextRaidAt) {
      nextRaidAt = t + scaled(ctx, RAID_EVERY_MS) * (0.7 + Math.random() * 0.6);
      if (botRaid(ctx, bots, t)) changed = true;
    }
    if (t >= nextScoutAt) {
      nextScoutAt = t + scaled(ctx, SCOUT_EVERY_MS) * (0.7 + Math.random() * 0.6);
      if (botScout(ctx, bots, t)) changed = true;
    }
    if (t >= nextWarCheckAt) {
      nextWarCheckAt = t + WAR_CHECK_EVERY_MS;
      const humans = humanPlayers(ctx, meta);
      if (inviteHumans(ctx, meta, humans, t)) changed = true;
      if (tribeAttacks(ctx, bots, humans, t)) changed = true;
      if (humanRaids(ctx, bots, humans, t)) changed = true;
    }
  }
  return changed;
}
