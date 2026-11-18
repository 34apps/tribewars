// Siege experiments (docs/GAME_DESIGN.md 18.9, docs/BALANCE.md section 8): focused questions about the Log Ram (the Wall) and the Firecart (other buildings),
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
  RANK_MAX,
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
import type { BattleResult, BuildingId, Resources, UnitId, Units, VillageRanks, VillageState, WorldSettings } from '../../packages/engine/src/index.ts';

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
/** Both siege units at the top Breach rank (the engine ignores a track a unit does not have in RANK_TRACKS_OF). */
const BREACH_TOP: VillageRanks = {
  logram: { might: 0, bulwark: 0, keen: 0, breach: RANK_MAX },
  firecart: { might: 0, bulwark: 0, keen: 0, breach: RANK_MAX },
};

function fight(def: VillageState, units: Units, seed: number, target?: BuildingId, ranks?: VillageRanks): BattleResult {
  return resolveBattle({ attackerUnits: units, defender: def, seed, noLoot: true, ...(ranks ? { attackerRanks: ranks } : {}), ...(target ? { siegeTarget: target } : {}) });
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
function survivorsNeeded(unit: 'logram' | 'firecart', building: BuildingId, level: number, drop: number, ranks?: VillageRanks): number | undefined {
  const levels = village({ [building]: level }).buildings;
  for (let n = 1; n <= 800; n++) {
    const hit = resolveSiege(army({ [unit]: n }), levels, building, undefined, 0, ranks).find((h) => h.unit === unit);
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
function averageFight(def: VillageState, units: Units, building: BuildingId, unit: 'logram' | 'firecart', ranks?: VillageRanks): { won: number; dropped: number; lossValue: number; defenderUnitsLost: number } {
  let won = 0;
  let dropped = 0;
  let loss = 0;
  let defLost = 0;
  for (const seed of SEEDS) {
    const r = fight(def, units, seed, building, ranks);
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
  const cart = UNITS.firecart;
  const ram = UNITS.logram;
  const cap = ram.siege?.maxLevels ?? 0; // levels per step of the Log Ram (the Wall)
  const capCart = cart.siege?.maxLevels ?? 0; // levels per step of the Firecart (other buildings)
  const fDecisive = survival(DECISIVE);

  lines.push('# Siege: Log Ram (Wall) and Firecart (buildings), balance experiments (real engine, fixed seeds)', '');
  lines.push(
    `Unit prices (valued wood + food + iron + 10 x gold): Log Ram ${n0(unitValue('logram'))} (pop ${POP_PER_UNIT.logram}), Firecart ${n0(unitValue('firecart'))} (pop ${POP_PER_UNIT.firecart}), Raider ${n0(unitValue('raider'))}, Pikeman ${n0(unitValue('pikeman'))}, Shieldbearer ${n0(unitValue('guard'))}. Points to lower a level: ${[1, 3, 6, 10, 15, 25].map((l) => `L${l} ${siegePointsNeeded(l)}`).join(', ')}. In a decisive win (attack = ${DECISIVE} x defence) ${(fDecisive * 100).toFixed(0)}% of an army comes back, so about ${(100 / fDecisive).toFixed(0)}% of the survivors must be sent.`,
    '',
  );

  // (b) How many siege units drop a level --------------------------------------------------------------
  lines.push('## (b) Siege units that must SURVIVE the battle to lower a building (after-the-battle step)', '');
  lines.push(`| level | points / level | Log Rams: Wall 1 level | ... ${cap} levels | Firecarts: 1 level | ... ${capCart} levels |`);
  lines.push('|---|---|---|---|---|---|');
  for (const level of [3, 6, 10, 15, 22]) {
    const f = (u: 'logram' | 'firecart', b: BuildingId, d: number): string => String(survivorsNeeded(u, b, level, d) ?? 'n/a');
    lines.push(`| ${level} | ${siegePointsNeeded(level)} | ${f('logram', 'wall', 1)} | ${f('logram', 'wall', cap)} | ${f('firecart', 'market', 1)} | ${f('firecart', 'market', capCart)} |`);
  }
  const huge = resolveSiege(army({ firecart: 5000 }), village({ wall: 20, market: 12 }).buildings, 'market').find((h) => h.unit === 'firecart');
  const hugeBoth = resolveSiege(army({ logram: 5000 }), village({ wall: 20 }).buildings, 'wall', army({ logram: 5000 })).find((h) => h.unit === 'logram');
  lines.push('', `With 5,000 survivors one step still lowers a building by at most ${huge ? huge.from - huge.to : '?'} levels (Firecart), and a Wall hit by both Log Ram steps (during + after) by at most ${hugeBoth ? hugeBoth.from - hugeBoth.to : '?'}: the per-step cap works.`, '');
  check(`per-step cap: a Firecart lowers at most ${capCart} levels`, huge !== undefined && huge.from - huge.to === capCart);
  check(`the Wall takes at most 2 x ${cap} levels when the Log Rams hit it in both steps`, hugeBoth !== undefined && hugeBoth.from - hugeBoth.to === 2 * cap);
  const mixed = army({ logram: 5000, firecart: 5000 });
  const mixedHits = resolveSiege(mixed, village({ wall: 20, market: 12, barracks: 9 }).buildings, null, mixed, 0.5);
  check('Log Rams only ever hit the Wall; Firecarts never do (no pick: a random other building)', mixedHits.filter((h) => h.unit === 'logram').every((h) => h.building === 'wall') && mixedHits.some((h) => h.unit === 'firecart') && mixedHits.filter((h) => h.unit === 'firecart').every((h) => h.building !== 'wall'));
  check('the Farm and the Longhouse never drop below 1', ['farm', 'longhouse'].every((b) => resolveSiege(army({ firecart: 5000 }), village({ [b]: 2 }).buildings, b as BuildingId)[0]?.to === 1));

  // (a) Cost of the Firecart army vs cost of rebuilding ---------------------------------------------
  lines.push('## (a) What siege costs the attacker vs what the defender pays to rebuild (Wall rows: Log Rams; other buildings: Firecarts)', '');
  lines.push(`Siege army = the siege units (Log Rams for the Wall, Firecarts for the rest) that must be SENT so enough survive a decisive win (attack ${DECISIVE} x defence). "Loses" = the siege units that die in that win (value). Rebuild = resources of the lowered levels + build hours (Town Hall 10, speed 1). Check = real battles, average levels dropped over ${SEEDS.length} seeds.`, '');
  lines.push('| target | survivors | send | army value (capital) | loses (value) | defender rebuild cost | rebuild time | rebuild / loses | rebuild / capital | check: levels dropped |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  const rowsA: Array<[BuildingId, number, number]> = [
    ['wall', 5, 1], ['wall', 10, 1], ['wall', 10, 2], ['wall', 15, 1], ['wall', 22, 1],
    ['market', 5, 1], ['market', 10, 1], ['drillyard', 5, 1], ['drillyard', 9, 1],
    ['bannerhall', 1, 1], ['bannerhall', 3, 1], ['bannerhall', 4, 1], ['bannerhall', 4, 2],
  ];
  const verdictRows: Array<{ label: string; ratioLoses: number; ratioCapital: number }> = [];
  for (const [b, level, drop] of rowsA) {
    const unit = b === 'wall' ? 'logram' : 'firecart';
    const need = survivorsNeeded(unit, b, level, drop);
    const label = `${BUILDINGS[b].name} ${level}->${level - drop}`;
    if (need === undefined) {
      lines.push(`| ${label} | n/a | | | | | | | | |`);
      continue;
    }
    const send = Math.ceil(need / fDecisive);
    const capital = send * unitValue(unit);
    const loses = (send - need) * unitValue(unit);
    const rb = rebuild(b, level - drop, level);
    const def = village({ [b]: level, ...(b === 'wall' ? {} : { wall: 10 }) }, { pikeman: 250, guard: 150 });
    const raiders = raidersFor(def, DECISIVE, { [unit]: send });
    const real = averageFight(def, army({ raider: raiders, [unit]: send }), b, unit);
    lines.push(
      `| ${label} (${unit === 'logram' ? 'Log Rams' : 'Firecarts'}) | ${need} | ${send} | ${n0(capital)} | ${n0(loses)} | ${n0(rb.value)} | ${rb.hours.toFixed(1)} h | ${(rb.value / loses).toFixed(2)} | ${(rb.value / capital).toFixed(2)} | ${real.dropped.toFixed(1)} (won ${(real.won * 100).toFixed(0)}%) |`,
    );
    verdictRows.push({ label, ratioLoses: rb.value / loses, ratioCapital: rb.value / capital });
  }
  lines.push('', 'rebuild / loses above 1 means the defender pays MORE than the attacker lost in the attack; rebuild / capital above 1 means even buying the whole siege army for one attack would be cheaper than the damage (siege is a bargain).', '');
  const wallRows = verdictRows.filter((r) => r.label.startsWith('Wall'));
  // BALANCE 14 (2026-11-17): the Wall line moved from 1 to 1.5 x. BALANCE 18 (2026-11-18): the Log Ram took over the Wall (owner pick: about 3x the power,
  // cheaper) and SIEGE_POINTS_PER_LEVEL went 2 -> 7 so a high Wall is not a bargain: the line is 2 x for EVERY Wall level (Wall 22 comes out at 1.8 x; 1.5 x would need
  // 9 points per level, which makes the Firecart useless against ordinary buildings).
  check('Wall levels are not a bargain to knock down with Log Rams (rebuild < 2 x attacker capital, every Wall level)', wallRows.every((r) => r.ratioCapital < 2));
  check('one Log Ram costs less than one Firecart and does at least 3x its old Wall damage (power 2)', unitValue('logram') < unitValue('firecart') && (ram.siege?.power ?? 0) >= 3 * 2);

  // (a2) The same with Breach ranks (Drillyard, GAME_DESIGN 15): rank 0 vs rank RANK_MAX ---------------------------------
  lines.push(`## (a2) Breach rank 0 vs ${RANK_MAX} (the Drillyard track of the Log Ram and the Firecart: more siege power per unit)`, '');
  lines.push(
    `Same method as (b) and (a); "Breach ${RANK_MAX}" = both siege units at rank ${RANK_MAX} in the sending village (attackerRanks / resolveSiege ranks). The defender's rebuild cost does not change, so a cheaper siege army pushes rebuild / capital up: the table checks the line "rebuild < 2 x the attacker's capital" for EVERY Wall level.`,
    '',
  );
  lines.push(`| level | Log Rams to lower the Wall 1 level: Breach 0 | Breach ${RANK_MAX} | ${cap} levels: Breach 0 | Breach ${RANK_MAX} | Firecarts (Market) 1 level: Breach 0 | Breach ${RANK_MAX} |`);
  lines.push('|---|---|---|---|---|---|---|');
  for (const level of [3, 6, 10, 15, 22]) {
    const f = (u: 'logram' | 'firecart', b: BuildingId, d: number, r?: VillageRanks): string => String(survivorsNeeded(u, b, level, d, r) ?? 'n/a');
    lines.push(`| ${level} | ${f('logram', 'wall', 1)} | ${f('logram', 'wall', 1, BREACH_TOP)} | ${f('logram', 'wall', cap)} | ${f('logram', 'wall', cap, BREACH_TOP)} | ${f('firecart', 'market', 1)} | ${f('firecart', 'market', 1, BREACH_TOP)} |`);
  }
  lines.push('');
  lines.push(`Wall, one level at a time (send = survivors needed / ${fDecisive.toFixed(2)} so enough live through a decisive win; Town Hall 10, speed 1):`, '');
  lines.push(`| Wall level -> | Log Rams sent, Breach 0 | capital | rebuild / capital | Log Rams sent, Breach ${RANK_MAX} | capital | rebuild / capital |`);
  lines.push('|---|---|---|---|---|---|---|');
  const wallMax = BUILDINGS.wall.maxLevel;
  const ratioAt: Record<'0' | 'top', number[]> = { '0': [], top: [] };
  let sweepMissing = 0;
  for (let level = 2; level <= wallMax; level++) {
    const cells: string[] = [];
    for (const [which, ranks] of [['0', undefined], ['top', BREACH_TOP]] as const) {
      const need = survivorsNeeded('logram', 'wall', level, 1, ranks);
      if (need === undefined) {
        cells.push('n/a', '', '');
        sweepMissing += 1;
        continue;
      }
      const send = Math.ceil(need / fDecisive);
      const capital = send * unitValue('logram');
      const ratio = rebuild('wall', level - 1, level).value / capital;
      ratioAt[which].push(ratio);
      cells.push(String(send), n0(capital), ratio.toFixed(2));
    }
    lines.push(`| ${level} -> ${level - 1} | ${cells.join(' | ')} |`);
  }
  const maxRatio0 = Math.max(...ratioAt['0']);
  const maxRatioTop = Math.max(...ratioAt.top);
  lines.push('', `Highest rebuild / capital over the Wall levels: ${maxRatio0.toFixed(2)} at Breach 0, ${maxRatioTop.toFixed(2)} at Breach ${RANK_MAX} (line: 2).`, '');
  const wallTop: number[] = [];
  for (const [b, level, drop] of rowsA.filter(([b]) => b === 'wall')) {
    const need = survivorsNeeded('logram', b, level, drop, BREACH_TOP);
    if (need === undefined) continue;
    wallTop.push(rebuild(b, level - drop, level).value / (Math.ceil(need / fDecisive) * unitValue('logram')));
  }
  check(`Wall levels are not a bargain with Log Rams at Breach ${RANK_MAX} either (rebuild < 2 x attacker capital, the rows of (a))`, wallTop.length > 0 && wallTop.every((r) => r < 2));
  check(`... and at EVERY Wall level 2..${wallMax} one level at a time (Breach 0 and Breach ${RANK_MAX})`, sweepMissing === 0 && maxRatio0 < 2 && maxRatioTop < 2);

  lines.push(`Real battles, Wall 10, 250 Pikemen + 150 Shieldbearers, Raiders for 2 x the defence + the Log Rams that Breach 0 needs for ${cap} Wall levels; same army with Breach 0 and ${RANK_MAX} (${SEEDS.length} seeds):`, '');
  lines.push('| Breach | battles won | Wall levels lowered (avg) | attacker loses (value) |');
  lines.push('|---|---|---|---|');
  {
    const wallDef = village({ wall: 10 }, { pikeman: 250, guard: 150 });
    const rams = Math.ceil((survivorsNeeded('logram', 'wall', 10, cap) ?? 0) / fDecisive);
    const raiders = raidersFor(wallDef, DECISIVE, { logram: rams });
    const units = army({ raider: raiders, logram: rams });
    const dropped: number[] = [];
    for (const [label, ranks] of [['0', undefined], [String(RANK_MAX), BREACH_TOP]] as const) {
      const real = averageFight(wallDef, units, 'wall', 'logram', ranks);
      dropped.push(real.dropped);
      lines.push(`| ${label} | ${(real.won * 100).toFixed(0)}% | ${real.dropped.toFixed(2)} | ${n0(real.lossValue)} |`);
    }
    lines.push('', `(${raiders} Raiders + ${rams} Log Rams.) Breach ${RANK_MAX} lowers ${dropped[1] !== undefined && dropped[0] !== undefined ? (dropped[1] - dropped[0]).toFixed(2) : '?'} more Wall levels than Breach 0 with the same army.`, '');
    check(`Breach ${RANK_MAX} never lowers fewer Wall levels than Breach 0 with the same army`, dropped.length === 2 && (dropped[1] as number) >= (dropped[0] as number));
  }

  // (c) Campaign against a fortified village -----------------------------------------------------------
  lines.push('## (c) Attacks needed against a fortified village, with and without Log Rams', '');
  lines.push(
    `Each wave: the attacker sends Raiders + Log Rams so that attack = ${DECISIVE} x the defence the engine reports (Wall as it stands before the battle, after the during-the-battle hit), wins, the garrison dies. Between waves the defender brings the garrison back to 50% of the original. Log Rams are sized to take ${cap} Wall levels after the battle from the starting level (survivors / ${fDecisive.toFixed(2)}). No siege = the same waves with no Log Rams (the Wall never drops).`,
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
    const cartsNeed = survivorsNeeded('logram', 'wall', sc.wall, cap) ?? 0;
    const carts = Math.ceil(cartsNeed / fDecisive);
    lines.push(`### ${sc.label} (${carts} Log Rams, value ${n0(carts * unitValue('logram'))})`, '');
    lines.push('| wave | siege? | Wall before -> after | defence | Raiders sent | Log Rams sent | army sent (value) | army lost (value) |');
    lines.push('|---|---|---|---|---|---|---|---|');
    const totals: Record<string, { sent: number; lost: number; raiders: number }> = {};
    for (const withSiege of [false, true]) {
      let def = village({ wall: sc.wall }, sc.garrison);
      const key = withSiege ? 'siege' : 'plain';
      totals[key] = { sent: 0, lost: 0, raiders: 0 };
      const t = totals[key] as { sent: number; lost: number; raiders: number };
      for (let wave = 1; wave <= 6; wave++) {
        if (def.buildings.wall === 0 && withSiege) break;
        const useCarts = withSiege && def.buildings.wall > 0 ? carts : 0;
        const raiders = raidersFor(def, DECISIVE, { logram: useCarts });
        const sentUnits = army({ raider: raiders, logram: useCarts });
        const r = fight(def, sentUnits, SEEDS[wave] as number, 'wall');
        const d = defenceOf(def);
        let lost = 0;
        for (const id of Object.keys(UNITS) as UnitId[]) lost += r.attackerLosses[id] * unitValue(id);
        const sent = raiders * unitValue('raider') + useCarts * unitValue('logram');
        const after = applyBattleToDefender(def, r);
        lines.push(`| ${wave} | ${withSiege ? 'yes' : 'no'} | ${def.buildings.wall} -> ${after.buildings.wall} | ${n0(d)} | ${raiders} | ${useCarts} | ${n0(sent)} | ${n0(lost)} |`);
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
    const wallAfter = Math.max(0, sc.wall - cap);
    const wave2Plain = village({ wall: sc.wall }, half(sc.garrison));
    const wave2Siege = village({ wall: wallAfter }, half(sc.garrison));
    const target = defenceOf(wave2Plain);
    let extra = 0;
    while (defenceOf({ ...wave2Siege, troops: { ...wave2Siege.troops, guard: wave2Siege.troops.guard + extra } }) < target && extra < 5000) extra += 1;
    lines.push(
      `Wave 2 needs ${n0(defenceOf(wave2Plain))} attack without siege and ${n0(defenceOf(wave2Siege))} after a siege wave took the Wall to ${wallAfter}: the attacker saves ${n0(((target - defenceOf(wave2Siege)) / UNITS.raider.attack) * DECISIVE)} Raider-equivalents per wave (${n0(((target - defenceOf(wave2Siege)) / UNITS.raider.attack) * DECISIVE * unitValue('raider'))} value). To cancel that the defender adds ${extra} Shieldbearers (${n0(extra * unitValue('guard'))} value) or rebuilds ${cap} Wall levels (${n0(rebuild('wall', wallAfter, sc.wall).value)} value, ${rebuild('wall', wallAfter, sc.wall).hours.toFixed(1)} h). First waves: ${n0(plain.sent)} sent without siege (${plain.raiders} Raiders over the same waves) vs ${n0(siege.sent)} with.`,
      '',
    );
    if (sc.label.startsWith('Wall 10')) fortressSiegeSavings = (target - defenceOf(wave2Siege)) / target;
  }
  lines.push(
    'Reading: against a village with a real garrison the Wall is only a part of the defence, so lowering it a few levels barely changes the attack the next wave needs. The Log Rams cost more than the Raiders they save, and the defender can undo it with a few Shieldbearers or a few cheap Wall levels. Only a village that is mostly Wall gains a lot from siege.',
    '',
  );
  check("against a garrisoned village siege lowers the next wave's defence by under 40%", fortressSiegeSavings !== undefined && fortressSiegeSavings < 0.4);

  // (d) Siege must not make defending pointless -----------------------------------------------------
  lines.push('## (d) Does siege make defending pointless?', '');
  lines.push('### (d1) The same attack at different strengths: a hold still costs the attacker, a lost attack lowers little', '');
  const fort = village({ wall: 10, market: 5, bannerhall: 3 }, { pikeman: 250, guard: 150 });
  const fortRams = 25;
  const fortCarts = 25;
  const maxAll = 2 * cap + capCart;
  lines.push(`Attacker: ${fortRams} Log Rams + ${fortCarts} Firecarts (picking the Banner Hall) + enough Raiders for the ratio. Defender: Wall 10, Banner Hall 3, Market 5, 250 Pikemen + 150 Shieldbearers. ${SEEDS.length} seeds per row (luck +-10%).`, '');
  lines.push('| attack / defence | battles won | buildings lowered when LOST | levels lowered when WON (avg) | attacker loses (value) | defender troops lost (avg) |');
  lines.push('|---|---|---|---|---|---|');
  let lostBattleChanged = 0;
  let lostBattles = 0;
  for (const ratio of [0.6, 0.9, 1.0, 1.1, 1.25, 1.5, 2, 3]) {
    const raiders = raidersFor(fort, ratio, { logram: fortRams, firecart: fortCarts });
    const units = army({ raider: raiders, logram: fortRams, firecart: fortCarts });
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
        // The during-the-battle Wall hit and a share of the siege units still count on a loss, but the total can never pass what the steps may lower.
        if (changed > 0) changedWhenLost += 1;
        if (changed > maxAll) lostBattleChanged += 1;
      }
      for (const id of Object.keys(UNITS) as UnitId[]) {
        lossValue += r.attackerLosses[id] * unitValue(id);
        defLost += r.defenderLosses[id];
      }
    }
    const nLost = SEEDS.length - won;
    lines.push(`| ${ratio.toFixed(2)} | ${won} / ${SEEDS.length} | ${nLost === 0 ? '-' : `${changedWhenLost} of ${nLost}`} | ${won === 0 ? '-' : (wonLevels / won).toFixed(1)} | ${n0(lossValue / SEEDS.length)} | ${n0(defLost / SEEDS.length)} |`);
  }
  lines.push('', 'A defence that holds can still lose a Wall level or two: the Log Rams fire half their points during the battle, and a share of the siege units counts as survivors on a loss. The attacker lost the whole army for it. A clear win lowers the most.', '');
  check('a lost battle never lowers more than the two steps may lower in one attack', lostBattles > 0 && lostBattleChanged === 0);

  lines.push('### (d2) The army needed to win AND take one Wall level, by how well the village is defended', '');
  lines.push(`Each row: Log Rams sized so one Wall level survives a decisive win (attack ${DECISIVE} x defence), Raiders sized for the ratio. Defence = the engine's number for the village as it stands.`, '');
  lines.push('| village | defence | Raiders | Log Rams | army pop | army value | x the empty-village army |');
  lines.push('|---|---|---|---|---|---|---|');
  const targets: Array<[string, VillageState]> = [
    ['Wall 10, no garrison', village({ wall: 10 })],
    ['Wall 10, 100 Pikemen + 60 Shieldbearers', village({ wall: 10 }, { pikeman: 100, guard: 60 })],
    ['Wall 10, 250 Pikemen + 150 Shieldbearers', village({ wall: 10 }, { pikeman: 250, guard: 150 })],
    ['Wall 15, 500 Pikemen + 300 Shieldbearers', village({ wall: 15 }, { pikeman: 500, guard: 300 })],
  ];
  const needCarts = Math.ceil((survivorsNeeded('logram', 'wall', 10, 1) ?? 0) / fDecisive);
  let baseValue = 0;
  const armyValues: number[] = [];
  for (const [label, v] of targets) {
    const carts = Math.ceil((survivorsNeeded('logram', 'wall', v.buildings.wall, 1) ?? needCarts) / fDecisive);
    const raiders = raidersFor(v, DECISIVE, { logram: carts });
    const val = raiders * unitValue('raider') + carts * unitValue('logram');
    if (baseValue === 0) baseValue = val;
    armyValues.push(val);
    lines.push(`| ${label} | ${n0(defenceOf(v))} | ${raiders} | ${carts} | ${raiders + carts * POP_PER_UNIT.logram} | ${n0(val)} | ${(val / baseValue).toFixed(1)}x |`);
  }
  lines.push('', 'The garrison, not the Wall, decides how big the attack must be; siege adds a fixed Log Ram block on top and does nothing to shrink the garrison part.', '');
  check('a real garrison + Wall needs a much bigger army even with siege (at least 5x the empty village)', armyValues.length === 4 && (armyValues[2] as number) >= 5 * (armyValues[0] as number));

  lines.push('### (d3) The siege army is slow: warning time for the defender (20 tiles, speed 1, terrain from the world seed)', '');
  const to = { x: home.x + 20, y: home.y };
  lines.push('| army | slowest unit | flat ground | with terrain |');
  lines.push('|---|---|---|---|');
  const trips: Array<[string, Units, UnitId]> = [
    ['Raiders only', army({ raider: 100 }), 'raider'],
    ['Elk-class riders (Elk Riders only)', army({ outrider: 100 }), 'outrider'],
    ['Pathfinder (scout)', army({ pathfinder: 5 }), 'pathfinder'],
    ['Raiders + 20 Log Rams', army({ raider: 100, logram: 20 }), 'logram'],
    ['Log Rams only', army({ logram: 20 }), 'logram'],
    ['Raiders + 20 Firecarts', army({ raider: 100, firecart: 20 }), 'firecart'],
  ];
  const times: Record<string, number> = {};
  for (const [label, units, slow] of trips) {
    const p = travelPreview(home, to, units, world);
    times[label] = p.ms;
    lines.push(`| ${label} | ${UNITS[slow].name} (speed ${UNITS[slow].speed}) | ${fmtH(p.flatMs)} | ${fmtH(p.ms)} |`);
  }
  const yard = village({ barracks: 8, wrightyard: 1 });
  const yard4 = village({ barracks: 8, wrightyard: 4 });
  lines.push(
    '',
    `Training: one Log Ram takes ${fmtH(trainTimeMs('logram', yard, world))} in a Wrightyard level 1, so 20 are ${fmtH(20 * trainTimeMs('logram', yard, world))} of queue (research ${fmtH(ram.research ? ram.research.timeSec * 1000 : 0)} at Drillyard ${ram.research?.drillyard}); one Firecart takes ${fmtH(trainTimeMs('firecart', yard4, world))} in a Wrightyard level 4 (research ${fmtH(cart.research ? cart.research.timeSec * 1000 : 0)} at Drillyard ${cart.research?.drillyard}). The defender sees the army on the map for the whole trip and can reinforce, recall support or strike the slow column first.`,
    '',
  );
  check('a siege column is at least 1.8x slower than Raiders over 20 tiles', (times['Raiders + 20 Log Rams'] as number) >= 1.8 * (times['Raiders only'] as number));
  return { lines, checks };
}

export function formatSiegeExperiments(x: SiegeExperiments): string {
  const failed = x.checks.filter((c) => !c.ok);
  return [...x.lines, '## Invariants', '', ...x.checks.map((c) => `- ${c.ok ? 'OK' : 'FAILED'}: ${c.name}`), '', failed.length === 0 ? 'All invariants hold.' : `${failed.length} invariant(s) FAILED.`, ''].join('\n');
}
