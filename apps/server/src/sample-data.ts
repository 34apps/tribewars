// Sandbox "Fill with sample data" (test mode only): fills the signed-in player's own account with rich sample content so every
// page can be looked at with data on it: reports of every kind, mail, a tribe with all its tabs, troops at home / away /
// returning, incoming marches and support in and out.
//
// Guard: the same allow-list as every other test-mode action (`Store.isSandboxUser`, SANDBOX_USERS; empty in production).
// Everything is written through the normal stores (the same rows the game itself writes). Reports and troop marches are inserted
// the way the existing demo seeds do it: a real battle or a real march would need a long real-time wait. Idempotent: a marker in
// the world's meta table (per player) makes a second press change nothing.

import {
  GameError,
  TRIBE_CHAT_KEEP,
  TRIBE_EVENTS_KEEP,
  UNIT_IDS,
  buildScoutIntel,
  createPlayerVillage,
  emptyResources,
  emptyUnits,
  findSpawnLocation,
  mulberry32,
  resolveBattle,
  projectCost,
  settleVillage,
  villagePoints,
  type BattleReportData,
  type BuildingId,
  type ChieftainId,
  type DiplomacyKind,
  type Recruitment,
  type Resources,
  type ScoutReportData,
  type TribeRole,
  type Units,
  type VillageRefDto,
  type VillageReportData,
  type VillageState,
} from '@clanfire/engine';
import type { AppContext } from './context.ts';
import type { NewReport, PlayerRow, VillageRecord } from './store.ts';

export interface SampleDataResponse {
  /** false = this account was filled before: only the sample reports were replaced (`refreshed`). */
  created: boolean;
  /** true = second press: the earlier sample reports were replaced by a new set; nothing else changed. */
  refreshed: boolean;
  counts: { reports: number; mails: number; players: number; tribeMessages: number; forumThreads: number; marches: number };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MARKER = (playerId: number): string => `sample_data:${playerId}`;
/** JSON list of the report ids this feature made for a player: only these are replaced on a refresh. */
const REPORT_IDS = (playerId: number): string => `sample_reports:${playerId}`;

type Draft<T> = T extends unknown ? Omit<T, 'playerId' | 'createdAt'> : never;

const units = (p: Partial<Units>): Units => ({ ...emptyUnits(), ...p });
const res = (wood: number, food: number, iron: number, gold = 0): Resources => ({ wood, food, iron, gold });

interface CastPlan {
  name: string;
  chieftain: ChieftainId;
  hall: number;
  /** Role in the player's tribe, or the tag of the tribe this person leads. */
  tribe?: 'mine' | string;
  role?: TribeRole;
}

/** Players around the account. Names are marked "Sample_" so they are never mistaken for real players. */
const CAST: CastPlan[] = [
  { name: 'Sample_Ysolde', chieftain: 'ysra', hall: 8, tribe: 'mine', role: 'officer' },
  { name: 'Sample_Brannoch', chieftain: 'brannoc', hall: 9, tribe: 'mine', role: 'officer' },
  { name: 'Sample_Hild', chieftain: 'hild', hall: 5, tribe: 'mine', role: 'member' },
  { name: 'Sample_Wren', chieftain: 'wren', hall: 4, tribe: 'mine', role: 'member' },
  { name: 'Sample_Odalys', chieftain: 'saffi', hall: 6, tribe: 'mine', role: 'member' },
  { name: 'Sample_Tolvek', chieftain: 'corwen', hall: 10, tribe: 'RAVN', role: 'leader' },
  { name: 'Sample_Grimwald', chieftain: 'old-orm', hall: 7, tribe: 'RAVN', role: 'member' },
  { name: 'Sample_Mira', chieftain: 'maelis', hall: 6, tribe: 'STNE', role: 'leader' },
  { name: 'Sample_Corwen', chieftain: 'corwen', hall: 8, tribe: 'ROOK', role: 'leader' },
  { name: 'Sample_Khorza', chieftain: 'khorza', hall: 7, tribe: 'MSTW', role: 'leader' },
  { name: 'Sample_Barley', chieftain: 'barley-tam', hall: 5, tribe: 'ASHL', role: 'leader' },
  { name: 'Sample_Orm', chieftain: 'old-orm', hall: 6, tribe: 'WOLF', role: 'leader' },
  { name: 'Sample_Saffi', chieftain: 'saffi', hall: 3, role: 'member' }, // applicants and others: no tribe
  { name: 'Sample_Maelis', chieftain: 'maelis', hall: 3, role: 'member' },
  { name: 'Sample_Kestrel', chieftain: 'wren', hall: 4, role: 'member' },
  { name: 'Sample_Vex', chieftain: 'ysra', hall: 6, role: 'member' },
];

const OTHER_TRIBES: Array<{ tag: string; name: string; recruitment: Recruitment }> = [
  { tag: 'RAVN', name: 'Raven Pact', recruitment: 'application' },
  { tag: 'STNE', name: 'Stone Oath', recruitment: 'open' },
  { tag: 'ROOK', name: 'Black Rooks', recruitment: 'invite' },
  { tag: 'MSTW', name: 'Mist Walkers', recruitment: 'open' },
  { tag: 'ASHL', name: 'Ash Legion', recruitment: 'application' },
  { tag: 'WOLF', name: 'Wolf Hall', recruitment: 'open' },
];

/** A cast village sized by Town Hall level, with a standing army. Built straight as state (no waiting for construction). */
function castVillage(hall: number, t: number): VillageState {
  const v = createPlayerVillage(t);
  const set = (b: keyof VillageState['buildings'], n: number): void => {
    v.buildings[b] = Math.max(v.buildings[b], n);
  };
  set('hall', hall);
  set('lumber', hall + 1);
  set('farm', hall + 1);
  set('mine', hall);
  set('storehouse', hall);
  if (hall >= 3) set('barracks', hall - 2);
  if (hall >= 4) set('wall', hall - 3);
  v.renownPaid = { ...v.buildings };
  v.troops = units({ pikeman: hall * 12, guard: hall * 6, raider: hall * 9, outrider: hall * 3, pathfinder: Math.floor(hall / 2) });
  for (const r of ['wood', 'food', 'iron'] as const) v.resources[r] = 2000 + hall * 300;
  return v;
}

export function fillSampleData(ctx: AppContext, player: PlayerRow, t: number): SampleDataResponse {
  const { store, settings } = ctx;
  if (!store.isSandboxUser(player.username)) throw new GameError('forbidden', 'Test mode is not available for this account.');
  const marker = store.getMeta(MARKER(player.id));
  const refresh = marker !== null;
  const counts: SampleDataResponse['counts'] = { reports: 0, mails: 0, players: 0, tribeMessages: 0, forumThreads: 0, marches: 0 };
  const madeIds: number[] = [];

  store.tx(() => {
    const home = store.villagesOfPlayer(player.id)[0];
    if (!home) throw new GameError('not_found', 'You have no village to fill.');
    const rng = mulberry32(settings.seed ^ 0x51ab1e ^ player.id);
    const ago = (ms: number): number => t - ms;

    // ---- the cast: players with villages ---------------------------------------------------------
    const people = new Map<string, { player: PlayerRow; village: VillageRecord }>();
    for (const c of CAST) {
      let row = store.getPlayerByLowerName(c.name.toLowerCase());
      if (!row) {
        const id = store.insertPlayer(c.name, 'bot', t - 20 * DAY, 0, c.chieftain); // 'bot' is never a valid hash: nobody can sign in
        row = store.getPlayer(id);
        counts.players++;
      }
      if (!row) continue;
      let v = store.villagesOfPlayer(row.id)[0];
      if (!v) {
        const spot = findSpawnLocation((x, y) => store.villageExistsAt(x, y), rng, settings);
        const state = castVillage(c.hall, t);
        const id = store.insertVillage(row.id, `${c.name.replace('Sample_', '')}'s village`, spot.x, spot.y, villagePoints(state), state);
        v = store.getVillage(id) ?? undefined;
      }
      if (v) people.set(c.name, { player: row, village: v });
    }
    const who = (name: string): { player: PlayerRow; village: VillageRecord } => {
      const p = people.get(name);
      if (!p) throw new Error(`sample cast member ${name} missing`);
      return p;
    };
    const ref = (v: { id: number; name: string; x: number; y: number }, owner: string | null): VillageRefDto => ({ villageId: v.id, name: v.name, x: v.x, y: v.y, ownerName: owner });
    const refPlayer = (name: string): VillageRefDto => ref(who(name).village, who(name).player.username);
    const me = ref(home, player.username);

    // Abandoned villages near the account (real ones when the map has them).
    const abandoned = store
      .mapVillages(home.x - 25, home.x + 25, home.y - 25, home.y + 25)
      .filter((m) => m.ownerId === null)
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))
      .slice(0, 4);
    const abandonedRef = (i: number): VillageRefDto => {
      const m = abandoned[i % Math.max(1, abandoned.length)];
      return m ? { villageId: m.id, name: m.name, x: m.x, y: m.y, ownerName: null } : { villageId: 0, name: 'Abandoned village', x: home.x + 4 + i, y: home.y - 3 - i, ownerName: null };
    };
    const coords = (r: { x: number; y: number }): string => `(${r.x}|${r.y})`;

    if (!refresh) {
    // ---- the player's tribe ---------------------------------------------------------------------
    const existing = store.tribes.membership(player.id);
    let tribeId: number;
    if (existing) {
      tribeId = existing.tribeId;
    } else {
      let tribe = store.tribes.getTribeByTag('HRTH');
      if (!tribe) {
        const id = store.tribes.insertTribe('Hearth Keepers', 'HRTH', 'A friendly tribe of farmers and raiders. Sample tribe made by the test-mode data fill.', 'application', ago(14 * DAY));
        store.forum.createDefaultBoards(id, ago(14 * DAY));
        tribe = store.tribes.getTribe(id);
      }
      if (!tribe) throw new Error('sample tribe vanished');
      tribeId = tribe.id;
      store.tribes.insertMember(player.id, tribeId, 'leader', ago(14 * DAY));
    }
    const tribeEvent = (at: number, text: string, tribe = tribeId): void => store.tribes.insertEvent(tribe, at, text, TRIBE_EVENTS_KEEP);
    const mates = CAST.filter((c) => c.tribe === 'mine');
    mates.forEach((c, i) => {
      const p = who(c.name).player;
      if (!store.tribes.membership(p.id)) {
        store.tribes.insertMember(p.id, tribeId, c.role ?? 'member', ago((12 - i * 2) * DAY));
        tribeEvent(ago((12 - i * 2) * DAY), `${p.username} joined the tribe.`);
      }
    });
    tribeEvent(ago(14 * DAY), `${player.username} founded the tribe.`);

    // Other tribes, each with its leader (and Raven Pact with a second member).
    const otherTribe = new Map<string, number>();
    for (const o of OTHER_TRIBES) {
      let tribe = store.tribes.getTribeByTag(o.tag);
      if (!tribe) {
        const id = store.tribes.insertTribe(o.name, o.tag, `${o.name}: sample tribe for diplomacy.`, o.recruitment, ago(30 * DAY));
        store.forum.createDefaultBoards(id, ago(30 * DAY));
        tribe = store.tribes.getTribe(id);
      }
      if (!tribe) continue;
      otherTribe.set(o.tag, tribe.id);
      for (const c of CAST.filter((x) => x.tribe === o.tag)) {
        const p = who(c.name).player;
        if (!store.tribes.membership(p.id)) store.tribes.insertMember(p.id, tribe.id, c.role ?? 'member', ago(25 * DAY));
      }
    }
    const rel = (tag: string, kind: DiplomacyKind, createdAt: number, endsAt: number | null, declaredBy: number | null): void => {
      const other = otherTribe.get(tag);
      if (other === undefined || other === tribeId) return;
      store.tribes.deleteRelationBetween(tribeId, other);
      store.tribes.insertRelation(tribeId, other, kind, declaredBy, createdAt, endsAt);
    };
    rel('RAVN', 'ally', ago(9 * DAY), null, null);
    rel('STNE', 'nap', ago(6 * DAY), null, null);
    rel('WOLF', 'nap', ago(8 * DAY), t + 18 * HOUR, tribeId); // being cancelled: serving its notice
    rel('ROOK', 'enemy', ago(3 * DAY), null, tribeId);
    const proposal = (from: string, kind: 'ally' | 'nap', at: number, fromMine = false): void => {
      const other = otherTribe.get(from);
      if (other === undefined) return;
      const a = fromMine ? tribeId : other;
      const b = fromMine ? other : tribeId;
      if (!store.tribes.proposalBetween(a, b)) store.tribes.insertProposal(kind, a, b, at);
    };
    proposal('MSTW', 'nap', ago(2 * HOUR)); // they propose to us
    proposal('ASHL', 'ally', ago(5 * HOUR), true); // we proposed to them
    tribeEvent(ago(9 * DAY), '[RAVN] accepted our alliance proposal.');
    tribeEvent(ago(6 * DAY), `${who('Sample_Ysolde').player.username} accepted the non-aggression pact with [STNE].`);
    tribeEvent(ago(3 * DAY), `${player.username} declared [ROOK] an enemy.`);
    tribeEvent(ago(2 * DAY), `${who('Sample_Brannoch').player.username} cancelled the non-aggression pact with [WOLF].`);
    tribeEvent(ago(5 * HOUR), `${player.username} proposed an alliance with [ASHL].`);
    tribeEvent(ago(2 * HOUR), '[MSTW] proposed a non-aggression pact with us.');
    tribeEvent(ago(40 * HOUR), `${who('Sample_Hild').player.username} set recruitment to application.`);
    tribeEvent(ago(30 * HOUR), `${player.username} made ${who('Sample_Hild').village.name} the store village.`);
    tribeEvent(ago(20 * HOUR), `${player.username} started Roads level 3.`);
    tribeEvent(ago(10 * HOUR), `${who('Sample_Wren').player.username} was promoted to officer.`);

    // Applications and an invitation.
    const apps: Array<[string, string]> = [
      ['Sample_Saffi', 'I trade a lot and want to feed your store. Active every day.'],
      ['Sample_Maelis', 'Looking for a calm tribe. I can scout for you.'],
    ];
    for (const [name, msg] of apps) {
      const p = who(name).player;
      if (!store.tribes.findApplication(tribeId, p.id)) store.tribes.insertApplication(tribeId, p.id, msg, ago(3 * HOUR));
    }
    const kestrel = who('Sample_Kestrel').player;
    if (!store.tribes.findInvite(tribeId, kestrel.id, t)) store.tribes.insertInvite(tribeId, kestrel.id, player.id, ago(5 * HOUR), t + 2 * DAY);

    // Tribe chat.
    const chatPlan: Array<[string, string, number]> = [
      ['Sample_Brannoch', 'Morning all. Walls first, then the lumber camps. That is my advice for newcomers.', 30 * HOUR],
      ['Sample_Ysolde', 'Raided an abandoned village near the lake. Nice haul of iron.', 29 * HOUR],
      [player.username, 'Nice! Please keep the rotation: not the same village twice in an hour.', 28 * HOUR],
      ['Sample_Hild', 'Who can send me a few guards? Rooks keep scouting my village.', 20 * HOUR],
      ['Sample_Wren', 'Sending 20 now.', 19 * HOUR],
      [player.username, 'Reminder: Roads level 3 is running, please give to the Tribe Store today.', 12 * HOUR],
      ['Sample_Odalys', 'Given 4,000 wood.', 11 * HOUR],
      ['Sample_Ysolde', 'Anyone seen their outriders? Mine are not back yet.', 6 * HOUR],
      ['Sample_Brannoch', 'Enemy march on Hild, arriving in about two hours. Support if you can.', 3 * HOUR],
      [player.username, 'On it. Guards leave in ten minutes.', 170 * MIN],
      ['Sample_Hild', 'Thank you all!', 100 * MIN],
      ['Sample_Wren', 'Good luck out there.', 20 * MIN],
    ];
    for (const [name, text, back] of chatPlan) {
      const p = name === player.username ? player : who(name).player;
      store.tribes.insertMessage(tribeId, p.id, text, ago(back), TRIBE_CHAT_KEEP);
      counts.tribeMessages++;
    }

    // Tribe Store, projects and funding ledger.
    store.projects.ensure(tribeId);
    store.projects.setResources(tribeId, res(185_000, 142_000, 96_000, 4_000));
    store.projects.setVillage(tribeId, who('Sample_Hild').village.id, ago(30 * HOUR));
    store.projects.setLevel(tribeId, 'roads', 2);
    store.projects.setLevel(tribeId, 'watchtower', 1);
    if (!store.projects.getRun(tribeId)) {
      store.projects.insertRun({ tribeId, project: 'wards', level: 1, startedAt: ago(1 * HOUR), endsAt: t + 6 * HOUR, cost: projectCost(1) });
    }
    const ledger: Array<[string, Resources, number]> = [
      [player.username, res(6000, 4000, 2000), 36 * HOUR],
      ['Sample_Ysolde', res(5000, 5000, 3000), 30 * HOUR],
      ['Sample_Odalys', res(4000, 0, 0), 11 * HOUR],
      ['Sample_Brannoch', res(8000, 6000, 4000, 200), 8 * HOUR],
      ['Sample_Hild', res(2500, 2500, 1500), 5 * HOUR],
    ];
    for (const [name, r, back] of ledger) {
      const p = name === player.username ? player : who(name).player;
      store.projects.insertLedger(tribeId, p.id, p.username, r, ago(back));
    }

    // Forum.
    const boards = store.forum.boards(tribeId, player.id);
    const boardNamed = (n: string): number | undefined => (boards.find((b) => b.name === n) ?? boards[0])?.id;
    const thread = (board: string, author: string, title: string, body: string, back: number, replies: Array<[string, string]> = [], flags: { pinned?: boolean; locked?: boolean } = {}): void => {
      const boardId = boardNamed(board);
      if (boardId === undefined) return;
      const a = author === player.username ? player : who(author).player;
      const id = store.forum.insertThread(boardId, tribeId, a.id, title, ago(back));
      store.forum.insertPost(id, a.id, body, ago(back));
      replies.forEach(([name, text], i) => {
        const p = name === player.username ? player : who(name).player;
        store.forum.insertPost(id, p.id, text, ago(back - (i + 1) * 17 * MIN));
      });
      store.forum.refreshThread(id, ago(back));
      if (flags.pinned || flags.locked) store.forum.setThreadFlags(id, flags.pinned ?? false, flags.locked ?? false);
      store.forum.markRead(player.id, id, t - 2 * HOUR);
      counts.forumThreads++;
    };
    thread('Announcements', player.username, 'Welcome to Hearth Keepers', 'Read this first: be active, help each other, give to the Tribe Store when you can.', 13 * DAY, [['Sample_Wren', 'Glad to be here!']], { pinned: true });
    thread('Announcements', player.username, 'War with the Black Rooks', 'We declared [ROOK] an enemy. Keep scouts home and walls up. Report any march you see.', 3 * DAY, [['Sample_Brannoch', 'Understood.'], ['Sample_Ysolde', 'Walls are at 6 here.']], { locked: true });
    thread('Announcements', 'Sample_Brannoch', 'Tribe Store: Roads level 3', 'Everyone please send what you can spare. Daily cap applies.', 20 * HOUR);
    const long: Array<[string, string]> = [];
    const talkers = ['Sample_Ysolde', 'Sample_Hild', 'Sample_Wren', 'Sample_Odalys', player.username];
    for (let i = 0; i < 24; i++) long.push([talkers[i % talkers.length] as string, `Reply ${i + 1}: my numbers are ${100 + i * 7} raiders at home; who needs what before the weekend?`]);
    thread('General', 'Sample_Odalys', 'Army sizes: who has what?', 'Let us compare armies so the leadership can plan. Post your raiders, guards and outriders.', 6 * DAY, long);
    thread('General', 'Sample_Hild', 'Best use of the Drillyard?', 'Is Might or Bulwark better for a defensive village?', 2 * DAY, [['Sample_Brannoch', 'Bulwark for defence, Might for raiders.'], [player.username, 'Agreed, and Keen for scouts.']]);
    thread('General', 'Sample_Wren', 'Abandoned villages near the lake', 'Three are free to farm. Please keep the rotation.', 30 * HOUR, [['Sample_Ysolde', 'Taking the north one.']]);
    thread('General', 'Sample_Ysolde', 'Looking for more members', 'We are recruiting. Spread the word.', 12 * HOUR);
    thread('Leadership', player.username, 'Candidates', 'Saffi and Maelis applied. Thoughts?', 3 * HOUR, [['Sample_Brannoch', 'Saffi trades well, accept.'], ['Sample_Ysolde', 'Maelis can scout. Accept both.']]);
    thread('Leadership', 'Sample_Brannoch', 'Plan against the Rooks', 'Hit their weakest village first once the siege rams are done.', 2 * DAY);

    // ---- mail: a few long threads with different players -------------------------------------------
    const mailPlan: Array<[string, string, Array<[boolean, string]>, number, boolean]> = [
      // [other, subject, [fromMe, text] oldest first, hours ago of the first, leave the last unread]
      ['Sample_Ysolde', 'Raid rotation', longThread(14, ['Which village are you hitting tonight?', 'The north one, 40 raiders.', 'I will take the east one then.', 'Remember the loot is full when stocks are high.']), 9 * 24, false],
      ['Sample_Brannoch', 'Wall levels', longThread(10, ['How high is your wall?', 'Level 6. You?', 'Level 8, but the Rooks have rams.', 'Then build more guards.']), 5 * 24, false],
      ['Sample_Vex', 'Trade?', longThread(7, ['I have spare iron. Want to trade?', 'Not now.', 'Then I will take it by force.', 'You can try.']), 30, true],
      ['Sample_Tolvek', 'Alliance terms', longThread(5, ['We are happy with the pact so far.', 'Same here. Support goes both ways.']), 3 * 24, false],
      ['Sample_Kestrel', 'Invitation', [[false, 'Thanks for the invitation. I will think about it.']], 4, true],
      ['Sample_Saffi', 'Application', [[false, 'I applied to your tribe. Any news?']], 2, true],
      ['Sample_Mira', 'NAP renewal', longThread(4, ['Your NAP is fine with us.', 'Good, renew it next week.']), 6 * 24, false],
    ];
    for (const [other, subject, msgs, firstHoursAgo, lastUnread] of mailPlan) {
      const o = who(other).player;
      msgs.forEach(([fromMe, text], i) => {
        const at = t - firstHoursAgo * HOUR + i * Math.floor((firstHoursAgo * HOUR * 0.9) / Math.max(1, msgs.length));
        const from = fromMe ? player : o;
        const to = fromMe ? o : player;
        const id = store.mail.insert(from.id, to.id, i === 0 ? subject : `Re: ${subject}`, text, Math.min(at, t - MIN));
        counts.mails++;
        const unread = lastUnread && i === msgs.length - 1 && !fromMe;
        if (!fromMe && !unread) store.mail.markRead(id, player.id, at + 5 * MIN);
        if (fromMe) store.mail.markRead(id, o.id, at + 9 * MIN);
      });
    }

    }
    // ---- reports ---------------------------------------------------------------------------------
    const mateRef = refPlayer('Sample_Ysolde');
    const hildRef = refPlayer('Sample_Hild');
    const vexRef = refPlayer('Sample_Vex');
    const corwenRef = refPlayer('Sample_Corwen');
    const storeRef = hildRef;
    const storeLoot = res(6200, 5100, 3300);
    const reports: Array<{ back: number; r: Draft<NewReport> }> = [];
    const add = (back: number, r: Draft<NewReport>): void => {
      reports.push({ back, r });
    };
    const battle = (b: Partial<BattleReportData> & Pick<BattleReportData, 'attacker' | 'defender' | 'attackerWon' | 'attackerUnits'>): BattleReportData => ({
      outcome: 'battle',
      luck: 0.03,
      attackPower: 3200,
      defensePower: 1500,
      attackerLosses: units({}),
      defenderUnits: units({ pikeman: 20 }),
      defenderLosses: units({ pikeman: 20 }),
      supportUnits: null,
      supportLosses: null,
      wallLevel: 2,
      loot: emptyResources(),
      ...b,
    });
    const scout = (target: VillageRefDto, success: boolean, keen: number | null, extra: Partial<ScoutReportData> = {}): ScoutReportData => {
      const tgt = castVillage(6, t);
      tgt.troops = units({ pikeman: 240, guard: 130, raider: 160, outrider: 55, knight: 9, pathfinder: 18, logram: 6, boulder: 8 });
      return {
        scout: me,
        target,
        success,
        scoutsSent: 30,
        scoutsLost: success ? 4 : 30,
        defenderScouts: success ? 12 : null,
        defenderScoutsLost: success ? 0 : 9,
        intel: success && keen !== null ? buildScoutIntel({ keen, resources: res(1840, 1210, 960, 12), buildings: tgt.buildings, troops: tgt.troops, ranks: { pikeman: { might: 1, bulwark: 2, keen: 0 } } }) : null,
        ...extra,
      };
    };
    const village = (kind: VillageReportData['kind'], v: VillageRefDto, extra: Partial<VillageReportData> = {}): VillageReportData => ({ kind, village: v, ...extra });

    // Today
    add(3 * HOUR, { side: 'attack', type: 'scout', won: true, title: `Scouting ${corwenRef.name} ${coords(corwenRef)}`, scout: scout(corwenRef, true, 5) });
    add(4 * HOUR, { side: 'attack', type: 'scout', won: false, title: `Scouting ${vexRef.name} ${coords(vexRef)}`, scout: scout(vexRef, false, null) });
    add(5 * HOUR, { side: 'shipment', type: 'shipment', won: true, title: `Shipment received from ${mateRef.name} ${coords(mateRef)}`, shipment: { role: 'received', from: mateRef, to: me, resources: res(4000, 3000, 2000), stored: res(4000, 3000, 2000), lost: emptyResources() } });
    add(8 * HOUR, { side: 'attack', type: 'village', won: true, title: `Hearth out at ${abandonedRef(2).name} ${coords(abandonedRef(2))}`, village: village('struck', abandonedRef(2), { holdEndsAt: t + 20 * HOUR }) });
    // Yesterday
    add(30 * HOUR, { side: 'attack', type: 'battle', won: false, title: `Attack on ${mateRef.name} ${coords(mateRef)} called off`, battle: { ...battle({ attacker: me, defender: mateRef, attackerWon: false, attackerUnits: units({ raider: 25 }) }), outcome: 'called_off', luck: 0, attackPower: 0, defensePower: 0, defenderUnits: null, defenderLosses: null, wallLevel: null } });
    add(32 * HOUR, { side: 'attack', type: 'scout', won: true, title: `Scouting ${abandonedRef(0).name} ${coords(abandonedRef(0))}`, scout: scout(abandonedRef(0), true, 0, { defenderScouts: 0, scoutsLost: 0 }) });
    add(33 * HOUR, { side: 'attack', type: 'scout', won: true, title: `Scouting ${vexRef.name} ${coords(vexRef)}`, scout: scout(vexRef, true, 2) });
    add(38 * HOUR, { side: 'support', type: 'support', won: false, title: `Support for ${hildRef.name} ${coords(hildRef)} turned back`, support: { reason: 'relation_changed', home: me, host: hildRef, units: units({ guard: 30, pikeman: 10 }) } });
    add(40 * HOUR, { side: 'shipment', type: 'shipment', won: true, title: `Shipment delivered to ${mateRef.name} ${coords(mateRef)}`, shipment: { role: 'sent', from: me, to: mateRef, resources: res(5000, 3000, 2000), stored: res(3900, 3000, 2000), lost: res(1100, 0, 0) } });
    add(42 * HOUR, { side: 'shipment', type: 'shipment', won: true, title: `Shipment delivered into the Tribe Store at ${storeRef.name} ${coords(storeRef)}`, shipment: { role: 'sent', from: me, to: storeRef, resources: res(6000, 4000, 2000), stored: res(6000, 4000, 2000), lost: emptyResources() } });
    // Older
    add(3 * DAY, { side: 'defense', type: 'scout', won: true, title: `Enemy scouts from ${vexRef.name} ${coords(vexRef)}`, scout: { ...scout(me, false, null), scout: vexRef, target: me, defenderScouts: 6, defenderScoutsLost: 0, scoutsLost: 5, scoutsSent: 5 } });
    add(3 * DAY + 2 * HOUR, { side: 'defense', type: 'scout', won: false, title: `Enemy scouts from ${corwenRef.name} ${coords(corwenRef)}`, scout: { ...scout(me, true, null), scout: corwenRef, target: me, defenderScouts: 3, defenderScoutsLost: 1, intel: null } });
    add(3 * DAY + 5 * HOUR, { side: 'attack', type: 'scout', won: true, title: `Scouting ${corwenRef.name} ${coords(corwenRef)}`, scout: scout(corwenRef, true, 3) });
    add(4 * DAY, { side: 'attack', type: 'scout', won: true, title: `Scouting ${vexRef.name} ${coords(vexRef)}`, scout: scout(vexRef, true, 4) });
    add(4 * DAY + 3 * HOUR, { side: 'attack', type: 'scout', won: true, title: `Scouting ${abandonedRef(1).name} ${coords(abandonedRef(1))}`, scout: scout(abandonedRef(1), true, 1) });
    add(5 * DAY, { side: 'attack', type: 'village', won: true, title: `Village taken: ${abandonedRef(3).name} ${coords(abandonedRef(3))}`, village: village('taken', abandonedRef(3), { overflow: units({ raider: 8 }) }) });
    add(5 * DAY + HOUR, { side: 'defense', type: 'village', won: false, title: `Village lost: ${me.name} ${coords(me)}`, village: village('lost', me, { claimBy: vexRef.ownerName ?? 'Sample_Vex', units: units({ raider: 20, outrider: 4 }) }) });
    add(6 * DAY, { side: 'attack', type: 'village', won: true, title: `Village founded: New village ${coords({ x: home.x + 6, y: home.y + 6 })}`, village: village('founded', { villageId: 0, name: 'New village', x: home.x + 6, y: home.y + 6, ownerName: player.username }, { overflow: units({ pikeman: 5 }) }) });
    add(6 * DAY + HOUR, { side: 'attack', type: 'village', won: false, title: `Founding at ${coords({ x: home.x - 5, y: home.y + 7 })} failed`, village: village('found_failed', { villageId: 0, name: 'New village', x: home.x - 5, y: home.y + 7, ownerName: null }, { reason: 'tile_taken' }) });
    add(7 * DAY, { side: 'attack', type: 'village', won: false, title: `Claim on ${abandonedRef(2).name} ${coords(abandonedRef(2))} ended`, village: village('claim_failed', abandonedRef(2), { reason: 'time', units: units({ raider: 12, chieftain: 1 }) }) });
    add(7 * DAY + HOUR, { side: 'defense', type: 'village', won: true, title: `Hearth relit at ${me.name} ${coords(me)}`, village: village('relit', me) });
    add(8 * DAY, { side: 'defense', type: 'village', won: false, title: `Hearth out at ${me.name} ${coords(me)}`, village: village('hearth_out', me, { claimBy: 'Sample_Vex', holdEndsAt: ago(7 * DAY + 20 * HOUR) }) });
    add(8 * DAY + HOUR, { side: 'attack', type: 'village', won: true, title: `Hearth out at ${abandonedRef(3).name} ${coords(abandonedRef(3))}`, village: village('struck', abandonedRef(3), { holdEndsAt: null }) });
    add(10 * DAY, { side: 'shipment', type: 'shipment', won: true, title: `Shipment received from ${refPlayer('Sample_Brannoch').name} ${coords(refPlayer('Sample_Brannoch'))}`, shipment: { role: 'received', from: refPlayer('Sample_Brannoch'), to: me, resources: res(9000, 0, 0), stored: res(6500, 0, 0), lost: res(2500, 0, 0) } });
    /**
     * A battle report built from the engine's real battle function: the losses, powers, loot and siege hits are what resolveBattle gives
     * for these armies, so the report always matches who won. As in the game, an attacker who lost sees none of the defence.
     */
    const fight = (back: number, side: 'attack' | 'defense' | 'support', other: VillageRefDto, title: string, o: {
      attacker: VillageRefDto; defender: VillageRefDto; att: Partial<Units>; def: Partial<Units>; sup?: Partial<Units>; wall: number;
      luck?: number; morale?: number; siegeTarget?: BuildingId; renown?: number; noLoot?: boolean; tribeStore?: Resources;
    }): void => {
      const dv = castVillage(6, t);
      dv.troops = units(o.def);
      dv.buildings.wall = o.wall;
      dv.buildings.barracks = 6;
      dv.buildings.storehouse = 9;
      for (const r of ['wood', 'food', 'iron'] as const) dv.resources[r] = 14_000;
      const r = resolveBattle(
        { attackerUnits: units(o.att), defender: dv, support: o.sup ? [units(o.sup)] : undefined, seed: 7000 + reports.length, fixedLuck: o.luck ?? 0.03, moraleFactor: o.morale, noLoot: o.noLoot, siegeTarget: o.siegeTarget, extraLootable: o.tribeStore },
        { config: settings.config },
      );
      const hidden = side === 'attack' && !r.attackerWon;
      const sup = o.sup ? units(o.sup) : null;
      const loot = r.loot;
      const b: BattleReportData = {
        outcome: 'battle',
        attacker: o.attacker,
        defender: o.defender,
        attackerWon: r.attackerWon,
        luck: r.luck,
        attackPower: Math.round(r.attackPower),
        defensePower: Math.round(r.defensePower),
        attackerUnits: units(o.att),
        attackerLosses: r.attackerLosses,
        defenderUnits: hidden ? null : r.defenderUnits,
        defenderLosses: hidden ? null : r.defenderLosses,
        supportUnits: hidden ? null : sup,
        supportLosses: hidden || !sup ? null : (r.supportLosses[0] ?? null),
        wallLevel: hidden ? null : r.wallDuring,
        loot,
        ...(o.morale !== undefined ? { morale: o.morale } : {}),
        ...(o.tribeStore ? { lootFromTribeStore: res(Math.min(o.tribeStore.wood, loot.wood), Math.min(o.tribeStore.food, loot.food), Math.min(o.tribeStore.iron, loot.iron)) } : {}),
        ...(o.renown ? { renownGained: o.renown } : {}),
        ...(r.siege && r.siege.length > 0 ? { siege: hidden ? r.siege.filter((h) => h.building === 'wall') : r.siege } : {}),
      };
      const won = side === 'attack' ? r.attackerWon : !r.attackerWon;
      add(back, { side, type: 'battle', won, title, battle: b });
    };
    // Today
    fight(25 * MIN, 'attack', abandonedRef(0), `Raid on ${abandonedRef(0).name} ${coords(abandonedRef(0))}`, { attacker: me, defender: abandonedRef(0), att: { raider: 180, outrider: 40, pikeman: 30 }, def: { pikeman: 22, guard: 8 }, wall: 0 });
    fight(70 * MIN, 'attack', abandonedRef(1), `Raid on ${abandonedRef(1).name} ${coords(abandonedRef(1))}`, { attacker: me, defender: abandonedRef(1), att: { raider: 260, outrider: 60, knight: 12, pikeman: 40 }, def: { pikeman: 90, guard: 60, raider: 15, pathfinder: 6 }, wall: 3 });
    fight(2 * HOUR, 'defense', vexRef, `Attack from ${vexRef.name} ${coords(vexRef)}`, { attacker: vexRef, defender: me, att: { raider: 220, outrider: 70, knight: 10, logram: 24, boulder: 20 }, def: { pikeman: 260, guard: 180, raider: 40, outrider: 20, knight: 8, pathfinder: 12 }, sup: { guard: 90, pikeman: 60 }, wall: 6, renown: 12 });
    fight(6 * HOUR, 'attack', vexRef, `Raid on ${vexRef.name} ${coords(vexRef)}`, { attacker: me, defender: vexRef, att: { raider: 150, outrider: 30, knight: 6, pikeman: 40 }, def: { pikeman: 300, guard: 220, outrider: 25, pathfinder: 10 }, wall: 7 });
    fight(7 * HOUR, 'support', hildRef, `Your troops at ${hildRef.name} ${coords(hildRef)} were attacked`, { attacker: corwenRef, defender: hildRef, att: { raider: 200, outrider: 50, boulder: 20 }, def: { pikeman: 90, guard: 40 }, sup: { guard: 120, pikeman: 80, knight: 6 }, wall: 4, renown: 9 });
    // Yesterday
    fight(26 * HOUR, 'attack', vexRef, `Raid on ${vexRef.name} ${coords(vexRef)}`, { attacker: me, defender: vexRef, att: { raider: 320, outrider: 80, knight: 18, pikeman: 60, logram: 48, boulder: 40 }, def: { pikeman: 120, guard: 60, raider: 20, pathfinder: 8 }, wall: 8, siegeTarget: 'barracks' });
    fight(28 * HOUR, 'attack', corwenRef, `Raid on ${corwenRef.name} ${coords(corwenRef)}`, { attacker: me, defender: corwenRef, att: { raider: 140, outrider: 20, logram: 30, boulder: 24 }, def: { pikeman: 350, guard: 250, knight: 12, outrider: 40 }, wall: 9 });
    fight(36 * HOUR, 'defense', corwenRef, `Attack from ${corwenRef.name} ${coords(corwenRef)}`, { attacker: corwenRef, defender: me, att: { raider: 380, outrider: 90, knight: 25, logram: 40, boulder: 30 }, def: { pikeman: 90, guard: 50, raider: 20, pathfinder: 5 }, wall: 3, morale: 0.75 });
    fight(44 * HOUR, 'attack', corwenRef, `Raid on ${corwenRef.name} ${coords(corwenRef)}`, { attacker: me, defender: corwenRef, att: { raider: 240, outrider: 50, knight: 10, pikeman: 40 }, def: { pikeman: 110, guard: 45, pathfinder: 6 }, wall: 4, tribeStore: storeLoot, renown: 15 });
    // Older
    fight(9 * DAY, 'attack', hildRef, `Relief attack at ${hildRef.name} ${coords(hildRef)}`, { attacker: me, defender: hildRef, att: { raider: 120, outrider: 20 }, def: { raider: 30, pikeman: 12 }, sup: { pikeman: 40, guard: 10 }, wall: 1, noLoot: true });
    fight(11 * DAY, 'attack', abandonedRef(2), `Raid on ${abandonedRef(2).name} ${coords(abandonedRef(2))}`, { attacker: me, defender: abandonedRef(2), att: { raider: 210, outrider: 35, guard: 20 }, def: { pikeman: 40 }, wall: 1, morale: 0.75, renown: 4 });
    fight(12 * DAY, 'attack', vexRef, `Raid on ${vexRef.name} ${coords(vexRef)}`, { attacker: me, defender: vexRef, att: { raider: 200, outrider: 25, logram: 36, knight: 6 }, def: { pikeman: 280, guard: 160, outrider: 20 }, wall: 6 });
    fight(12 * DAY + 2 * HOUR, 'defense', abandonedRef(0), `Attack from ${abandonedRef(0).name} ${coords(abandonedRef(0))}`, { attacker: abandonedRef(0), defender: me, att: { raider: 60, pikeman: 25 }, def: { pikeman: 180, guard: 90, knight: 6 }, wall: 5 });
    // Filler over the older weeks, so paging and the day groups show
    for (let i = 0; i < 16; i++) {
      const target = abandonedRef(i);
      const strong = i % 4 === 3;
      fight((13 + i) * DAY + (i % 5) * HOUR, 'attack', target, `Raid on ${target.name} ${coords(target)}`, {
        attacker: me,
        defender: target,
        att: { raider: 60 + i * 25, outrider: 10 + i * 3, pikeman: (i % 3) * 20 },
        def: strong ? { pikeman: 420, guard: 300, pathfinder: 8 } : { pikeman: 20 + i * 5, guard: i * 3 },
        wall: i % 5,
      });
    }
    reports.sort((a, b) => b.back - a.back); // oldest first: ids rise with time
    if (refresh) {
      // Second press: replace only what this feature made. Without a recorded id list (filled before ids were kept) take only the
      // reports that are clearly sample-made (Sample_ players, the generator's whole-minute timestamps); real ones always stay.
      const stored = store.getMeta(REPORT_IDS(player.id));
      const old = stored ? (JSON.parse(stored) as number[]) : store.legacySampleReportIds(player.id, Number(marker));
      store.deleteReports(player.id, old);
    }
    for (const { back, r } of reports) {
      const id = store.insertReport({ ...r, playerId: player.id, createdAt: ago(back) } as NewReport);
      madeIds.push(id);
      counts.reports++;
      if (back > 2 * DAY) store.markReportRead(player.id, id);
    }

    if (!refresh) {
    // ---- troops and marches ----------------------------------------------------------------------
    const st: VillageState = settleVillage(home.state, t, settings);
    const base = units({ pikeman: 220, guard: 160, raider: 180, outrider: 70, knight: 24, pathfinder: 18, logram: 12 }); // chieftain and boulder stay locked at 0
    for (const u of UNIT_IDS) st.troops[u] = Math.max(st.troops[u], base[u]);
    for (const r of ['wood', 'food', 'iron'] as const) st.resources[r] = Math.max(st.resources[r], 6000);
    st.resources.gold = Math.max(st.resources.gold, 120);
    const leave = (u: Units): void => {
      for (const k of UNIT_IDS) {
        st.troops[k] -= u[k];
        st.away[k] += u[k];
      }
    };
    const march = (kind: 'attack' | 'scout' | 'support' | 'return', fromV: VillageRecord, toV: VillageRecord, u: Units, departAgo: number, arriveIn: number, loot: Resources | null = null): void => {
      store.insertMovement({ kind, originVillageId: fromV.id, targetVillageId: toV.id, units: u, loot, departAt: ago(departAgo), arriveAt: t + arriveIn });
      counts.marches++;
    };
    const asVillage = (r: VillageRefDto): VillageRecord | null => store.getVillage(r.villageId);
    const target = asVillage(abandonedRef(2));
    const hild = who('Sample_Hild').village;
    const ysolde = who('Sample_Ysolde').village;
    const vex = who('Sample_Vex').village;
    const corwen = who('Sample_Corwen').village;
    const odalys = who('Sample_Odalys').village;

    // Out: a raid, a scouting trip, support on the road.
    const raidUnits = units({ raider: 40, outrider: 10 });
    leave(raidUnits);
    march('attack', home, target ?? vex, raidUnits, 10 * MIN, 35 * MIN);
    const scoutUnits = units({ pathfinder: 4 });
    leave(scoutUnits);
    march('scout', home, corwen, scoutUnits, 2 * MIN, 12 * MIN);
    const supportOut = units({ guard: 30, pikeman: 20 });
    leave(supportOut);
    march('support', home, hild, supportOut, 5 * MIN, 50 * MIN);
    // Back: a returning raid with loot, and recalled support.
    const back1 = units({ raider: 25, outrider: 5 });
    leave(back1);
    march('return', home, target ?? vex, back1, 30 * MIN, 22 * MIN, res(1200, 800, 600));
    const back2 = units({ pikeman: 10 });
    leave(back2);
    march('return', home, ysolde, back2, 40 * MIN, 8 * MIN, emptyResources());
    // A shipment on the road.
    const cargo = res(3000, 2000, 1000);
    for (const r of ['wood', 'food', 'iron'] as const) st.resources[r] -= cargo[r];
    store.insertMovement({ kind: 'shipment', originVillageId: home.id, targetVillageId: odalys.id, units: emptyUnits(), loot: cargo, departAt: ago(4 * MIN), arriveAt: t + 20 * MIN });
    counts.marches++;
    // Standing: my troops at a tribe-mate (support out), and tribe-mates' troops at my village (support in).
    const standOut = units({ guard: 40, pikeman: 30 });
    leave(standOut);
    store.addStationed(player.id, home.id, hild.id, standOut, ago(1 * DAY));
    const standIn = units({ guard: 35, pikeman: 25 });
    store.addStationed(who('Sample_Brannoch').player.id, who('Sample_Brannoch').village.id, home.id, standIn, ago(6 * HOUR));
    {
      const bv = who('Sample_Brannoch').village;
      const bs = settleVillage(bv.state, t, settings);
      for (const k of UNIT_IDS) {
        bs.troops[k] = Math.max(bs.troops[k], standIn[k]);
        bs.troops[k] -= standIn[k];
        bs.away[k] += standIn[k];
      }
      store.saveVillage(bv.id, bs, villagePoints(bs));
    }
    // Incoming: an attack and a scout from the enemy, support from a tribe-mate.
    const sendFrom = (v: VillageRecord, kind: 'attack' | 'scout' | 'support', u: Units, departAgo: number, arriveIn: number): void => {
      const s2 = settleVillage(v.state, t, settings);
      for (const k of UNIT_IDS) {
        s2.troops[k] = Math.max(s2.troops[k], u[k]);
        s2.troops[k] -= u[k];
        s2.away[k] += u[k];
      }
      store.saveVillage(v.id, s2, villagePoints(s2));
      march(kind, v, home, u, departAgo, arriveIn);
    };
    sendFrom(vex, 'attack', units({ raider: 45, outrider: 12, knight: 3 }), 1 * HOUR, 3 * HOUR);
    sendFrom(corwen, 'scout', units({ pathfinder: 3 }), 10 * MIN, 1 * HOUR);
    sendFrom(ysolde, 'support', units({ guard: 40 }), 20 * MIN, 30 * MIN);

    store.saveVillage(home.id, st, villagePoints(st));
    }
    store.setMeta(REPORT_IDS(player.id), JSON.stringify(madeIds));
    if (!refresh) store.setMeta(MARKER(player.id), String(t));
  });

  return { created: !refresh, refreshed: refresh, counts };
}

/** Alternating lines (the other player first), as [fromMe, text] pairs, padded out to `n` messages. */
function longThread(n: number, seed: string[]): Array<[boolean, string]> {
  const filler = ['OK.', 'Sounds good.', 'I will check and tell you.', 'Understood.', 'Let me think about it.', 'Done.', 'Thanks for the heads-up.', 'Back in an hour.'];
  const out: Array<[boolean, string]> = [];
  for (let i = 0; i < n; i++) out.push([i % 2 === 1, seed[i] ?? filler[(i * 3) % filler.length]!]);
  return out;
}
