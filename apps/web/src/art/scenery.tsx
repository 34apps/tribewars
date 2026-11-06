// Village scene scenery in style D (Toy Diorama, like the approved village artboard): a chunky ground plate with thick
// warm-ink outlines, bold tan paths to the buildings that stand, a paved square under the Town Hall, toy trees and rocks,
// and the ring wall on the plate's edge drawn by its stage (palisade, stone, towers with terracotta roofs and flags).
// Flat 3-tone block shading lit from the top left. Laid out on the isometric grid from ./buildings.ts (iso(u, v, z)).

import { memo } from 'react';
import type { ReactNode } from 'react';
import { T } from './Icon.tsx';
import type { BuildingId } from '@clanfire/engine';
import { BRANCH_W, LAND_Z, OUTER_ROADS, OUTSIDE, PLACEMENT, SIDE_STREET_W, STREET_W, WALL_RING, doorUV, iso, plotUV } from './buildings.ts';
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

// ---- Paths ---------------------------------------------------------------------------------------------------
// One street network on the ground, all in grid directions (no wiggles): the main street runs from the gate straight along
// u = GATE_U to the hall square, as wide as the road outside the walls (which leaves the gate along the same line), and a
// branch runs from the square to the door of EVERY building, ending at the middle of its front-left face (where the doors
// are). The four front buildings hang off one lane just inside the gate; Storehouse and Barracks off the sides of the
// square; the back buildings off the back of the square. A branch shows only once its building exists (built or queued),
// so no road leads nowhere.

export type PathDef = RoadDef;
export { STREET_W };

/** The ink edge round a path (grid units). Matches the road tile's. */
const EDGE = 3.2;
const { gateU: GATE_U } = WALL_RING;
/** Where the lane just inside the gate runs (v), and the lane across the front of the square. */
const LANE_V = 238;
/** The side branches out of the square to the Storehouse (right) and the Barracks (left), and the Iron Mine road's bend. */
const SIDE_R = 36;
const SIDE_L = 70;
const MINE_U = 120;

/** A branch along the corner points `via`, then along u to the building and along v to its door. */
const branch = (to: BuildingId, ...via: [number, number][]): PathDef => {
  const d = doorUV(to);
  return { key: to, to, w: BRANCH_W, pts: [...via, [d.u, via[via.length - 1]![1]], [d.u, d.v]] };
};
const BACK = HALL.v - SQUARE + 6;

export const PATHS: PathDef[] = [
  // The gate to the middle of the square, straight (the outside road continues it).
  { key: 'main', to: null, w: STREET_W, pts: [[GATE_U, RP + 6], [GATE_U, HALL.v + SQUARE - 30]] },
  // Along the lane just inside the gate.
  branch('market', [GATE_U, LANE_V]),
  branch('drillyard', [GATE_U, LANE_V]),
  branch('lumber', [GATE_U, LANE_V]),
  branch('farm', [GATE_U, LANE_V]),
  // Out of the sides of the square.
  branch('storehouse', [HALL.u + SQUARE - 6, SIDE_R]),
  branch('barracks', [HALL.u - SQUARE + 6, SIDE_L]),
  // Out of the back of the square: the Banner Hall and the Stables straight up, the others round them.
  branch('bannerhall', [GATE_U, BACK]),
  branch('stables', [doorUV('stables').u, BACK]),
  branch('mine', [HALL.u + SQUARE - 6, -20], [MINE_U, -20], [MINE_U, -120]),
  branch('vault', [HALL.u - SQUARE + 6, -20], [HALL.u - SQUARE + 6, -40]),
  branch('goldmine', [HALL.u - SQUARE + 6, -20], [HALL.u - SQUARE + 6, -40]),
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
  [240, 180, 18, 18, 'wheat'],
  [232, -88, 16, 18, 'greens'],
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

/** Bold tan paths to the buildings that stand, the hall square and the pads of the buildings inside the wall. */
const Paths = memo(function Paths({ built }: { built: string }) {
  const have = new Set(built.split(','));
  const shown = PATHS.filter((p) => !p.to || have.has(p.to));
  const sq = (h: number) => groundSquare(HALL.u, HALL.v, h);
  return (
    <g className="vv-paths" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <clipPath id="vv-ground-clip">
          <path d={groundSquare(0, 0, RP - 2)} />
        </clipPath>
      </defs>
      {PLOTS.filter((p) => !p.out && p.id !== 'hall' && have.has(p.id)).map((p) => pad(p, 0))}
      {/* a clip cuts the streets flat inside the plate's edge (they end under the gates) */}
      <g clipPath="url(#vv-ground-clip)">{roadBands(shown, 0, 'i')}</g>
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
  // Forest around the Lumber Camp in the left corner (owner 2026-11-04: no scattered stumps or log piles; the
  // camp's own sprite carries the neat plank and log stacks).
  [['pineA', 'pineB', 'pineA', 'oak'], -229, 112, 26, 44, 8, 1.35, 1.7],
  [['pineA', 'pineB', 'oak'], -138, 233, 18, 22, 4, 1.35, 1.7],
  [['pineA', 'pineB'], -240, 245, 12, 12, 2, 1.3, 1.5],
  // Rocks around the Gold Mine (back corner) and the Iron Mine (right corner), with a few pines.
  [['rockA', 'rockC', 'rockB', 'pineB'], -152, -240, 26, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineB'], -240, -140, 14, 30, 4, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB', 'pineA'], 152, -240, 26, 14, 5, 1.2, 1.7],
  [['rockA', 'rockC', 'rockB'], 240, -146, 14, 28, 3, 1.2, 1.7],
  // Hedges and bushes around the fields in front.
  [['bush', 'bush', 'oak'], 243, 175, 10, 30, 3, 1.2, 1.5],
  [['bush', 'oak'], 140, 240, 20, 16, 3, 1.2, 1.5],
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
