// Village scene scenery in style D (Toy Diorama, like the approved village artboard): a chunky ground plate with thick
// warm-ink outlines, bold tan paths to the buildings that stand, a paved square under the Town Hall, toy trees and rocks,
// and the ring wall on the plate's edge drawn by its stage (palisade, stone, towers with terracotta roofs and flags).
// Flat 3-tone block shading lit from the top left. Laid out on the isometric grid from ./buildings.ts (iso(u, v, z)).

import { memo } from 'react';
import type { ReactNode } from 'react';
import { T } from './Icon.tsx';
import type { BuildingId } from '@clanfire/engine';
import { BRANCH_W, LAND_Z, OUTER_ROADS, OUTSIDE, PLACEMENT, SIDE_STREET_W, STREET_W, WALL_RING, doorUV, iso, plotUV, roadEnd } from './buildings.ts';
import type { RoadDef } from './buildings.ts';

export interface DepthItem {
  key: string;
  depth: number;
  node: ReactNode;
}

const INK = '#2B211C';
const { cx: CX, cy: CY, plate: RP } = WALL_RING;

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
  id: BuildingId;
  u: number;
  v: number;
  /** Half-side of the plot's pad plus a margin. */
  half: number;
  x: number;
  y: number;
  hw: number;
  /** Stands outside the wall, on the land. */
  out: boolean;
}

const PLOTS: Plot[] = (Object.keys(PLACEMENT) as BuildingId[])
  .filter((id) => id !== 'wall')
  .map((id) => {
    const p = PLACEMENT[id];
    const { u, v } = plotUV(id);
    return { id, u, v, half: 31 * p.scale, x: p.x, y: p.y + 26 * p.scale, hw: 56 * p.scale, out: OUTSIDE.has(id) };
  });

const HALL = PLOTS.find((p) => p.id === 'hall')!;

// ---- Paths ----------------------------------------------------------------------------------------------------
// One street network on the ground. The layout (and the layout test) works on a skeleton in grid directions: the main street
// runs from the gate straight along u = GATE_U to the hall square, as wide as the road outside the walls (which leaves the gate
// along the same line), and a branch runs from it or from the square to the door of EVERY building, ending at the middle of
// its front-left face (where the doors are). The four front buildings hang off one lane just inside the gate, the Drill Yard,
// the Barracks and the Farm off the high street across the front of the square, the Storehouse off the square's right side,
// the back buildings off the back of the square. A branch shows only once its building exists (built or queued), so no road
// leads nowhere.
// How it is DRAWN: see "Street drawing" below (surfaces by building look, rounded bends, sway on the earth roads).

export type PathDef = RoadDef;
export { STREET_W, SQUARE };

/** The ink edge round a path (grid units). Matches the road tile's. */
const EDGE = 3.2;
const { gateU: GATE_U } = WALL_RING;
/** The lane just inside the gate (v). */
const LANE_V = 276;
/** Out of the square: to the left past the Drill Yard (v), to the right to the Farm (v), and the bend of the right-hand back road (u). */
const SIDE_L = 84;
const SIDE_R = 60;
const EAST_U = 130;
/** The back road behind the Barracks to the Gold Mine and the Vault (v). */
const BACK_V = -93;

/** A branch along the corner points `via`, then along u to the building and along v to its door. */
const branch = (to: BuildingId, ...via: [number, number][]): PathDef => {
  const d = doorUV(to);
  const last = via[via.length - 1]!;
  const turn: [number, number][] = Math.abs(last[0] - d.u) < 0.01 ? [] : [[d.u, last[1]]];
  return { key: to, to, w: BRANCH_W, pts: [...via, ...turn, [d.u, d.v]] };
};
/** A branch along the lane just inside the gate (a little wider). */
const lane = (to: BuildingId): PathDef => ({ ...branch(to, [GATE_U, LANE_V]), w: SIDE_STREET_W });
const BACK = HALL.v - SQUARE + 6;
const SQ_R = HALL.u + SQUARE - 6;
const SQ_L = HALL.u - SQUARE + 6;

export const PATHS: PathDef[] = [
  // The gate to the middle of the square, straight (the outside road continues it).
  { key: 'main', to: null, w: STREET_W, pts: [[GATE_U, RP + 6], [GATE_U, HALL.v + SQUARE - 30]] },
  // Along the lane just inside the gate.
  lane('market'),
  lane('wrightyard'),
  lane('lumber'),
  lane('longhouse'),
  // Out of the sides of the square.
  branch('drillyard', [SQ_L, SIDE_L]),
  branch('barracks', [SQ_L, SIDE_L]),
  branch('farm', [SQ_R, SIDE_R]),
  // Out of the back of the square: the Banner Hall and the Stables straight up, the others round them.
  branch('bannerhall', [GATE_U, BACK]),
  branch('stables', [doorUV('stables').u, BACK]),
  branch('storehouse', [SQ_R, -20], [EAST_U, -20], [EAST_U, -54]),
  branch('mine', [SQ_R, -20], [EAST_U, -20], [EAST_U, -165]),
  branch('vault', [SQ_L, -20], [SQ_L, BACK_V]),
  branch('goldmine', [SQ_L, -20], [SQ_L, BACK_V]),
];

interface Sample {
  u: number;
  v: number;
  /** Unit normal in grid units. */
  nu: number;
  nv: number;
  /** Distance along the path. */
  s: number;
}

/** Points about every 2.5 grid units along the corner list, with the left-hand normal of each leg. */
function samplePath(pts: PathDef['pts']): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, v0] = pts[i]!;
    const [u1, v1] = pts[i + 1]!;
    const len = Math.hypot(u1 - u0, v1 - v0);
    const n = Math.max(1, Math.ceil(len / 2.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ u: u0 + (u1 - u0) * t, v: v0 + (v1 - v0) * t, nu: -(v1 - v0) / len, nv: (u1 - u0) / len, s: s + len * t });
    }
    s += len;
  }
  const [lu, lv] = pts[pts.length - 1]!;
  const last = out[out.length - 1]!;
  out.push({ u: lu, v: lv, nu: last.nu, nv: last.nv, s });
  return out;
}

const SAMPLES = PATHS.map((p) => samplePath(p.pts));

const onRoad = (u: number, v: number, pad: number) =>
  PATHS.some((p, i) => SAMPLES[i]!.some((q) => Math.hypot(q.u - u, q.v - v) < p.w + pad + 1.5));

/** Crop fields: wheat beside the Farm, a vegetable plot by the Storehouse. [centre u, centre v, half u, half v, crop]. */
const FIELDS: [number, number, number, number, 'wheat' | 'greens'][] = [
  [264, 66, 14, 22, 'wheat'],
  [190, -50, 18, 12, 'greens'],
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
/** Building pads: a calmer, lighter grass with a soft darker edge. */
const PAD_FILL = '#B9D27A';
const PAD_EDGE = '#7FA650';

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

/** Draws road bands (ink edge, flat fill, a lighter dashed middle) in grid units through the iso projection at height z. */
function roadBands(list: readonly PathDef[], z: number, keyPrefix: string): ReactNode {
  // Drawn in grid units (u, v) through the same projection as iso(), so a path is exactly as wide in the ground as it says.
  const line = (p: PathDef) => `M${p.pts.map(([u, v]) => `${u} ${v}`).join('L')}`;
  return (
    <g transform={`matrix(1 0.5 -1 0.5 ${CX} ${CY - z})`}>
      {list.map((p) => (
        <path key={`${keyPrefix}e${p.key}`} d={line(p)} stroke={INK} strokeWidth={p.w * 2 + EDGE * 2} />
      ))}
      {list.map((p) => (
        <path key={`${keyPrefix}f${p.key}`} d={line(p)} stroke={PATH_FILL} strokeWidth={p.w * 2} />
      ))}
      {list.map((p) => (
        <path key={`${keyPrefix}m${p.key}`} d={line(p)} stroke="#E8D3A4" strokeWidth={p.w * 0.5} strokeDasharray="9 11" strokeLinecap="butt" opacity={0.8} />
      ))}
    </g>
  );
}

/** A plot's pad: a calm lot of packed grass under the building, with a soft edge, so each building reads on its own ground. */
function pad(p: Plot, z: number): ReactNode {
  const h = 28 * PLACEMENT[p.id].scale + 4;
  const sq = poly([
    [p.u - h, p.v - h, z],
    [p.u + h, p.v - h, z],
    [p.u + h, p.v + h, z],
    [p.u - h, p.v + h, z],
  ]);
  return <path key={`pad-${p.id}`} d={sq} fill={PAD_FILL} stroke={PAD_EDGE} strokeWidth={1.6} strokeLinejoin="round" />;
}

/** Roads and pads outside the wall (drawn under the plate, on the land). */
const OuterGround = memo(function OuterGround({ built }: { built: string }) {
  const have = new Set(built.split(','));
  return (
    <g className="vv-paths vv-outer" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {PLOTS.filter((p) => p.out && have.has(p.id)).map((p) => pad(p, LAND_Z))}
      {roadBands(
        OUTER_ROADS.filter((p) => !p.to || have.has(p.to)),
        LAND_Z,
        'o',
      )}
    </g>
  );
});

// ---- Street drawing ------------------------------------------------------------------------------------------
// Everything flat on the ground is drawn in grid units (u, v) under the iso matrix, so a stone is a true iso tile; grass
// tufts are dotted on in screen units. Each road's surface follows the look (stage) of the building it leads to (owner
// 2026-11-11): 1 dirt with wheel ruts and pebbles, 2 gravel with edge stones, 3 cobbles, 4 flagstones with kerbs. A stretch
// that several branches share takes the best surface among them; the main street and the plaza follow the Town Hall. All of
// it sits in the still backdrop layer: a few dozen path elements, redrawn only when a look changes.
// Joins: every ink edge is drawn before any surface, so where roads meet there is no ink inside the crossing; a lower surface
// gives way to a higher one (round end under it), and the stone patterns stop short of a crossing, which shows as one slab.

export type Surface = 1 | 2 | 3 | 4;
type P2 = readonly [number, number];
const GROUND_T = `matrix(1 0.5 -1 0.5 ${CX} ${CY})`;
const g1 = (n: number) => Math.round(n * 10) / 10;
/** Corner and end points of every path: the sway fades to nothing at them, so roads sharing a stretch draw it identically. */
const NODES: readonly P2[] = PATHS.flatMap((p) => p.pts);
/** How far a road may sway off its skeleton (grid units; the layout test keeps every road edge clear by more), its bend radius, its ink edge. */
const SWAY: Record<Surface, number> = { 1: 2.6, 2: 1.6, 3: 0, 4: 0 };
const BEND: Record<Surface, number> = { 1: 18, 2: 16, 3: 10, 4: 9 };
const EDGE_W: Record<Surface, number> = { 1: 2.3, 2: 2.6, 3: 2.9, 4: 3.1 };
const FILL: Record<Surface, string> = { 1: '#D4AF7A', 2: '#CDBD9C', 3: '#C9C1B1', 4: '#DDD7CA' };

/** Sideways sway of a road at (u, v) on a leg along u (`alongU`) or along v. Smooth, zero at every node. */
function swayAt(u: number, v: number, alongU: boolean, amp: number): number {
  if (!amp) return 0;
  let d = 60;
  for (const [nu, nv] of NODES) {
    if (alongU ? Math.abs(nv - v) < 0.5 : Math.abs(nu - u) < 0.5) d = Math.min(d, Math.abs(alongU ? nu - u : nv - v));
  }
  const e = Math.min(1, d / 30);
  const env = e * e * (3 - 2 * e);
  const t = alongU ? u : v;
  const ph = (alongU ? v : u) * 0.173;
  return amp * env * (0.7 * Math.sin(t / 21 + ph) + 0.3 * Math.sin(t / 9.5 + ph * 2.1));
}

/** The drawn centreline through corner points `pts`: rounded bends (radius up to `rmax`) and the sway on the straight runs. */
function drawnLine(pts: readonly P2[], amp: number, rmax: number): string {
  let d = '';
  const legLen = (i: number) => Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  const rad = (k: number) => (k <= 0 || k >= pts.length - 1 ? 0 : Math.min(rmax, legLen(k - 1) / 2, legLen(k) / 2));
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, v0] = pts[i]!;
    const [u1, v1] = pts[i + 1]!;
    const len = legLen(i);
    if (len < 0.01) continue;
    const du = (u1 - u0) / len;
    const dv = (v1 - v0) / len;
    const alongU = Math.abs(du) > 0.5;
    const a = rad(i);
    const b = rad(i + 1);
    const n = amp ? Math.max(1, Math.ceil((len - a - b) / 3)) : 1;
    for (let k = 0; k <= n; k++) {
      const t = a + ((len - a - b) * k) / n;
      const u = u0 + du * t;
      const v = v0 + dv * t;
      const w = swayAt(u, v, alongU, amp);
      d += `${d ? 'L' : 'M'}${g1(alongU ? u : u + w)} ${g1(alongU ? v + w : v)}`;
    }
    if (b > 0) {
      const [u2, v2] = pts[i + 2]!;
      const l2 = Math.hypot(u2 - u1, v2 - v1);
      d += `Q${g1(u1)} ${g1(v1)} ${g1(u1 + ((u2 - u1) / l2) * b)} ${g1(v1 + ((v2 - v1) / l2) * b)}`;
    }
  }
  return d;
}

/** A tile with chamfered corners, u0..u1 by v0..v1 in grid units. */
function tile(u0: number, v0: number, u1: number, v1: number, c: number): string {
  return `M${g1(u0 + c)} ${g1(v0)}H${g1(u1 - c)}L${g1(u1)} ${g1(v0 + c)}V${g1(v1 - c)}L${g1(u1 - c)} ${g1(v1)}H${g1(u0 + c)}L${g1(u0)} ${g1(v1 - c)}V${g1(v0 + c)}Z`;
}
/** The lit back edges (-u, -v) and the shaded front edges (+u, +v) of a tile: chunky toy paving lit from the top left. */
const tileLit = (u0: number, v0: number, u1: number, v1: number, c: number) =>
  `M${g1(u0)} ${g1(v1 - c)}V${g1(v0 + c)}L${g1(u0 + c)} ${g1(v0)}H${g1(u1 - c)}`;
const tileShade = (u0: number, v0: number, u1: number, v1: number, c: number) =>
  `M${g1(u1)} ${g1(v0 + c)}V${g1(v1 - c)}L${g1(u1 - c)} ${g1(v1)}H${g1(u0 + c)}`;
const dot = (u: number, v: number) => `M${g1(u)} ${g1(v)}h0`;

/** Surface stage per building from the `built` key: "id" (look 1) or "id:look", comma-separated. */
export function roadStages(built: string): Map<string, Surface> {
  const m = new Map<string, Surface>();
  for (const part of built.split(',')) {
    if (!part) continue;
    const [id, st] = part.split(':');
    m.set(id!, Math.min(4, Math.max(1, Number(st) || 1)) as Surface);
  }
  return m;
}

/** A straight piece of road between two nodes, with its surface and half width. */
interface Seg {
  a: P2;
  b: P2;
  w: number;
  s: Surface;
}
/** A run of one path on one surface, drawn as one line; `capA` / `capB`: round end (else square, under a better surface). */
interface Run {
  pts: P2[];
  w: number;
  s: Surface;
  capA: boolean;
  capB: boolean;
  /** Ends at a door: square end with a doorstep, in under the drawing. */
  door: boolean;
}
interface Net {
  segs: Seg[];
  runs: Run[];
  /** Number of road pieces meeting at a node ("u,v"). */
  deg: Map<string, number>;
  /** Door ends. */
  doors: Set<string>;
}

const pk = (p: P2) => `${g1(p[0])},${g1(p[1])}`;
const inside = (n: P2, a: P2, b: P2) =>
  a[0] === b[0]
    ? Math.abs(n[0] - a[0]) < 0.01 && n[1] > Math.min(a[1], b[1]) + 0.01 && n[1] < Math.max(a[1], b[1]) - 0.01
    : Math.abs(n[1] - a[1]) < 0.01 && n[0] > Math.min(a[0], b[0]) + 0.01 && n[0] < Math.max(a[0], b[0]) - 0.01;

const NETS = new Map<string, Net>();
/** The road network of the buildings in `built`, split at every node, each piece on the best surface that uses it. */
export function network(built: string): Net {
  const hit = NETS.get(built);
  if (hit) return hit;
  const st = roadStages(built);
  // Each road runs on to where its building's drawing begins at the building's look (roadEnd), not just to the pad edge.
  const shown = PATHS.filter((p) => p.to && st.has(p.to)).map((p) => {
    const e = roadEnd(p.to!, st.get(p.to!)!);
    return { ...p, pts: [...p.pts.slice(0, -1), [e.u, e.v] as const] };
  });
  const nodes: P2[] = shown.flatMap((p) => p.pts);
  const pieces = shown.map((p) => {
    const parts: { a: P2; b: P2; key: string }[] = [];
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i]!;
      const b = p.pts[i + 1]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) continue;
      const cuts = nodes.filter((n) => inside(n, a, b)).sort((m, n) => Math.hypot(m[0] - a[0], m[1] - a[1]) - Math.hypot(n[0] - a[0], n[1] - a[1]));
      const chain: P2[] = [a];
      for (const c of cuts) if (pk(c) !== pk(chain[chain.length - 1]!)) chain.push(c);
      chain.push(b);
      for (let k = 0; k < chain.length - 1; k++) {
        const x = chain[k]!;
        const y = chain[k + 1]!;
        parts.push({ a: x, b: y, key: [pk(x), pk(y)].sort().join('|') });
      }
    }
    return { p, s: st.get(p.to!)!, parts };
  });
  const segS = new Map<string, Surface>();
  const segW = new Map<string, number>();
  const segAB = new Map<string, [P2, P2]>();
  for (const { p, s, parts } of pieces)
    for (const q of parts) {
      segS.set(q.key, Math.max(segS.get(q.key) ?? 1, s) as Surface);
      segW.set(q.key, Math.max(segW.get(q.key) ?? 0, p.w));
      segAB.set(q.key, [q.a, q.b]);
    }
  const deg = new Map<string, number>();
  const segs: Seg[] = [];
  for (const [key, [a, b]] of segAB) {
    segs.push({ a, b, w: segW.get(key)!, s: segS.get(key)! });
    for (const n of [a, b]) deg.set(pk(n), (deg.get(pk(n)) ?? 0) + 1);
  }
  const runs: Run[] = [];
  const seen = new Set<string>();
  for (const { parts } of pieces) {
    const list = parts.map((q) => ({ ...q, s: segS.get(q.key)!, w: segW.get(q.key)! }));
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && list[j + 1]!.s === list[i]!.s && list[j + 1]!.w === list[i]!.w) j++;
      const pts: P2[] = [list[i]!.a, ...list.slice(i, j + 1).map((q) => q.b)];
      // Drop the in-between nodes on a straight line, so bends are rounded only where the road really turns.
      const clean: P2[] = [pts[0]!];
      for (let k = 1; k < pts.length - 1; k++) {
        const [x, y, z] = [clean[clean.length - 1]!, pts[k]!, pts[k + 1]!];
        if (!((x[0] === y[0] && y[0] === z[0]) || (x[1] === y[1] && y[1] === z[1]))) clean.push(y);
      }
      clean.push(pts[pts.length - 1]!);
      const before = list[i - 1];
      const after = list[j + 1];
      const run: Run = {
        pts: clean,
        w: list[i]!.w,
        s: list[i]!.s,
        capA: !before || before.s > list[i]!.s || before.w > list[i]!.w,
        capB: !after || after.s > list[i]!.s || after.w > list[i]!.w,
        door: !after,
      };
      const key = `${run.pts.map(pk).join(';')}/${run.s}/${run.w}/${run.capA}/${run.capB}/${run.door}`;
      if (!seen.has(key)) {
        seen.add(key);
        runs.push(run);
      }
      i = j + 1;
    }
  }
  const net: Net = { segs, runs, deg, doors: new Set(shown.map((p) => pk(p.pts[p.pts.length - 1]!))) };
  NETS.set(built, net);
  return net;
}

/** Texture strings per surface (grid units, except `tufts` in screen units). */
interface Tex {
  ruts: string;
  pebD: string;
  pebL: string;
  tufts: string;
  spk: [string, string, string];
  edgeInk: string;
  edgeStone: string;
  setA: string;
  setB: string;
  flagA: string;
  flagB: string;
  lit: string;
  shade: string;
  kerb: string;
}
const emptyTex = (): Tex => ({ ruts: '', pebD: '', pebL: '', tufts: '', spk: ['', '', ''], edgeInk: '', edgeStone: '', setA: '', setB: '', flagA: '', flagB: '', lit: '', shade: '', kerb: '' });

/**
 * The surface pattern on a straight stretch from `a` to `b` (along u or v), from `t0` to `t1` along it, `hw(t)` its half
 * width, swaying by `amp`. Dirt: two broken wheel ruts and pebbles, grass tufts at the edges. Gravel: grit and a row of edge
 * stones. Cobbles: rows of small setts in a running bond. Flagstones: bigger slabs between two kerbs.
 */
function texture(x: Tex, s: Surface, a: P2, b: P2, hw: (t: number) => number, amp: number, t0: number, t1: number, tufts = true) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (t1 - t0 < 2 || len < 0.01) return;
  const du = (b[0] - a[0]) / len;
  const dv = (b[1] - a[1]) / len;
  const alongU = Math.abs(du) > 0.5;
  const P = (t: number, c: number): [number, number] => {
    const u0 = a[0] + du * t;
    const v0 = a[1] + dv * t;
    const sw = swayAt(u0, v0, alongU, amp);
    return alongU ? [u0, v0 + sw + du * c] : [u0 + sw - dv * c, v0];
  };
  const rect = (ta: number, tb: number, ca: number, cb: number): [number, number, number, number] => {
    const [p, q] = [P(ta, ca), P(tb, cb)];
    return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
  };
  const r = rng(Math.round(a[0] * 31 + a[1] * 17 + b[0] * 7 + b[1] * 3) + s * 1013);
  if (s === 1) {
    for (const side of [-1, 1]) {
      let on = false;
      for (let t = t0; t <= t1; t += 3) {
        const [u, v] = P(t, side * hw(t) * 0.42);
        if (r() < 0.12) on = false;
        else {
          x.ruts += `${on ? 'L' : 'M'}${g1(u)} ${g1(v)}`;
          on = true;
        }
      }
    }
    for (let t = t0; t < t1; t += 4.5) {
      const [u, v] = P(t + r() * 3, (r() * 2 - 1) * hw(t) * 0.8);
      if (r() < 0.5) x.pebD += dot(u, v);
      else x.pebL += dot(u, v);
    }
  }
  if (s === 2) {
    for (let t = t0; t < t1; t += 1.4) {
      const [u, v] = P(t + r(), (r() * 2 - 1) * hw(t) * 0.85);
      x.spk[Math.floor(r() * 3)] += dot(u, v);
    }
    for (const side of [-1, 1])
      for (let t = t0 + 2; t < t1 - 1; t += 4.6) {
        const [u, v] = P(t, side * (hw(t) - 1));
        x.edgeInk += dot(u, v);
        x.edgeStone += dot(u, v);
      }
  }
  if (s === 3) {
    for (let t = t0, row = 0; t + 4.8 <= t1 + 0.5; t += 4.8, row++) {
      const h = hw(t + 2.4) - 0.6;
      let c = -h - (row % 2 ? 2.6 : 0);
      while (c < h) {
        const l = 4.4 + r() * 1.6;
        const c0 = Math.max(c, -h);
        const c1 = Math.min(c + l, h);
        if (c1 - c0 > 1.6) {
          const box = rect(t + 0.35, t + 4.45, c0 + 0.35, c1 - 0.35);
          if (r() < 0.6) x.setA += tile(...box, 0.9);
          else x.setB += tile(...box, 0.9);
          x.lit += tileLit(...box, 0.9);
          x.shade += tileShade(...box, 0.9);
        }
        c += l;
      }
    }
  }
  if (s === 4) {
    for (let t = t0; t + 6.2 <= t1 + 0.5; t += 7.6) {
      for (const side of [-1, 1]) {
        const h = hw(t + 3);
        x.kerb += tile(...rect(t + 0.4, t + 6.6, side * (h - 0.2), side * (h - 2.8)), 0.6);
      }
    }
    for (let t = t0, row = 0; t + 8.5 <= t1 + 0.5; t += 8.5, row++) {
      const h = hw(t + 4.2) - 3.4;
      let c = -h - (row % 2 ? 5 : 0);
      while (c < h) {
        const l = 8 + r() * 4;
        const c0 = Math.max(c, -h);
        const c1 = Math.min(c + l, h);
        if (c1 - c0 > 2.4) {
          const box = rect(t + 0.6, t + 7.9, c0 + 0.5, c1 - 0.5);
          if (r() < 0.62) x.flagA += tile(...box, 1.3);
          else x.flagB += tile(...box, 1.3);
          x.lit += tileLit(...box, 1.3);
          x.shade += tileShade(...box, 1.3);
        }
        c += l;
      }
    }
  }
  if (tufts && s <= 2) {
    for (let t = t0; t < t1; t += 9) {
      if (r() < 0.4) continue;
      const side = r() < 0.5 ? 1 : -1;
      const [u, v] = P(t + r() * 4, side * (hw(t) + EDGE_W[s] + 1.4 + r() * 2));
      if (onRoad(u, v, -1) || inSquare(u, v, 2) || PLOTS.some((p) => Math.abs(u - p.u) < p.half - 3 && Math.abs(v - p.v) < p.half - 3)) continue;
      const [sx, sy] = iso(u, v);
      x.tufts += `M${f(sx - 2.4)} ${f(sy)}l-1.2 -3.6M${f(sx)} ${f(sy)}l0 -4.6M${f(sx + 2.4)} ${f(sy)}l1.2 -3.6`;
    }
  }
}

/** The grid-unit paths of one surface's pattern (inside the iso matrix). */
function TexLayer({ s, x }: { s: Surface; x: Tex }) {
  if (s === 1)
    return (
      <>
        <path d={x.ruts} stroke="#9E7444" strokeWidth={1.8} strokeLinecap="round" opacity={0.85} />
        <path d={x.pebD} stroke="#9C7A4C" strokeWidth={1.9} strokeLinecap="round" />
        <path d={x.pebL} stroke="#F1E1C2" strokeWidth={1.6} strokeLinecap="round" />
      </>
    );
  if (s === 2)
    return (
      <>
        <path d={x.spk[0]} stroke="#A39276" strokeWidth={1.3} strokeLinecap="round" />
        <path d={x.spk[1]} stroke="#EFE6D2" strokeWidth={1.2} strokeLinecap="round" />
        <path d={x.spk[2]} stroke="#8E877C" strokeWidth={1} strokeLinecap="round" />
        <path d={x.edgeInk} stroke={INK} strokeWidth={4} strokeLinecap="round" />
        <path d={x.edgeStone} stroke="#D6CFC1" strokeWidth={2.7} strokeLinecap="round" />
      </>
    );
  if (s === 3)
    return (
      <g strokeLinejoin="round">
        <path d={x.setA} fill="#D6CFC1" stroke="#8E877C" strokeWidth={0.8} />
        <path d={x.setB} fill="#BFB6A4" stroke="#8E877C" strokeWidth={0.8} />
        <path d={x.lit} stroke="#FFFFFF" strokeWidth={0.8} opacity={0.7} />
        <path d={x.shade} stroke="#7A7368" strokeWidth={0.8} />
      </g>
    );
  return (
    <g strokeLinejoin="round">
      <path d={x.flagA} fill="#E8E3D8" stroke="#A39E94" strokeWidth={0.9} />
      <path d={x.flagB} fill="#D4CCBC" stroke="#A39E94" strokeWidth={0.9} />
      <path d={x.lit} stroke="#FFFFFF" strokeWidth={1} opacity={0.75} />
      <path d={x.shade} stroke="#857E73" strokeWidth={1} />
      <path d={x.kerb} fill="#CFC6B2" stroke={INK} strokeWidth={0.9} />
    </g>
  );
}

const LANE_TEX = new Map<string, Tex[]>();
/** The pattern of every road piece, per surface; it stops short of crossings and bends (a plain slab there) but runs to doors. */
function laneTextures(built: string, net: Net): Tex[] {
  const hit = LANE_TEX.get(built);
  if (hit) return hit;
  const out = [emptyTex(), emptyTex(), emptyTex(), emptyTex()];
  for (const g of net.segs) {
    const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    const trim = (n: P2) => (net.doors.has(pk(n)) ? 0 : (net.deg.get(pk(n)) ?? 1) >= 2 ? Math.max(BEND[g.s], g.w + 4) : 0);
    texture(out[g.s - 1]!, g.s, g.a, g.b, () => g.w, SWAY[g.s], trim(g.a), len - trim(g.b));
  }
  LANE_TEX.set(built, out);
  return out;
}

/** The lanes and branches: all ink edges first, then each surface from dirt up, each with its pattern. */
function Lanes({ built }: { built: string }) {
  const net = network(built);
  const tex = laneTextures(built, net);
  const lines = net.runs.map((r) => ({ r, d: drawnLine(r.pts, SWAY[r.s], BEND[r.s]) }));
  const ends = (r: Run) => `${r.capA ? dot(...r.pts[0]!) : ''}${r.capB && !r.door ? dot(...r.pts[r.pts.length - 1]!) : ''}`;
  // A square doorstep a little wider than the road where it meets the building (the road comes in along v from the front).
  const step = (r: Run) => {
    const [u, v] = r.pts[r.pts.length - 1]!;
    const h = r.w + 2.4;
    return `M${g1(u - h)} ${g1(v)}H${g1(u + h)}V${g1(v + 8)}H${g1(u - h)}Z`;
  };
  const doorRuns = lines.filter((l) => l.r.door);
  const surfaces = ([1, 2, 3, 4] as const).map((s) => {
    const mine = lines.filter((l) => l.r.s === s);
    if (!mine.length) return null;
    const widths = [...new Set(mine.map((l) => l.r.w))];
    return (
      <g key={`s${s}`}>
        {widths.map((w) => {
          const ls = mine.filter((l) => l.r.w === w);
          return (
            <g key={w}>
              <path d={ls.map((l) => l.d).join('')} stroke={FILL[s]} strokeWidth={w * 2} strokeLinecap="butt" />
              <path d={ls.map((l) => ends(l.r)).join('')} stroke={FILL[s]} strokeWidth={w * 2} strokeLinecap="round" />
              <path d={ls.filter((l) => l.r.door).map((l) => step(l.r)).join('')} fill={FILL[s]} stroke="none" />
              {s === 1 && <path d={ls.map((l) => l.d).join('')} stroke="#E2C48F" strokeWidth={w * 0.9} strokeLinecap="butt" opacity={0.8} />}
            </g>
          );
        })}
        <TexLayer s={s} x={tex[s - 1]!} />
        {s >= 3 && (
          // Paved roads end on one dressed doorstep slab.
          <path
            d={mine.filter((l) => l.r.door).map((l) => { const [u, v] = l.r.pts[l.r.pts.length - 1]!; return tile(u - l.r.w - 1.6, v + 0.8, u + l.r.w + 1.6, v + 7.2, 1.2); }).join('')}
            fill="#E8E3D8"
            stroke="#857E73"
            strokeWidth={0.9}
          />
        )}
      </g>
    );
  });
  const edgeKeys = [...new Set(lines.map((l) => `${l.r.s}/${l.r.w}`))];
  return (
    <>
      <g transform={GROUND_T}>
        {edgeKeys.map((k) => {
          const [s, w] = k.split('/').map(Number) as [Surface, number];
          return (
            <g key={`e${k}`}>
              <path d={lines.filter((l) => l.r.s === s && l.r.w === w).map((l) => l.d).join('')} stroke={INK} strokeWidth={w * 2 + EDGE_W[s] * 2} strokeLinecap="butt" />
              <path d={lines.filter((l) => l.r.s === s && l.r.w === w).map((l) => ends(l.r)).join('')} stroke={INK} strokeWidth={w * 2 + EDGE_W[s] * 2} strokeLinecap="round" />
              <path d={doorRuns.filter((l) => l.r.s === s && l.r.w === w).map((l) => step(l.r)).join('')} fill="none" stroke={INK} strokeWidth={EDGE_W[s] * 2} strokeLinejoin="miter" />
            </g>
          );
        })}
        {surfaces}
      </g>
      <path d={tex[0]!.tufts + tex[1]!.tufts} stroke="#5E8C3A" strokeWidth={1.5} />
    </>
  );
}

// The main street: the gate's width at the gate, widening into the plaza in front of the hall; its surface follows the Town Hall.
const MAIN = PATHS.find((p) => p.key === 'main')!;
/** Front kerb of the plaza (v) and where the street starts to widen. */
const PLAZA_V = HALL.v + SQUARE + 3;
const FLARE_V = PLAZA_V + 54;
const FLARE_W = 24;
const streetHalf = (v: number) => (v >= FLARE_V ? STREET_W : STREET_W + (FLARE_W - STREET_W) * ((FLARE_V - v) / (FLARE_V - PLAZA_V)) ** 2);
const STREET_TOP = MAIN.pts[0]![1];
const STREET_OUTLINE = (() => {
  const left: string[] = [];
  const right: string[] = [];
  for (let v = STREET_TOP; v >= PLAZA_V - 2; v -= 3) {
    left.push(`${g1(GATE_U - streetHalf(Math.max(v, PLAZA_V)))} ${g1(v)}`);
    right.push(`${g1(GATE_U + streetHalf(Math.max(v, PLAZA_V)))} ${g1(v)}`);
  }
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
})();
const STREET_TEX = new Map<Surface, Tex>();
function streetTex(s: Surface): Tex {
  let x = STREET_TEX.get(s);
  if (!x) {
    x = emptyTex();
    // Along the street from the plaza (t = 0) out to the gate.
    texture(x, s, [GATE_U, PLAZA_V - 2], [GATE_U, STREET_TOP], (t) => streetHalf(PLAZA_V - 2 + t), 0, 0, STREET_TOP - PLAZA_V + 2, false);
    STREET_TEX.set(s, x);
  }
  return x;
}

function GateStreet({ s }: { s: Surface }) {
  return (
    <g transform={GROUND_T} strokeLinejoin="round">
      <path d={STREET_OUTLINE} fill={FILL[s]} stroke={INK} strokeWidth={EDGE_W[s] * 2} />
      <path d={STREET_OUTLINE} fill={FILL[s]} />
      {s === 1 && <path d={`M${GATE_U} ${STREET_TOP}V${PLAZA_V}`} stroke="#E2C48F" strokeWidth={STREET_W * 0.9} opacity={0.8} />}
      <TexLayer s={s} x={streetTex(s)} />
    </g>
  );
}

/** The plaza under the Town Hall, on the Town Hall's surface: trodden earth, gravel, cobbles, then big flagstones. */
const PLAZA_TEX = new Map<Surface, Tex>();
function plazaTex(s: Surface): Tex {
  let x = PLAZA_TEX.get(s);
  if (!x) {
    x = emptyTex();
    if (s === 4) {
      const T = 15.5;
      const n = Math.floor(((SQUARE - 1) * 2) / T);
      const o = (SQUARE * 2 - n * T) / 2;
      const r = rng(41);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const u0 = HALL.u - SQUARE + o + i * T;
          const v0 = HALL.v - SQUARE + o + j * T;
          const box = [u0 + 0.8, v0 + 0.8, u0 + T - 0.8, v0 + T - 0.8] as const;
          if ((i + j) % 2 === 0 && r() < 0.7) x.flagB += tile(...box, 1.8);
          else x.flagA += tile(...box, 1.8);
          x.lit += tileLit(...box, 1.8);
          x.shade += tileShade(...box, 1.8);
        }
    } else {
      texture(x, s, [HALL.u, HALL.v - SQUARE], [HALL.u, HALL.v + SQUARE], () => SQUARE - 0.5, 0, 0, SQUARE * 2, false);
      // Gravel: no edge stones down the middle; the kerb ring is the edge.
      if (s === 2) x.edgeInk = x.edgeStone = '';
    }
    PLAZA_TEX.set(s, x);
  }
  return x;
}

function Plaza({ s }: { s: Surface }) {
  const sq = (h: number) => `M${HALL.u - h} ${HALL.v - h}H${HALL.u + h}V${HALL.v + h}H${HALL.u - h}Z`;
  // A ring of stones round the earth and gravel squares; a dressed kerb round the paved ones.
  let ring = '';
  if (s <= 2) {
    const h = SQUARE + 1.5;
    for (let k = -h; k < h; k += 5.2) ring += dot(HALL.u + k, HALL.v - h) + dot(HALL.u + h, HALL.v + k) + dot(HALL.u - k, HALL.v + h) + dot(HALL.u - h, HALL.v - k);
  }
  return (
    <g transform={GROUND_T} strokeLinejoin="round">
      {s >= 3 ? (
        <path d={sq(SQUARE + 3)} fill="#CFC6B2" stroke={INK} strokeWidth={2.2} />
      ) : (
        <path d={sq(SQUARE + 1.5)} fill={FILL[s]} stroke={INK} strokeWidth={EDGE_W[s] * 2} />
      )}
      <path d={sq(SQUARE)} fill={s === 4 ? '#AFA798' : FILL[s]} stroke={s >= 3 ? '#8E877C' : 'none'} strokeWidth={0.8} />
      <TexLayer s={s} x={plazaTex(s)} />
      {ring && (
        <>
          <path d={ring} stroke={INK} strokeWidth={4.4} strokeLinecap="round" />
          <path d={ring} stroke={s === 1 ? '#B3ACA0' : '#D6CFC1'} strokeWidth={3.1} strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

/** The streets to the buildings that stand, the hall's plaza and the pads of the buildings inside the wall. */
const Paths = memo(function Paths({ built }: { built: string }) {
  const st = roadStages(built);
  const hall = st.get('hall') ?? 1;
  return (
    <g className="vv-paths" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <clipPath id="vv-ground-clip">
          <path d={groundSquare(0, 0, RP - 2)} />
        </clipPath>
      </defs>
      {PLOTS.filter((p) => !p.out && p.id !== 'hall' && st.has(p.id)).map((p) => pad(p, 0))}
      {/* a clip cuts the streets flat inside the plate's edge (they end under the gates) */}
      <g clipPath="url(#vv-ground-clip)">
        <Lanes built={built} />
        <GateStreet s={hall} />
      </g>
      <Plaza s={hall} />
    </g>
  );
});

/**
 * The ground plate with its paths, fields and the hall square. `built`: comma-separated "id:look" of the buildings that
 * stand (or are being built, look 1); paths to the others are not drawn, so a new village has no roads to nowhere. Each
 * road's surface follows its building's look.
 */
export const Ground = memo(function Ground({ built }: { built: string }) {
  return (
    <>
      <OuterGround built={built} />
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
  // Forest around the Lumber Camp on the left (owner 2026-11-04: no scattered stumps or log piles; the camp's own sprite
  // carries the neat plank and log stacks).
  [['pineA', 'pineB', 'pineA', 'oak'], -272, 92, 22, 46, 8, 1.35, 1.7],
  [['pineA', 'pineB', 'oak'], -186, 238, 22, 16, 4, 1.35, 1.7],
  [['pineA', 'pineB'], -280, 250, 12, 14, 2, 1.3, 1.5],
  // Rocks around the Gold Mine (back corner) and the Iron Mine (right corner), with a few pines.
  [['rockA', 'rockC', 'rockB', 'pineB'], -176, -276, 30, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineB'], -276, -150, 14, 34, 4, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineA'], 168, -276, 30, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB'], 280, -176, 10, 20, 3, 1.2, 1.7],
  // Hedges and bushes round the fields and in the front corner.
  [['bush', 'bush', 'oak'], 280, 20, 8, 24, 3, 1.2, 1.5],
  [['bush', 'oak', 'bush'], 200, 236, 40, 22, 5, 1.2, 1.5],
  // A few lone trees and bushes in the gaps (owner 2026-11-06: fewer than before, so the buildings stand clear).
  [['oak', 'bush', 'pineB', 'bush', 'oak'], 0, 0, INNER, INNER, 16, 1.2, 1.55],
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
      if (q.s < 30 || i % 15 !== 0 || r() < 0.4) return;
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

// ---- Town square campfire ---------------------------------------------------------------------------------------
// The living fire in front of the Town Hall: hand-drawn flames that flicker and smoke puffs that rise (CSS only, see
// village.css .vv-fire-*; still when the visitor prefers reduced motion). A village whose hearth is out gets cold ash
// instead: no flames, no smoke. Decoration only: pointer-events are off, so it never blocks a building.

const FIRE_AT = iso(HALL.u + 34, HALL.v + 34);
const STONE_GREY = '#A39E94';

/** The campfire as a depth item (drawn in front of the Town Hall). `cold`: the hearth is out. */
export function fireItem(cold: boolean): DepthItem {
  const [x, y] = FIRE_AT;
  return {
    key: 'fire',
    depth: y,
    node: (
      <g className="vv-life vv-fire" transform={`translate(${f(x)} ${f(y)}) scale(0.5) translate(-35 -58)`} pointerEvents="none">
        <ellipse cx={35} cy={58} rx={30} ry={9} fill={INK} opacity={0.35} />
        <g stroke={INK} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round">
          <ellipse cx={14} cy={52} rx={7} ry={5} fill={STONE_GREY} />
          <ellipse cx={56} cy={52} rx={7} ry={5} fill={STONE_GREY} />
          <ellipse cx={25} cy={58} rx={7} ry={5} fill={STONE_GREY} />
          <ellipse cx={45} cy={58} rx={7} ry={5} fill={STONE_GREY} />
          <path d="M16 54 L52 44" strokeWidth={9} />
          <path d="M16 54 L52 44" strokeWidth={4} stroke={cold ? '#6E5638' : '#B98F56'} />
          <path d="M54 54 L18 44" strokeWidth={9} />
          <path d="M54 54 L18 44" strokeWidth={4} stroke={cold ? '#5A4128' : '#8A6030'} />
        </g>
        {cold ? (
          <path d="M22 47 C24 42 46 42 48 47 C46 51 24 51 22 47Z" fill="#6B645C" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        ) : (
          <>
            <path className="vv-flame" d="M35 8 C44 20 52 28 50 40 C48 50 22 50 20 40 C18 30 28 24 35 8Z" fill="#C4623A" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
            <path className="vv-flame is-b" d="M35 20 C41 28 45 33 43 41 C41 47 29 47 27 41 C26 35 31 31 35 20Z" fill="#F2B33D" />
            <path className="vv-flame" d="M35 32 C38 36 40 39 38 43 C36 46 33 46 32 43 C31 40 33 37 35 32Z" fill="#FFDC7A" />
            <circle className="vv-fire-puff" cx={35} cy={14} r={9} />
            <circle className="vv-fire-puff" cx={35} cy={14} r={9} />
            <circle className="vv-fire-puff" cx={35} cy={14} r={9} />
          </>
        )}
      </g>
    ),
  };
}

// The ring wall (with its gates) lives in ./wall.tsx.
export { wallItems } from './wall.tsx';
