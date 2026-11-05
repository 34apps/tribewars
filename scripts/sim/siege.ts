// Siege experiments (docs/GAME_DESIGN.md 18.9, docs/BALANCE.md section 8): focused questions about Log Rams and Boulder Slings,
// answered with the REAL engine (resolveBattle, resolveSiege, applyBattleToDefender, buildingCost, buildTimeMs, travelPreview,
// trainTimeMs). No formula is copied here; the only arithmetic is searching for a count that makes the engine say "yes".
//
//   npm run sim -- --siege            prints these tables first, then the computer players with and without siege units
//
// Fixed seeds (hashSeed), so every run gives the same numbers. Luck in a battle is +-10%, so each fight is averaged over SEEDS.

import {
  BUILDINGS,
  DEFAULT_WORLD,
  POP_PER_UNIT,
  RESOURCE_IDS,
  UNITS,
  applyBattleToDefender,
  buildTimeMs,
  buildingCost,
  cloneVillage,
  createPlayerVillage,
  emptyUnits,
  hashSeed,
  resolveBattle,
  resolveSiege,
  siegePointsNeeded,
  trainTimeMs,
  travelPreview,
} from '../../packages/engine/src/index.ts';
import type { BattleResult, BuildingId, Resources, UnitId, Units, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';

const HOUR = 3_600_000;
/** Same value weights as the balance simulator: gold is rare, so it counts 10x. */
const VALUE_WEIGHT: Resources = { wood: 1, food: 1, iron: 1, gold: 10 };
const value = (r: Resources): number => RESOURCE_IDS.reduce((a, id) => a + r[id] * VALUE_WEIGHT[id], 0);
const unitValue = (u: UnitId): number => value(UNITS[u].cost);
const world: WorldSettings = { ...DEFAULT_WORLD, speed: 1 };
const SEEDS = Array.from({ length: 9 }, (_, i) => hashSeed(20261105, i));
/** A decisive win: attack = 2x the defence (the winner then loses (1/2)^1.5 of the army, about 35%). */
const DECISIVE = 2;
const k = (n: number): string => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const n0 = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtH = (ms: number): string => (ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / HOUR).toFixed(1)} h`);

export interface SiegeExperiments {
  lines: string[];
  /** Invariants the experiments verify; every entry should be ok (a test checks it). */
  checks: Array<{ name: string; ok: boolean }>;
}

// ---- Building blocks -------------------------------------------------------------------------------

/** A player village (Town Hall 10) with the given levels and garrison. */
function village(buildings: Partial<Record<BuildingId, number>>, troops: Partial<Units> = {}): VillageState {
  const v = cloneVillage(createPlayerVillage(0));
  v.buildings = { ...v.buildings, hall: 10, ...buildings };
  v.troops = { ...emptyUnits(), ...troops };
  return v;
}
const army = (spec: Partial<Units>): Units => ({ ...emptyUnits(), ...spec });

function fight(def: VillageState, units: Units, seed: number, target?: BuildingId): BattleResult {
  return resolveBattle({ attackerUnits: units, defender: def, seed, noLoot: true, ...(target ? { siegeTarget: target } : {}) });
}

/** The defence the engine computes against an all-infantry attack (every siege unit and the Raider is infantry). */
function defenceOf(def: VillageState): number {
  return fight(def, army({ raider: 1 }), 1).defensePower;
}

/** Raiders that make (raiders + the other units) reach `ratio` x the defence, by the engine's own attack numbers. */
function raidersFor(def: VillageState, ratio: number, other: Partial<Units> = {}): number {
  const d = defenceOf(def);
  let n = 0;
  let a = 0;
  for (const id of Object.keys(other) as UnitId[]) a += (other[id] ?? 0) * UNITS[id].attack;
  while (a + n * UNITS.raider.attack < ratio * d) n += 1;
  return n;
}

/** Smallest number of SURVIVING siege units of `unit` that lowers `building` (from `level`) by `drop` levels, or undefined (cap or floor). */
function survivorsNeeded(unit: 'logram' | 'boulder', building: BuildingId, level: number, drop: number): number | undefined {
  const levels = village({ [building]: level }).buildings;
  for (let n = 1; n <= 800; n++) {
    const hit = resolveSiege(army({ [unit]: n }), levels, building, 0).find((h) => h.unit === unit);
    if (hit && hit.from - hit.to >= drop) return n;
  }
  return undefined;
}

/** Share of an army that comes back from a won battle at `ratio` x the defence, averaged over the seeds (the engine's own loss rule). */
function survival(ratio: number): number {
  const def = village({ wall: 10 }, { pikeman: 250, guard: 150 });
  const sent = raidersFor(def, ratio);
  let lost = 0;
  let wins = 0;
  for (const seed of SEEDS) {
    const r = fight(def, army({ raider: sent }), seed);
    if (!r.attackerWon) continue;
    wins += 1;
    lost += r.attackerLosses.raider / sent;
  }
  return wins === 0 ? 0 : 1 - lost / wins;
}

/** Cost of building a level range (from+1 .. to) of `b` again: resources valued, and construction hours (Town Hall 10, speed 1). */
function rebuild(b: BuildingId, lowTo: number, from: number): { value: number; hours: number } {
  let v = 0;
  let ms = 0;
  for (let l = lowTo + 1; l <= from; l++) {
    v += value(buildingCost(b, l));
    ms += buildTimeMs(b, l, 10, world);
  }
  return { value: v, hours: ms / HOUR };
}

/** Real battles of `units` against `def`: share won, average levels dropped on `building` by `unit`, average attacker loss value. */
function averageFight(def: VillageState, units: Units, building: BuildingId, unit: 'logram' | 'boulder'): { won: number; dropped: number; lossValue: number; defenderUnitsLost: number } {
  let won = 0;
  let dropped = 0;
  let loss = 0;
  let defLost = 0;
  for (const seed of SEEDS) {
    const r = fight(def, units, seed, building);
    if (r.attackerWon) won += 1;
    const after = applyBattleToDefender(def, r);
    dropped += def.buildings[building] - after.buildings[building];
    for (const id of Object.keys(UNITS) as UnitId[]) {
      loss += r.attackerLosses[id] * unitValue(id);
      defLost += r.defenderLosses[id];
    }
  }
  const count = SEEDS.length;
  void unit;
  return { won: won / count, dropped: dropped / count, lossValue: loss / count, defenderUnitsLost: defLost / count };
}

// ---- The experiments -------------------------------------------------------------------------------

export function runSiegeExperiments(home: { x: number; y: number } = { x: -30, y: -10 }): SiegeExperiments {
  const lines: string[] = [];
  const checks: SiegeExperiments['checks'] = [];
  const check = (name: string, ok: boolean): void => {
    checks.push({ name, ok });
  };
  const ram = UNITS.logram;
  const sling = UNITS.boulder;
  const fDecisive = survival(DECISIVE);

  lines.push('# Siege units: balance experiments (real engine, fixed seeds)', '');
  lines.push(
    `Unit prices (valued wood + food + iron + 10 x gold): Log Ram ${n0(unitValue('logram'))} (pop ${POP_PER_UNIT.logram}), Boulder Sling ${n0(unitValue('boulder'))} (pop ${POP_PER_UNIT.boulder}), Raider ${n0(unitValue('raider'))}, Pikeman ${n0(unitValue('pikeman'))}, Shieldbearer ${n0(unitValue('guard'))}. Points to lower a level: ${[1, 3, 6, 10, 15, 20].map((l) => `L${l} ${siegePointsNeeded(l)}`).join(', ')}. In a decisive win (attack = ${DECISIVE} x defence) ${(fDecisive * 100).toFixed(0)}% of an army comes back, so about ${(100 / fDecisive).toFixed(0)}% of the survivors must be sent.`,
    '',
  );

  // (b) How many siege units drop a level -----------------------------------------------------------
  lines.push('## (b) Siege units that must SURVIVE the battle to lower the Wall', '');
  lines.push('| Wall level | points / level | Log Rams: 1 level | 2 levels | 3 levels (cap) | Boulder Slings: 1 level | 2 levels (cap) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const level of [3, 6, 10, 15, 20]) {
    const f = (u: 'logram' | 'boulder', d: number): string => String(survivorsNeeded(u, 'wall', level, d) ?? 'n/a');
    lines.push(`| ${level} | ${siegePointsNeeded(level)} | ${f('logram', 1)} | ${f('logram', 2)} | ${f('logram', 3)} | ${f('boulder', 1)} | ${f('boulder', 2)} |`);
  }
  const hugeRams = resolveSiege(army({ logram: 5000 }), village({ wall: 20 }).buildings, 'wall', 0).find((h) => h.unit === 'logram');
  const hugeSlings = resolveSiege(army({ boulder: 5000 }), village({ wall: 20 }).buildings, 'wall', 0).find((h) => h.unit === 'boulder');
  lines.push('', `With 5,000 survivors one attack still lowers the Wall by at most ${hugeRams ? hugeRams.from - hugeRams.to : '?'} (Rams) or ${hugeSlings ? hugeSlings.from - hugeSlings.to : '?'} (Slings) levels: the per-attack cap works. Send size = survivors / ${fDecisive.toFixed(2)} in a decisive win (table (a)).`, '');
  check('per-attack cap: Rams at most 3 levels', hugeRams !== undefined && hugeRams.from - hugeRams.to === ram.siege?.maxLevels);
  check('per-attack cap: Slings at most 2 levels', hugeSlings !== undefined && hugeSlings.from - hugeSlings.to === sling.siege?.maxLevels);

  // (a) Cost of the siege army vs cost of rebuilding ------------------------------------------------
  lines.push('## (a) What siege costs the attacker vs what the defender pays to rebuild', '');
  lines.push(`Siege army = the units that must be SENT so enough survive a decisive win (attack ${DECISIVE} x defence). "Loses" = the units that die in that win (value). Rebuild = resources of the lowered levels + build hours (Town Hall 10, speed 1). Check = real battles, average levels dropped over ${SEEDS.length} seeds.`, '');
  lines.push('| target | unit | survivors | send | army value (capital) | loses (value) | defender rebuild cost | rebuild time | rebuild / loses | rebuild / capital | check: levels dropped |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const rowsA: Array<[BuildingId, number, number, 'logram' | 'boulder']> = [
    ['wall', 5, 1, 'logram'], ['wall', 10, 1, 'logram'], ['wall', 10, 3, 'logram'], ['wall', 15, 1, 'logram'], ['wall', 20, 1, 'logram'], ['wall', 10, 1, 'boulder'],
    ['market', 5, 1, 'boulder'], ['market', 10, 1, 'boulder'], ['drillyard', 5, 1, 'boulder'], ['drillyard', 9, 1, 'boulder'],
    ['bannerhall', 1, 1, 'boulder'], ['bannerhall', 3, 1, 'boulder'], ['bannerhall', 4, 1, 'boulder'], ['bannerhall', 4, 2, 'boulder'],
  ];
  const verdictRows: Array<{ label: string; ratioLoses: number; ratioCapital: number }> = [];
  for (const [b, level, drop, unit] of rowsA) {
    const need = survivorsNeeded(unit, b, level, drop);
    const label = `${BUILDINGS[b].name} ${level}->${level - drop}`;
    if (need === undefined) {
      lines.push(`| ${label} | ${UNITS[unit].name} | n/a | | | | | | | | |`);
      continue;
    }
    const send = Math.ceil(need / fDecisive);
    const capital = send * unitValue(unit);
    const loses = (send - need) * unitValue(unit);
    const rb = rebuild(b, level - drop, level);
    // Real check: the defender has the building at `level`, Wall 10 and a garrison; the attack is raiders + the siege units.
    const def = village({ [b]: level, ...(b === 'wall' ? {} : { wall: 10 }) }, { pikeman: 250, guard: 150 });
    const raiders = raidersFor(def, DECISIVE, { [unit]: send });
    const real = averageFight(def, army({ raider: raiders, [unit]: send }), b, unit);
    lines.push(
      `| ${label} | ${UNITS[unit].name} | ${need} | ${send} | ${n0(capital)} | ${n0(loses)} | ${n0(rb.value)} | ${rb.hours.toFixed(1)} h | ${(rb.value / loses).toFixed(2)} | ${(rb.value / capital).toFixed(2)} | ${real.dropped.toFixed(1)} (won ${(real.won * 100).toFixed(0)}%) |`,
    );
    verdictRows.push({ label, ratioLoses: rb.value / loses, ratioCapital: rb.value / capital });
  }
  lines.push('', 'rebuild / loses above 1 means the defender pays MORE than the attacker lost in the attack (siege pays off even if every siege unit that survives is only reused); rebuild / capital above 1 means even buying the whole siege army for one attack would be cheaper than the damage (siege is a bargain).', '');
  const wallRows = verdictRows.filter((r) => r.label.startsWith('Wall'));
  check('Wall levels are cheap to rebuild vs the Rams that lower them (rebuild < attacker capital)', wallRows.every((r) => r.ratioCapital < 1));

  // (c) Campaign against a fortified village -----------------------------------------------------------
  lines.push('## (c) Attacks needed against a fortified village, with and without siege', '');
  lines.push(
    `Each wave: the attacker sends Raiders + Log Rams so that attack = ${DECISIVE} x the defence the engine reports (Wall as it stands before the battle), wins, the garrison dies. Between waves the defender brings the garrison back to 50% of the original. Rams are sized to take 3 Wall levels from the starting level (survivors / ${fDecisive.toFixed(2)}). No siege = the same waves with no Rams (the Wall never drops).`,
    '',
  );
  const scenarios: Array<{ label: string; wall: number; garrison: Partial<Units> }> = [
    { label: 'Wall 10, 250 Pikemen + 150 Shieldbearers', wall: 10, garrison: { pikeman: 250, guard: 150 } },
    { label: 'Wall 15, 250 Pikemen + 150 Shieldbearers', wall: 15, garrison: { pikeman: 250, guard: 150 } },
    { label: 'Wall 15, empty (just the Wall and militia)', wall: 15, garrison: {} },
  ];
  const half = (g: Partial<Units>): Partial<Units> => ({ pikeman: Math.round((g.pikeman ?? 0) / 2), guard: Math.round((g.guard ?? 0) / 2) });
  let fortressSiegeSavings: number | undefined;
  for (const sc of scenarios) {
    const ramsNeed = survivorsNeeded('logram', 'wall', sc.wall, 3) ?? 0;
    const rams = Math.ceil(ramsNeed / fDecisive);
    lines.push(`### ${sc.label} (${rams} Rams, value ${n0(rams * unitValue('logram'))})`, '');
    lines.push('| wave | siege? | Wall before -> after | defence | Raiders sent | Rams sent | army sent (value) | army lost (value) |');
    lines.push('|---|---|---|---|---|---|---|---|');
    const totals: Record<string, { sent: number; lost: number; raiders: number }> = {};
    for (const withSiege of [false, true]) {
      let def = village({ wall: sc.wall }, sc.garrison);
      const key = withSiege ? 'siege' : 'plain';
      totals[key] = { sent: 0, lost: 0, raiders: 0 };
      const t = totals[key] as { sent: number; lost: number; raiders: number };
      for (let wave = 1; wave <= 6; wave++) {
        if (def.buildings.wall === 0 && withSiege) break;
        const useRams = withSiege && def.buildings.wall > 0 ? rams : 0;
        const raiders = raidersFor(def, DECISIVE, { logram: useRams });
        const sentUnits = army({ raider: raiders, logram: useRams });
        const r = fight(def, sentUnits, SEEDS[wave] as number, 'wall');
        const d = defenceOf(def);
        let lost = 0;
        for (const id of Object.keys(UNITS) as UnitId[]) lost += r.attackerLosses[id] * unitValue(id);
        const sent = raiders * unitValue('raider') + useRams * unitValue('logram');
        const after = applyBattleToDefender(def, r);
        lines.push(`| ${wave} | ${withSiege ? 'yes' : 'no'} | ${def.buildings.wall} -> ${after.buildings.wall} | ${n0(d)} | ${raiders} | ${useRams} | ${n0(sent)} | ${n0(lost)} |`);
        t.sent += sent;
        t.lost += lost;
        t.raiders += raiders;
        if (!r.attackerWon) break;
        def = { ...after, troops: { ...emptyUnits(), ...half(sc.garrison) } };
        if (!withSiege && wave >= 4) break;
      }
    }
    const plain = totals.plain as { sent: number; lost: number; raiders: number };
    const siege = totals.siege as { sent: number; lost: number; raiders: number };
    lines.push('');
    // The defender's answer: how many Shieldbearers (real defence numbers) make wave 2 as strong as it is without siege?
    const wallAfter = survivorsNeeded('logram', 'wall', sc.wall, 3) !== undefined ? sc.wall - 3 : sc.wall;
    const wave2Plain = village({ wall: sc.wall }, half(sc.garrison));
    const wave2Siege = village({ wall: wallAfter }, half(sc.garrison));
    const target = defenceOf(wave2Plain);
    let extra = 0;
    while (defenceOf({ ...wave2Siege, troops: { ...wave2Siege.troops, guard: wave2Siege.troops.guard + extra } }) < target && extra < 5000) extra += 1;
    lines.push(
      `Wave 2 needs ${n0(defenceOf(wave2Plain))} attack without siege and ${n0(defenceOf(wave2Siege))} after a siege wave took the Wall to ${wallAfter}: the attacker saves ${n0(((target - defenceOf(wave2Siege)) / UNITS.raider.attack) * DECISIVE)} Raider-equivalents per wave (${n0(((target - defenceOf(wave2Siege)) / UNITS.raider.attack) * DECISIVE * unitValue('raider'))} value). To cancel that the defender adds ${extra} Shieldbearers (${n0(extra * unitValue('guard'))} value) or rebuilds ${3} Wall levels (${n0(rebuild('wall', wallAfter, sc.wall).value)} value, ${rebuild('wall', wallAfter, sc.wall).hours.toFixed(1)} h). First waves: ${n0(plain.sent)} sent without siege (${plain.raiders} Raiders over the same waves) vs ${n0(siege.sent)} with.`,
      '',
    );
    if (sc.label.startsWith('Wall 10')) fortressSiegeSavings = (target - defenceOf(wave2Siege)) / target;
  }
  lines.push(
    'Reading: against a village with a real garrison the Wall is only a part of the defence, so lowering it three levels barely changes the attack the next wave needs. The Rams cost more than the Raiders they save, and the defender can undo it with a few Shieldbearers or three cheap Wall levels. Only a village that is mostly Wall gains a lot from siege.',
    '',
  );
  check('against a garrisoned village siege lowers the next wave\'s defence by under 40%', fortressSiegeSavings !== undefined && fortressSiegeSavings < 0.4);

  // (d) Siege must not make defending pointless -----------------------------------------------------
  lines.push('## (d) Does siege make defending pointless?', '');
  lines.push('### (d1) The same attack at different strengths: a hold still costs the attacker, a lost attack lowers little', '');
  const fort = village({ wall: 10, market: 5, bannerhall: 3 }, { pikeman: 250, guard: 150 });
  const fortRams = 60;
  lines.push(`Attacker: ${fortRams} Log Rams + 20 Boulder Slings (picking the Banner Hall) + enough Raiders for the ratio. Defender: Wall 10, Banner Hall 3, Market 5, 250 Pikemen + 150 Shieldbearers. ${SEEDS.length} seeds per row (luck +-10%).`, '');
  lines.push('| attack / defence | battles won | buildings lowered when LOST | levels lowered when WON (avg) | attacker loses (value) | defender troops lost (avg) |');
  lines.push('|---|---|---|---|---|---|');
  let lostBattleChanged = 0;
  let lostBattles = 0;
  for (const ratio of [0.6, 0.9, 1.0, 1.1, 1.25, 1.5, 2, 3]) {
    const raiders = raidersFor(fort, ratio, { logram: fortRams, boulder: 20 });
    const units = army({ raider: raiders, logram: fortRams, boulder: 20 });
    let won = 0;
    let wonLevels = 0;
    let lossValue = 0;
    let defLost = 0;
    let changedWhenLost = 0;
    for (const seed of SEEDS) {
      const r = fight(fort, units, seed, 'bannerhall');
      const after = applyBattleToDefender(fort, r);
      const changed = (Object.keys(fort.buildings) as BuildingId[]).reduce((a, b) => a + (fort.buildings[b] - after.buildings[b]), 0);
      if (r.attackerWon) {
        won += 1;
        wonLevels += changed;
      } else {
        lostBattles += 1;
        // Rules of 2026-11-05: the rams' during-the-battle hit and a share of the siege units still count on a loss, but the
        // total can never pass what the two siege kinds may lower in one attack.
        if (changed > 0) changedWhenLost += 1;
        if (changed > (UNITS.logram.siege?.maxLevels ?? 0) + (UNITS.boulder.siege?.maxLevels ?? 0)) lostBattleChanged += 1;
      }
      for (const id of Object.keys(UNITS) as UnitId[]) {
        lossValue += r.attackerLosses[id] * unitValue(id);
        defLost += r.defenderLosses[id];
      }
    }
    const nLost = SEEDS.length - won;
    lines.push(`| ${ratio.toFixed(2)} | ${won} / ${SEEDS.length} | ${nLost === 0 ? '-' : `${changedWhenLost} of ${nLost}`} | ${won === 0 ? '-' : (wonLevels / won).toFixed(1)} | ${n0(lossValue / SEEDS.length)} | ${n0(defLost / SEEDS.length)} |`);
  }
  lines.push('', 'Since 2026-11-05 a defence that holds can still lose a Wall level or two: the Log Rams fire half their points during the battle, and a share of every siege kind counts as a survivor on a loss. The attacker lost the whole army for it, and a hopeless attack (ratio 0.6) lowers the Wall only by the during hit. A clear win lowers the most.', '');
  check('a lost battle never lowers more than the siege kinds may lower in one attack', lostBattles > 0 && lostBattleChanged === 0);

  lines.push('### (d2) The army needed to win AND take one Wall level, by how well the village is defended', '');
  lines.push(`Each row: Log Rams sized so one level survives a decisive win (attack ${DECISIVE} x defence), Raiders sized for the ratio. Defence = the engine's number for the village as it stands.`, '');
  lines.push('| village | defence | Raiders | Rams | army pop | army value | x the empty-village army |');
  lines.push('|---|---|---|---|---|---|---|');
  const targets: Array<[string, VillageState]> = [
    ['Wall 10, no garrison', village({ wall: 10 })],
    ['Wall 10, 100 Pikemen + 60 Shieldbearers', village({ wall: 10 }, { pikeman: 100, guard: 60 })],
    ['Wall 10, 250 Pikemen + 150 Shieldbearers', village({ wall: 10 }, { pikeman: 250, guard: 150 })],
    ['Wall 15, 500 Pikemen + 300 Shieldbearers', village({ wall: 15 }, { pikeman: 500, guard: 300 })],
  ];
  const needRams = Math.ceil((survivorsNeeded('logram', 'wall', 10, 1) ?? 0) / fDecisive);
  let baseValue = 0;
  const armyValues: number[] = [];
  for (const [label, v] of targets) {
    const rams = Math.ceil((survivorsNeeded('logram', 'wall', v.buildings.wall, 1) ?? needRams) / fDecisive);
    const raiders = raidersFor(v, DECISIVE, { logram: rams });
    const val = raiders * unitValue('raider') + rams * unitValue('logram');
    if (baseValue === 0) baseValue = val;
    armyValues.push(val);
    lines.push(`| ${label} | ${n0(defenceOf(v))} | ${raiders} | ${rams} | ${raiders + rams * POP_PER_UNIT.logram} | ${n0(val)} | ${(val / baseValue).toFixed(1)}x |`);
  }
  lines.push('', 'The garrison, not the Wall, decides how big the attack must be; siege adds a fixed Ram block on top and does nothing to shrink the garrison part.', '');
  check('a real garrison + Wall needs a much bigger army even with siege (at least 5x the empty village)', armyValues.length === 4 && (armyValues[2] as number) >= 5 * (armyValues[0] as number));

  lines.push('### (d3) The siege army is slow: warning time for the defender (20 tiles, speed 1, terrain from the world seed)', '');
  const to = { x: home.x + 20, y: home.y };
  lines.push('| army | slowest unit | flat ground | with terrain |');
  lines.push('|---|---|---|---|');
  const trips: Array<[string, Units, UnitId]> = [
    ['Raiders only', army({ raider: 100 }), 'raider'],
    ['Outriders only', army({ outrider: 100 }), 'outrider'],
    ['Pathfinder (scout)', army({ pathfinder: 5 }), 'pathfinder'],
    ['Raiders + 20 Boulder Slings', army({ raider: 100, boulder: 20 }), 'boulder'],
    ['Raiders + 20 Log Rams', army({ raider: 100, logram: 20 }), 'logram'],
    ['Log Rams only', army({ logram: 20 }), 'logram'],
  ];
  const times: Record<string, number> = {};
  for (const [label, units, slow] of trips) {
    const p = travelPreview(home, to, units, world);
    times[label] = p.ms;
    lines.push(`| ${label} | ${UNITS[slow].name} (speed ${UNITS[slow].speed}) | ${fmtH(p.flatMs)} | ${fmtH(p.ms)} |`);
  }
  const barracks8 = village({ barracks: 8 });
  lines.push(
    '',
    `Training: one Log Ram takes ${fmtH(trainTimeMs('logram', barracks8, world))} and one Boulder Sling ${fmtH(trainTimeMs('boulder', barracks8, world))} in a Barracks level 8, so 20 Rams are ${fmtH(20 * trainTimeMs('logram', barracks8, world))} of queue; each unit first needs a Drillyard research of ${fmtH(ram.research ? ram.research.timeSec * 1000 : 0)} / ${fmtH(sling.research ? sling.research.timeSec * 1000 : 0)}. The defender sees the army on the map for the whole trip and can reinforce, recall support or strike the slow column first.`,
    '',
  );
  check('a siege column is at least 1.8x slower than Raiders over 20 tiles', (times['Raiders + 20 Log Rams'] as number) >= 1.8 * (times['Raiders only'] as number));
  return { lines, checks };
}

export function formatSiegeExperiments(x: SiegeExperiments): string {
  const failed = x.checks.filter((c) => !c.ok);
  return [...x.lines, '## Invariants', '', ...x.checks.map((c) => `- ${c.ok ? 'OK' : 'FAILED'}: ${c.name}`), '', failed.length === 0 ? 'All invariants hold.' : `${failed.length} invariant(s) FAILED.`, ''].join('\n');
}
