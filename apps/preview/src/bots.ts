// Computer players for the preview, so tribe features can be tried alone. Deliberately simple and isolated:
//  - seedBots(): on a fresh world, 8 bot players with villages of different sizes in 3 bot tribes (made with the real
//    TribeService, so they appear in the ranking, map and tribe finder like anyone else);
//  - botTick(): reacts to the human with the real services (accept applications after ~20 s, answer diplomacy proposals
//    after ~20-30 s, welcome newcomers in tribe chat) and keeps the map moving: raids and scouting missions on abandoned
//    villages, an attack by a rival tribe's bot on a bot village of the human's tribe every few minutes (so tribe alerts
//    and "Send support" can be tried), and a rare, weak raid on the human's own village once protection is over.
// Reactions are driven by timestamps already in the database, so they survive a page reload.

import {
  BUILDINGS,
  UNITS,
  UNIT_IDS,
  createPlayerVillage,
  emptyUnits,
  findSpawnLocation,
  mulberry32,
  settleVillage,
  storageCapForLevel,
  travelTimeMs,
  villagePoints,
} from '@clanfire/engine';
import type { BuildingId, ChieftainId, Mission, Recruitment, Units, VillageState } from '@clanfire/engine';
import type { AppContext } from '../../server/src/context.ts';
import type { PlayerRow, VillageRecord } from '../../server/src/store.ts';

interface BotPlan {
  name: string;
  /** Town Hall level; the rest of the village is derived from it. */
  level: number;
  tribe: 'EMBR' | 'ASH' | 'MIST';
  role: 'leader' | 'officer' | 'member';
  /** Pathfinders this village keeps at home (only with Barracks 2). They defend against enemy scouts and scout abandoned villages. */
  scouts?: number;
  /** Fixed portrait (CHIEFTAINS id), so the preview shows variety. */
  chieftain: ChieftainId;
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
      [1, 'Outriders carry 70 each. Worth the stables for the big villages.'],
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
  { name: 'Brannoch', level: 9, tribe: 'EMBR', role: 'leader', scouts: 6, chieftain: 'brannoc' },
  { name: 'Ysolde_K', level: 6, tribe: 'EMBR', role: 'officer', chieftain: 'ysra' },
  { name: 'Ironhart', level: 4, tribe: 'EMBR', role: 'member', chieftain: 'hild' },
  { name: 'Tolvek', level: 10, tribe: 'ASH', role: 'leader', scouts: 8, chieftain: 'corwen' },
  { name: 'Grimwald', level: 7, tribe: 'ASH', role: 'officer', scouts: 3, chieftain: 'old-orm' },
  { name: 'Odalys', level: 5, tribe: 'ASH', role: 'member', chieftain: 'saffi' },
  { name: 'Mira_of_Vale', level: 6, tribe: 'MIST', role: 'leader', scouts: 2, chieftain: 'maelis' },
  { name: 'Sable', level: 3, tribe: 'MIST', role: 'member', chieftain: 'wren' },
];

const META_KEY = 'preview_bots';
const ACCEPT_APPLICATION_AFTER_MS = 20_000;
const WELCOME_AFTER_MS = 3_000;
const FIRST_RAID_MS = 75_000;
const RAID_EVERY_MS = 150_000;
const FIRST_SCOUT_MS = 40_000;
const SCOUT_EVERY_MS = 110_000;
/** First rival-tribe attack on the human's tribe-mates comes this long after the human joins a tribe with bot members. */
const FIRST_TRIBE_ATTACK_MS = 50_000;
const TRIBE_ATTACK_EVERY_MS = 4 * 60_000;
/** Bots top their villages up (army, stores) this often, so attacked or raiding villages recover. */
const RESTOCK_EVERY_MS = 3 * 60_000;
/** A bot raid on the human's own village: only after protection, never more often than this, and small. */
const HUMAN_RAID_AFTER_PROTECTION_MS = 5 * 60_000;
const HUMAN_RAID_EVERY_MS = 10 * 60_000;
const HUMAN_RAID_RAIDERS = 6;
/** Bump when bots change in a way that existing saved worlds need to catch up with (see upgradeBots). */
const BOT_VERSION = 2;

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

/** A bot village sized by Town Hall level, built directly as state (no waiting for construction). */
function botVillage(level: number, t: number): VillageState {
  const v = createPlayerVillage(t);
  const set = (b: BuildingId, lvl: number): void => {
    v.buildings[b] = Math.max(0, Math.min(lvl, BUILDINGS[b].maxLevel));
  };
  set('hall', level);
  set('lumber', level + 1);
  set('farm', level + 2);
  set('mine', level);
  set('storehouse', level);
  set('barracks', level >= 2 ? Math.max(1, level - 3) : 0);
  set('wall', v.buildings.barracks >= 1 ? Math.max(0, level - 4) : 0);
  set('vault', level >= 2 ? Math.max(0, level - 4) : 0);
  set('goldmine', level >= 3 ? level - 3 : 0);
  set('stables', level >= 5 && v.buildings.barracks >= 3 ? level - 4 : 0);
  return v;
}

/** Fill a bot village's army and stores to its standing levels (what it "keeps trained"). */
function restock(v: VillageState, scouts = 0): void {
  const level = v.buildings.hall;
  const want: Partial<Units> = {};
  for (const u of UNIT_IDS) {
    const def = UNITS[u];
    const ok = (Object.keys(def.requires) as BuildingId[]).every((b) => v.buildings[b] >= (def.requires[b] ?? 0));
    if (!ok) continue;
    want[u] =
      u === 'raider' ? level * 8 : u === 'pikeman' ? level * 6 : u === 'guard' ? level * 3 : u === 'outrider' ? level * 2 : u === 'pathfinder' ? scouts : 0;
  }
  for (const u of UNIT_IDS) v.troops[u] = Math.max(v.troops[u], want[u] ?? 0);
  const cap = storageCapForLevel(v.buildings.storehouse);
  v.resources.wood = Math.max(v.resources.wood, cap * 0.6);
  v.resources.food = Math.max(v.resources.food, cap * 0.6);
  v.resources.iron = Math.max(v.resources.iron, cap * 0.6);
}

export function seedBots(ctx: AppContext): void {
  if (loadMeta(ctx)) return;
  const { store, tribes, settings } = ctx;
  const t = ctx.now();
  const rng = mulberry32(settings.seed ^ 0x5bd1e995);
  const meta: BotMeta = { bots: {}, tribes: {}, v: BOT_VERSION };
  const rows = new Map<string, PlayerRow>();

  store.tx(() => {
    for (const bot of BOTS) {
      // Bots cannot sign in: "bot" is not a valid password hash, so verifyPassword always refuses it.
      const id = store.insertPlayer(bot.name, 'bot', t, 0, bot.chieftain);
      const spot = findSpawnLocation((x, y) => store.villageExistsAt(x, y), rng, settings);
      const state = botVillage(bot.level, t);
      restock(state, bot.scouts);
      store.insertVillage(id, `${bot.name}'s village`, spot.x, spot.y, villagePoints(state), state);
      const row = store.getPlayer(id);
      if (!row) throw new Error('bot vanished after insert');
      rows.set(bot.name, row);
      meta.bots[String(id)] = bot.tribe;
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
        tribes.chatPost(speaker, text, t - (plan.chat.length - i) * 7 * 60_000);
      } catch {
        // chat is decoration; never block seeding
      }
    });
  }
  store.setMeta(META_KEY, JSON.stringify(meta));
}

// ---- behaviour ---------------------------------------------------------------------------------------

let nextRaidAt = 0;
let nextScoutAt = 0;
let nextRestockAt = 0;
let nextWarCheckAt = 0;
/** Human's tribe id -> when the next rival attack on that tribe's bot villages is due (resets with the page). */
const nextTribeAttackAt = new Map<number, number>();
/** Human player id -> do not try a raid on them before this (after a failed try). */
const nextHumanRaidTry = new Map<number, number>();

interface Bot {
  player: PlayerRow;
  home: VillageRecord;
  plan: BotPlan | undefined;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function loadBots(ctx: AppContext, meta: BotMeta): Bot[] {
  const out: Bot[] = [];
  for (const id of Object.keys(meta.bots).map(Number)) {
    const player = ctx.store.getPlayer(id);
    const home = ctx.store.villagesOfPlayer(id)[0];
    if (player && home) out.push({ player, home, plan: BOTS.find((b) => b.name === player.username) });
  }
  return out;
}

/** Settle a bot village to now and top its army and stores up to the standing levels. Returns the new state. */
function restockBot(ctx: AppContext, bot: Bot, t: number): VillageState {
  const state = settleVillage(bot.home.state, t, ctx.settings);
  restock(state, bot.plan?.scouts);
  ctx.store.saveVillage(bot.home.id, state, villagePoints(state));
  bot.home = { ...bot.home, state };
  return state;
}

/** Existing saved worlds (built before warfare) get Pathfinders and the new schedule here. */
function upgradeBots(ctx: AppContext, meta: BotMeta, t: number): void {
  if ((meta.v ?? 1) >= BOT_VERSION) return;
  for (const bot of loadBots(ctx, meta)) restockBot(ctx, bot, t);
  meta.v = BOT_VERSION;
  ctx.store.setMeta(META_KEY, JSON.stringify(meta));
}

/** Has any movement of its own out (marching, or coming home): a busy bot is left alone. */
const isBusy = (ctx: AppContext, playerId: number): boolean => ctx.store.movementViewsForPlayer(playerId).some((m) => m.origin.ownerId === playerId);

const underAttack = (ctx: AppContext, playerId: number): boolean =>
  ctx.store.movementViewsForPlayer(playerId).some((m) => m.kind === 'attack' && m.target.ownerId === playerId);

/** Send on a mission; false when the real rules refuse (pact, protection, troops away...). */
function trySend(ctx: AppContext, bot: Bot, x: number, y: number, units: Partial<Units>, mission: Mission, t: number): boolean {
  try {
    ctx.game.send(bot.player, bot.home.id, x, y, units, mission, t);
    return true;
  } catch {
    return false;
  }
}

/** A few abandoned villages near a bot, nearest first. */
function nearbyAbandoned(ctx: AppContext, home: VillageRecord, take: number) {
  const R = 14;
  return ctx.store
    .mapVillages(home.x - R, home.x + R, home.y - R, home.y + R)
    .filter((m) => m.ownerId === null)
    .sort((a, b) => dist(a, home) - dist(b, home))
    .slice(0, take);
}

const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** Pick a bot at random and send raiders at a nearby abandoned village. */
function botRaid(ctx: AppContext, bots: Bot[], t: number): boolean {
  const bot = pick(bots);
  if (!bot) return false;
  const state = restockBot(ctx, bot, t);
  const target = pick(nearbyAbandoned(ctx, bot.home, 4));
  if (!target) return false;
  const raiders = Math.min(state.troops.raider, 40 + state.buildings.hall * 4);
  return trySend(ctx, bot, target.x, target.y, { raider: raiders }, 'attack', t);
}

/** A bot with Pathfinders scouts a nearby abandoned village (the report goes to the bot; this keeps the machinery busy). */
function botScout(ctx: AppContext, bots: Bot[], t: number): boolean {
  const bot = pick(bots.filter((b) => (b.plan?.scouts ?? 0) > 0 && !isBusy(ctx, b.player.id)));
  if (!bot) return false;
  const state = restockBot(ctx, bot, t);
  const target = pick(nearbyAbandoned(ctx, bot.home, 4));
  if (!target || state.troops.pathfinder < 1) return false;
  return trySend(ctx, bot, target.x, target.y, { pathfinder: Math.min(state.troops.pathfinder, 2) }, 'scout', t);
}

/** Every human player (anyone who is not a bot). */
function humanPlayers(ctx: AppContext, meta: BotMeta): PlayerRow[] {
  const rows = ctx.store.db.prepare('SELECT id FROM players ORDER BY id').all() as Array<{ id: number }>;
  return rows.filter((r) => !(String(r.id) in meta.bots)).flatMap((r) => ctx.store.getPlayer(r.id) ?? []);
}

interface Attack {
  bot: Bot;
  units: Partial<Units>;
  travelMs: number;
}

const MIN_WARNING_MS = 90_000;
const IDEAL_TRAVEL_MS = 5 * 60_000;

/**
 * Idle bots outside `exclude` as possible attackers of `target`, best first. Everything runs at 25x, but a 55-tile march
 * still takes 20 minutes with infantry, so a bot with stables sends Outriders (fast) and the candidates are ranked by how
 * close their travel time is to ~5 minutes (never under ~90 s, so the target's tribe has time to see the alert).
 */
function attacksOn(ctx: AppContext, bots: Bot[], exclude: Set<Bot>, target: { x: number; y: number }, t: number, raiders: (hall: number) => number): Attack[] {
  const out: Attack[] = [];
  for (const bot of bots) {
    if (exclude.has(bot) || isBusy(ctx, bot.player.id)) continue;
    const state = restockBot(ctx, bot, t);
    const cap = raiders(state.buildings.hall);
    const units: Partial<Units> = state.troops.outrider >= 6 ? { outrider: Math.min(state.troops.outrider, cap) } : { raider: Math.min(state.troops.raider, cap) };
    if (Object.values(units).every((n) => n === 0)) continue;
    const travelMs = travelTimeMs(bot.home, target, { ...emptyUnits(), ...units }, ctx.settings);
    out.push({ bot, units, travelMs });
  }
  const rank = (a: Attack): number => Math.abs(a.travelMs - IDEAL_TRAVEL_MS) + (a.travelMs < MIN_WARNING_MS ? 10 * 60_000 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * Tribe warfare for the human to watch: when the human is in a tribe that has bot members, a bot from another tribe
 * attacks the bot village of that tribe nearest to the human, every few minutes (tribe alerts appear; "Send support"
 * can be tried). The real rules apply: tribe-mates and allies of the attacker's tribe are refused and skipped.
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
      nextTribeAttackAt.set(tribeId, t + FIRST_TRIBE_ATTACK_MS);
      continue;
    }
    if (t < due) continue;
    nextTribeAttackAt.set(tribeId, t + TRIBE_ATTACK_EVERY_MS * (0.8 + Math.random() * 0.4));

    const hv = ctx.store.villagesOfPlayer(human.id)[0];
    if (!hv) continue;
    const target = mates
      .filter((m) => !underAttack(ctx, m.player.id))
      .sort((a, b) => dist(a.home, hv) - dist(b.home, hv))[0];
    if (!target) continue;
    for (const a of attacksOn(ctx, bots, new Set(mates), target.home, t, (hall) => 20 + 3 * hall).slice(0, 4)) {
      if (trySend(ctx, a.bot, target.home.x, target.home.y, a.units, 'attack', t)) {
        changed = true;
        break;
      }
    }
  }
  return changed;
}

/**
 * A rare, weak raid on a human village: only once beginner protection is over (and a few minutes after it), then at
 * most one every ~10 minutes, six raiders. Never while protected; the server refuses that too.
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
      ? last + HUMAN_RAID_EVERY_MS * (1 + (human.id % 3) * 0.15)
      : Math.max(human.protectedUntil, human.createdAt) + HUMAN_RAID_AFTER_PROTECTION_MS;
    if (t < dueAt || underAttack(ctx, human.id)) continue;

    const own = ctx.store.tribes.membership(human.id)?.tribeId;
    const friends = new Set(bots.filter((b) => own !== undefined && ctx.store.tribes.membership(b.player.id)?.tribeId === own));
    let sent = false;
    // Small and slow: six raiders, from the nearest idle bot outside the human's tribe.
    const nearest = bots
      .filter((b) => !friends.has(b) && !isBusy(ctx, b.player.id))
      .sort((a, b) => dist(a.home, hv) - dist(b.home, hv))
      .slice(0, 4);
    for (const attacker of nearest) {
      const state = restockBot(ctx, attacker, t);
      if (state.troops.raider < HUMAN_RAID_RAIDERS) continue;
      if (trySend(ctx, attacker, hv.x, hv.y, { raider: HUMAN_RAID_RAIDERS }, 'attack', t)) {
        sent = true;
        break;
      }
    }
    if (sent) {
      ctx.store.setMeta(key, String(t));
      changed = true;
    } else {
      nextHumanRaidTry.set(human.id, t + 30_000); // pacts or busy bots: look again in a bit
    }
  }
  return changed;
}

/**
 * One bot step. Cheap when nothing is due. Returns true when it changed the world (so the caller can save).
 */
export function botTick(ctx: AppContext): boolean {
  const meta = loadMeta(ctx);
  if (!meta) return false;
  const { store, tribes } = ctx;
  const t = ctx.now();
  let changed = false;
  const bot = (id: number): boolean => String(id) in meta.bots;

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

  // 4. Keeping the map moving. Bots are loaded only when something is due.
  if (nextRaidAt === 0) {
    nextRaidAt = t + FIRST_RAID_MS;
    nextScoutAt = t + FIRST_SCOUT_MS;
    nextRestockAt = t + RESTOCK_EVERY_MS;
  }
  const upgrade = (meta.v ?? 1) < BOT_VERSION;
  if (upgrade || t >= nextRaidAt || t >= nextScoutAt || t >= nextRestockAt || t >= nextWarCheckAt) {
    if (upgrade) {
      upgradeBots(ctx, meta, t);
      changed = true;
    }
    const bots = loadBots(ctx, meta);
    if (t >= nextRestockAt) {
      nextRestockAt = t + RESTOCK_EVERY_MS;
      for (const bot of bots) restockBot(ctx, bot, t);
      changed = true;
    }
    if (t >= nextRaidAt) {
      nextRaidAt = t + RAID_EVERY_MS * (0.7 + Math.random() * 0.6);
      if (botRaid(ctx, bots, t)) changed = true;
    }
    if (t >= nextScoutAt) {
      nextScoutAt = t + SCOUT_EVERY_MS * (0.7 + Math.random() * 0.6);
      if (botScout(ctx, bots, t)) changed = true;
    }
    if (t >= nextWarCheckAt) {
      nextWarCheckAt = t + 5_000;
      const humans = humanPlayers(ctx, meta);
      if (tribeAttacks(ctx, bots, humans, t)) changed = true;
      if (humanRaids(ctx, bots, humans, t)) changed = true;
    }
  }
  return changed;
}

