// Support reach (GAME_DESIGN 18.2 "Conquest changes 2026-11-05"): can typical tribe support arrive inside the hold?
//
//   npm run sim -- --reach [--out file]
//
// Real engine only (travelTimeMs on the real terrain of the default world, speed 1): for distances of 10..90 tiles in eight directions from
// a home tile, how long do the usual support columns take, and is that inside HOLD_HOURS (player villages) and HOLD_HOURS_ABANDONED? Also the
// Chieftain chain: Chieftains walk at 5 tiles/h, so two attacks sent from two villages arrive inside STRIKE_CHAIN_WINDOW_HOURS of each other when
// their distances differ by less than 2 h x 5 tiles/h = 10 tiles (flat ground).

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_WORLD,
  HOLD_FAIL_HOURS,
  HOLD_HOURS,
  HOLD_HOURS_ABANDONED,
  STRIKE_CHAIN_WINDOW_HOURS,
  UNITS,
  emptyUnits,
  flatTravelTimeMs,
  travelTimeMs,
} from '../../packages/engine/src/index.ts';
import type { UnitId, Units, WorldSettings } from '../../packages/engine/src/index.ts';

const HOUR = 3_600_000;
const DIRS: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DISTANCES = [10, 20, 30, 40, 50, 60, 80, 100];
const COLUMNS: Array<{ name: string; units: UnitId[] }> = [
  { name: 'Outriders (cavalry)', units: ['outrider'] },
  { name: 'Pikemen', units: ['pikeman'] },
  { name: 'Guards (slowest fighter)', units: ['guard'] },
  { name: 'Mixed: Pikemen + Guards + Knights', units: ['pikeman', 'guard', 'knight'] },
  { name: 'Chieftain with escort', units: ['guard', 'chieftain'] },
];

function army(ids: UnitId[]): Units {
  const u = emptyUnits();
  for (const id of ids) u[id] = 10;
  return u;
}

export function reachReport(): string {
  const s: WorldSettings = { ...DEFAULT_WORLD, speed: 1 };
  const home = { x: 0, y: 0 };
  const out: string[] = [];
  out.push('# Support reach against the hold (speed 1, real terrain of the default world)', '');
  out.push(`Hold: **${HOLD_HOURS} h** player villages, **${HOLD_HOURS_ABANDONED} h** abandoned; a claim fails after ${HOLD_FAIL_HOURS} h under the minimum; Chieftain chain window ${STRIKE_CHAIN_WINDOW_HOURS} h.`, '');
  out.push('Hours for a column to walk the distance (average of eight directions from (0,0), terrain included; flat = no terrain). `ok` = the worst direction is still inside the player hold.', '');
  out.push(`| column (speed tiles/h) | ${DISTANCES.map((d) => `${d} tiles`).join(' | ')} |`);
  out.push(`|---|${DISTANCES.map(() => '---').join('|')}|`);
  const speedOf = (ids: UnitId[]): number => Math.min(...ids.map((id) => UNITS[id].speed));
  const lines: Record<string, number> = {};
  for (const col of COLUMNS) {
    const u = army(col.units);
    const cells: string[] = [];
    for (const d of DISTANCES) {
      let sum = 0;
      let worst = 0;
      for (const [dx, dy] of DIRS) {
        const len = Math.hypot(dx, dy);
        const to = { x: Math.round((dx / len) * d), y: Math.round((dy / len) * d) };
        const h = travelTimeMs(home, to, u, s) / HOUR;
        sum += h;
        worst = Math.max(worst, h);
      }
      const flat = flatTravelTimeMs(home, { x: d, y: 0 }, u, s) / HOUR;
      cells.push(`${(sum / DIRS.length).toFixed(1)} h (flat ${flat.toFixed(1)}, worst ${worst.toFixed(1)})${worst <= HOLD_HOURS ? ' ok' : worst <= HOLD_HOURS * 1.5 ? ' late' : ' no'}`);
      if (worst <= HOLD_HOURS) lines[col.name] = d;
    }
    out.push(`| ${col.name} (${speedOf(col.units)}) | ${cells.join(' | ')} |`);
  }
  out.push('');
  out.push('Farthest tested distance (tiles) whose worst direction is still inside the player hold:');
  for (const col of COLUMNS) out.push(`- ${col.name}: ${lines[col.name] ?? 'none'}`);
  out.push('');
  const chief = UNITS.chieftain.speed;
  out.push(`Chieftain chain: Chieftains walk ${chief} tiles/h, so two attacks sent at the same moment from two of the attacker's villages arrive inside the ${STRIKE_CHAIN_WINDOW_HOURS} h window when their distances to the target differ by at most ${STRIKE_CHAIN_WINDOW_HOURS * chief} tiles (flat ground); sent at different moments, the later one only has to arrive within ${STRIKE_CHAIN_WINDOW_HOURS} h of the earlier one's arrival and while that Chieftain is still walking home.`);
  return out.join('\n');
}

export function main(): void {
  const args = process.argv.slice(2);
  const text = reachReport();
  const at = args.indexOf('--out');
  if (at >= 0 && args[at + 1]) writeFileSync(args[at + 1] as string, `${text}\n`);
  else console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
