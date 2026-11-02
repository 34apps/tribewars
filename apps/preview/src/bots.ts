// Computer players for the preview, so tribe features can be tried alone. Deliberately simple and isolated:
//  - seedBots(): on a fresh world, 8 bot players with villages of different sizes in 3 bot tribes (made with the real
//    TribeService, so they appear in the ranking, map and tribe finder like anyone else);
//  - botTick(): reacts to the human with the real services (accept applications after ~20 s, answer diplomacy proposals
//    after ~20-30 s, welcome newcomers in tribe chat) and now and then sends a bot raid at an abandoned village.
// Reactions are driven by timestamps already in the database, so they survive a page reload. Bots never attack players.

import { BUILDING_IDS, BUILDINGS, UNITS, UNIT_IDS, createPlayerVillage, findSpawnLocation, mulberry32, settleVillage, storageCapForLevel, villagePoints } from '@clanfire/engine';
import type { BuildingId, Recruitment, Units, VillageState } from '@clanfire/engine';
import type { AppContext } from '../../server/src/context.ts';
import type { PlayerRow } from '../../server/src/store.ts';

interface BotPlan {
  name: string;
  /** Town Hall level; the rest of the village is derived from it. */
  level: number;
  tribe: 'EMBR' | 'ASH' | 'MIST';
  role: 'leader' | 'officer' | 'member';
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
  { name: 'Brannoch', level: 9, tribe: 'EMBR', role: 'leader' },
  { name: 'Ysolde_K', level: 6, tribe: 'EMBR', role: 'officer' },
  { name: 'Ironhart', level: 4, tribe: 'EMBR', role: 'member' },
  { name: 'Tolvek', level: 10, tribe: 'ASH', role: 'leader' },
  { name: 'Grimwald', level: 7, tribe: 'ASH', role: 'officer' },
  { name: 'Odalys', level: 5, tribe: 'ASH', role: 'member' },
  { name: 'Mira_of_Vale', level: 6, tribe: 'MIST', role: 'leader' },
  { name: 'Sable', level: 3, tribe: 'MIST', role: 'member' },
];

const META_KEY = 'preview_bots';
const ACCEPT_APPLICATION_AFTER_MS = 20_000;
const WELCOME_AFTER_MS = 3_000;
const FIRST_RAID_MS = 75_000;
const RAID_EVERY_MS = 150_000;

interface BotMeta {
  /** playerId -> tribe tag */
  bots: Record<string, string>;
  /** tribe tag -> tribe id */
  tribes: Record<string, number>;
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
function restock(v: VillageState): void {
  const level = v.buildings.hall;
  const want: Partial<Units> = {};
  for (const u of UNIT_IDS) {
    const def = UNITS[u];
    const ok = (Object.keys(def.requires) as BuildingId[]).every((b) => v.buildings[b] >= (def.requires[b] ?? 0));
    if (!ok) continue;
    want[u] = u === 'raider' ? level * 8 : u === 'pikeman' ? level * 6 : u === 'guard' ? level * 3 : u === 'outrider' ? level * 2 : 0;
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
  const meta: BotMeta = { bots: {}, tribes: {} };
  const rows = new Map<string, PlayerRow>();

  store.tx(() => {
    for (const bot of BOTS) {
      // Bots cannot sign in: "bot" is not a valid password hash, so verifyPassword always refuses it.
      const id = store.insertPlayer(bot.name, 'bot', t, 0);
      const spot = findSpawnLocation((x, y) => store.villageExistsAt(x, y), rng, settings);
      const state = botVillage(bot.level, t);
      restock(state);
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

/** Pick a bot at random and send raiders at a nearby abandoned village. */
function botRaid(ctx: AppContext, meta: BotMeta, t: number): boolean {
  const { store, game, settings } = ctx;
  const ids = Object.keys(meta.bots).map(Number);
  const id = ids[Math.floor(Math.random() * ids.length)];
  if (id === undefined) return false;
  const player = store.getPlayer(id);
  const home = store.villagesOfPlayer(id)[0];
  if (!player || !home) return false;

  const state = settleVillage(home.state, t, settings);
  restock(state);
  store.saveVillage(home.id, state, villagePoints(state));

  const R = 14;
  const near = store
    .mapVillages(home.x - R, home.x + R, home.y - R, home.y + R)
    .filter((m) => m.ownerId === null)
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))
    .slice(0, 4);
  const target = near[Math.floor(Math.random() * near.length)];
  if (!target) return false;
  const raiders = Math.min(state.troops.raider, 40 + state.buildings.hall * 4);
  try {
    game.send(player, home.id, target.x, target.y, { raider: raiders }, t);
    return true;
  } catch {
    return false; // e.g. the troops are still out: try again next time
  }
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

  // 4. An occasional bot raid on an abandoned village, so the map keeps moving.
  if (nextRaidAt === 0) nextRaidAt = t + FIRST_RAID_MS;
  if (t >= nextRaidAt) {
    nextRaidAt = t + RAID_EVERY_MS * (0.7 + Math.random() * 0.6);
    if (botRaid(ctx, meta, t)) changed = true;
  }
  return changed;
}

