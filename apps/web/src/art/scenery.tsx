// Village scene scenery in style D (Toy Diorama, like the approved village artboard): a chunky ground plate with thick
// warm-ink outlines, bold tan paths to the buildings that stand, a paved square under the Town Hall, toy trees and rocks,
// and the ring wall on the plate's edge drawn by its stage (palisade, stone, towers with terracotta roofs and flags).
// Flat 3-tone block shading lit from the top left. Laid out on the isometric grid from ./buildings.ts (iso(u, v, z)).

import { memo } from 'react';
import type { ReactNode } from 'react';
import { T } from './Icon.tsx';
import type { BuildingId } from '@clanfire/engine';
import { PLACEMENT, WALL_RING, iso } from './buildings.ts';
import type { Stage } from './buildings.ts';

export interface DepthItem {
  key: string;
  depth: number;
  node: ReactNode;
}

const INK = '#2B211C';
const { cx: CX, cy: CY, plate: RP, gateHalf: GATE, gateU: GATE_U } = WALL_RING;
/** Half width of the closed main gate (a third wider than the road's gap, so the doors read clearly). */
const GATE_W = GATE * 1.3;

/** Half-side of the paved square under the Town Hall. */
const SQUARE = 58;
/** Props stay this far inside the plate edge (the wall stands there). */
const INNER = RP - 14;

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

const HALL = PLOTS[(Object.keys(PLACEMENT) as BuildingId[]).filter((id) => id !== 'wall').indexOf('hall')]!;

// ---- Paths ---------------------------------------------------------------------------------------------------
// Packed-earth paths that meander a little: the main road from the gate up to the hall square, and a branch to the front
// of each plot (never across one). Each is a smooth curve through hand-placed points (grid units) with a soft, wobbly
// width; paths that start at the hall square turn into flagstones there. A path shows only once its building exists.

interface PathDef {
  key: string;
  pts: readonly (readonly [number, number])[];
  /** Half width. */
  w: number;
  /** The building it leads to (null: always shown). */
  to: BuildingId | null;
  /** Starts at the hall square (gets flagstones there). */
  paved?: boolean;
}

const PATHS: PathDef[] = [
  { key: 'main', to: null, paved: true, w: 12, pts: [[14, 74], [10, 110], [4, 150], [10, 195], [8, RP + 2]] },
  { key: 'market', to: 'market', w: 7.2, pts: [[7, 146], [16, 150], [26, 152]] },
  { key: 'drill', to: 'drillyard', w: 7.2, pts: [[5, 134], [-12, 140], [-30, 146]] },
  { key: 'farm', to: 'farm', paved: true, w: 7.8, pts: [[74, 74], [92, 90], [102, 104], [108, 108]] },
  { key: 'east', to: 'storehouse', paved: true, w: 8.4, pts: [[78, 26], [92, 20], [104, 12]] },
  { key: 'mine', to: 'mine', w: 7.2, pts: [[90, 20], [104, -18], [122, -60], [130, -96], [130, -118]] },
  { key: 'north', to: 'stables', paved: true, w: 8.4, pts: [[34, -34], [40, -62], [52, -86], [62, -106]] },
  { key: 'vault', to: 'vault', w: 6.6, pts: [[40, -62], [10, -88], [-18, -102], [-34, -116]] },
  { key: 'gold', to: 'goldmine', paved: true, w: 7.8, pts: [[-32, -32], [-60, -70], [-92, -96], [-110, -110], [-122, -122]] },
  { key: 'west', to: 'barracks', paved: true, w: 8.4, pts: [[-34, 16], [-58, 8], [-80, 2], [-100, 0]] },
  { key: 'lumber', to: 'lumber', w: 7.2, pts: [[-76, 4], [-92, 44], [-106, 84], [-120, 120]] },
];

/** Paths that also show when a branch off them does (a branch needs its trunk). */
const TRUNK: Record<string, string> = { mine: 'east', vault: 'north', lumber: 'west', market: 'main', drill: 'main' };

interface Sample {
  u: number;
  v: number;
  /** Unit normal in grid units. */
  nu: number;
  nv: number;
  /** Distance along the path. */
  s: number;
}

/** Catmull-Rom curve through the points, sampled about every 2.5 grid units. */
function samplePath(pts: PathDef['pts']): Sample[] {
  const raw: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      raw.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  raw.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  let s = 0;
  return raw.map(([u, v], i) => {
    const a = raw[Math.max(0, i - 1)]!;
    const b = raw[Math.min(raw.length - 1, i + 1)]!;
    const du = b[0] - a[0];
    const dv = b[1] - a[1];
    const len = Math.hypot(du, dv) || 1;
    if (i > 0) s += Math.hypot(u - raw[i - 1]![0], v - raw[i - 1]![1]);
    return { u, v, nu: -dv / len, nv: du / len, s };
  });
}

const SAMPLES = PATHS.map((p) => samplePath(p.pts));

/** Smooth wobble in [-1, 1] along a path. */
const wobble = (s: number, k: number) => Math.sin(s * 0.13 + k * 1.7) * 0.55 + Math.sin(s * 0.37 + k * 4.1) * 0.3 + Math.sin(s * 0.91 + k * 2.3) * 0.15;

const onRoad = (u: number, v: number, pad: number) =>
  PATHS.some((p, i) => SAMPLES[i]!.some((q) => Math.abs(q.u - u) < p.w + pad + 2 && Math.hypot(q.u - u, q.v - v) < p.w * 1.2 + pad));

/** Crop fields: wheat beside the Farm, a vegetable plot by the Storehouse. [centre u, centre v, half u, half v, crop]. */
const FIELDS: [number, number, number, number, 'wheat' | 'greens'][] = [
  [172, 84, 20, 22, 'wheat'],
  [170, -60, 16, 18, 'greens'],
];
const onField = (u: number, v: number, pad: number) =>
  FIELDS.some(([cu, cv, hu, hv]) => Math.abs(u - cu) < hu + pad && Math.abs(v - cv) < hv + pad);

const inSquare = (u: number, v: number, pad: number) => Math.max(Math.abs(u - HALL.u), Math.abs(v - HALL.v)) < SQUARE + 3 + pad;

/** Free ground for a prop of radius `rad` at (u, v): off the plots, roads, fields and square, and not hiding a plot. */
function clear(u: number, v: number, rad: number, tall: boolean): boolean {
  if (Math.max(Math.abs(u), Math.abs(v)) > INNER - rad) return false;
  if (inSquare(u, v, rad) || onRoad(u, v, rad + 2) || onField(u, v, rad)) return false;
  const [x, y] = iso(u, v);
  for (const p of PLOTS) {
    if (Math.abs(u - p.u) < p.half + rad && Math.abs(v - p.v) < p.half + rad) return false;
    // A tall tree just in front of a plot would hide the building.
    if (tall && Math.abs(x - p.x) < p.hw * 0.85 && y > p.y && y < p.y + p.hw * 0.5 + 46) return false;
  }
  return true;
}

// ---- Prop symbols (toy pines, round trees, bushes, rocks, stump, logs) ----------------------------------------

/** A cut tree: round top with growth rings, in warm wood tones. */
const stump = (
  <g stroke="#2B211C" strokeWidth="1.4" strokeLinejoin="round">
    <ellipse cx="3" cy="2" rx="10" ry="4.5" fill="#2B211C" opacity="0.22" stroke="none" />
    <path d="M-7 -8V0A7 3.2 0 0 0 7 0V-8Z" fill="#B07D46" />
    <ellipse cx="0" cy="-8" rx="7" ry="3.2" fill="#E4B67C" />
    <ellipse cx="0" cy="-8" rx="3.2" ry="1.4" fill="none" stroke="#B07D46" strokeWidth="1" />
  </g>
);

/** A stack of cut logs: two on the ground, one on top. */
const logs = (
  <g stroke="#2B211C" strokeWidth="1.4" strokeLinejoin="round">
    <ellipse cx="3" cy="3" rx="22" ry="6" fill="#2B211C" opacity="0.22" stroke="none" />
    <path d="M-18 -2H4V6H-18Z" fill="#B07D46" />
    <ellipse cx="4" cy="2" rx="3" ry="4" fill="#E4B67C" />
    <path d="M-4 -2H18V6H-4Z" fill="#B07D46" />
    <ellipse cx="18" cy="2" rx="3" ry="4" fill="#E4B67C" />
    <path d="M-12 -10H10V-2H-12Z" fill="#8E6539" />
    <ellipse cx="10" cy="-6" rx="3" ry="4" fill="#E4B67C" />
  </g>
);

const pine = (u: string) => (
  <>
    <ellipse cx="5" cy="2" rx="12" ry="5.5" fill="#2B211C" opacity="0.25" />
    <T
      u={u + '0'}
      d="M-3.5 -8Q-3.5 -10 -1.5 -10L1.5 -10Q3.5 -10 3.5 -8L3.5 -1Q3.5 1 1.5 1L-1.5 1Q-3.5 1 -3.5 -1Z"
      l="#E4B67C"
      k="#714B29"
      m="#B07D46"
      s={1}
      x={-1.6}
      y={-2}
      w={1.8}
    />
    <T
      u={u + '1'}
      d="M-2.3 -36.8Q0 -40 2.3 -36.8L10.7 -25.2Q13 -22 13.6 -18L14.4 -12Q15 -8 11 -8L-11 -8Q-15 -8 -14.4 -12L-13.6 -18Q-13 -22 -10.7 -25.2Z"
      l="#7FB04E"
      k="#2C4E1F"
      m="#467A32"
      s={2.5}
      x={-4}
      y={-5}
      w={2}
    />
    <T
      u={u + '2'}
      d="M-2.1 -48.6Q0 -52 2.1 -48.6L7.9 -39.4Q10 -36 10.4 -32L10.6 -30Q11 -26 7 -26L-7 -26Q-11 -26 -10.6 -30L-10.4 -32Q-10 -36 -7.9 -39.4Z"
      l="#7FB04E"
      k="#2C4E1F"
      m="#467A32"
      s={2}
      x={-3.2}
      y={-4}
      w={2}
    />
  </>
);
const round = (u: string) => (
  <>
    <ellipse cx="5" cy="2" rx="13" ry="6" fill="#2B211C" opacity="0.25" />
    <T u={u + '0'} d="M4 0L4 -16A4 4 0 0 0 -4 -16L-4 0A4 4 0 0 0 4 0Z" l="#E4B67C" k="#714B29" m="#B07D46" s={1} x={-1.6} y={-2} w={1.8} />
    <T u={u + '1'} d="M-15 -28A15 15 0 1 0 15 -28A15 15 0 1 0 -15 -28Z" l="#A6C964" k="#3A5E27" m="#5E8C3A" s={2.5} x={-4} y={-5} w={2} />
    <ellipse cx="-6" cy="-36" rx="4" ry="2.4" transform="rotate(-30 -6 -36)" fill="#FFFFFF" opacity="0.7" />
  </>
);
const rock = (u: string) => (
  <>
    <T
      u={u + '0'}
      d="M-12 0C-13.5 -2.3 -11.2 -7.3 -9 -10C-6.8 -12.7 -2.3 -16.2 1 -16C4.3 -15.8 9 -11.7 11 -9C13 -6.3 14.8 -2.2 13 0C11.2 2.2 4.2 4 0 4C-4.2 4 -10.5 2.3 -12 0Z"
      l="#E3DED3"
      k="#7C756B"
      m="#B3ACA0"
      s={2}
      x={-3.2}
      y={-4}
      w={1.8}
    />
  </>
);

const bush = (
  <g stroke={INK} strokeWidth={1.6} strokeLinejoin="round">
    <ellipse cx={3} cy={1.5} rx={11} ry={4.5} fill={INK} opacity={0.22} stroke="none" />
    <circle cx={-4.5} cy={-4.5} r={5.5} fill="#5E8C3A" />
    <circle cx={4.5} cy={-4} r={5.2} fill="#3A5E27" />
    <circle cx={0} cy={-8} r={6} fill="#5E8C3A" />
    <ellipse cx={-2.4} cy={-10.4} rx={2.6} ry={1.5} transform="rotate(-30 -2.4 -10.4)" fill="#A6C964" stroke="none" />
  </g>
);

/** Symbols referenced by <use href="#vt-…">; render once inside the scene's <defs>. Sizes are tuned to the sprites. */
export function SceneryDefs() {
  return (
    <>
      <g id="vt-pineA" transform="scale(0.78)">{pine('vtp')}</g>
      <g id="vt-pineB" transform="scale(0.64)">{pine('vtq')}</g>
      <g id="vt-oak" transform="scale(0.74)">{round('vtr')}</g>
      <g id="vt-bush" transform="scale(0.62)">{bush}</g>
      <g id="vt-rockA" transform="scale(0.72)">{rock('vtk')}</g>
      <g id="vt-rockB" transform="scale(0.52)">{rock('vtl')}</g>
      <g id="vt-rockC" transform="scale(0.62)">
        <g transform="translate(-6 -2)">{rock('vtm')}</g>
        <g transform="translate(8 3) scale(0.7)">{rock('vtn')}</g>
      </g>
      <g id="vt-stump" transform="scale(0.6)">{stump}</g>
      <g id="vt-logs" transform="scale(0.55)">{logs}</g>
    </>
  );
}

// ---- Ground plate --------------------------------------------------------------------------------------------

const GRASS = '#A6C964';
const PATH_FILL = '#D9B98A';

/** The ground plate: chunky earth sides, grass top with light patches and speckles, and the fields. */
const GroundBase = memo(function GroundBase() {
  const D = 24;
  const L: P3 = [-RP, RP, 0];
  const F: P3 = [RP, RP, 0];
  const Rt: P3 = [RP, -RP, 0];
  const B: P3 = [-RP, -RP, 0];
  const down = (p: P3, z: number): P3 => [p[0], p[1], -z];
  const r = rng(5);
  const patches: ReactNode[] = [];
  for (let i = 0; i < 18; i++) {
    const u = (r() * 2 - 1) * (RP - 40);
    const v = (r() * 2 - 1) * (RP - 40);
    const [x, y] = iso(u, v);
    const rx = 26 + r() * 40;
    patches.push(<ellipse key={i} cx={f(x)} cy={f(y)} rx={f(rx)} ry={f(rx * 0.42)} fill="#BCD283" opacity={0.6} />);
  }
  const specks = ['', '', ''];
  for (let i = 0; i < 420; i++) {
    const [x, y] = iso((r() * 2 - 1) * (RP - 6), (r() * 2 - 1) * (RP - 6));
    specks[i % 3] += `M${f(x)} ${f(y)}h0`;
  }
  const fields = FIELDS.map(([cu, cv, hu, hv, crop], i) => {
    const a = crop === 'wheat' ? ['#E8C468', '#C98E1F'] : ['#A6C964', '#5E8C3A'];
    let rows = '';
    for (let v = cv - hv + 4; v <= cv + hv - 3; v += 5) rows += `M${pt(cu - hu + 3, v)}L${pt(cu + hu - 3, v)}`;
    return (
      <g key={`f${i}`}>
        <path d={groundSquare(cu, cv, hu, hv)} fill={a[0]} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <path d={rows} fill="none" stroke={a[1]} strokeWidth={1.8} strokeLinecap="round" opacity={0.7} />
      </g>
    );
  });
  return (
    <g className="vv-ground" strokeLinejoin="round">
      <path d={poly([L, F, down(F, D), down(L, D)])} fill="#B07D46" stroke={INK} strokeWidth={2.4} />
      <path d={poly([F, Rt, down(Rt, D), down(F, D)])} fill="#714B29" stroke={INK} strokeWidth={2.4} />
      <path d={poly([B, Rt, F, L])} fill={GRASS} stroke={INK} strokeWidth={2.4} />
      {patches}
      <g fill="none" stroke="#5E8C3A" strokeLinecap="round" opacity={0.5}>
        <path d={specks[0]} strokeWidth={1.8} />
        <path d={specks[1]} strokeWidth={2.6} />
        <path d={specks[2]} strokeWidth={3.4} />
      </g>
      {fields}
    </g>
  );
});

/** A few grass ticks and white flowers on the open grass (Toy Diorama meadow texture). */
const GrassDetail = memo(function GrassDetail() {
  const r = rng(9);
  let ticks = '';
  let blooms = '';
  for (let i = 0; i < 160; i++) {
    const u = (r() * 2 - 1) * (RP - 8);
    const v = (r() * 2 - 1) * (RP - 8);
    if (inSquare(u, v, 2) || onRoad(u, v, 1) || onField(u, v, 2) || PLOTS.some((p) => Math.abs(u - p.u) < p.half && Math.abs(v - p.v) < p.half)) continue;
    const [x, y] = iso(u, v);
    ticks += `M${f(x)} ${f(y)}l-2 -4M${f(x)} ${f(y)}l0 -5M${f(x)} ${f(y)}l2 -4`;
    if (i % 4 === 0) blooms += `M${f(x + 7)} ${f(y + 4)}h0`;
  }
  return (
    <g fill="none" strokeLinecap="round">
      <path d={ticks} stroke="#5E8C3A" strokeWidth={1.5} opacity={0.75} />
      <path d={blooms} stroke="#F7F1E3" strokeWidth={3.4} />
    </g>
  );
});

/** Bold tan paths (ink edge, flat fill, a lighter dashed middle) to the buildings that stand, and the hall square. */
const Paths = memo(function Paths({ built }: { built: string }) {
  const have = new Set(built.split(','));
  const reach = new Map<string, number>();
  PATHS.forEach((p) => {
    if (p.to && !have.has(p.to)) return;
    reach.set(p.key, Infinity);
    const t = TRUNK[p.key];
    const ti = PATHS.findIndex((q) => q.key === t);
    if (t && ti >= 0 && reach.get(t) !== Infinity) {
      const [bu, bv] = p.pts[0]!;
      const at = SAMPLES[ti]!.reduce((best, q) => (Math.hypot(q.u - bu, q.v - bv) < Math.hypot(best.u - bu, best.v - bv) ? q : best));
      reach.set(t, Math.max(reach.get(t) ?? 0, at.s + PATHS[ti]!.w));
    }
  });
  const shown = PATHS.map((p, i) => ({ p, sm: SAMPLES[i]!.filter((q) => q.s <= (reach.get(p.key) ?? -1)) })).filter(({ sm }) => sm.length > 1);
  // Paths stop just inside the plate's edge (the main road runs under the gate, not over the earth side).
  const line = (sm: Sample[]) =>
    `M${sm
      .filter((q) => Math.max(Math.abs(q.u), Math.abs(q.v)) < RP - 9)
      .filter((_, i, all) => i % 2 === 0 || i === all.length - 1)
      .map((q) => pt(q.u, q.v))
      .join('L')}`;
  const sq = (h: number) => groundSquare(HALL.u, HALL.v, h);
  return (
    <g className="vv-paths" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {shown.map(({ p, sm }) => (
        <path key={`e${p.key}`} d={line(sm)} stroke={INK} strokeWidth={p.w * 2.1 + 3.2} />
      ))}
      {shown.map(({ p, sm }) => (
        <path key={`f${p.key}`} d={line(sm)} stroke={PATH_FILL} strokeWidth={p.w * 2.1} />
      ))}
      {shown.map(({ p, sm }) => (
        <path key={`m${p.key}`} d={line(sm)} stroke="#E8D3A4" strokeWidth={p.w * 0.5} strokeDasharray="10 12" opacity={0.8} />
      ))}
      {/* the square under the Town Hall: kerb, light paving, inner ring */}
      <path d={sq(SQUARE + 3)} fill="#CFC6B2" stroke={INK} strokeWidth={1.8} />
      <path d={sq(SQUARE - 7)} fill="#E3DED3" stroke={INK} strokeWidth={1} />
    </g>
  );
});

/**
 * The ground plate with its paths, fields and the hall square. `built`: comma-separated ids of the buildings that
 * stand (or are being built); paths to the others are not drawn, so a new village has no roads to nowhere.
 */
export const Ground = memo(function Ground({ built }: { built: string }) {
  return (
    <>
      <GroundBase />
      <Paths built={built} />
      <GrassDetail />
    </>
  );
});

// ---- Trees, bushes and rocks ---------------------------------------------------------------------------------

type Kind = 'pineA' | 'pineB' | 'oak' | 'bush' | 'rockA' | 'rockB' | 'rockC' | 'stump' | 'logs';
const TALL: ReadonlySet<Kind> = new Set(['pineA', 'pineB', 'oak']);
const RADIUS: Record<Kind, number> = { pineA: 8, pineB: 9, oak: 9, bush: 6, rockA: 8, rockB: 6, rockC: 8, stump: 4, logs: 10 };

/** [kinds, centre u, centre v, spread u, spread v, count, min scale, max scale] — scattered, then filtered by clear(). */
const ZONES: [Kind[], number, number, number, number, number, number, number][] = [
  // Forest around the Lumber Camp in the left corner (owner 2026-11-04: no scattered stumps or log piles; the
  // camp's own sprite carries the neat plank and log stacks).
  [['pineA', 'pineB', 'pineA', 'oak'], -196, 96, 26, 44, 9, 1.35, 1.7],
  [['pineA', 'pineB', 'oak'], -118, 200, 18, 22, 5, 1.35, 1.7],
  [['pineA', 'pineB'], -206, 210, 12, 12, 2, 1.3, 1.5],
  [['bush', 'bush', 'oak'], -130, 130, 22, 22, 3, 1.2, 1.5],
  // Rocks around the Gold Mine (back corner) and the Iron Mine (right corner), with a few pines.
  [['rockA', 'rockC', 'rockB', 'pineB'], -130, -205, 26, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineB'], -205, -120, 14, 30, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineA'], 130, -205, 26, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB'], 205, -125, 14, 28, 4, 1.2, 1.7],
  // Hedges and haystack-like bushes around the fields in front.
  [['bush', 'bush', 'oak'], 208, 150, 10, 30, 4, 1.2, 1.5],
  [['bush', 'oak'], 120, 205, 20, 16, 3, 1.2, 1.5],
  // Lone trees and bushes filling the gaps between the ring and the corners.
  [['oak', 'bush', 'pineB', 'bush', 'oak'], 0, 0, INNER, INNER, 26, 1.2, 1.55],
];

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
      if (!clear(u, v, rad, TALL.has(kind)) || taken(u, v, rad)) continue;
      out.push([kind, f(u), f(v), f(s)]);
      i++;
    }
  }
  // Little bushes and stones along the paths' edges.
  PATHS.forEach((p, pi) => {
    SAMPLES[pi]!.forEach((q, i) => {
      if (q.s < 30 || i % 13 !== 0 || r() < 0.35) return;
      const g = r() < 0.5 ? 1 : -1;
      const kind: Kind = r() < 0.8 ? 'bush' : 'rockB';
      const sc = 0.9 + r() * 0.35;
      const o = g * (p.w * 1.2 + RADIUS[kind] * sc + 2);
      const u = q.u + q.nu * o;
      const v = q.v + q.nv * o;
      const rad = RADIUS[kind] * sc;
      if (clear(u, v, rad, false) && !taken(u, v, rad)) out.push([kind, f(u), f(v), f(sc)]);
    });
  });
  return out;
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
// Stage 1: wooden palisade with timber watchtowers; stage 2: low stone wall with square towers; stage 3: tall stone
// wall with round towers, terracotta roofs and sunflower flags (as the approved building-stages artboard).

type Pt = readonly [number, number];
const WOOD = { top: '#E4B67C', left: '#B07D46', right: '#714B29', pTop: '#B98F5E', pLeft: '#8E6539', pRight: '#5E3F22' };
const STONE = { top: '#E3DED3', left: '#B3ACA0', right: '#7C756B' };
const ROOF = { light: '#EF9C6E', mid: '#C4623A', dark: '#843A23' };
const SUN = '#F2B33D';

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
  o: { courses?: number; sw?: number; band?: { z0: number; z1: number; left: string; right: string } } = {},
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
  return (
    <g key={key} stroke={INK} strokeWidth={o.sw ?? 1.5} strokeLinejoin="round">
      <path d={left} fill={c.left} />
      <path d={right} fill={c.right} />
      <path d={top} fill={c.top} />
      {o.courses && <path d={masonry(u0, u1, v0, v1, z0, z1, o.courses)} fill="none" strokeWidth={0.7} opacity={0.4} />}
      {o.band && (
        <>
          <path
            d={poly([[u0, v1, o.band.z0], [u1, v1, o.band.z0], [u1, v1, o.band.z1], [u0, v1, o.band.z1]])}
            fill={o.band.left}
            strokeWidth={1.1}
          />
          <path
            d={poly([[u1, v1, o.band.z0], [u1, v0, o.band.z0], [u1, v0, o.band.z1], [u1, v1, o.band.z1]])}
            fill={o.band.right}
            strokeWidth={1.1}
          />
        </>
      )}
    </g>
  );
}

/** Stone courses on both visible faces of a box: level joints plus staggered upright joints (one path). */
function masonry(u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, n: number): string {
  const ch = (z1 - z0) / n;
  const js = Math.max(5, ch * 2.4);
  let d = '';
  for (let i = 0; i < n; i++) {
    const za = z0 + ch * i;
    const zb = za + ch;
    if (i > 0) d += `M${pt(u0, v1, za)}L${pt(u1, v1, za)}M${pt(u1, v1, za)}L${pt(u1, v0, za)}`;
    const off = (i % 2) * (js / 2) + js / 2;
    for (let u = u0 + off; u < u1 - 1; u += js) d += `M${pt(u, v1, za)}L${pt(u, v1, zb)}`;
    for (let v = v1 - off; v > v0 + 1; v -= js) d += `M${pt(u1, v, za)}L${pt(u1, v, zb)}`;
  }
  return d;
}

/** Crenellations on both edges of a wall top (the walkway runs between them). `a..b` along the wall, `lo..hi` across. */
function merlonRows(along: 'u' | 'v', a: number, b: number, lo: number, hi: number, z: number, mh: number): ReactNode[] {
  const ml = 3.6;
  const mt = (hi - lo) * 0.34;
  const out: ReactNode[] = [];
  for (let s = a + 1.2; s + ml <= b - 0.6; s += ml * 2) {
    for (const m0 of [lo, hi - mt]) {
      out.push(
        along === 'u'
          ? box(`m${f(s)}-${f(m0)}`, s, s + ml, m0, m0 + mt, z, z + mh, STONE, { sw: 1.2 })
          : box(`m${f(s)}-${f(m0)}`, m0, m0 + mt, s, s + ml, z, z + mh, STONE, { sw: 1.2 }),
      );
    }
  }
  return out;
}

const sp = (list: Pt[]) => list.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');

/** Screen-space iso box (half-width a, height h) on (cx, cy), for the timber towers. */
function isoBox(key: string, cx: number, cy: number, a: number, h: number, c: Colors, sw = 1.5): ReactNode {
  const L: Pt = [cx - a, cy];
  const F: Pt = [cx, cy + a / 2];
  const R: Pt = [cx + a, cy];
  const B: Pt = [cx, cy - a / 2];
  const up = (p: Pt): Pt => [p[0], p[1] - h];
  return (
    <g key={key} stroke={INK} strokeWidth={sw} strokeLinejoin="round">
      <path d={`M${sp([L, F, up(F), up(L)])}Z`} fill={c.left} />
      <path d={`M${sp([F, R, up(R), up(F)])}Z`} fill={c.right} />
      <path d={`M${sp([up(L), up(F), up(R), up(B)])}Z`} fill={c.top} />
    </g>
  );
}

function pyramid(key: string, cx: number, cy: number, a: number, rise: number, c = { top: WOOD.top, left: WOOD.left, right: WOOD.right }): ReactNode {
  const L: Pt = [cx - a, cy];
  const F: Pt = [cx, cy + a / 2];
  const R: Pt = [cx + a, cy];
  const A: Pt = [cx, cy - rise];
  return (
    <g key={key} stroke={INK} strokeWidth={2} strokeLinejoin="round">
      <path d={`M${sp([L, A, F])}Z`} fill={c.left} />
      <path d={`M${sp([R, A, F])}Z`} fill={c.right} />
      <path d={`M${sp([[cx, cy - rise + 7], A, L])}Z`} fill={c.top} />
    </g>
  );
}

/** A sunflower pennant on a pole standing at screen point (x, y). */
function flag(key: string, x: number, y: number, h = 13): ReactNode {
  return (
    <g key={key}>
      <path d={`M${f(x)} ${f(y)}V${f(y - h)}`} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d={`M${f(x + 1)} ${f(y - h)}h11l-3 3.5l3 3.5h-11z`} fill={SUN} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  );
}

/** Round stone tower with a terracotta cone roof (screen space, base centre (cx, cy)). */
function roundTower(cx: number, cy: number, r: number, h: number, rise: number, withFlag: boolean, gallery = false): ReactNode {
  const ry = r / 2;
  const top = cy - h;
  const roofR = r + 2.5;
  return (
    <g stroke={INK} strokeLinejoin="round">
      <path d={`M${f(cx - r)} ${f(top)}V${f(cy)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}Z`} fill={STONE.left} strokeWidth={1.6} />
      <path d={`M${f(cx + 2)} ${f(top + ry)}V${f(cy + ry)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}Z`} fill={STONE.right} strokeWidth={0} />
      <path d={`M${f(cx - r)} ${f(top)}V${f(cy)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}`} fill="none" strokeWidth={1.8} />
      {/* Stone courses round the shaft, and a darker footing ring */}
      <path
        d={[0.2, 0.4, 0.6, 0.8].map((p) => `M${f(cx - r)} ${f(cy - h * p)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy - h * p)}`).join('')}
        fill="none"
        strokeWidth={0.8}
        opacity={0.4}
      />
      <path d={`M${f(cx - r)} ${f(cy - 4)}V${f(cy)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(cy - 4)}A${r} ${ry} 0 0 1 ${f(cx - r)} ${f(cy - 4)}Z`} fill={STONE.right} strokeWidth={1.2} opacity={0.55} />
      {/* Arrow slits on the lit side and a lookout window higher up */}
      <path d={`M${f(cx - r * 0.55)} ${f(top + h * 0.5)}v6M${f(cx - r * 0.1)} ${f(top + h * 0.34)}v7`} strokeWidth={2.4} strokeLinecap="round" />
      <path d={`M${f(cx + r * 0.42)} ${f(top + h * 0.5)}v6`} strokeWidth={2.4} strokeLinecap="round" />
      {/* Corbelled gallery ring under the roof */}
      {gallery && (
        <>
          <path d={`M${f(cx - r - 3.5)} ${f(top)}V${f(top + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}Z`} fill={STONE.left} strokeWidth={1.6} />
          <path d={`M${f(cx + 2)} ${f(top + (r + 3.5) / 2 + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}H${f(cx + 2)}Z`} fill={STONE.right} strokeWidth={0} />
          <path d={`M${f(cx - r - 3.5)} ${f(top)}V${f(top + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}`} fill="none" strokeWidth={1.6} />
        </>
      )}
      <path
        d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx - roofR)} ${f(top)}Z`}
        fill={ROOF.mid}
        strokeWidth={1.8}
      />
      <path d={`M${f(cx + 1)} ${f(top - rise + 2)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx + 1)} ${f(top + roofR / 2)}Z`} fill={ROOF.dark} strokeWidth={0} />
      <path d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx - 3)} ${f(top - rise + 6)}Z`} fill={ROOF.light} strokeWidth={0} />
      <path
        d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx - roofR)} ${f(top)}Z`}
        fill="none"
        strokeWidth={2}
      />
      {withFlag && flag('fl', cx, top - rise, 13)}
    </g>
  );
}

/** Stone tower: square with merlons (stage 2), or round with a terracotta roof (stage 3, when `roof` is set). */
function stoneTower(key: string, cu: number, cv: number, a: number, h: number, o: { roof?: number; flag?: boolean; banner?: 'l' | 'r'; plinth?: number; turret?: boolean }) {
  if (o.roof) {
    // A square footing fills the whole footprint (flush with the plate edge and the walls), the round tower stands on it.
    const pl = o.plinth ?? 0;
    const [x, y] = iso(cu, cv, pl);
    return (
      <g key={key}>
        {pl > 0 && box('pl', cu - a, cu + a, cv - a, cv + a, 0, pl, STONE, { sw: 1.6, courses: Math.max(3, Math.round(pl / 5)), band: { z0: pl - 3.4, z1: pl, left: ROOF.mid, right: ROOF.dark } })}
        {roundTower(x, y, a * 1.3, h, o.roof * 0.8, !!o.flag, true)}
      </g>
    );
  }
  // Tower shaft with stone courses, a slightly wider crown (corbelled top), two arrow slits per visible face.
  const crown = 4;
  const parts: ReactNode[] = [box('b', cu - a, cu + a, cv - a, cv + a, 0, h - crown, STONE, { sw: 1.6, courses: Math.max(3, Math.round(h / 5)) })];
  const sl = (u: number, v: number, z: number) => `M${pt(u, v, z)}L${pt(u, v, z + 6)}`;
  parts.push(
    <path
      key="sl"
      d={[-0.5, 0.5].map((k) => sl(cu + k * a, cv + a, h * 0.4) + sl(cu + a, cv + k * a, h * 0.4)).join('') + sl(cu, cv + a, h * 0.68) + sl(cu + a, cv, h * 0.68)}
      stroke={INK}
      strokeWidth={2.4}
      strokeLinecap="round"
    />,
  );
  const a1 = a + 1;
  parts.push(box('cr', cu - a1, cu + a1, cv - a1, cv + a1, h - crown, h, STONE, { sw: 1.6 }));
  const m = Math.max(2, a1 * 0.26);
  const spots: [number, number][] = [];
  for (const du of [-1, 0, 1]) for (const dv of [-1, 0, 1]) if (du || dv) spots.push([du, dv]);
  spots.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  for (const [du, dv] of spots) {
    const u = cu + du * (a1 - m);
    const v = cv + dv * (a1 - m);
    parts.push(box(`m${du}${dv}`, u - m, u + m, v - m, v + m, h, h + 5, STONE, { sw: 1.2 }));
  }
  let top = h + 5;
  if (o.turret) {
    const at = parts.findIndex((n) => (n as { key?: string }).key === 'cr') + 1;
    const mark = parts.length;
    // A smaller turret with its own battlements crowns the keep.
    const ta = a * 0.5;
    const th = 12;
    parts.push(box('tu', cu - ta, cu + ta, cv - ta, cv + ta, h, h + th, STONE, { sw: 1.5, courses: 2 }));
    const tm = 1.8;
    for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const u = cu + du * (ta - tm);
      const v = cv + dv * (ta - tm);
      parts.push(box(`tm${du}${dv}`, u - tm, u + tm, v - tm, v + tm, h + th, h + th + 3.5, STONE, { sw: 1.1 }));
    }
    top = h + th + 3.5;
    // The turret goes right after the crown, before the front merlons (painter's order).
    parts.splice(at, 0, ...parts.splice(mark));
  }
  if (o.flag) {
    const [x, y] = iso(cu, cv, top);
    parts.push(flag('fl', x, y, o.turret ? 16 : 13));
  }
  return <g key={key}>{parts}</g>;
}

/** Timber watchtower with a pyramid roof (palisade stage), standing on (cu, cv). */
function watchtower(key: string, cu: number, cv: number, half: number) {
  const [cx, cy] = iso(cu, cv);
  // The base fills the whole corner footprint (`half` grid units each way), flush with both plate edges.
  const a = half * 2;
  const h = 36;
  const L: Pt = [cx - a, cy];
  const F: Pt = [cx, cy + a / 2];
  const R: Pt = [cx + a, cy];
  const at = (p: Pt, z: number) => `${f(p[0])} ${f(p[1] - z)}`;
  const mix = (p: Pt, q: Pt, k: number): Pt => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  // Plank joints, an X of cross braces on the lower half, a dark lookout opening under the platform.
  let planks = '';
  for (const z of [10, 20]) planks += `M${at(L, z)}L${at(F, z)}L${at(R, z)}`;
  let braces = `M${at(L, 1)}L${at(F, 19)}M${at(L, 19)}L${at(F, 1)}M${at(F, 1)}L${at(R, 19)}M${at(F, 19)}L${at(R, 1)}`;
  const look = (p: Pt, q: Pt) => `M${at(mix(p, q, 0.28), 23)}L${at(mix(p, q, 0.72), 23)}L${at(mix(p, q, 0.72), 30)}L${at(mix(p, q, 0.28), 30)}Z`;
  return (
    <g key={key}>
      {isoBox('b', cx, cy, a, h, WOOD, 1.6)}
      <path d={planks} fill="none" stroke={INK} strokeWidth={0.8} opacity={0.4} />
      <path d={braces} fill="none" stroke={WOOD.pRight} strokeWidth={1.7} strokeLinecap="round" />
      <path d={look(L, F) + look(F, R)} fill="#3B2A1E" stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      {isoBox('p', cx, cy - h, a + 4, 5, { top: WOOD.pTop, left: WOOD.pLeft, right: WOOD.pRight })}
      {pyramid('r', cx, cy - h - 5, a + 8, 18)}
      <path d={`M${f(cx - 8)} ${f(cy - h - 5 + 2.5)}L${f(cx)} ${f(cy - h - 23)}`} stroke={WOOD.pRight} strokeWidth={1} opacity={0.6} fill="none" />
      {flag('fl', cx, cy - h - 23, 14)}
    </g>
  );
}

/** Timber gate post with a small pyramid cap (palisade stage). */
function gatePost(key: string, cu: number, cv: number, half: number) {
  const [cx, cy] = iso(cu, cv);
  const a = half * 2;
  return (
    <g key={key}>
      {isoBox('b', cx, cy, a, 32, WOOD, 1.4)}
      {pyramid('r', cx, cy - 32, a + 3, 11)}
    </g>
  );
}

/** One run of palisade along an edge: chunky pointed stakes with a rail. */
function palisade(key: string, along: 'u' | 'v', c: number, a: number, b: number, hs: number): ReactNode {
  const P = (s: number, dc = 0): Pt => {
    const [x, y] = along === 'u' ? iso(s, c + dc) : iso(c + dc, s);
    return [x, y + 1];
  };
  const step = 3.6;
  const xs: number[] = [];
  for (let s = a + 1.5; s <= b - 1.5; s += step) xs.push(s);
  // Stakes of uneven height (a repeating pattern, so every chunk matches its neighbours), pointed tops.
  const ups = [1, 0.9, 1.07, 0.96, 1.03];
  const stake = (s: number, dc: number, back: boolean) => {
    const [x, y] = P(s, dc);
    const hh = (back ? 25 : 21) * hs * (ups[Math.abs(Math.round(s / step)) % ups.length] ?? 1);
    const tip = hh + 6.1 * hs;
    const x0 = x - 3.4;
    return (
      <g key={`${back ? 'k' : 'q'}${f(s)}`}>
        <path
          d={`M${f(x0)} ${f(y)}V${f(y - hh)}L${f(x)} ${f(y - tip)}L${f(x0 + 6.8)} ${f(y - hh)}V${f(y)}Z`}
          fill={back ? WOOD.pLeft : WOOD.left}
          stroke={INK}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path d={`M${f(x + 0.8)} ${f(y - 1)}V${f(y - hh)}H${f(x + 2.6)}V${f(y - 1)}Z`} fill={back ? WOOD.pRight : WOOD.right} />
      </g>
    );
  };
  // A second, taller row stands half a step behind, so there is no gap to see through.
  const back = xs.map((s) => stake(s + step / 2, -1.6, true));
  const front = xs.map((s) => stake(s, 0, false));
  const first = P(xs[0] ?? a);
  const last = P(xs[xs.length - 1] ?? b);
  const rail = (z: number) => `M${f(first[0])} ${f(first[1] - z * hs)}L${f(last[0])} ${f(last[1] - z * hs)}`;
  return (
    <g key={key}>
      {back}
      {front}
      <path d={rail(15) + rail(6)} fill="none" stroke={WOOD.pRight} strokeWidth={2.2} strokeLinecap="round" />
      <path d={rail(15.9) + rail(6.9)} fill="none" stroke={WOOD.top} strokeWidth={0.8} strokeLinecap="round" opacity={0.8} />
    </g>
  );
}

/** One run of stone wall along an edge, with merlons on its outer side. `outer` is +1 when the outer side is +v/+u. */
function stoneRun(key: string, along: 'u' | 'v', c: number, a: number, b: number, h: number, t: number, stage: 2 | 3): ReactNode {
  const lo = c - t / 2;
  const hi = c + t / 2;
  // Stage 3 wears a terracotta tile cap under the battlements.
  const opts = {
    courses: Math.max(2, Math.round(h / 5)),
    band: stage === 3 ? { z0: h - 3.4, z1: h, left: ROOF.mid, right: ROOF.dark } : undefined,
  };
  const body = along === 'u' ? box('w', a, b, lo, hi, 0, h, STONE, opts) : box('w', lo, hi, a, b, 0, h, STONE, opts);
  // Arrow slits on the visible long face of walls tall enough to hold them.
  let slits = '';
  if (h >= 14) {
    for (let s = a + 6; s < b - 2; s += 12) slits += along === 'u' ? `M${pt(s, hi, h * 0.4)}L${pt(s, hi, h * 0.4 + 5)}` : `M${pt(hi, s, h * 0.4)}L${pt(hi, s, h * 0.4 + 5)}`;
  }
  return (
    <g key={key}>
      {body}
      {slits && <path d={slits} stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />}
      {merlonRows(along, a, b, lo, hi, h, stage === 3 ? 5 : 4.2)}
    </g>
  );
}

/** Colours and line weights of the gate doors (Toy Diorama). */
const G = { sw: 1.5, merlonSw: 1.2, wood: '#B07D46', plank: '#714B29', lit: '#E4B67C', iron: '#4A4440', band: 2, stud: 0.75, studFill: '#E3DED3', bar: '#8E6539', lock: '#F2B33D', arch: '#7C756B' };
/** A terracotta banner with a sunflower flame hanging on the gatehouse face (plane v = cv). */
function gateBanner(key: string, cu: number, cv: number, ztop: number): ReactNode {
  const w = 3.2;
  const hh = 10;
  const d = poly([[cu - w, cv, ztop], [cu + w, cv, ztop], [cu + w, cv, ztop - hh], [cu, cv, ztop - hh + 3], [cu - w, cv, ztop - hh]]);
  const [x, y] = iso(cu, cv, ztop - hh / 2 + 1);
  return (
    <g key={key}>
      <path d={d} fill="#C4623A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={`M${f(x)} ${f(y + 2)}q-1.8 -1.4 0 -4.2q1.8 2.8 0 4.2Z`} fill={SUN} stroke={INK} strokeWidth={0.6} />
    </g>
  );
}
/** The closed main gate between the gate towers: wooden double doors with iron bands, studs, a crossbar and a lock. */
function closedGate(key: string, stage: Exclude<Stage, 0>, c: number, t: number): ReactNode {
  const u0 = GATE_U - GATE_W;
  const u1 = GATE_U + GATE_W;
  const stone = stage > 1;
  const V = stone ? c + t / 2 : c + 1;
  const Hd = stage === 1 ? 19 : stage === 2 ? 13 : 19;
  const rise = stone ? 4 : 0;
  // The gatehouse stands clearly taller than the (low) front wall beside it.
  const top = stage === 1 ? 0 : stage === 2 ? 22 : 35;
  const a = u0 + (stone ? 2 : 0.5);
  const b = u1 - (stone ? 2 : 0.5);
  const q = (u: number, z: number) => pt(u, V, z);
  const parts: ReactNode[] = [];
  if (stone) {
    // Gatehouse block over the opening, with merlons on the outer side.
    parts.push(
      box('gh', u0, u1, c - t / 2, c + t / 2, 0, top, STONE, {
        courses: Math.round(top / 5),
        band: stage === 3 ? { z0: top - 3.4, z1: top, left: ROOF.mid, right: ROOF.dark } : undefined,
      }),
    );
    parts.push(...merlonRows('u', u0, u1, c - t / 2, c + t / 2, top, stage === 3 ? 5 : 4.2));
  }
  // Door outline: straight sides, arched (stone) or stake-pointed (timber) top.
  const n = 12;
  const topAt = (u: number) => {
    if (stone) return Hd + rise * Math.sin((Math.PI * (u - a)) / (b - a));
    const k = Math.floor((u - a) / 3.4);
    const m = a + k * 3.4 + 1.7;
    return Hd + 3 - Math.abs(u - m) * 1.6;
  };
  const arc: string[] = [];
  if (stone) for (let i = n; i >= 0; i--) arc.push(q(a + ((b - a) * i) / n, topAt(a + ((b - a) * i) / n)));
  else for (let u = b; u >= a - 0.01; u -= 0.85) arc.push(q(u, topAt(u)));
  const door = `M${q(a, 0)}L${q(b, 0)}L${arc.join('L')}Z`;
  if (stone) {
    // Dark recess and a ring of arch stones around the doors.
    const ring: string[] = [];
    for (let i = 0; i <= n; i++) ring.push(q(a - 1.6 + ((b - a + 3.2) * i) / n, Hd + 1.6 + (rise + 1) * Math.sin((Math.PI * i) / n)));
    parts.push(<path key="ar" d={`M${q(a - 1.6, 0)}L${ring.join('L')}L${q(b + 1.6, 0)}Z`} fill={G.arch} stroke={INK} strokeWidth={G.sw} strokeLinejoin="round" />);
  }
  parts.push(<path key="dr" d={door} fill={G.wood} stroke={INK} strokeWidth={G.sw} strokeLinejoin="round" />);
  // Planks and the split between the two leaves.
  let planks = '';
  for (let u = a + 3; u < b - 1; u += 3) planks += `M${q(u, 0.4)}L${q(u, topAt(u) - 0.6)}`;
  parts.push(<path key="pl" d={planks} stroke={G.plank} strokeWidth={0.7} fill="none" />);
  parts.push(<path key="lit" d={`M${q(a + 1, 0.6)}L${q(a + 1, topAt(a + 1) - 0.8)}`} stroke={G.lit} strokeWidth={0.9} fill="none" />);
  parts.push(<path key="sp" d={`M${q(GATE_U, 0)}L${q(GATE_U, topAt(GATE_U))}`} stroke={INK} strokeWidth={G.sw} fill="none" />);
  // Iron bands with studs.
  const studs: ReactNode[] = [];
  let bands = '';
  for (const zb of [Hd * 0.22, Hd * 0.74]) {
    bands += `M${q(a + 0.4, zb)}L${q(b - 0.4, zb)}`;
    for (let u = a + 1.6; u < b - 1; u += 3.2) {
      const [x, y] = iso(u, V, zb);
      studs.push(<circle key={`s${f(u)}-${f(zb)}`} cx={f(x)} cy={f(y)} r={G.stud} fill={G.studFill} stroke={INK} strokeWidth={0.3} />);
    }
  }
  parts.push(<path key="bd" d={bands} stroke={G.iron} strokeWidth={G.band} strokeLinecap="round" fill="none" />);
  parts.push(...studs);
  // Crossbar in iron brackets, and a big padlock hanging from it.
  const zc = Hd * 0.47;
  parts.push(
    <path key="cb" d={`M${q(a - 0.6, zc - 1.5)}L${q(b + 0.6, zc - 1.5)}L${q(b + 0.6, zc + 1.5)}L${q(a - 0.6, zc + 1.5)}Z`} fill={G.bar} stroke={INK} strokeWidth={G.sw * 0.8} strokeLinejoin="round" />,
  );
  let brackets = '';
  for (const u of [a + 3, b - 3]) brackets += `M${q(u - 0.8, zc - 2.3)}L${q(u - 0.8, zc + 2.3)}M${q(u + 0.8, zc - 2.3)}L${q(u + 0.8, zc + 2.3)}`;
  parts.push(<path key="bk" d={brackets} stroke={G.iron} strokeWidth={1.1} fill="none" />);
  const [lx, ly] = iso(GATE_U, V, zc - 1.6);
  parts.push(
    <g key="lk" strokeLinejoin="round">
      <path d={`M${f(lx - 2.2)} ${f(ly + 0.3)}v-3a2.2 2.2 0 0 1 4.4 0v3`} fill="none" stroke={G.iron} strokeWidth={1.4} />
      <rect x={f(lx - 3.6)} y={f(ly)} width={7.2} height={6} rx={1} fill={G.lock} stroke={INK} strokeWidth={G.sw * 0.8} />
      <circle cx={f(lx)} cy={f(ly + 2.4)} r={0.8} fill={INK} />
      <path d={`M${f(lx)} ${f(ly + 2.8)}v1.8`} stroke={INK} strokeWidth={0.8} />
    </g>,
  );
  if (stage === 1) {
    // Timber lintel across the posts.
    parts.push(box('ln', u0 - 2, u1 + 2, c - 1.2, c + 1.2, Hd + 4, Hd + 7, { top: G.lit, left: G.wood, right: G.plank }, { sw: G.sw }));
  }
  if (stage === 3) parts.push(gateBanner('gb', GATE_U, V, top - 2.5));
  return <g key={key}>{parts}</g>;
}

interface Edge {
  name: string;
  /** Runs along u (at v = c) or along v (at u = c). */
  along: 'u' | 'v';
  c: number;
}

/** The four walls, each on the plate's edge with its outer face flush with the border (`c` is the wall's middle line). */
function edges(t: number): Edge[] {
  // Flush with the plate's edge: no ground left outside the wall, no gap under it.
  const c = RP - t / 2;
  return [
    { name: 'back-right', along: 'u', c: -c },
    { name: 'back-left', along: 'v', c: -c },
    { name: 'front-left', along: 'u', c },
    { name: 'front-right', along: 'v', c },
  ];
}

/** Screen depth of the front-most ground point of a run piece. */
function runDepth(e: Edge, s1: number, t: number): number {
  return e.along === 'u' ? iso(s1, e.c + t / 2)[1] : iso(e.c + t / 2, s1)[1];
}

const wallCache = new Map<number, DepthItem[]>();

/** Painter-sorted pieces of the ring wall for a stage (1–3): corner towers, four walls, one gate on the main road. */
export function wallItems(stage: Exclude<Stage, 0>): DepthItem[] {
  const hit = wallCache.get(stage);
  if (hit) return hit;
  const items: DepthItem[] = [];
  // Half-size of the corner towers' footprint (towers stand inside the corner, flush with both edges).
  const corner = stage === 1 ? 9 : stage === 2 ? 13 : 16;
  const post = stage === 1 ? 3 : stage === 2 ? 8 : 10;
  const t = stage === 1 ? 2 : stage === 2 ? 7 : 9;
  // The two walls facing the camera stay low so the village inside shows over them; the two far walls stand tall.
  const hBack = stage === 2 ? 18 : 30;
  const hFront = stage === 2 ? 9 : 16;
  const chunk = 24;
  // Gate towers a third bigger than before, so the gate reads as the village's front door.
  const gpost = Math.round(post * 1.3);
  const end = RP - 2 * corner + 1;

  for (const e of edges(t)) {
    const near = e.c > 0;
    const h = near ? hFront : hBack;
    const gate = e.name === 'front-left';
    const runs: [number, number][] = gate
      ? [
          [-end, GATE_U - GATE_W - gpost],
          [GATE_U + GATE_W + gpost, end],
        ]
      : [[-end, end]];
    for (const [a0, b0] of runs) {
      for (let a = a0; a < b0 - 0.5; a += chunk) {
        const b = Math.min(b0, a + chunk);
        const node = stage === 1 ? palisade('p', e.along, e.c, a, b, near ? 0.72 : 1) : stoneRun('s', e.along, e.c, a, b, h, t, stage);
        items.push({ key: `w-${e.name}-${f(a)}`, depth: runDepth(e, b, t), node });
      }
    }
    if (!gate) continue;
    // The closed gate, then the gate towers (or posts) on both sides of it.
    items.push({ key: 'gate', depth: iso(GATE_U + GATE_W, e.c + t / 2)[1], node: closedGate('gate', stage, e.c, t) });
    for (const side of [-1, 1] as const) {
      const u = GATE_U + side * (GATE_W + gpost);
      const v = RP - Math.max(gpost, t / 2 + 0.3);
      const node =
        stage === 1
          ? gatePost('g', u, v, gpost)
          : stoneTower('g', u, v, gpost, stage === 2 ? 34 : 22, {
              roof: stage === 3 ? 20 : undefined,
              plinth: stage === 3 ? 30 : undefined,
              banner: stage >= 2 ? 'l' : undefined,
              flag: stage === 2,
            });
      items.push({ key: `g-${side}`, depth: iso(u + gpost, v + gpost)[1], node });
    }
  }
  const k = RP - corner;
  const corners: [number, number][] = [
    [-k, -k],
    [k, -k],
    [-k, k],
    [k, k],
  ];
  corners.forEach(([u, v], i) => {
    const node =
      stage === 1
        ? watchtower(`c${i}`, u, v, corner)
        : stoneTower(`c${i}`, u, v, corner, stage === 2 ? 38 : 32, {
            roof: stage === 3 ? 30 : undefined,
            plinth: stage === 3 ? 30 : undefined,
            turret: stage === 2,
            flag: true,
          });
    items.push({ key: `c${i}`, depth: iso(u + corner, v + corner)[1], node });
  });
  wallCache.set(stage, items);
  return items;
}
