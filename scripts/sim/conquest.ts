// Conquest simulator (GAME_DESIGN 18.7 step 4): 20 computer players (5 each of builder / raider / turtle / balanced) share ONE
// world and can take each other's villages with the REAL engine (resolveBattle, checkStrike, applyStrike, updateHold,
// applyOwnerChange, createFoundedVillage, settleVillage, applyBuild, applyTrain, villageRenownPrice, battleRenown, ...).
// No server, no database, no wall clock: all time is simulated, all luck comes from fixed seeds, so every run is identical.
//
//   npm run sim -- --conquest                     30 days, 20 players, seed 20261105, report to stdout (markdown)
//   npm run sim -- --conquest --days 60 --seed 3 --seeds 5      5 seeds (snowball line per seed), the first one in full
//   npm run sim -- --conquest --out docs/sim/<file>.txt          write the report to a file
// (`npm run sim:conquest` is the same; the agent runner's allow list only knows `npm run sim ...`, so use the first form there.)
// Levers (change only the SIM's rule, never config.ts; for "what would fix it" runs):
//   --hold-hours H     hold clock after a Strike (default HOLD_HOURS)
//   --chief-points P   points per extra Chieftain needed (default HEARTH_POINTS_PER_CHIEFTAIN)
//   --lock-hours H     lock after a change of owner (default STRIKE_LOCK_HOURS)
//
// Each player plays its balance.ts style script (build list, army, research, raids on its OWN ring of 8 abandoned villages, Feast,
// Renown from buildings / defender trickle / raids). New here: players are targets of each other (raids with loot, Strikes with
// Chieftains), owners counter-attack the occupiers, the last village can be taken (restart), no pair cap, 24 h lock, protection.
// Assumptions are listed at the end of the report ("Model").

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BUILDINGS,
  BUILDING_IDS,
  DEFAULT_WORLD,
  HEARTH_MAX_CHIEFTAINS,
  HEARTH_POINTS_PER_CHIEFTAIN,
  HOLD_HOURS,
  HOLD_MIN_POPULATION,
  POP_PER_UNIT,
  RESOURCE_IDS,
  STRIKE_LOCK_HOURS,
  UNITS,
  UNIT_IDS,
  applyAttackerLosses,
  applyBattleToDefender,
  applyBuild,
  applyFeast,
  applyOwnerChange,
  applyResearch,
  applyReturn,
  applySend,
  applyStrike,
  applyTrain,
  battleRenown,
  buildingCost,
  canAfford,
  checkBuild,
  checkFeast,
  checkFoundTarget,
  checkResearch,
  checkStrike,
  checkTrain,
  chieftainRefund,
  chieftainsNeeded,
  collectBuildRenown,
  collectDefenderRenown,
  createFoundedVillage,
  createNpcVillage,
  createPlayerVillage,
  emptyResources,
  emptyUnits,
  feastAllowance,
  hashSeed,
  holdDueAt,
  isAttackBlocked,
  isStrikeBlocked,
  occupierPopulation,
  protectionEndsAt,
  renownPairWindowMs,
  resolveBattle,
  restartProtectionMs,
  settleVillage,
  storageCap,
  totalUnits,
  travelTimeMs,
  updateHold,
  villagePoints,
  villageRenownPrice,
  FEAST_COST,
} from '../../packages/engine/src/index.ts';
import type { BuildingId, Resources, UnitId, Units, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';
import { STYLES, STYLE_DEFS } from './balance.ts';
import type { StyleName } from './balance.ts';

type StyleDef = (typeof STYLE_DEFS)[StyleName];
type Pos = { x: number; y: number };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STEP_MS = 10 * 60_000; // a player "looks at the game" every 10 minutes
const QUEUE_LIMIT = 2;
const VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
const value = (r: Resources): number => RESOURCE_IDS.reduce((a, id) => a + r[id] * VALUE_WEIGHT[id], 0);
const num = (n: number): number => Math.round(n);
/** A strike army wants this many population of survivors so the hold clock (HOLD_MIN_POPULATION) runs. */
const OCCUPIER_NEED = Math.ceil(HOLD_MIN_POPULATION * 1.05);
/** A player with a Chieftain waits this long for a beatable village, then founds instead. */
const PATIENCE_HOURS = 72;
const FOUND_ESCORT = 30;
/** Raids and Strikes only go to player villages within this many tiles. */
const REACH = 22;
/** Grid of players: spacing in tiles and columns. */
const SPACING = 10;
const COLUMNS = 5;
/** A Strike is only worth it on a village with at least this share of the attacker's best village points ("weaker or richer"). */
const STRIKE_MIN_RATIO = 0.5;
/** Raids on players skip villages under this share of the attacker's points (they pay little Renown and little loot). */
const RAID_MIN_RATIO = 0.3;
const TARGET_LAYOUT: Array<[number, number]> = [[1, 3], [1, 5], [2, 5], [2, 7], [3, 8], [3, 10], [4, 12], [5, 14]]; // [tier, tiles]
const CHIEF_COST = UNITS.chieftain.cost;

export interface ConquestOptions {
  days: number;
  seed: number;
  players: number;
  holdHours?: number;
  chiefPoints?: number;
  lockHours?: number;
}

// ---- Model types --------------------------------------------------------------------------------

interface Vil {
  id: number;
  owner: number;
  state: VillageState;
  pos: Pos;
  trainCursor: number;
  alive: boolean;
}
interface Npc {
  state: VillageState;
  tier: number;
  pos: Pos;
}
interface Claim {
  by: number;
  origin: number;
  occupiers: Units;
  ver: number;
  /** Counter-attack armies of the owner on their way. */
  pending: number;
}
interface Plan {
  kind: 'strike' | 'found';
  k: number;
}
interface Stats {
  raidsOnPlayers: number;
  raidWinsOnPlayers: number;
  strikesSent: number;
  /** Strike battles fought (the army arrived and the target was still strikeable). */
  strikes: number;
  /** Strikes that put the hearth out (a hold started). */
  holds: number;
  taken: number;
  /** Holds ended by the owner killing the occupiers (hearth relit) or by the occupiers falling short too long. */
  broken: number;
  lost: number;
  restarts: number;
  chieftainsTrained: number;
  chieftainsLost: number;
  founds: number;
  countersSent: number;
  failReasons: Record<string, number>;
}
interface Player {
  id: number;
  style: StyleName;
  def: StyleDef;
  seed: number;
  vils: Vil[];
  npcs: Npc[];
  renownTotal: number;
  renownSpent: number;
  reserved: number;
  pairs: Map<string, { start: number; raw: number }>;
  plan: Plan | null;
  saving: Plan | null;
  readySince: number;
  waitSince: number;
  raidSeq: number;
  strikeSeq: number;
  points: number;
  stats: Stats;
  rows: Array<{ villages: number; points: number }>;
}

type Event =
  | { at: number; kind: 'return'; to: number; survivors: Units; loot: Resources }
  | { at: number; kind: 'raidNpc'; from: number; owner: number; npc: number; units: Units; seed: number }
  | { at: number; kind: 'raidVil'; from: number; target: number; targetOwner: number; units: Units; seed: number }
  | { at: number; kind: 'strike'; from: number; target: number; targetOwner: number; units: Units; seed: number }
  | { at: number; kind: 'counter'; from: number; target: number; by: number; units: Units; seed: number }
  | { at: number; kind: 'hold'; village: number; ver: number }
  | { at: number; kind: 'found'; from: number; pos: Pos; units: Units };

export interface Conquest {
  at: number;
  attacker: number;
  victim: number;
  points: number;
  last: boolean;
}

export interface PlayerResult {
  id: number;
  style: StyleName;
  pos: Pos;
  rows: Array<{ villages: number; points: number }>;
  villages: number;
  points: number;
  renownTotal: number;
  stats: Stats;
}

export interface ConquestReport {
  options: ConquestOptions;
  players: PlayerResult[];
  conquests: Conquest[];
  errors: string[];
}

// ---- Small helpers ------------------------------------------------------------------------------

function npcPos(home: Pos, i: number, distance: number): Pos {
  const angle = 0.4 + (i * 2 * Math.PI) / TARGET_LAYOUT.length;
  return { x: home.x + Math.round(distance * Math.cos(angle)), y: home.y + Math.round(distance * Math.sin(angle)) };
}
const dist = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y);
function addUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const id of UNIT_IDS) out[id] = a[id] + b[id];
  return out;
}
function subUnits(a: Units, b: Units): Units {
  const out = emptyUnits();
  for (const id of UNIT_IDS) out[id] = Math.max(0, a[id] - b[id]);
  return out;
}
function queuedUnits(v: VillageState): Units {
  const out = emptyUnits();
  for (const q of [v.trainQueues.barracks, v.trainQueues.stables]) for (const j of q) out[j.unit] += j.count - j.done;
  return out;
}
const emptyStats = (): Stats => ({
  raidsOnPlayers: 0,
  raidWinsOnPlayers: 0,
  strikesSent: 0,
  strikes: 0,
  holds: 0,
  taken: 0,
  broken: 0,
  lost: 0,
  restarts: 0,
  chieftainsTrained: 0,
  chieftainsLost: 0,
  founds: 0,
  countersSent: 0,
  failReasons: {},
});

// ---- The simulation -----------------------------------------------------------------------------

export function runConquest(options: Partial<ConquestOptions> = {}): ConquestReport {
  const opt: ConquestOptions = { days: 30, seed: 20261105, players: 20, ...options };
  const s: WorldSettings = { ...DEFAULT_WORLD, speed: 1 };
  const end = opt.days * DAY;
  const eligibleFrom = protectionEndsAt(0, s);
  const errors: string[] = [];
  const conquests: Conquest[] = [];

  const world = new Map<number, Vil>();
  let nextVilId = 0;
  const claims = new Map<number, Claim>();
  const events: Event[] = [];
  const sortEvents = (): void => {
    events.sort((a, b) => a.at - b.at);
  };

  const needFor = (points: number): number =>
    opt.chiefPoints ? Math.min(HEARTH_MAX_CHIEFTAINS, 1 + Math.floor(Math.max(0, points) / opt.chiefPoints)) : chieftainsNeeded(false, points);

  // ---- Players ----
  const players: Player[] = [];
  const origin: Pos = { x: -30, y: -10 };
  const styleOrder: StyleName[] = [];
  for (let i = 0; i < opt.players; i++) styleOrder.push(STYLES[i % STYLES.length] as StyleName);
  // Deterministic shuffle of the styles over the grid places.
  const place = styleOrder.map((st, i) => ({ st, key: hashSeed(opt.seed, 1000 + i) })).sort((a, b) => a.key - b.key).map((x) => x.st);

  const makeNpcs = (home: Pos): Npc[] => TARGET_LAYOUT.map(([tier, d], i) => ({ state: createNpcVillage(tier, 0), tier, pos: npcPos(home, i, d) }));
  const newVil = (owner: number, state: VillageState, pos: Pos): Vil => {
    const v: Vil = { id: nextVilId++, owner, state, pos, trainCursor: 0, alive: true };
    world.set(v.id, v);
    return v;
  };
  for (let i = 0; i < opt.players; i++) {
    const style = place[i] as StyleName;
    const pos: Pos = { x: origin.x + (i % COLUMNS) * SPACING, y: origin.y + Math.floor(i / COLUMNS) * SPACING };
    const st = createPlayerVillage(0);
    st.protectedUntil = eligibleFrom; // beginner protection (72 h): nobody can strike or raid it, and it does not attack players
    const p: Player = {
      id: i,
      style,
      def: STYLE_DEFS[style],
      seed: hashSeed(opt.seed, i),
      vils: [],
      npcs: makeNpcs(pos),
      renownTotal: 0,
      renownSpent: 0,
      reserved: 0,
      pairs: new Map(),
      plan: null,
      saving: null,
      readySince: -1,
      waitSince: -1,
      raidSeq: 0,
      strikeSeq: 0,
      points: 0,
      stats: emptyStats(),
      rows: [],
    };
    p.vils.push(newVil(i, st, pos));
    players.push(p);
  }
  const P = (id: number): Player => players[id] as Player;

  // ---- Per-player views ----
  const bal = (p: Player): number => p.renownTotal - p.renownSpent;
  const outstanding = (p: Player): number => {
    let n = 0;
    for (const vil of p.vils) {
      n += vil.state.troops.chieftain + vil.state.away.chieftain;
      for (const j of vil.state.trainQueues.bannerhall) if (j.unit === 'chieftain') n += j.count - j.done;
    }
    return n;
  };
  const trainer = (p: Player): Vil | undefined => p.vils.find((x) => x.state.buildings.bannerhall >= 1 && !x.state.hearth);
  const chiefHolder = (p: Player): Vil | undefined => {
    let best: Vil | undefined;
    for (const x of p.vils) if (!x.state.hearth && x.state.troops.chieftain >= 1 && (!best || x.state.troops.chieftain > best.state.troops.chieftain)) best = x;
    return best;
  };
  const chiefPrice = (p: Player, k: number): number => {
    let sum = 0;
    for (let i = 0; i < k; i++) sum += villageRenownPrice(p.vils.length, i);
    return sum;
  };
  const armyPop = (vil: Vil): number => {
    const all = addUnits(addUnits(vil.state.troops, vil.state.away), queuedUnits(vil.state));
    let pop = 0;
    for (const u of UNIT_IDS) if (UNITS[u].attack > 0 && !UNITS[u].siege) pop += all[u] * POP_PER_UNIT[u];
    return pop;
  };
  const levelWithQueue = (vil: Vil, b: BuildingId): number => vil.state.buildings[b] + vil.state.buildQueue.filter((j) => j.building === b).length;
  const refreshPoints = (): void => {
    for (const p of players) p.points = Math.max(1, p.vils.reduce((a, vil) => a + villagePoints(vil.state), 0));
  };

  // ---- Chieftain Renown ledger ----
  /** `count` of the player's `before` Chieftains died: their reserved Renown share comes back at CHIEFTAIN_RENOWN_REFUND_SHARE. */
  const loseChiefs = (p: Player, count: number, before: number): void => {
    if (count <= 0 || before <= 0) return;
    const share = p.reserved / before;
    p.reserved = Math.max(0, p.reserved - share * count);
    p.renownSpent -= count * chieftainRefund(share);
    p.stats.chieftainsLost += count;
  };
  /** One Chieftain was used up (village founded or taken): the spend stays, the reservation is released. */
  const useChief = (p: Player, before: number): void => {
    if (before <= 0) return;
    p.reserved = Math.max(0, p.reserved - p.reserved / before);
  };

  // ---- Renown from battles (pair windows, size factor) ----
  const pairRaw = (p: Player, key: string, now: number): number => {
    const w = p.pairs.get(key);
    return w && now < w.start + renownPairWindowMs(s) ? w.raw : 0;
  };
  const pairAdd = (p: Player, key: string, now: number, counted: number): void => {
    if (!(counted > 0)) return;
    const w = p.pairs.get(key);
    if (w && now < w.start + renownPairWindowMs(s)) w.raw += counted;
    else p.pairs.set(key, { start: now, raw: counted });
  };
  /** Both sides' Renown for one battle. `def` null = an abandoned village (never earns, exempt from the size factor). */
  const award = (r: ReturnType<typeof resolveBattle>, att: Player, def: Player | null, npcKey: string, at: number): void => {
    const aKey = def ? `a${def.id}` : npcKey;
    const dKey = `d${att.id}`;
    for (const a of battleRenown({
      result: r,
      attacker: { eligible: true, points: att.points },
      defender: { eligible: def !== null, points: def ? def.points : att.points },
      pairValue: (earner) => (earner.side === 'attacker' ? pairRaw(att, aKey, at) : def ? pairRaw(def, dKey, at) : 0),
    })) {
      if (a.side === 'attacker') {
        att.renownTotal += a.renown;
        pairAdd(att, aKey, at, a.counted);
      } else if (a.side === 'defender' && def) {
        def.renownTotal += a.renown;
        pairAdd(def, dKey, at, a.counted);
      }
    }
  };

  const homeTrip = (to: Vil, from: Pos, at: number, units: Units, loot: Resources = emptyResources()): void => {
    if (totalUnits(units) <= 0 && value(loot) <= 0) return;
    events.push({ at: at + travelTimeMs(from, to.pos, units, s), kind: 'return', to: to.id, survivors: units, loot });
    sortEvents();
  };
  const settleOf = (vil: Vil, t: number): VillageState => settleVillage(vil.state, t, s);
  const fail = (p: Player, reason: string): void => {
    p.stats.failReasons[reason] = (p.stats.failReasons[reason] ?? 0) + 1;
  };

  // ---- Claims (hold clock) ----
  const pushHold = (v: Vil): void => {
    const claim = claims.get(v.id) as Claim;
    claim.ver++;
    events.push({ at: holdDueAt(v.state.hearth as NonNullable<VillageState['hearth']>, s), kind: 'hold', village: v.id, ver: claim.ver });
    sortEvents();
  };
  const endClaim = (v: Vil, at: number): void => {
    v.state = settleVillage(v.state, at, s);
    delete v.state.hearth;
    claims.delete(v.id);
  };

  /** A fresh starting village at the outer edge for a player who lost the last village (engine: RESTART protection). */
  const restart = (p: Player, at: number): void => {
    p.stats.restarts++;
    p.reserved = 0;
    p.plan = null;
    p.saving = null;
    p.waitSince = -1;
    p.readySince = -1;
    const angle = (p.id * 2.399963 + p.stats.restarts * 1.7) % (2 * Math.PI);
    const ringR = 50 + 4 * p.stats.restarts;
    const pos: Pos = { x: origin.x + 20 + Math.round(ringR * Math.cos(angle)), y: origin.y + 15 + Math.round(ringR * Math.sin(angle)) };
    const st = createPlayerVillage(at);
    st.protectedUntil = at + restartProtectionMs(s);
    p.vils = [newVil(p.id, st, pos)];
    p.npcs = makeNpcs(pos);
  };

  /** The hold clock ended: the village changes owner (all buildings kept, 24 h lock, occupiers move in). */
  const changeOwner = (v: Vil, claim: Claim, at: number): void => {
    const att = P(claim.by);
    const old = P(v.owner);
    const home = world.get(claim.origin) as Vil;
    const nAtt = outstanding(att);
    const nOld = outstanding(old);
    const oc = applyOwnerChange(v.state, { newOwnerOccupiers: claim.occupiers, now: at, settings: s });
    if (opt.lockHours !== undefined) oc.state.lockUntil = at + Math.round((opt.lockHours * HOUR) / s.speed);
    const oldPoints = villagePoints(oc.state);
    // The old owner loses the village with everything in it: Chieftains at home, away and queued are gone (half the Renown comes back).
    let lostChiefs = v.state.troops.chieftain + v.state.away.chieftain;
    for (const j of v.state.trainQueues.bannerhall) if (j.unit === 'chieftain') lostChiefs += j.count - j.done;
    old.vils = old.vils.filter((x) => x !== v);
    v.alive = false;
    claims.delete(v.id);
    for (const [cid, c] of [...claims]) {
      // Armies stationed from the lost village are disbanded: those claims end (hearth relit, nobody left to hold).
      if (c.origin === v.id) {
        endClaim(world.get(cid) as Vil, at);
        P((world.get(cid) as Vil).owner).stats.broken++;
      }
    }
    loseChiefs(old, lostChiefs, nOld);
    old.stats.lost++;
    // The attacker's occupiers move in; the rest (and spare Chieftains) walk home. One Chieftain is used up.
    const moved = subUnits(claim.occupiers, oc.overflow);
    if (home.alive) {
      home.state = applyAttackerLosses(settleVillage(home.state, at, s), moved);
      homeTrip(home, v.pos, at, oc.overflow);
    }
    useChief(att, nAtt);
    const nv = newVil(att.id, oc.state, v.pos);
    att.vils.push(nv);
    att.stats.taken++;
    const last = old.vils.length === 0;
    conquests.push({ at, attacker: att.id, victim: old.id, points: oldPoints, last });
    if (last) restart(old, at);
  };

  /** Bring the hold clock of village `v` to `at` with the current occupiers and apply the outcome. */
  const settleClaim = (v: Vil, at: number): void => {
    const claim = claims.get(v.id);
    const hearth = v.state.hearth;
    if (!claim || !hearth) {
      claims.delete(v.id);
      return;
    }
    const up = updateHold(hearth, occupierPopulation(claim.occupiers), at, s);
    const att = P(claim.by);
    if (up.outcome === 'taken') {
      changeOwner(v, claim, up.at);
    } else if (up.outcome === 'failed' || up.outcome === 'relit') {
      endClaim(v, at);
      att.stats.broken++;
      const home = world.get(claim.origin) as Vil;
      if (up.outcome === 'failed' && home.alive) homeTrip(home, v.pos, at, claim.occupiers);
    } else {
      v.state.hearth = up.hearth as NonNullable<VillageState['hearth']>;
      pushHold(v);
    }
  };

  // ---- Events ----
  const resolveEvent = (e: Event): void => {
    if (e.kind === 'return') {
      const o = world.get(e.to) as Vil;
      if (o.alive) o.state = applyReturn(o.state, e.survivors, e.loot, e.at, s);
      return;
    }
    if (e.kind === 'hold') {
      const v = world.get(e.village) as Vil;
      const claim = claims.get(e.village);
      if (!v.alive || !claim || claim.ver !== e.ver) return;
      settleClaim(v, e.at);
      return;
    }
    if (e.kind === 'found') {
      const o = world.get(e.from) as Vil;
      if (!o.alive) return;
      const p = P(o.owner);
      const occupied = new Set<string>();
      for (const v of world.values()) if (v.alive) occupied.add(`${v.pos.x},${v.pos.y}`);
      for (const q of players) for (const n of q.npcs) occupied.add(`${n.pos.x},${n.pos.y}`);
      if (!checkFoundTarget(e.pos, s, (x, y) => occupied.has(`${x},${y}`)).ok) {
        homeTrip(o, e.pos, e.at, e.units);
        return;
      }
      const made = createFoundedVillage(e.at, s, e.units);
      const n0 = outstanding(p);
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), subUnits(e.units, made.overflow));
      useChief(p, n0);
      p.stats.founds++;
      p.vils.push(newVil(p.id, made.state, e.pos));
      homeTrip(o, e.pos, e.at, made.overflow);
      return;
    }
    const o = world.get(e.from) as Vil;
    if (!o.alive) return; // the army's home village was taken meanwhile: the army is disbanded
    const att = P(o.owner);

    if (e.kind === 'raidNpc') {
      const npc = att.npcs[e.npc] as Npc;
      if (e.owner !== att.id) return;
      npc.state = settleVillage(npc.state, e.at, s);
      const r = resolveBattle({ attackerUnits: e.units, defender: npc.state, seed: e.seed });
      npc.state = applyBattleToDefender(npc.state, r);
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
      award(r, att, null, `t${e.npc}`, e.at);
      if (r.attackerWon) homeTrip(o, npc.pos, e.at, r.attackerSurvivors, r.loot);
      return;
    }

    const tv = world.get(e.target) as Vil;
    if (e.kind === 'raidVil') {
      if (!tv.alive || tv.owner !== e.targetOwner || tv.state.hearth || isAttackBlocked(tv.state, e.at)) {
        homeTrip(o, tv.pos, e.at, e.units); // target gone, cold or protected by now: turn back
        return;
      }
      const def0 = settleOf(tv, e.at);
      const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed });
      tv.state = applyBattleToDefender(def0, r);
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
      award(r, att, P(tv.owner), '', e.at);
      att.stats.raidsOnPlayers++;
      if (r.attackerWon) {
        att.stats.raidWinsOnPlayers++;
        homeTrip(o, tv.pos, e.at, r.attackerSurvivors, r.loot);
      }
      return;
    }

    if (e.kind === 'strike') {
      if (!tv.alive || tv.owner !== e.targetOwner || tv.state.hearth || isStrikeBlocked(tv.state, e.at)) {
        fail(att, 'target changed or blocked on arrival');
        homeTrip(o, tv.pos, e.at, e.units);
        return;
      }
      const def0 = settleOf(tv, e.at);
      const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed, noLoot: true });
      const n0 = outstanding(att);
      o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
      tv.state = applyBattleToDefender(def0, r);
      award(r, att, P(tv.owner), '', e.at);
      loseChiefs(att, r.attackerLosses.chieftain, n0);
      att.stats.strikes++;
      const points = villagePoints(tv.state);
      const chk = checkStrike(r, opt.chiefPoints ? { ...r.attackerSurvivors, chieftain: HEARTH_MAX_CHIEFTAINS } : r.attackerSurvivors, {
        abandoned: false,
        points,
        now: e.at,
        ...(tv.state.lockUntil !== undefined ? { lockUntil: tv.state.lockUntil } : {}),
        ...(tv.state.protectedUntil !== undefined ? { protectedUntil: tv.state.protectedUntil } : {}),
      });
      const enough = !opt.chiefPoints || r.attackerSurvivors.chieftain >= needFor(points);
      if (!chk.ok || !enough) {
        fail(att, chk.ok ? 'too_few_chieftains' : chk.reason);
        homeTrip(o, tv.pos, e.at, r.attackerSurvivors);
        return;
      }
      att.stats.holds++;
      tv.state = applyStrike(tv.state, { claimBy: att.id, now: e.at, settings: s, occupiers: r.attackerSurvivors });
      if (opt.holdHours !== undefined) {
        const h = tv.state.hearth as NonNullable<VillageState['hearth']>;
        h.holdMs = Math.round((opt.holdHours * HOUR) / s.speed);
      }
      claims.set(tv.id, { by: att.id, origin: o.id, occupiers: r.attackerSurvivors, ver: 0, pending: 0 });
      pushHold(tv);
      return;
    }

    // counter: the owner attacks the occupiers of a cold village (the occupiers defend with the village's Wall)
    const claim = claims.get(e.target);
    if (claim) claim.pending = Math.max(0, claim.pending - 1);
    if (!tv.alive || !claim || claim.by !== e.by || !tv.state.hearth) {
      homeTrip(o, tv.pos, e.at, e.units);
      return;
    }
    const cold = settleOf(tv, e.at);
    const def0: VillageState = { ...cold, troops: { ...claim.occupiers } };
    const r = resolveBattle({ attackerUnits: e.units, defender: def0, seed: e.seed, noLoot: true });
    o.state = applyAttackerLosses(settleVillage(o.state, e.at, s), r.attackerLosses);
    const claimant = P(claim.by);
    award(r, att, claimant, '', e.at);
    const home = world.get(claim.origin) as Vil;
    if (home.alive) {
      const n0 = outstanding(claimant);
      home.state = applyAttackerLosses(settleVillage(home.state, e.at, s), r.defenderLosses);
      loseChiefs(claimant, r.defenderLosses.chieftain, n0);
    }
    claim.occupiers = subUnits(claim.occupiers, r.defenderLosses);
    if (r.attackerWon) homeTrip(o, tv.pos, e.at, r.attackerSurvivors);
    settleClaim(tv, e.at);
  };

  // ---- Decisions ----
  const wanted = (p: Player, vil: Vil): { building: BuildingId; level: number } | undefined => {
    for (const [b, lvl] of p.def.order) if (levelWithQueue(vil, b) < lvl) return { building: b, level: levelWithQueue(vil, b) + 1 };
    const b = [...p.def.tail].sort((x, y) => levelWithQueue(vil, x) - levelWithQueue(vil, y))[0];
    return b ? { building: b, level: levelWithQueue(vil, b) + 1 } : undefined;
  };
  const chiefNeed = (p: Player): Resources => {
    const k = p.saving?.k ?? 1;
    const need = emptyResources();
    for (const id of RESOURCE_IDS) need[id] = CHIEF_COST[id] * k;
    return need;
  };
  const chiefSaving = (p: Player, vil: Vil): boolean => p.saving !== null && trainer(p) === vil;
  const takePrep = (p: Player, vil: Vil): boolean =>
    p.def.expand === 'take' && vil === trainer(p) && outstanding(p) === 0 && bal(p) >= villageRenownPrice(p.vils.length, 0) && p.saving === null && armyPop(vil) < OCCUPIER_NEED;

  const chiefBlock = (p: Player, vil: Vil, t: number): BuildingId | undefined => {
    const cap = storageCap(vil.state);
    const need = chiefNeed(p);
    if (RESOURCE_IDS.some((id) => need[id] > cap)) return 'storehouse';
    const c = checkTrain(vil.state, 'chieftain', p.saving?.k ?? 1, t, s);
    if (!c.ok && c.reason === 'population_full') return 'farm';
    return undefined;
  };

  const tryBuild = (p: Player, vil: Vil, t: number): void => {
    const saving = chiefSaving(p, vil);
    let forced = false;
    let cur: BuildingId | undefined;
    if (saving) {
      cur = chiefBlock(p, vil, t);
      forced = cur !== undefined;
    }
    cur ??= wanted(p, vil)?.building;
    if (!cur) return;
    for (let guard = 0; guard < 4; guard++) {
      const c = checkBuild(vil.state, cur, t, s, QUEUE_LIMIT);
      if (c.ok) {
        if (saving && !forced) {
          const cost = buildingCost(cur, levelWithQueue(vil, cur) + 1);
          const need = emptyResources();
          const chief = chiefNeed(p);
          for (const id of RESOURCE_IDS) need[id] = cost[id] + chief[id];
          if (!canAfford(vil.state.resources, need)) return;
        }
        vil.state = applyBuild(vil.state, cur, t, s, QUEUE_LIMIT);
        return;
      }
      if (c.reason === 'exceeds_storage' && cur !== 'storehouse') {
        cur = 'storehouse';
        forced = true;
      } else if (c.reason === 'population_full' && cur !== 'farm') {
        cur = 'farm';
        forced = true;
      } else if (c.reason === 'requirements_not_met') {
        const reqs: Partial<Record<BuildingId, number>> = BUILDINGS[cur].requires;
        const need: BuildingId | undefined = (Object.keys(reqs) as BuildingId[]).find((r) => vil.state.buildings[r] < (reqs[r] ?? 0));
        if (!need || need === cur) return;
        cur = need;
      } else return;
    }
  };

  const nextBuildCost = (p: Player, vil: Vil): Resources => {
    const w = wanted(p, vil);
    return w && w.level <= BUILDINGS[w.building].maxLevel ? buildingCost(w.building, w.level) : emptyResources();
  };

  const tryTrain = (p: Player, vil: Vil, t: number): void => {
    const day = t / DAY;
    if (day < p.def.trainFromDay || p.def.army.length === 0) return;
    if (chiefSaving(p, vil)) return;
    const wheel = p.def.army;
    const total = wheel.reduce((a, x) => a + x.weight, 0);
    for (let k = 0; k < wheel.length * 4; k++) {
      const pick = (vil.trainCursor * 37) % total;
      let acc = 0;
      let unit: UnitId = (wheel[0] as { unit: UnitId }).unit;
      for (const a of wheel) {
        acc += a.weight;
        if (pick < acc) {
          unit = a.unit;
          break;
        }
      }
      const building = UNITS[unit].building;
      const c1 = checkTrain(vil.state, unit, 1, t, s);
      if (!c1.ok && c1.reason === 'requirements_not_met') {
        vil.trainCursor++;
        continue;
      }
      if (vil.state.trainQueues[building].length >= 2) return;
      const reserve = nextBuildCost(p, vil);
      const spare = emptyResources();
      for (const id of RESOURCE_IDS) spare[id] = Math.max(0, vil.state.resources[id] - reserve[id] * p.def.reserve);
      spare.food = Math.max(0, spare.food - storageCap(vil.state) * 0.25);
      let n = 40;
      for (const id of RESOURCE_IDS) if (UNITS[unit].cost[id] > 0) n = Math.min(n, Math.floor(spare[id] / UNITS[unit].cost[id]));
      while (n >= 1) {
        const c = checkTrain(vil.state, unit, n, t, s);
        if (c.ok) {
          vil.state = applyTrain(vil.state, unit, n, t, s);
          vil.trainCursor++;
          return;
        }
        if (c.reason !== 'population_full') break;
        n = Math.floor(n / 2);
      }
      return;
    }
  };

  const tryResearch = (p: Player, vil: Vil, t: number): void => {
    for (const u of p.def.research) {
      if ((vil.state.researched ?? []).includes(u) || (vil.state.researchQueue ?? []).some((j) => j.unit === u)) continue;
      if (checkResearch(vil.state, u, t, s).ok) vil.state = applyResearch(vil.state, u, t, s);
      return;
    }
  };

  const tryFeast = (p: Player, vil: Vil, t: number): void => {
    if (vil.state.buildings.bannerhall < 1) return;
    const left = feastAllowance(vil.state, t, s).left;
    if (left < 1) return;
    const cap = storageCap(vil.state);
    const nearCap = RESOURCE_IDS.some((id) => FEAST_COST[id] > 0 && vil.state.resources[id] >= cap * 0.5);
    if (!nearCap) return; // a feast only to empty a full storehouse (the sim players have enough else to do)
    const reserve = nextBuildCost(p, vil);
    const chief = p.saving ? chiefNeed(p) : emptyResources();
    let n = left;
    for (const id of RESOURCE_IDS) {
      if (FEAST_COST[id] > 0) n = Math.min(n, Math.floor((vil.state.resources[id] - Math.max(reserve[id] * p.def.reserve, chief[id])) / FEAST_COST[id]));
    }
    if (n < 1 || !checkFeast(vil.state, n, t, s).ok) return;
    const r = applyFeast(vil.state, n, t, s);
    vil.state = r.state;
    p.renownTotal += r.renown;
  };

  /** Strike candidates for `vil` (the army that would go, `k` Chieftains in it): the best beatable player village, or undefined. */
  const bestStrike = (p: Player, vil: Vil, t: number, chiefs: number | 'any'): { target: Vil; k: number; travel: number; send: Units } | undefined => {
    if (isAttackBlocked(vil.state, t)) return undefined;
    let ownBest = 0;
    for (const x of p.vils) ownBest = Math.max(ownBest, villagePoints(x.state));
    let best: { target: Vil; k: number; travel: number; send: Units } | undefined;
    let bestPoints = -1;
    for (const tv of world.values()) {
      if (!tv.alive || tv.owner === p.id || tv.state.hearth) continue;
      if (dist(vil.pos, tv.pos) > REACH) continue;
      const base: Units = { ...vil.state.troops, pathfinder: 0, logram: 0, boulder: 0, chieftain: 0 };
      // The first preview only needs a rough Chieftain count: points at "now"; the real need is re-checked with arrival points.
      const rough = needFor(villagePoints(tv.state));
      const k = chiefs === 'any' ? rough : Math.min(chiefs, rough);
      let send: Units = { ...base, chieftain: k };
      let travel = travelTimeMs(vil.pos, tv.pos, send, s);
      const arrival = settleVillage(tv.state, t + travel, s);
      const pts = villagePoints(arrival);
      const kNeed = needFor(pts);
      if (chiefs !== 'any' && kNeed > chiefs) continue;
      send = { ...base, chieftain: kNeed };
      travel = travelTimeMs(vil.pos, tv.pos, send, s);
      if (isStrikeBlocked(arrival, t + travel)) continue;
      if (pts < ownBest * STRIKE_MIN_RATIO) continue;
      const pre = resolveBattle({ attackerUnits: send, defender: arrival, seed: hashSeed(p.seed, 555, p.strikeSeq), noLoot: true });
      if (!(pre.attackPower > pre.defensePower * 1.25)) continue;
      if (pre.attackerSurvivors.chieftain < kNeed || occupierPopulation(pre.attackerSurvivors) < HOLD_MIN_POPULATION) continue;
      if (pts > bestPoints) {
        best = { target: tv, k: kNeed, travel, send };
        bestPoints = pts;
      }
    }
    return best;
  };

  /** Once Renown and the Banner Hall are there: what does this player save for? */
  const decideSaving = (p: Player, t: number): Plan | null => {
    const tr = trainer(p);
    if (!tr || outstanding(p) > 0) {
      p.readySince = -1;
      return null;
    }
    if (bal(p) < villageRenownPrice(p.vils.length, 0)) {
      p.readySince = -1;
      return null;
    }
    if (p.readySince < 0) p.readySince = t;
    const strike = bestStrike(p, tr, t, 'any');
    if (strike && bal(p) >= chiefPrice(p, strike.k)) return { kind: 'strike', k: strike.k };
    if (p.def.expand === 'found' || t - p.readySince >= PATIENCE_HOURS * HOUR) return { kind: 'found', k: 1 };
    return null;
  };

  const tryChieftain = (p: Player, vil: Vil, t: number): void => {
    if (!p.saving || trainer(p) !== vil || outstanding(p) > 0) return;
    const { k } = p.saving;
    const price = chiefPrice(p, k);
    if (bal(p) < price || !checkTrain(vil.state, 'chieftain', k, t, s).ok) return;
    vil.state = applyTrain(vil.state, 'chieftain', k, t, s);
    p.renownSpent += price;
    p.reserved += price;
    p.stats.chieftainsTrained += k;
    p.plan = p.saving;
    p.saving = null;
  };

  const tryRaid = (p: Player, vil: Vil, t: number): void => {
    const def = p.def;
    if (def.raiders.length === 0 || vil.state.hearth) return;
    if (def.expand === 'take' && ((outstanding(p) > 0 && (chiefHolder(p) === vil || trainer(p) === vil)) || takePrep(p, vil) || chiefSaving(p, vil))) return;
    const send = emptyUnits();
    for (const u of def.raiders) send[u] = Math.max(0, vil.state.troops[u] - def.keepHome);
    if (totalUnits(send) < 5) return;
    type Pick = { kind: 'npc'; i: number; travel: number } | { kind: 'vil'; v: Vil; travel: number };
    let best: Pick | undefined;
    let bestScore = 0;
    const consider = (travel: number, arrivalState: VillageState, make: Pick): void => {
      const pre = resolveBattle({ attackerUnits: send, defender: arrivalState, seed: hashSeed(p.seed, 999, p.raidSeq) });
      if (!(pre.attackPower > pre.defensePower * 1.25)) return; // a thin win loses most of the army
      let lossVal = 0;
      for (const u of UNIT_IDS) lossVal += pre.attackerLosses[u] * value(UNITS[u].cost);
      const net = value(pre.loot) - lossVal;
      const score = net / (2 * travel);
      if (net > 0 && score > bestScore) {
        best = make;
        bestScore = score;
      }
    };
    for (let i = 0; i < p.npcs.length; i++) {
      const n = p.npcs[i] as Npc;
      const travel = travelTimeMs(vil.pos, n.pos, send, s);
      n.state = settleVillage(n.state, t, s);
      consider(travel, settleVillage(n.state, t + travel, s), { kind: 'npc', i, travel });
    }
    if (!isAttackBlocked(vil.state, t)) {
      for (const tv of world.values()) {
        if (!tv.alive || tv.owner === p.id || tv.state.hearth) continue;
        if (dist(vil.pos, tv.pos) > REACH) continue;
        const travel = travelTimeMs(vil.pos, tv.pos, send, s);
        if (isAttackBlocked(tv.state, t + travel)) continue;
        const arrival = settleVillage(tv.state, t + travel, s);
        if (villagePoints(arrival) < p.points * RAID_MIN_RATIO / Math.max(1, p.vils.length)) continue;
        consider(travel, arrival, { kind: 'vil', v: tv, travel });
      }
    }
    const pick = best as Pick | undefined;
    if (!pick) return;
    vil.state = applySend(vil.state, send, t, s);
    const seed = hashSeed(p.seed, p.raidSeq++);
    if (pick.kind === 'npc') {
      events.push({ at: t + pick.travel, kind: 'raidNpc', from: vil.id, owner: p.id, npc: pick.i, units: send, seed });
    } else {
      events.push({ at: t + pick.travel, kind: 'raidVil', from: vil.id, target: pick.v.id, targetOwner: pick.v.owner, units: send, seed });
    }
    sortEvents();
  };

  const findFoundTile = (from: Vil): Pos | undefined => {
    const occupied = new Set<string>();
    for (const v of world.values()) if (v.alive) occupied.add(`${v.pos.x},${v.pos.y}`);
    for (const q of players) for (const n of q.npcs) occupied.add(`${n.pos.x},${n.pos.y}`);
    const seen = new Set<string>();
    for (let d = 4; d <= 24; d++) {
      for (let k = 0; k < 24; k++) {
        const angle = 0.3 + (k * 2 * Math.PI) / 24;
        const pos: Pos = { x: from.pos.x + Math.round(d * Math.cos(angle)), y: from.pos.y + Math.round(d * Math.sin(angle)) };
        const key = `${pos.x},${pos.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (checkFoundTarget(pos, s, (x, y) => occupied.has(`${x},${y}`)).ok) return pos;
      }
    }
    return undefined;
  };

  /** A Chieftain is home: strike the best beatable player village, else found (at once, or after the patience time for a Strike plan). */
  const tryExpand = (p: Player, t: number): void => {
    const holder = chiefHolder(p);
    if (!holder) {
      p.waitSince = -1;
      return;
    }
    if (p.waitSince < 0) p.waitSince = t;
    const strike = bestStrike(p, holder, t, holder.state.troops.chieftain);
    if (strike) {
      holder.state = applySend(holder.state, strike.send, t, s);
      p.stats.strikesSent++;
      events.push({ at: t + strike.travel, kind: 'strike', from: holder.id, target: strike.target.id, targetOwner: strike.target.owner, units: strike.send, seed: hashSeed(p.seed, 556, p.strikeSeq++) });
      sortEvents();
      p.waitSince = -1;
      return;
    }
    const foundNow = p.plan?.kind === 'found' || p.def.expand === 'found' || t - p.waitSince >= PATIENCE_HOURS * HOUR;
    if (!foundNow) return;
    const pos = findFoundTile(holder);
    if (!pos) return;
    const send = emptyUnits();
    send.chieftain = 1;
    let room = FOUND_ESCORT;
    for (const u of ['pikeman', 'guard', 'raider'] as UnitId[]) {
      const n = Math.min(holder.state.troops[u], room);
      send[u] = n;
      room -= n;
    }
    const travel = travelTimeMs(holder.pos, pos, send, s);
    holder.state = applySend(holder.state, send, t, s);
    events.push({ at: t + travel, kind: 'found', from: holder.id, pos, units: send });
    sortEvents();
    p.waitSince = -1;
  };

  /** The owner of a cold village attacks the occupiers with its best army that arrives before the clock ends and beats them. */
  const tryCounter = (p: Player, t: number): void => {
    for (const cold of p.vils.slice()) {
      const claim = claims.get(cold.id);
      if (!claim || !cold.state.hearth || claim.pending > 0) continue;
      const due = holdDueAt(cold.state.hearth, s);
      const defender: VillageState = { ...settleVillage(cold.state, t, s), troops: { ...claim.occupiers } };
      let best: { src: Vil; army: Units; travel: number } | undefined;
      for (const src of p.vils) {
        const army = emptyUnits();
        for (const u of UNIT_IDS) if (UNITS[u].attack > 0 && !UNITS[u].siege && u !== 'chieftain' && u !== 'pathfinder') army[u] = src.state.troops[u];
        if (totalUnits(army) < 1) continue;
        const travel = src === cold ? 0 : travelTimeMs(src.pos, cold.pos, army, s);
        if (t + travel >= due) continue;
        const pre = resolveBattle({ attackerUnits: army, defender, seed: hashSeed(p.seed, 888, t), noLoot: true });
        if (!(pre.attackPower > pre.defensePower * 1.1)) continue;
        if (!best || travel < best.travel) best = { src, army, travel };
      }
      if (!best) continue;
      best.src.state = applySend(best.src.state, best.army, t, s);
      claim.pending++;
      p.stats.countersSent++;
      events.push({ at: t + Math.max(best.travel, 60_000), kind: 'counter', from: best.src.id, target: cold.id, by: claim.by, units: best.army, seed: hashSeed(p.seed, 889, t) });
      sortEvents();
    }
  };

  // ---- Main loop ----
  let nextDay = 1;
  for (let t = 0; t <= end; t += STEP_MS) {
    try {
      while (events.length > 0 && (events[0] as Event).at <= t) resolveEvent(events.shift() as Event);
      for (const p of players) {
        for (const vil of p.vils) {
          vil.state = settleVillage(vil.state, t, s);
          const br = collectBuildRenown(vil.state);
          vil.state = br.state;
          p.renownTotal += br.renown;
          const dr = collectDefenderRenown(vil.state, eligibleFrom, s);
          vil.state = dr.state;
          p.renownTotal += dr.renown;
        }
      }
      refreshPoints();
      for (const p of players) {
        if (outstanding(p) === 0) p.plan = null;
        p.saving = decideSaving(p, t);
        for (const vil of p.vils.slice()) {
          if (vil.state.hearth) continue; // a cold village does nothing new
          tryChieftain(p, vil, t);
          tryBuild(p, vil, t);
          tryResearch(p, vil, t);
          tryTrain(p, vil, t);
          tryRaid(p, vil, t);
          tryFeast(p, vil, t);
        }
        tryCounter(p, t);
        tryExpand(p, t);
      }
    } catch (err) {
      errors.push(`t=${(t / HOUR).toFixed(1)}h: ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') ?? err.message : String(err)}`);
    }
    if (t === nextDay * DAY - STEP_MS) {
      for (const p of players) p.rows.push({ villages: p.vils.length, points: p.vils.reduce((a, vil) => a + villagePoints(settleVillage(vil.state, t, s)), 0) });
      nextDay++;
    }
  }

  const results: PlayerResult[] = players.map((p) => ({
    id: p.id,
    style: p.style,
    pos: (p.vils[0] as Vil).pos,
    rows: p.rows,
    villages: p.vils.length,
    points: p.vils.reduce((a, vil) => a + villagePoints(settleVillage(vil.state, end, s)), 0),
    renownTotal: Math.floor(p.renownTotal),
    stats: p.stats,
  }));
  return { options: opt, players: results, conquests, errors };
}

// ---- Output -------------------------------------------------------------------------------------

const SNAPSHOT_DAYS = [7, 14, 21, 30];

function rowAt(p: PlayerResult, day: number): { villages: number; points: number } {
  return p.rows[Math.min(day, p.rows.length) - 1] ?? { villages: 1, points: 0 };
}

/** Biggest vs second biggest by total points (and by villages) at `day`. */
export function snowball(players: PlayerResult[], day: number): { pointsTop: number; pointsSecond: number; villagesTop: number; villagesSecond: number; ratio: number; villageRatio: number } {
  const pts = players.map((p) => rowAt(p, day).points).sort((a, b) => b - a);
  const vs = players.map((p) => rowAt(p, day).villages).sort((a, b) => b - a);
  const [pt = 0, ps = 1] = pts;
  const [vt = 0, vsec = 1] = vs;
  return { pointsTop: pt, pointsSecond: ps, villagesTop: vt, villagesSecond: vsec, ratio: pt / Math.max(1, ps), villageRatio: vt / Math.max(1, vsec) };
}

export function formatConquest(rep: ConquestReport, extraSeeds: Array<{ seed: number; rep: ConquestReport }> = []): string {
  const o = rep.options;
  const days = o.days;
  const out: string[] = [];
  const levers = [
    'no pair cap',
    `hold ${o.holdHours ?? HOLD_HOURS} h`,
    `1 Chieftain per ${o.chiefPoints ?? HEARTH_POINTS_PER_CHIEFTAIN} points (max ${HEARTH_MAX_CHIEFTAINS})`,
    `lock ${o.lockHours ?? STRIKE_LOCK_HOURS} h`,
  ];
  out.push(`# Conquest simulation: ${o.players} players, ${days} days, speed 1, seed ${o.seed}`, '', `Rules in force: ${levers.join('; ')}.`, '');
  const shown = SNAPSHOT_DAYS.filter((d) => d <= days);
  if (!shown.includes(days)) shown.push(days);

  out.push('## Per style (5 players each): villages and points per player (average) on day ' + shown.join(' / '), '');
  out.push(`| style | ${shown.map((d) => `day ${d} villages | day ${d} points`).join(' | ')} |`, `|---|${shown.map(() => '---|---').join('|')}|`);
  const groups: Array<[string, PlayerResult[]]> = [...STYLES.map((st): [string, PlayerResult[]] => [st, rep.players.filter((p) => p.style === st)]), ['**all**', rep.players]];
  for (const [name, ps] of groups) {
    const cells = shown.map((d) => {
      const v = ps.reduce((a, p) => a + rowAt(p, d).villages, 0) / ps.length;
      const pt = ps.reduce((a, p) => a + rowAt(p, d).points, 0) / ps.length;
      return `${v.toFixed(2)} | ${num(pt)}`;
    });
    out.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  out.push('', '## Conquest events per style (sum over the 5 players; day 1-' + days + ')', '');
  out.push('| style | Chieftains trained / lost | strikes sent | strikes fought | holds started | villages taken | holds broken | villages lost | restarts | founded | counter-attacks | raids on players (won) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, ps] of groups) {
    const sum = (f: (s: Stats) => number): number => ps.reduce((a, p) => a + f(p.stats), 0);
    out.push(
      `| ${name} | ${sum((x) => x.chieftainsTrained)} / ${sum((x) => x.chieftainsLost)} | ${sum((x) => x.strikesSent)} | ${sum((x) => x.strikes)} | ${sum((x) => x.holds)} | ${sum((x) => x.taken)} | ${sum((x) => x.broken)} | ${sum((x) => x.lost)} | ${sum((x) => x.restarts)} | ${sum((x) => x.founds)} | ${sum((x) => x.countersSent)} | ${sum((x) => x.raidsOnPlayers)} (${sum((x) => x.raidWinsOnPlayers)}) |`,
    );
  }
  const reasons = new Map<string, number>();
  for (const p of rep.players) for (const [r, n] of Object.entries(p.stats.failReasons)) reasons.set(r, (reasons.get(r) ?? 0) + n);
  out.push('', `Strikes that did not start a hold, by reason: ${[...reasons].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}.`);

  out.push('', '## Snowball check: biggest player vs second biggest (all villages together)', '');
  out.push('| day | biggest points | second | ratio | biggest villages | second | ratio |', '|---|---|---|---|---|---|---|');
  for (const d of shown) {
    const b = snowball(rep.players, d);
    out.push(`| ${d} | ${b.pointsTop} | ${b.pointsSecond} | ${b.ratio.toFixed(2)} | ${b.villagesTop} | ${b.villagesSecond} | ${b.villageRatio.toFixed(2)} |`);
  }
  const fin = snowball(rep.players, days);
  const ranked = [...rep.players].sort((a, b) => b.points - a.points);
  out.push('', `Top 5 on day ${days}: ${ranked.slice(0, 5).map((p) => `#${p.id} ${p.style} ${p.villages} villages ${p.points} points`).join('; ')}. Smallest: ${(ranked[ranked.length - 1] as PlayerResult).points} points.`);
  const total = rep.players.reduce((a, p) => a + p.points, 0);
  out.push(`Top 3 hold ${((ranked.slice(0, 3).reduce((a, p) => a + p.points, 0) / total) * 100).toFixed(0)}% of all points (an even split would be ${((3 / rep.players.length) * 100).toFixed(0)}%).`);
  out.push(`**Verdict: biggest has ${fin.ratio.toFixed(2)}x the second's points and ${fin.villageRatio.toFixed(2)}x its villages after ${days} days; target (<= ~2x) ${fin.ratio <= 2.1 ? 'MET' : 'NOT MET'}.**`);
  if (extraSeeds.length > 0) {
    out.push('', '## Other seeds (same rules)', '', '| seed | takes | holds started | restarts | biggest points / second | ratio | biggest villages / second | ratio |', '|---|---|---|---|---|---|---|---|');
    for (const x of [{ seed: o.seed, rep }, ...extraSeeds]) {
      const b = snowball(x.rep.players, x.rep.options.days);
      const takes = x.rep.players.reduce((a, p) => a + p.stats.taken, 0);
      const holds = x.rep.players.reduce((a, p) => a + p.stats.holds, 0);
      const rs = x.rep.players.reduce((a, p) => a + p.stats.restarts, 0);
      out.push(`| ${x.seed} | ${takes} | ${holds} | ${rs} | ${b.pointsTop} / ${b.pointsSecond} | ${b.ratio.toFixed(2)} | ${b.villagesTop} / ${b.villagesSecond} | ${b.villageRatio.toFixed(2)} |`);
    }
  }

  out.push('', '## Conquests (first 30)', '');
  if (rep.conquests.length === 0) out.push('None.');
  for (const c of rep.conquests.slice(0, 30)) {
    const a = rep.players[c.attacker] as PlayerResult;
    const v = rep.players[c.victim] as PlayerResult;
    out.push(`- day ${(c.at / DAY).toFixed(1)}: #${a.id} ${a.style} took a ${c.points}-point village from #${v.id} ${v.style}${c.last ? ' (their LAST village: restart)' : ''}`);
  }
  out.push('', '## Flags', '');
  if (rep.errors.length === 0) out.push('None (no engine errors).');
  for (const e of rep.errors.slice(0, 5)) out.push(`- ERROR ${e}`);
  out.push(
    '',
    '## Model',
    '',
    `- ${o.players} players on a grid (${COLUMNS} columns, ${SPACING} tiles apart, shuffled styles), one shared world, 10-minute decision steps, free-player queues. Real engine calls only; no server. Each player has its OWN ring of 8 abandoned villages (3-14 tiles) for raids and Renown (as in balance.ts); abandoned villages are not taken and not shared.`,
    '- Style scripts are the ones in balance.ts (build list, army, research, raids). New behaviour: raids and Strikes also go to player villages within ' + REACH + ' tiles. No assumed enemy raids (players are the enemy now). Feast only to empty a full storehouse.',
    '- Raid on a player: preview with the target state at arrival (as if scouted), attack >= 1.25 x defence, net loot minus lost troops > 0, best net per travel time; target needs >= 30% of the attacker\'s average village points; neither side protected. Loot comes from the real stock (vault protects). Renown through battleRenown for both sides (pair windows, size factor).',
    '- Strike plan: once Renown >= price and a Banner Hall exists, a player picks the village with most points that its home army (all troops but Pathfinders + the needed Chieftains) beats by 1.25x, with >= 1 surviving Chieftain per `need` and >= HOLD_MIN_POPULATION survivors, on a village with >= 50% of its own best village\'s points, not protected / locked / cold (no pair cap since 2026-11-05; the Chieftain chain of separate attacks is not modelled: every Strike brings all its Chieftains at once). It reserves Renown for all needed Chieftains (villageRenownPrice, summed), saves and trains them as one batch (max 3), then strikes with all home troops. Found-style players (builder, turtle) found a village when no Strike target exists; take-style players (raider, balanced) stop raiding to build an escort and found after 72 h.',
    '- Strike, hold, take: checkStrike, applyStrike (hearth out, village frozen), updateHold (hold clock, as a due event), applyOwnerChange (all buildings, stock x TAKE_KEEP_RESOURCE_SHARE, old garrison / queues gone, occupiers move in, STRIKE_LOCK_HOURS lock). The old owner\'s Chieftains in that village are lost (half the Renown back); armies it had stationed elsewhere are disbanded and their holds end.',
    '- Defence: the owner fights the Strike with whatever is at home (the real battle). During the hold it attacks the occupiers (they defend with the village\'s Wall) with the best army from any of its villages that arrives before the clock ends and beats them by 1.1x (one army at a time). Occupiers dead = hearth relit; under HOLD_MIN_POPULATION for HOLD_FAIL_HOURS = claim fails. Not modelled: tribe-mates\' support, third players, scouting errors, Chieftain escorts arriving late (second wave), the owner recalling raids.',
    '- Restart: a player who loses the LAST village gets a fresh starting village on a ring far outside the grid, RESTART_PROTECTION_HOURS protection, a new ring of abandoned villages; Renown is kept, its Chieftains are gone.',
    '- Beginner protection: every starting village is protected (cannot be attacked, does not attack players) for 72 h; founded villages 24 h (FOUND_PROTECTION_HOURS).',
  );
  return out.join('\n');
}

/** Entry point; also reached through `npm run sim -- --conquest ...` (balance.ts hands over). */
export function main(): void {
  const args = process.argv.slice(2);
  const get = (name: string): number | undefined => {
    const i = args.indexOf(name);
    const n = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const opt: Partial<ConquestOptions> = {};
  const set = <K extends keyof ConquestOptions>(key: K, flag: string): void => {
    const v = get(flag);
    if (v !== undefined) (opt as Record<string, number>)[key] = v;
  };
  set('days', '--days');
  set('seed', '--seed');
  set('players', '--players');
  set('holdHours', '--hold-hours');
  set('chiefPoints', '--chief-points');
  set('lockHours', '--lock-hours');
  const seeds = get('--seeds') ?? 1;
  const first = runConquest(opt);
  const extra: Array<{ seed: number; rep: ConquestReport }> = [];
  for (let i = 1; i < seeds; i++) {
    const seed = first.options.seed + i;
    extra.push({ seed, rep: runConquest({ ...opt, seed }) });
  }
  const text = args.includes('--json') ? JSON.stringify(first, null, 1) : formatConquest(first, extra);
  const outAt = args.indexOf('--out');
  if (outAt >= 0 && args[outAt + 1]) {
    writeFileSync(args[outAt + 1] as string, `${text}\n`);
    console.log(`Report written to ${args[outAt + 1]}`);
  } else console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
