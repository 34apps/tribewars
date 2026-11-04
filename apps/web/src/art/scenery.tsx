// Village scene scenery in style B (Painted Miniature, like the building sprites): the ground plate with its roads,
// paths and paved town square, the campfire, trees and rocks, and the ring wall drawn by its stage. Everything is laid
// out on the isometric grid from ./buildings.ts (iso(u, v, z)); buildings themselves are sprites from there.
// Thin dark-brown outlines, 4–5 painted tones per material, lit from the top left (left faces light, right faces dark).

import { memo } from 'react';
import type { ReactNode } from 'react';
import type { BuildingId } from '@clanfire/engine';
import { PLACEMENT, WALL_RING, iso } from './buildings.ts';
import type { Stage } from './buildings.ts';

export interface DepthItem {
  key: string;
  depth: number;
  node: ReactNode;
}

const INK = '#3B2619';
const { cx: CX, cy: CY, r: R, plate: RP, gateHalf: GATE } = WALL_RING;
/** Depth of the campfire in the town square for the painter's sort. */
export const SQUARE_DEPTH = CY;

/** Half-side of the paved square, the ring path around it, and the half width of the four roads (grid units). */
const SQUARE = 62;
const RING_IN = 80;
const RING_OUT = 92;
const ROAD = 12;

type P3 = readonly [number, number, number];
const f = (n: number) => Math.round(n * 10) / 10;
const pt = (u: number, v: number, z = 0) => {
  const [x, y] = iso(u, v, z);
  return `${f(x)} ${f(y)}`;
};
const poly = (pts: readonly P3[]) => `M${pts.map(([u, v, z]) => pt(u, v, z)).join('L')}Z`;
/** Ground square |u - cu|, |v - cv| <= h as a path. */
const groundSquare = (cu: number, cv: number, hu: number, hv = hu) =>
  poly([
    [cu - hu, cv - hv, 0],
    [cu + hu, cv - hv, 0],
    [cu + hu, cv + hv, 0],
    [cu - hu, cv + hv, 0],
  ]);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Plots (from PLACEMENT, in grid units) ---------------------------------------------------------------------

interface Plot {
  u: number;
  v: number;
  /** Half-side of the plot's pad plus a margin. */
  half: number;
  x: number;
  y: number;
  hw: number;
}

const PLOTS: Plot[] = (Object.keys(PLACEMENT) as BuildingId[])
  .filter((id) => id !== 'wall')
  .map((id) => {
    const p = PLACEMENT[id];
    const ty = p.y + 26 * p.scale;
    const dx = p.x - CX;
    const s = 2 * (ty - CY);
    return { u: (dx + s) / 2, v: (s - dx) / 2, half: 31 * p.scale, x: p.x, y: ty, hw: 56 * p.scale };
  });

const onRoad = (u: number, v: number, pad: number) =>
  (Math.abs(u) < ROAD + pad && Math.abs(v) > SQUARE - pad) || (Math.abs(v) < ROAD + pad && Math.abs(u) > SQUARE - pad);

/** Free ground for a prop of radius `rad` at (u, v): off the plots, roads, paths and square, and not hiding a plot. */
function clear(u: number, v: number, rad: number, tall: boolean): boolean {
  if (Math.max(Math.abs(u), Math.abs(v)) < RING_OUT + rad) return false;
  if (onRoad(u, v, rad)) return false;
  const [x, y] = iso(u, v);
  for (const p of PLOTS) {
    if (Math.abs(u - p.u) < p.half + rad && Math.abs(v - p.v) < p.half + rad) return false;
    // A tall tree just in front of a plot would hide the building.
    if (tall && Math.abs(x - p.x) < p.hw * 0.85 && y > p.y && y < p.y + p.hw * 0.5 + 46) return false;
  }
  return true;
}

// ---- Prop symbols (pines, oak, bush, boulders, stump, logs) ---------------------------------------------------

function tier(w: number, yb: number, ya: number, c: { mid: string; dark: string; light: string; hi: string }) {
  const J = 8;
  const jag: [number, number][] = [];
  for (let k = 0; k <= J; k++) jag.push([w - (k * 2 * w) / J, yb + (k % 2 ? -1.4 : k === 0 || k === J ? 0 : 0.9)]);
  const d = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
  const all: [number, number][] = [[0, ya], ...jag];
  const half = jag.filter((p) => p[0] >= -0.3);
  const left = jag.filter((p) => p[0] <= -0.4 * w);
  return (
    <g key={ya}>
      <path d={d(all)} fill={c.mid} />
      <path d={d([[0.3, ya + 1], ...half, [0.6, (ya + yb) / 2]])} fill={c.dark} />
      <path d={d([[0, ya], ...left, [-0.25 * w, ya + (yb - ya) * 0.55]])} fill={c.light} />
      <path
        d={`M${f(-0.1 * w)} ${f(ya + 2)}L${f(-0.55 * w)} ${f(yb - 1.6)}M${f(-0.05 * w)} ${f(ya + (yb - ya) * 0.5)}L${f(-0.3 * w)} ${f(yb - 0.8)}`}
        stroke={c.hi}
        strokeWidth={0.7}
        fill="none"
      />
      <path d={d(all)} fill="none" stroke={INK} strokeWidth={0.8} />
    </g>
  );
}

function pine(tiers: [number, number, number][], c: { mid: string; dark: string; light: string; hi: string }) {
  return (
    <>
      <ellipse cx={4} cy={0.6} rx={9} ry={3.4} fill="#1E110A" opacity={0.22} />
      <path d="M-1.4 .6L1.4 .6L1.1 -9L-1.1 -9Z" fill="#6E4628" stroke={INK} strokeWidth={0.7} />
      <path d="M.2 .5L1.3 .5L1 -8.6L.2 -8.6Z" fill="#4A2E1B" />
      {tiers.map(([w, yb, ya]) => tier(w, yb, ya, c))}
    </>
  );
}

const OAK_BLOBS: [number, number, number, string][] = [
  [4.5, -15, 6, '#3F6A31'],
  [-4.5, -15.5, 5.8, '#4A7838'],
  [0, -21, 7, '#4A7838'],
  [5, -22, 5, '#3F6A31'],
  [-5, -22, 4.6, '#5A8A41'],
  [-1.5, -26.5, 4.6, '#6A9A49'],
  [-3.6, -18, 3.4, '#7FAE55'],
  [-1.5, -24, 2.6, '#8DBA5E'],
];
const BUSH_BLOBS: [number, number, number, string][] = [
  [3.2, -3, 3.6, '#3F6A31'],
  [-3, -3.2, 3.5, '#4A7838'],
  [0, -5.6, 3.8, '#5A8A41'],
  [-1.4, -6.6, 1.8, '#7FAE55'],
];

// Boulders rendered from the same generator as the building sprites (faceted, lit top-left, mossy).
// Constant markup from this file only (never player input).
const ROCKS: Record<'rockA' | 'rockB' | 'rockC', string> = {
  rockA:
    '<g transform="translate(0 -26)"><ellipse cx="3" cy="27.5" rx="10.5" ry="4.5" fill="#1E110A" opacity=".2"/><path d="M9.3 18.3L8.9 26.4L8.9 23.5Z" fill="#554A43" stroke="#554A43" stroke-width="0.3"/><path d="M9.3 18.3L8.9 23.5L6.5 18.1Z" fill="#665D57" stroke="#665D57" stroke-width="0.3"/><path d="M2.9 15.5L9.3 18.3L6.5 18.1Z" fill="#6F6760" stroke="#6F6760" stroke-width="0.3"/><path d="M8.9 26.4L8.4 30L8.9 23.5Z" fill="#574C45" stroke="#574C45" stroke-width="0.3"/><path d="M8.9 23.5L8.4 30L3.5 25.3Z" fill="#7C756F" stroke="#7C756F" stroke-width="0.3"/><path d="M8.9 23.5L3.5 25.3L4.7 21.1Z" fill="#756E67" stroke="#756E67" stroke-width="0.3"/><path d="M6.5 18.1L8.9 23.5L4.7 21.1Z" fill="#716A63" stroke="#716A63" stroke-width="0.3"/><path d="M8.4 30L-1.1 31.5L3.5 25.3Z" fill="#817B74" stroke="#817B74" stroke-width="0.3"/><path d="M3.5 25.3L-1.1 31.5L-4 26Z" fill="#958F88" stroke="#958F88" stroke-width="0.3"/><path d="M3.5 25.3L-4 26L-0.7 21.4Z" fill="#98938A" stroke="#98938A" stroke-width="0.3"/><path d="M4.7 21.1L3.5 25.3L-0.7 21.4Z" fill="#979189" stroke="#979189" stroke-width="0.3"/><path d="M-1.1 31.5L-8.4 29.1L-4 26Z" fill="#88827C" stroke="#88827C" stroke-width="0.3"/><path d="M-4 26L-8.4 29.1L-10.2 22.9Z" fill="#8B8680" stroke="#8B8680" stroke-width="0.3"/><path d="M-4 26L-10.2 22.9L-4.4 20.2Z" fill="#ABA498" stroke="#ABA498" stroke-width="0.3"/><path d="M-0.7 21.4L-4 26L-4.4 20.2Z" fill="#A9A297" stroke="#A9A297" stroke-width="0.3"/><path d="M-8.4 29.1L-10.1 25.6L-10.2 22.9Z" fill="#6E665F" stroke="#6E665F" stroke-width="0.3"/><path d="M-4.4 20.2L-10.2 22.9L-5.8 17.4Z" fill="#A49D93" stroke="#A49D93" stroke-width="0.3"/><path d="M-5.8 17.4L-1.8 15.7L2.9 15.5L6.5 18.1L4.7 21.1L-0.7 21.4L-4.4 20.2Z" fill="#9F998F" stroke="#9F998F" stroke-width="0.3"/><path d="M-5.8 17.4L-1.8 15.7L2.9 15.5L6.5 18.1L4.7 21.1L-0.7 21.4L-4.4 20.2Z" fill="none" stroke="#B2AB9D" stroke-width="0.6"/><path d="M6 29.2L3 29.5L6 29.9" fill="none" stroke="#574D45" stroke-width="0.5" stroke-linecap="round"/><path d="M-7.1 24.6L-6.8 27.6L-6.8 26.4" fill="none" stroke="#5D534C" stroke-width="0.5" stroke-linecap="round"/><path d="M7.6 25L8.8 25.2L8.1 25" fill="none" stroke="#544942" stroke-width="0.5" stroke-linecap="round"/><path d="M4.8 16.3L5.1 17.1" fill="none" stroke="#898075" stroke-width="0.5" stroke-linecap="round"/><path d="M4.4 22.4L1.5 21.3" fill="none" stroke="#AAA297" stroke-width="0.5" stroke-linecap="round"/><ellipse cx="0.3" cy="19.8" rx="1.8" ry="0.6" fill="#6F8240" opacity="0.8"/><ellipse cx="1.9" cy="18.9" rx="2" ry="0.6" fill="#6F8240" opacity="0.8"/><path d="M-10.2 22.9L-5.8 17.4L-1.8 15.7L2.9 15.5L9.3 18.3L8.9 26.4L8.4 30L-1.1 31.5L-8.4 29.1L-10.1 25.6Z" fill="none" stroke="#3B2619" stroke-width="0.9"/></g>',
  rockB:
    '<g transform="translate(0 -26)"><ellipse cx="3" cy="27.5" rx="7.5" ry="3.2" fill="#1E110A" opacity=".2"/><path d="M7 23.6L6.6 28.2L3.9 26.7Z" fill="#70665E" stroke="#70665E" stroke-width="0.3"/><path d="M7 23.6L3.9 26.7L3.2 22.8Z" fill="#89827A" stroke="#89827A" stroke-width="0.3"/><path d="M4.1 20.7L7 23.6L3.2 22.8Z" fill="#918B83" stroke="#918B83" stroke-width="0.3"/><path d="M6.6 28.2L0.3 30.3L3.9 26.7Z" fill="#635951" stroke="#635951" stroke-width="0.3"/><path d="M3.9 26.7L0.3 30.3L-3.1 25.7Z" fill="#A9A195" stroke="#A9A195" stroke-width="0.3"/><path d="M3.9 26.7L-3.1 25.7L0 23Z" fill="#B2AA9C" stroke="#B2AA9C" stroke-width="0.3"/><path d="M3.2 22.8L3.9 26.7L0 23Z" fill="#99938A" stroke="#99938A" stroke-width="0.3"/><path d="M0.3 30.3L-6.9 28L-3.1 25.7Z" fill="#908A82" stroke="#908A82" stroke-width="0.3"/><path d="M-3.1 25.7L-6.9 28L-7.8 22.9Z" fill="#9D968D" stroke="#9D968D" stroke-width="0.3"/><path d="M-3.1 25.7L-7.8 22.9L-3.6 22.6Z" fill="#9F998F" stroke="#9F998F" stroke-width="0.3"/><path d="M0 23L-3.1 25.7L-3.6 22.6Z" fill="#BAB2A3" stroke="#BAB2A3" stroke-width="0.3"/><path d="M-3.6 22.6L-7.8 22.9L-4.6 20.5Z" fill="#A39C91" stroke="#A39C91" stroke-width="0.3"/><path d="M-4.6 20.5L-0.3 19.1L4.1 20.7L3.2 22.8L0 23L-3.6 22.6Z" fill="#A8A195" stroke="#A8A195" stroke-width="0.3"/><path d="M-4.6 20.5L-0.3 19.1L4.1 20.7L3.2 22.8L0 23L-3.6 22.6Z" fill="none" stroke="#B9B1A2" stroke-width="0.6"/><path d="M5.6 28.1L2.5 29.1" fill="none" stroke="#473A32" stroke-width="0.5" stroke-linecap="round"/><path d="M6.5 26.4L6.8 24.9" fill="none" stroke="#4E4139" stroke-width="0.5" stroke-linecap="round"/><path d="M5.4 24.8L4.4 25.6L5.1 24.9" fill="none" stroke="#5C5149" stroke-width="0.5" stroke-linecap="round"/><path d="M3.4 24L1.3 22.9" fill="none" stroke="#ABA498" stroke-width="0.5" stroke-linecap="round"/><ellipse cx="0.1" cy="22.6" rx="1.1" ry="0.9" fill="#6F8240" opacity="0.8"/><path d="M-7.8 22.9L-4.6 20.5L-0.3 19.1L4.1 20.7L7 23.6L6.6 28.2L0.3 30.3L-6.9 28Z" fill="none" stroke="#3B2619" stroke-width="0.9"/></g>',
  rockC:
    '<g transform="translate(0 -26)"><ellipse cx="3" cy="27.5" rx="9.8" ry="4.2" fill="#1E110A" opacity=".2"/><path d="M5.6 22.6L3.9 25.9L4.8 20.6Z" fill="#5E534B" stroke="#5E534B" stroke-width="0.3"/><path d="M4.8 20.6L3.9 25.9L1.9 22.1Z" fill="#695F56" stroke="#695F56" stroke-width="0.3"/><path d="M4.8 20.6L1.9 22.1L2 17.6Z" fill="#7D746C" stroke="#7D746C" stroke-width="0.3"/><path d="M4.5 16.5L4.8 20.6L2 17.6Z" fill="#7D756C" stroke="#7D756C" stroke-width="0.3"/><path d="M3.9 25.9L-1.1 26.6L1.9 22.1Z" fill="#766D65" stroke="#766D65" stroke-width="0.3"/><path d="M1.9 22.1L-1.1 26.6L-4.9 20.9Z" fill="#A19B90" stroke="#A19B90" stroke-width="0.3"/><path d="M1.9 22.1L-4.9 20.9L-1.4 18.2Z" fill="#ADA699" stroke="#ADA699" stroke-width="0.3"/><path d="M2 17.6L1.9 22.1L-1.4 18.2Z" fill="#ACA598" stroke="#ACA598" stroke-width="0.3"/><path d="M-1.1 26.6L-6.9 24.7L-4.9 20.9Z" fill="#8F887F" stroke="#8F887F" stroke-width="0.3"/><path d="M-4.9 20.9L-6.9 24.7L-6.4 19.2Z" fill="#999289" stroke="#999289" stroke-width="0.3"/><path d="M-4.9 20.9L-6.4 19.2L-4.5 17Z" fill="#9B958C" stroke="#9B958C" stroke-width="0.3"/><path d="M-1.4 18.2L-4.9 20.9L-4.5 17Z" fill="#AFA89B" stroke="#AFA89B" stroke-width="0.3"/><path d="M-4.5 17L-6.4 19.2L-2.8 14.8Z" fill="#847D74" stroke="#847D74" stroke-width="0.3"/><path d="M0.9 14.5L4.5 16.5L2 17.6L-1.4 18.2L-4.5 17L-2.8 14.8Z" fill="#AAA397" stroke="#AAA397" stroke-width="0.3"/><path d="M0.9 14.5L4.5 16.5L2 17.6L-1.4 18.2L-4.5 17L-2.8 14.8Z" fill="none" stroke="#BBB3A4" stroke-width="0.6"/><path d="M5.4 22.4L5 22.8" fill="none" stroke="#44372F" stroke-width="0.5" stroke-linecap="round"/><path d="M1.6 19.6L0.9 19.7" fill="none" stroke="#6F6459" stroke-width="0.5" stroke-linecap="round"/><path d="M-4.8 18.7L-4.8 19.5L-5.6 20.1" fill="none" stroke="#655B52" stroke-width="0.5" stroke-linecap="round"/><path d="M-2.5 19L-3.3 17.5" fill="none" stroke="#BDB5A6" stroke-width="0.5" stroke-linecap="round"/><ellipse cx="1.1" cy="16.9" rx="1.3" ry="0.6" fill="#6F8240" opacity="0.8"/><ellipse cx="0.8" cy="16.9" rx="2.1" ry="0.5" fill="#6F8240" opacity="0.8"/><path d="M-6.9 24.7L-6.4 19.2L-2.8 14.8L0.9 14.5L4.5 16.5L5.6 22.6L3.9 25.9L-1.1 26.6Z" fill="none" stroke="#3B2619" stroke-width="0.9"/><path d="M9.7 29.2L5.8 31.7L7.1 26Z" fill="#6F6760" stroke="#6F6760" stroke-width="0.3"/><path d="M7.1 26L5.8 31.7L1.3 28.6Z" fill="#88827C" stroke="#88827C" stroke-width="0.3"/><path d="M7.1 26L1.3 28.6L2.8 24.3Z" fill="#8F8A83" stroke="#8F8A83" stroke-width="0.3"/><path d="M4.6 22.7L7.1 26L2.8 24.3Z" fill="#8E8983" stroke="#8E8983" stroke-width="0.3"/><path d="M5.8 31.7L-4.1 32.3L1.3 28.6Z" fill="#87817B" stroke="#87817B" stroke-width="0.3"/><path d="M1.3 28.6L-4.1 32.3L-7.6 28.2Z" fill="#A49D93" stroke="#A49D93" stroke-width="0.3"/><path d="M1.3 28.6L-7.6 28.2L-1.1 25Z" fill="#A39D92" stroke="#A39D92" stroke-width="0.3"/><path d="M2.8 24.3L1.3 28.6L-1.1 25Z" fill="#ABA498" stroke="#ABA498" stroke-width="0.3"/><path d="M-4.1 32.3L-8.2 29.1L-7.6 28.2Z" fill="#685F58" stroke="#685F58" stroke-width="0.3"/><path d="M-7.6 28.2L-8.2 29.1L-9.2 23.1Z" fill="#706862" stroke="#706862" stroke-width="0.3"/><path d="M-7.6 28.2L-9.2 23.1L-5.8 23Z" fill="#9B958C" stroke="#9B958C" stroke-width="0.3"/><path d="M-1.1 25L-7.6 28.2L-5.8 23Z" fill="#B4AC9E" stroke="#B4AC9E" stroke-width="0.3"/><path d="M-5.8 23L-9.2 23.1L-4.3 20.4Z" fill="#948E87" stroke="#948E87" stroke-width="0.3"/><path d="M9.8 23.1L9.7 29.2L7.1 26Z" fill="#685F59" stroke="#685F59" stroke-width="0.3"/><path d="M9.8 23.1L7.1 26L4.6 22.7Z" fill="#87817B" stroke="#87817B" stroke-width="0.3"/><path d="M4.3 19.8L9.8 23.1L4.6 22.7Z" fill="#847E78" stroke="#847E78" stroke-width="0.3"/><path d="M4.6 22.7L2.8 24.3L-1.1 25L-5.8 23L-4.3 20.4L-0.3 18.7L4.3 19.8Z" fill="#9B958C" stroke="#9B958C" stroke-width="0.3"/><path d="M4.6 22.7L2.8 24.3L-1.1 25L-5.8 23L-4.3 20.4L-0.3 18.7L4.3 19.8Z" fill="none" stroke="#AFA89B" stroke-width="0.6"/><path d="M-6.8 30L-6.4 30L-5.7 30.5" fill="none" stroke="#493D36" stroke-width="0.5" stroke-linecap="round"/><path d="M2.8 30.1L1.6 30.8" fill="none" stroke="#5A5049" stroke-width="0.5" stroke-linecap="round"/><path d="M6.5 27.5L3.2 28.5L5.5 28.4" fill="none" stroke="#5B514A" stroke-width="0.5" stroke-linecap="round"/><path d="M-3.1 26L-3.9 23.8" fill="none" stroke="#C2B9A8" stroke-width="0.5" stroke-linecap="round"/><path d="M-6.8 23L-4.9 21.4" fill="none" stroke="#A7A095" stroke-width="0.5" stroke-linecap="round"/><path d="M9 24L6.7 22.9" fill="none" stroke="#9D958B" stroke-width="0.5" stroke-linecap="round"/><path d="M6 20.8L4.5 21.5" fill="none" stroke="#9A9389" stroke-width="0.5" stroke-linecap="round"/><path d="M-9.2 23.1L-4.3 20.4L-0.3 18.7L4.3 19.8L9.8 23.1L9.7 29.2L5.8 31.7L-4.1 32.3L-8.2 29.1Z" fill="none" stroke="#3B2619" stroke-width="0.9"/></g>',
};

/** Symbols referenced by <use href="#vt-…">, plus the scene's patterns; render once inside the scene's <defs>. */
export function SceneryDefs() {
  const pave = ['#C4B497', '#B3A285', '#BDB096', '#A89B82'];
  return (
    <>
      <g id="vt-pineA">
        {pine(
          [
            [9, -5, -18],
            [7.4, -11, -24],
            [5.6, -17, -29.5],
            [3.6, -23, -34.5],
          ],
          { mid: '#4B7A38', dark: '#2F5527', light: '#6E9A47', hi: '#A2C466' },
        )}
      </g>
      <g id="vt-pineB">
        {pine(
          [
            [10, -4.5, -15.5],
            [8, -10, -21],
            [5.6, -15.5, -26.5],
          ],
          { mid: '#557F39', dark: '#36592A', light: '#7AA34C', hi: '#B0CF70' },
        )}
      </g>
      <g id="vt-oak">
        <ellipse cx={4} cy={0.6} rx={10} ry={3.8} fill="#1E110A" opacity={0.22} />
        <path d="M-1.8 .6L1.8 .6L1.3 -10L3.4 -14L1.4 -13L.2 -16L-.9 -13.5L-3.2 -14.6L-1.2 -10Z" fill="#7A5232" stroke={INK} strokeWidth={0.7} />
        <path d="M.3 .5L1.8 .5L1.3 -10L.4 -12Z" fill="#553722" />
        {OAK_BLOBS.map(([x, y, r, c]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} fill={c} stroke={INK} strokeWidth={0.75} />
        ))}
        <path d="M-5 -19.5c1-2 3-2.5 4-2M-3.5 -26c.8-1.4 2-1.8 3-1.6" stroke="#B5D67A" strokeWidth={0.7} fill="none" />
      </g>
      <g id="vt-bush">
        <ellipse cx={2} cy={0.4} rx={7} ry={2.6} fill="#1E110A" opacity={0.2} />
        {BUSH_BLOBS.map(([x, y, r, c]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r={r} fill={c} stroke={INK} strokeWidth={0.7} />
        ))}
        <path d="M-3.6 -6.4c.7-1.2 1.8-1.5 2.6-1.3" stroke="#B5D67A" strokeWidth={0.6} fill="none" />
        <circle cx={2.4} cy={-4.4} r={0.7} fill="#C2553A" />
        <circle cx={-2.2} cy={-2.6} r={0.6} fill="#F3E9C8" />
      </g>
      {(Object.keys(ROCKS) as (keyof typeof ROCKS)[]).map((k) => (
        <g key={k} id={`vt-${k}`} dangerouslySetInnerHTML={{ __html: ROCKS[k] }} />
      ))}
      <g id="vt-stump">
        <ellipse cx={2.5} cy={1} rx={6} ry={2.4} fill="#1E110A" opacity={0.2} />
        <path d="M-3.6 -4V0A3.6 1.7 0 0 0 3.6 0V-4Z" fill="#7A5232" stroke={INK} strokeWidth={0.6} />
        <path d="M.8 -4V1.6A3.6 1.7 0 0 0 3.6 0V-4Z" fill="#583720" />
        <ellipse cx={0} cy={-4} rx={3.6} ry={1.7} fill="#D9B47E" stroke={INK} strokeWidth={0.6} />
        <ellipse cx={0} cy={-4} rx={1.6} ry={0.7} fill="none" stroke="#A07146" strokeWidth={0.4} />
      </g>
      <g id="vt-logs">
        <ellipse cx={1} cy={2.6} rx={13} ry={3.6} fill="#1E110A" opacity={0.2} />
        {[
          [-6, 0],
          [2, 0],
          [-2, -3.6],
        ].map(([x, y]) => (
          <g key={`${x},${y}`} transform={`translate(${x} ${y})`} stroke={INK} strokeWidth={0.6}>
            <path d="M-6 -1.8H5V1.8H-6Z" fill="#7A5232" />
            <path d="M-6 .4H5V1.8H-6Z" fill="#583720" stroke="none" />
            <ellipse cx={5} cy={0} rx={1.3} ry={1.8} fill="#D9B47E" />
          </g>
        ))}
      </g>
      {/* Stone courses on wall faces: left faces run down-right (+26.6°), right faces up-right. */}
      {(
        [
          ['vs-l', 26.565, ['#C4B497', '#A89B82', '#BDAE8C', '#9E9480'], '#6A5C4A'],
          ['vs-r', -26.565, ['#94846D', '#7C6C56', '#8F8066', '#796E5D'], '#554637'],
        ] as const
      ).map(([id, skew, tints, mortar]) => (
        <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={14} height={8} patternTransform={`skewY(${skew})`}>
          <rect x={0.4} y={0.4} width={6.2} height={3.2} fill={tints[0]} opacity={0.55} />
          <rect x={7.4} y={0.4} width={6.2} height={3.2} fill={tints[1]} opacity={0.5} />
          <rect x={3.9} y={4.4} width={6.2} height={3.2} fill={tints[2]} opacity={0.5} />
          <rect x={10.9} y={4.4} width={3.1} height={3.2} fill={tints[3]} opacity={0.5} />
          <rect x={0} y={4.4} width={3.1} height={3.2} fill={tints[3]} opacity={0.5} />
          <path d="M0 0H14M0 4H14M0 0V4M7 0V4M3.5 4V8M10.5 4V8" stroke={mortar} strokeWidth={0.4} fill="none" />
        </pattern>
      ))}
      {/* Flagstones of the town square, laid on the ground grid. */}
      <pattern id="vg-pave" patternUnits="userSpaceOnUse" width={14} height={14} patternTransform={`matrix(1 .5 -1 .5 ${CX} ${CY})`}>
        {[
          [0, 0],
          [7, 0],
          [0, 7],
          [7, 7],
        ].map(([x, y], i) => (
          <rect key={i} x={x! + 0.3} y={y! + 0.3} width={6.4} height={6.4} fill={pave[i]} stroke="#7C6C56" strokeWidth={0.5} />
        ))}
        <path d="M1.5 2.5l2 .8M8.6 9.4l1.8 1.1" stroke="#D5C5A9" strokeWidth={0.5} />
      </pattern>
    </>
  );
}

// ---- Ground plate --------------------------------------------------------------------------------------------

const GRASS = '#A6C964';

/** Dirt road on the ground: dark edge, body, worn lighter middle. `d` is a closed ground shape. */
function dirt(key: string, d: string, mid?: string): ReactNode {
  return (
    <g key={key}>
      <path d={d} fill="#9C7748" stroke="#8A6A40" strokeWidth={1.6} strokeLinejoin="round" />
      <path d={d} fill="#BE9862" />
      {mid && <path d={mid} fill="#CDAA72" opacity={0.6} />}
    </g>
  );
}

/** The ground plate: earth sides, grass top, roads, the ring path, the paved square and the grass detail. */
export const Ground = memo(function Ground() {
  const D = 22;
  const lip = 4;
  const L: P3 = [-RP, RP, 0];
  const F: P3 = [RP, RP, 0];
  const Rt: P3 = [RP, -RP, 0];
  const B: P3 = [-RP, -RP, 0];
  const down = (p: P3, z: number): P3 => [p[0], p[1], -z];
  const r = rng(5);

  // Stones in the earth sides.
  const sideStones: ReactNode[] = [];
  for (let i = 0; i < 46; i++) {
    const left = i % 2 === 0;
    const t = r() * 2 - 1;
    const z = lip + 3 + r() * (D - lip - 6);
    const [x, y] = left ? iso(t * RP, RP, -z) : iso(RP, t * RP, -z);
    sideStones.push(
      <ellipse
        key={i}
        cx={f(x)}
        cy={f(y)}
        rx={f(1.2 + r() * 1.6)}
        ry={f(0.8 + r() * 0.8)}
        fill={left ? '#A89B82' : '#7C6C56'}
        stroke={INK}
        strokeWidth={0.4}
      />,
    );
  }

  // Roads: from the ring path out through the four gates to the plate edge.
  const roads = [
    groundSquare(0, -(RING_OUT + RP) / 2, ROAD, (RP - RING_OUT) / 2 + 2),
    groundSquare(0, (RING_OUT + RP) / 2, ROAD, (RP - RING_OUT) / 2 + 2),
    groundSquare(-(RING_OUT + RP) / 2, 0, (RP - RING_OUT) / 2 + 2, ROAD),
    groundSquare((RING_OUT + RP) / 2, 0, (RP - RING_OUT) / 2 + 2, ROAD),
  ];
  const roadMids = [
    groundSquare(0, -(RING_OUT + RP) / 2, 4, (RP - RING_OUT) / 2 - 4),
    groundSquare(0, (RING_OUT + RP) / 2, 4, (RP - RING_OUT) / 2 - 4),
    groundSquare(-(RING_OUT + RP) / 2, 0, (RP - RING_OUT) / 2 - 4, 4),
    groundSquare((RING_OUT + RP) / 2, 0, (RP - RING_OUT) / 2 - 4, 4),
  ];
  const ring = `${groundSquare(0, 0, RING_OUT)}${groundSquare(0, 0, RING_IN)}`;

  // Painted grass: soft lighter and darker patches, tufts, a few flowers and pebbles.
  const patches: ReactNode[] = [];
  for (let i = 0; i < 26; i++) {
    const u = (r() * 2 - 1) * (RP - 30);
    const v = (r() * 2 - 1) * (RP - 30);
    const [x, y] = iso(u, v);
    const rx = 18 + r() * 34;
    patches.push(
      <ellipse key={i} cx={f(x)} cy={f(y)} rx={f(rx)} ry={f(rx * 0.45)} fill={i % 3 === 0 ? '#93B656' : '#B4D172'} opacity={0.55} />,
    );
  }
  const tuft = ['', '', ''];
  const flowers = ['', '', ''];
  const pebbles: ReactNode[] = [];
  for (let i = 0; i < 260; i++) {
    const u = (r() * 2 - 1) * (RP - 4);
    const v = (r() * 2 - 1) * (RP - 4);
    const free = Math.max(Math.abs(u), Math.abs(v)) > RING_OUT + 2 && !onRoad(u, v, 2) && !PLOTS.some((p) => Math.abs(u - p.u) < p.half && Math.abs(v - p.v) < p.half);
    const inSquareGrass = Math.max(Math.abs(u), Math.abs(v)) > SQUARE + 4 && Math.max(Math.abs(u), Math.abs(v)) < RING_IN - 2;
    if (!free && !inSquareGrass) continue;
    const [x, y] = iso(u, v);
    const s = 1.1 + r() * 0.5;
    tuft[0] += `M${f(x - 1.3 * s)} ${f(y)}l${f(-0.4 * s)} ${f(-2.6 * s)}`;
    tuft[1] += `M${f(x)} ${f(y)}l${f(0)} ${f(-3.6 * s)}`;
    tuft[2] += `M${f(x + 1.2 * s)} ${f(y)}l${f(0.5 * s)} ${f(-2.8 * s)}`;
    if (i % 5 === 0) flowers[i % 3] += `M${f(x + 4)} ${f(y + 2)}h0`;
    if (i % 11 === 0)
      pebbles.push(<ellipse key={i} cx={f(x - 5)} cy={f(y + 1)} rx={1.6} ry={0.9} fill="#A89C86" stroke={INK} strokeWidth={0.4} />);
  }

  return (
    <g className="vv-ground">
      {/* earth sides: grass lip, then soil with stones */}
      <path d={poly([L, F, down(F, lip), down(L, lip)])} fill="#6F9640" />
      <path d={poly([F, Rt, down(Rt, lip), down(F, lip)])} fill="#4E6E2B" />
      <path d={poly([down(L, lip), down(F, lip), down(F, D), down(L, D)])} fill="#8B684B" />
      <path d={poly([down(F, lip), down(Rt, lip), down(Rt, D), down(F, D)])} fill="#603F27" />
      <path d={`M${pt(L[0], L[1], -(lip + 9))}L${pt(F[0], F[1], -(lip + 9))}L${pt(Rt[0], Rt[1], -(lip + 9))}`} stroke="#4A2E1B" strokeWidth={0.6} fill="none" opacity={0.5} />
      {sideStones}
      <path d={poly([L, F, Rt, down(Rt, D), down(F, D), down(L, D)])} fill="none" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      <path d={`M${pt(...F)}V${f(iso(...F)[1] + D)}`} stroke={INK} strokeWidth={1} />
      {/* grass top */}
      <path d={poly([B, Rt, F, L])} fill={GRASS} />
      {patches}
      <path d={`M${pt(...L)}L${pt(...B)}L${pt(...Rt)}`} fill="none" stroke="#C8DE8A" strokeWidth={1.4} opacity={0.8} />
      <path d={poly([B, Rt, F, L])} fill="none" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      {/* roads and the ring path */}
      {dirt('ring', ring)}
      {roads.map((d, i) => dirt(`r${i}`, d, roadMids[i]))}
      {/* paved town square with a stone kerb */}
      <path d={groundSquare(0, 0, SQUARE + 3)} fill="#887761" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      <path d={groundSquare(0, 0, SQUARE)} fill="#B3A285" />
      <path d={groundSquare(0, 0, SQUARE)} fill="url(#vg-pave)" />
      <path d={groundSquare(0, 0, SQUARE)} fill="none" stroke={INK} strokeWidth={0.6} />
      {/* grass detail */}
      <g fill="none" strokeWidth={0.8} strokeLinecap="round">
        <path d={tuft[0]} stroke="#5E7F33" />
        <path d={tuft[1]} stroke="#6F9640" />
        <path d={tuft[2]} stroke="#4E6E2B" />
      </g>
      <g fill="none" strokeWidth={2.2} strokeLinecap="round">
        <path d={flowers[0]} stroke="#F3E9C8" />
        <path d={flowers[1]} stroke="#E8B04A" />
        <path d={flowers[2]} stroke="#C2553A" />
      </g>
      {pebbles}
    </g>
  );
});

// ---- Town square: the clan campfire with log seats ----------------------------------------------------------------

/** A log seat lying on the paving (local units around the fire). */
const seat = (dx: number, dy: number, key: string) => (
  <g key={key} transform={`translate(${dx} ${dy})`} stroke={INK} strokeWidth={0.6} strokeLinejoin="round">
    <ellipse cx={1.5} cy={3.4} rx={14} ry={2.6} fill="#1E110A" opacity={0.18} stroke="none" />
    <path d="M-12 -3.4H12V3H-12Z" fill="#7A5232" />
    <path d="M-12 .4H12V3H-12Z" fill="#583720" stroke="none" />
    <path d="M-9 -1.6H6" stroke="#957253" strokeWidth={0.6} />
    <ellipse cx={12} cy={-0.2} rx={2.4} ry={3.2} fill="#D9B47E" />
    <ellipse cx={12} cy={-0.2} rx={1} ry={1.4} fill="none" stroke="#A07146" strokeWidth={0.4} />
  </g>
);

/** The big campfire: ring of stones, crossed logs, three layers of flame, sparks, log seats around it. */
export function Campfire() {
  const stones = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const x = f(Math.cos(a) * 18);
    const y = f(3 + Math.sin(a) * 8.5);
    return (
      <g key={i}>
        <ellipse cx={x} cy={y} rx={4.4} ry={3.2} fill={i % 3 ? '#A89B82' : '#BDAE8C'} stroke={INK} strokeWidth={0.6} />
        <ellipse cx={x - 0.9} cy={y - 1.1} rx={2.2} ry={1.1} fill="#D5C5A9" />
      </g>
    );
  });
  return (
    <g transform={`translate(${CX} ${CY}) scale(1.6)`}>
      {seat(-46, 6, 's1')}
      {seat(46, 6, 's2')}
      {seat(-24, 28, 's3')}
      {seat(24, 28, 's4')}
      <ellipse cx={0} cy={4} rx={30} ry={14} fill="#E8B04A" opacity={0.22} />
      {stones.slice(5, 12)}
      <ellipse cx={0} cy={3} rx={14} ry={6} fill="#2B1C14" stroke={INK} strokeWidth={0.6} />
      <g stroke={INK} strokeWidth={0.6} strokeLinejoin="round">
        <path d="M-15 6L11 -2L14 2L-12 10Z" fill="#7A5232" />
        <path d="M-12 10L14 2L14 3.4L-12 11.4Z" fill="#583720" />
        <ellipse cx={-13.6} cy={8} rx={1.6} ry={2.2} fill="#D9B47E" />
        <path d="M15 6L-11 -2L-14 2L12 10Z" fill="#957253" />
        <ellipse cx={13.6} cy={8} rx={1.6} ry={2.2} fill="#D9B47E" />
        <path d="M-11 2Q-15 -13 -4.5 -22Q-4.5 -12 0 -9Q3 -27 4.5 -34Q13.5 -19 12 2Q0 7 -11 2Z" fill="#D4602E" strokeWidth={0.8} />
        <path d="M-7 2Q-9 -7 -1.5 -15Q0 -7 2.2 -6Q4.5 -16 6.7 -19Q9.7 -9 7.5 2Q0 4.6 -7 2Z" fill="#E8B04A" strokeWidth={0.6} />
        <path d="M-3 2Q-3.8 -3.8 0 -8.2Q3.8 -3.8 3 2Q0 3 -3 2Z" fill="#FBE3A0" strokeWidth={0.4} />
      </g>
      {stones.slice(0, 5)}
      <g fill="#FBE3A0" stroke="#E8B04A" strokeWidth={0.4}>
        <circle cx={-10} cy={-27} r={1.2} />
        <circle cx={12} cy={-33} r={1} />
        <circle cx={2} cy={-43} r={0.9} />
      </g>
    </g>
  );
}

// ---- Trees, bushes and rocks ---------------------------------------------------------------------------------

type Kind = 'pineA' | 'pineB' | 'oak' | 'bush' | 'rockA' | 'rockB' | 'rockC' | 'stump' | 'logs';
const TALL: ReadonlySet<Kind> = new Set(['pineA', 'pineB', 'oak']);
const RADIUS: Record<Kind, number> = { pineA: 8, pineB: 9, oak: 9, bush: 6, rockA: 8, rockB: 6, rockC: 8, stump: 4, logs: 10 };

/** [kinds, centre u, centre v, spread u, spread v, count, min scale, max scale] — scattered, then filtered by clear(). */
const ZONES: [Kind[], number, number, number, number, number, number, number][] = [
  // The grove in front of the Lumber Camp, and a few stumps and logs where it was cut.
  [['pineA', 'pineB', 'pineA', 'oak'], -60, 160, 40, 40, 11, 1.35, 1.7],
  [['stump', 'stump', 'logs'], -100, 120, 30, 50, 4, 1.3, 1.5],
  // Rocks around the Iron Mine corner and the Gold Mine.
  [['rockA', 'rockC', 'rockB'], 150, -150, 60, 60, 7, 1.2, 1.8],
  [['rockB', 'rockA'], 140, 140, 60, 60, 4, 1.1, 1.5],
  // Lone trees and bushes in the quarters.
  [['oak', 'bush', 'pineB', 'bush'], 0, 0, 200, 200, 14, 1.2, 1.55],
];

/** Props on the rim outside the wall: pines behind the back walls, only bushes and rocks in front. */
function rimProps(r: () => number): [Kind, number, number, number][] {
  const out: [Kind, number, number, number][] = [];
  for (let i = 0; i < 70 && out.length < 34; i++) {
    const edge = Math.floor(r() * 4);
    const t = (r() * 2 - 1) * (RP - 10);
    const d = R + 11 + r() * (RP - R - 16);
    const [u, v] = edge === 0 ? [t, -d] : edge === 1 ? [-d, t] : edge === 2 ? [t, d] : [d, t];
    if (onRoad(u, v, 8)) continue;
    const back = edge < 2;
    const kind: Kind = back ? (r() < 0.75 ? (r() < 0.5 ? 'pineA' : 'pineB') : 'oak') : r() < 0.7 ? 'bush' : 'rockB';
    out.push([kind, u, v, back ? 1.3 + r() * 0.35 : 1.1 + r() * 0.3]);
  }
  return out;
}

const PROPS: [Kind, number, number, number][] = (() => {
  const r = rng(17);
  const out: [Kind, number, number, number][] = [];
  const taken = (u: number, v: number, rad: number) => out.some(([k, pu, pv, s]) => Math.hypot(u - pu, v - pv) < rad + RADIUS[k] * s);
  for (const [kinds, cu, cv, su, sv, n, s0, s1] of ZONES) {
    for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
      const kind = kinds[Math.floor(r() * kinds.length)]!;
      const s = s0 + r() * (s1 - s0);
      const u = cu + (r() * 2 - 1) * su;
      const v = cv + (r() * 2 - 1) * sv;
      const rad = RADIUS[kind] * s;
      if (Math.max(Math.abs(u), Math.abs(v)) > R - 8 - rad || !clear(u, v, rad, TALL.has(kind)) || taken(u, v, rad)) continue;
      out.push([kind, f(u), f(v), f(s)]);
      i++;
    }
  }
  return out.concat(rimProps(r));
})();

let propItems: DepthItem[] | null = null;

export function sceneryItems(): DepthItem[] {
  propItems ??= PROPS.map(([kind, u, v, s], i) => {
    const [x, y] = iso(u, v);
    return { key: `t${i}`, depth: y, node: <use href={`#vt-${kind}`} transform={`translate(${f(x)} ${f(y)}) scale(${s})`} /> };
  });
  return propItems;
}

// ---- Ring wall ------------------------------------------------------------------------------------------------
// Drawn in code (not a sprite) because it wraps the whole village, split into pieces for the painter's sort.
// Stage 1: wooden palisade with thatched watchtowers; stage 2: crenellated stone wall with square towers and flags;
// stage 3: tall stone wall, towers with slate roofs, flags and hanging banners (as the B wall-1..3 sprites).

const STONE = { top: '#BDB096', left: '#B3A285', right: '#887761' };
const WOOD = { top: '#B98754', left: '#957253', right: '#603F27' };
const SLATE = { left: '#80888E', right: '#626B74', line: '#4B5258', hi: '#A3ABB0' };
const THATCH = { left: '#C39A52', right: '#96743E', line: '#E0C08A', dark: '#7A5A2E' };
const BANNER = { cloth: '#A63E28', dark: '#7A2A1A', light: '#C2553A', flame: '#E8B04A', core: '#FBE3A0' };

interface Colors {
  top: string;
  left: string;
  right: string;
}

/** Visible faces of the box u0..u1 x v0..v1 x z0..z1: left (+v, lit), right (+u, shaded), top. */
function box(
  key: string,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  z0: number,
  z1: number,
  c: Colors,
  o: { stones?: boolean; sw?: number } = {},
): ReactNode {
  const left = poly([
    [u0, v1, z0],
    [u1, v1, z0],
    [u1, v1, z1],
    [u0, v1, z1],
  ]);
  const right = poly([
    [u1, v1, z0],
    [u1, v0, z0],
    [u1, v0, z1],
    [u1, v1, z1],
  ]);
  const top = poly([
    [u0, v0, z1],
    [u1, v0, z1],
    [u1, v1, z1],
    [u0, v1, z1],
  ]);
  const sw = o.sw ?? 0.7;
  return (
    <g key={key} stroke={INK} strokeWidth={sw} strokeLinejoin="round">
      <path d={left} fill={c.left} />
      {o.stones && <path d={left} fill="url(#vs-l)" stroke="none" />}
      <path d={right} fill={c.right} />
      {o.stones && <path d={right} fill="url(#vs-r)" stroke="none" />}
      <path d={top} fill={c.top} />
    </g>
  );
}

/** Square pyramid roof on (cu, cv) with half-side a at height z: the two front faces, with shingle courses. */
function roof(key: string, cu: number, cv: number, a: number, z: number, rise: number, c: { left: string; right: string; line: string; hi?: string }) {
  const apex: P3 = [cu, cv, z + rise];
  const E: P3 = [cu - a, cv + a, z];
  const D: P3 = [cu + a, cv + a, z];
  const Bk: P3 = [cu + a, cv - a, z];
  const lerp = (p: P3, q: P3, t: number): P3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  let courses = '';
  for (const t of [0.22, 0.42, 0.6, 0.76]) {
    courses += `M${pt(...lerp(E, apex, t))}L${pt(...lerp(D, apex, t))}L${pt(...lerp(Bk, apex, t))}`;
  }
  return (
    <g key={key} strokeLinejoin="round">
      <path d={poly([E, D, apex])} fill={c.left} />
      <path d={poly([D, Bk, apex])} fill={c.right} />
      <path d={courses} fill="none" stroke={c.line} strokeWidth={0.45} />
      {c.hi && <path d={`M${pt(...lerp(E, apex, 0.08))}L${pt(...lerp(apex, E, 0.04))}`} stroke={c.hi} strokeWidth={0.6} fill="none" />}
      <path d={`M${pt(...E)}L${pt(...apex)}L${pt(...Bk)}L${pt(...D)}Z M${pt(...D)}L${pt(...apex)}`} fill="none" stroke={INK} strokeWidth={0.7} />
    </g>
  );
}

/** A flag on a pole standing at screen point (x, y). */
function flag(key: string, x: number, y: number): ReactNode {
  const top = y - 15;
  return (
    <g key={key} strokeLinejoin="round">
      <path d={`M${f(x)} ${f(y)}V${f(top)}`} stroke="#4A2E1B" strokeWidth={1.1} strokeLinecap="round" />
      <circle cx={f(x)} cy={f(top - 0.6)} r={0.9} fill={BANNER.flame} stroke={INK} strokeWidth={0.4} />
      <path
        d={`M${f(x + 0.5)} ${f(top)}q5 -1.4 10 .4l-2.4 3.2l2.6 3.4q-5 -1.6 -10.2 -.2Z`}
        fill={BANNER.cloth}
        stroke={INK}
        strokeWidth={0.6}
      />
      <path d={`M${f(x + 0.5)} ${f(top + 5)}q5 -1 10.2 .6l.2 .4q-5 -1.6 -10.2 -.2Z`} fill={BANNER.dark} />
      <path
        d={`M${f(x + 5)} ${f(top + 5.2)}q-1.6 -1.2 -.2 -3.4q.4 1.2 1 1.2q.2 -1 .8 -1.6q1 2.2 -.2 3.8Z`}
        fill={BANNER.flame}
        stroke={BANNER.core}
        strokeWidth={0.3}
      />
    </g>
  );
}

/** A banner hanging on a wall face: `face` 'l' lies on the plane v = const (runs along u), 'r' on u = const. */
function hangingBanner(key: string, face: 'l' | 'r', cu: number, cv: number, ztop: number): ReactNode {
  const w = 2.6;
  const h = 11;
  const p = (s: number, z: number): P3 => (face === 'l' ? [cu + s, cv, z] : [cu, cv - s, z]);
  const d = poly([p(-w, ztop), p(w, ztop), p(w, ztop - h), p(0, ztop - h + 2.4), p(-w, ztop - h)]);
  const [fx, fy] = iso(...p(0, ztop - h / 2 + 0.6));
  return (
    <g key={key}>
      <path d={d} fill={face === 'l' ? BANNER.cloth : BANNER.dark} stroke={INK} strokeWidth={0.5} strokeLinejoin="round" />
      <path d={`M${pt(...p(-w - 0.6, ztop))}L${pt(...p(w + 0.6, ztop))}`} stroke="#4A2E1B" strokeWidth={0.9} strokeLinecap="round" />
      <path d={`M${f(fx)} ${f(fy + 2)}q-1.5 -1.2 0 -3.6q1.5 2.4 0 3.6Z`} fill={BANNER.flame} />
    </g>
  );
}

/** Stone tower: body with courses, crenellated top, optional slate roof and flag. */
function stoneTower(key: string, cu: number, cv: number, a: number, h: number, o: { roof?: number; flag?: boolean; banner?: 'l' | 'r' }) {
  const parts: ReactNode[] = [box('b', cu - a, cu + a, cv - a, cv + a, 0, h, STONE, { stones: true })];
  // Arrow slits on both visible faces.
  parts.push(
    <path
      key="sl"
      d={`M${pt(cu, cv + a, h * 0.45)}L${pt(cu, cv + a, h * 0.45 + 6)}M${pt(cu + a, cv, h * 0.5)}L${pt(cu + a, cv, h * 0.5 + 6)}`}
      stroke="#2B1C14"
      strokeWidth={1.5}
      strokeLinecap="round"
    />,
  );
  if (o.banner) parts.push(hangingBanner('hb', o.banner, o.banner === 'l' ? cu : cu + a, o.banner === 'l' ? cv + a : cv, h - 3));
  // Merlons: corners and edge middles; the back ones first, the roof, then the front ones.
  const m = Math.max(1.8, a * 0.24);
  const spots: [number, number][] = [];
  for (const du of [-1, 0, 1]) for (const dv of [-1, 0, 1]) if (du || dv) spots.push([du, dv]);
  spots.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  const merlon = ([du, dv]: [number, number]) => {
    const u = cu + du * (a - m);
    const v = cv + dv * (a - m);
    return box(`m${du}${dv}`, u - m, u + m, v - m, v + m, h, h + 4, STONE, { sw: 0.5 });
  };
  const back = spots.filter(([du, dv]) => du + dv <= 0);
  const front = spots.filter((s) => !back.includes(s));
  parts.push(...back.map(merlon));
  if (o.roof) parts.push(roof('rf', cu, cv, a - m * 0.6, h + 2, o.roof, SLATE));
  parts.push(...front.map(merlon));
  if (o.flag) {
    const [x, y] = o.roof ? iso(cu, cv, h + 2 + o.roof) : iso(cu, cv, h);
    parts.push(flag('fl', x, y));
  }
  return <g key={key}>{parts}</g>;
}

/** Thatched timber watchtower (palisade stage). */
function watchtower(key: string, cu: number, cv: number) {
  const a = 8;
  const leg = (du: number, dv: number, z0: number, z1: number) =>
    box(`l${du}${dv}${z0}`, cu + du * a - 1.3, cu + du * a + 1.3, cv + dv * a - 1.3, cv + dv * a + 1.3, z0, z1, WOOD, { sw: 0.5 });
  const legs = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;
  return (
    <g key={key}>
      {legs.map(([du, dv]) => leg(du, dv, 0, 24))}
      <path
        d={`M${pt(cu - a, cv + a, 3)}L${pt(cu + a, cv + a, 22)}M${pt(cu + a, cv + a, 3)}L${pt(cu - a, cv + a, 22)}M${pt(cu + a, cv - a, 3)}L${pt(cu + a, cv + a, 22)}M${pt(cu + a, cv + a, 3)}L${pt(cu + a, cv - a, 22)}`}
        stroke="#583720"
        strokeWidth={0.9}
      />
      {box('p', cu - a - 2, cu + a + 2, cv - a - 2, cv + a + 2, 24, 27, { top: '#A07146', left: WOOD.left, right: WOOD.right })}
      {legs.map(([du, dv]) => leg(du, dv, 27, 34))}
      {box('r1', cu - a - 2, cu + a + 2, cv + a + 1.4, cv + a + 2, 27, 30.5, { top: WOOD.top, left: '#7A5232', right: '#583720' }, { sw: 0.5 })}
      {box('r2', cu + a + 1.4, cu + a + 2, cv - a - 2, cv + a + 2, 27, 30.5, { top: WOOD.top, left: '#7A5232', right: '#583720' }, { sw: 0.5 })}
      {roof('rf', cu, cv, a + 4, 34, 13, THATCH)}
    </g>
  );
}

/** Thick gate post with a pointed cap (palisade stage). */
function gatePost(key: string, cu: number, cv: number) {
  return (
    <g key={key}>
      {box('b', cu - 3, cu + 3, cv - 3, cv + 3, 0, 24, { top: WOOD.top, left: '#7A5232', right: '#4A2E1B' })}
      {roof('c', cu, cv, 3.6, 24, 5, { left: '#957253', right: '#583720', line: '#583720' })}
      <path d={`M${pt(cu - 3, cv + 3, 16)}L${pt(cu + 3, cv + 3, 16)}L${pt(cu + 3, cv - 3, 16)}`} stroke="#3B2619" strokeWidth={0.9} fill="none" />
    </g>
  );
}

/** One run of palisade along an edge: `along` 'u' runs at v = c, 'v' runs at u = c, from a to b. */
function palisade(key: string, along: 'u' | 'v', c: number, a: number, b: number): ReactNode {
  const h = 17;
  const tip = 4;
  const w = 3.2;
  const P = (s: number, z: number): P3 => (along === 'u' ? [s, c, z] : [c, s, z]);
  const n = Math.max(1, Math.round((b - a) / w));
  const step = (b - a) / n;
  let top = '';
  let dark = '';
  let lines = '';
  for (let i = 0; i < n; i++) {
    const s0 = a + i * step;
    const s1 = s0 + step;
    const mid = (s0 + s1) / 2;
    const hh = h + ((i * 7) % 3) * 0.8;
    top += `L${pt(...P(s0, hh))}L${pt(...P(mid, hh + tip))}L${pt(...P(s1, hh))}`;
    dark += `M${pt(...P(mid + step * 0.1, 0))}L${pt(...P(s1, 0))}L${pt(...P(s1, hh))}L${pt(...P(mid + step * 0.1, hh + tip * 0.8))}Z`;
    if (i > 0) lines += `M${pt(...P(s0, 0))}L${pt(...P(s0, hh))}`;
  }
  const body = `M${pt(...P(a, 0))}${top}L${pt(...P(b, 0))}Z`;
  const lit = along === 'u';
  return (
    <g key={key} strokeLinejoin="round">
      <path d={body} fill={lit ? '#8B684B' : '#7A5232'} />
      <path d={dark} fill={lit ? '#6E4628' : '#583720'} />
      <path d={lines} stroke="#4A2E1B" strokeWidth={0.4} fill="none" />
      <path d={`M${pt(...P(a, 6))}L${pt(...P(b, 6))}M${pt(...P(a, 12.5))}L${pt(...P(b, 12.5))}`} stroke="#4A2E1B" strokeWidth={1.4} fill="none" />
      <path d={`M${pt(...P(a, 6.6))}L${pt(...P(b, 6.6))}M${pt(...P(a, 13.1))}L${pt(...P(b, 13.1))}`} stroke="#A07146" strokeWidth={0.5} fill="none" />
      <path d={body} fill="none" stroke={INK} strokeWidth={0.7} />
    </g>
  );
}

/** One run of stone wall along an edge, with merlons on its outer side. `outer` is +1 when the outer side is +v/+u. */
function stoneRun(key: string, along: 'u' | 'v', c: number, a: number, b: number, h: number, t: number, outer: 1 | -1): ReactNode {
  const lo = c - t / 2;
  const hi = c + t / 2;
  const body = along === 'u' ? box('w', a, b, lo, hi, 0, h, STONE, { stones: true }) : box('w', lo, hi, a, b, 0, h, STONE, { stones: true });
  const ml = 3.6;
  const mt = t * 0.36;
  const m0 = outer > 0 ? hi - mt : lo;
  const merlons: ReactNode[] = [];
  for (let s = a + 1.2; s + ml <= b - 0.6; s += ml * 2) {
    merlons.push(
      along === 'u'
        ? box(`m${f(s)}`, s, s + ml, m0, m0 + mt, h, h + 4.5, STONE, { sw: 0.5 })
        : box(`m${f(s)}`, m0, m0 + mt, s, s + ml, h, h + 4.5, STONE, { sw: 0.5 }),
    );
  }
  // Soft shadow at the foot of the visible face.
  const foot =
    along === 'u'
      ? poly([
          [a, hi, 0],
          [b, hi, 0],
          [b, hi, 3],
          [a, hi, 3],
        ])
      : poly([
          [hi, a, 0],
          [hi, b, 0],
          [hi, b, 3],
          [hi, a, 3],
        ]);
  return (
    <g key={key}>
      {body}
      <path d={foot} fill="#1E110A" opacity={0.16} />
      {merlons}
    </g>
  );
}

interface Edge {
  name: string;
  /** Runs along u (at v = c) or along v (at u = c). */
  along: 'u' | 'v';
  c: number;
}

const EDGES: Edge[] = [
  { name: 'back-right', along: 'u', c: -R },
  { name: 'back-left', along: 'v', c: -R },
  { name: 'front-left', along: 'u', c: R },
  { name: 'front-right', along: 'v', c: R },
];

/** Screen depth of the front-most ground point of a run piece. */
function runDepth(e: Edge, s1: number, t: number): number {
  return e.along === 'u' ? iso(s1, e.c + t / 2)[1] : iso(e.c + t / 2, s1)[1];
}

const wallCache = new Map<number, DepthItem[]>();

/** Painter-sorted pieces of the ring wall for a stage (1–3). */
export function wallItems(stage: Exclude<Stage, 0>): DepthItem[] {
  const hit = wallCache.get(stage);
  if (hit) return hit;
  const items: DepthItem[] = [];
  const corner = stage === 1 ? 9 : stage === 2 ? 12 : 15;
  const post = stage === 1 ? 3 : stage === 2 ? 8 : 10;
  const t = stage === 1 ? 2 : stage === 2 ? 7 : 9;
  const h = stage === 2 ? 16 : 24;
  const chunk = 24;

  for (const e of EDGES) {
    const outer: 1 | -1 = e.c > 0 ? 1 : -1;
    const runs: [number, number][] = [
      [-R + corner, -GATE - post],
      [GATE + post, R - corner],
    ];
    for (const [a0, b0] of runs) {
      for (let a = a0; a < b0 - 0.5; a += chunk) {
        const b = Math.min(b0, a + chunk);
        const node = stage === 1 ? palisade('p', e.along, e.c, a, b) : stoneRun('s', e.along, e.c, a, b, h, t, outer);
        items.push({ key: `w-${e.name}-${f(a)}`, depth: runDepth(e, b, t), node });
      }
    }
    // Gate towers / posts on both sides of the gap.
    for (const side of [-1, 1] as const) {
      const s = side * (GATE + post);
      const [u, v] = e.along === 'u' ? [s, e.c] : [e.c, s];
      const node =
        stage === 1
          ? gatePost('g', u, v)
          : stoneTower('g', u, v, post, stage === 2 ? 24 : 34, {
              roof: stage === 3 ? 16 : undefined,
              banner: stage === 3 && side === -1 ? (e.along === 'u' ? 'l' : 'r') : undefined,
            });
      items.push({ key: `g-${e.name}-${side}`, depth: iso(u + post, v + post)[1], node });
    }
  }
  const corners: [number, number][] = [
    [-R, -R],
    [R, -R],
    [-R, R],
    [R, R],
  ];
  corners.forEach(([u, v], i) => {
    const node =
      stage === 1
        ? watchtower(`c${i}`, u, v)
        : stoneTower(`c${i}`, u, v, corner, stage === 2 ? 30 : 46, { roof: stage === 3 ? 26 : undefined, flag: true });
    items.push({ key: `c${i}`, depth: iso(u + corner, v + corner)[1], node });
  });
  wallCache.set(stage, items);
  return items;
}
