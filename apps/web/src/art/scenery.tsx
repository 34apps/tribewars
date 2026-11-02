// Village scene scenery: trees, rocks and the ring wall drawn by its stage. Ground, roads and the market square
// are static files in ./scene/ (from the approved artboard VillageViewDesktop); buildings come from ./buildings.ts.

import type { ReactNode } from 'react';
import { T } from './Icon.tsx';
import { WALL_RING } from './buildings.ts';
import type { Stage } from './buildings.ts';

export { default as GROUND_URL } from './scene/ground.svg?no-inline';
export { default as MARKET_URL } from './scene/market.svg?no-inline';

/** Depth of the market square (well and stalls) for the painter's sort. */
export const MARKET_DEPTH = 205;

export interface DepthItem {
  key: string;
  depth: number;
  node: ReactNode;
}

// ---- Trees and rocks (shapes from the artboard) -----------------------------------------------------------------

type Prop = 'pine' | 'round' | 'rock';

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

/** Symbols referenced by <use href="#vt-…">; render once inside the scene's <defs>. */
export function SceneryDefs() {
  return (
    <>
      <g id="vt-pine">{pine('vtp')}</g>
      <g id="vt-round">{round('vtr')}</g>
      <g id="vt-rock">{rock('vtk')}</g>
    </>
  );
}

const PROPS: [Prop, number, number, number][] = [
  ['pine', 302.6, 74.3, 0.85],
  ['round', 271.4, 87.3, 0.8],
  ['pine', 326.0, 88.6, 0.85],
  ['pine', 235.0, 102.9, 0.85],
  ['pine', 336.4, 109.4, 0.85],
  ['pine', 266.2, 110.7, 0.85],
  ['round', 378.0, 114.6, 0.8],
  ['round', 229.8, 118.5, 0.8],
  ['pine', 198.6, 123.7, 0.85],
  ['pine', 388.4, 132.8, 0.85],
  ['pine', 216.8, 138.0, 0.85],
  ['round', 146.6, 147.1, 0.8],
  ['pine', 164.8, 161.4, 0.85],
  ['round', 482.0, 161.4, 0.8],
  ['pine', 131.0, 162.7, 0.85],
  ['pine', 97.2, 169.2, 0.85],
  ['round', 144.0, 177.0, 0.8],
  ['pine', 121.9, 179.0, 0.85],
  ['rock', 445.6, 184.8, 0.7],
  ['rock', 463.8, 193.9, 0.9],
  ['round', 29.6, 200.4, 0.8],
  ['rock', 567.8, 201.7, 0.8],
  ['pine', 146.6, 227.7, 0.75],
  ['rock', 518.4, 229.0, 1.1],
  ['pine', 92.0, 231.6, 0.85],
  ['rock', 404.0, 231.6, 0.7],
  ['pine', 118.0, 234.2, 0.85],
  ['pine', 138.8, 247.2, 0.75],
  ['round', 125.8, 248.5, 0.8],
  ['rock', 466.4, 257.6, 0.9],
  ['round', 404.0, 283.6, 0.75],
  ['round', 216.8, 288.8, 0.75],
  ['pine', 235.0, 303.1, 0.75],
];

export function sceneryItems(): DepthItem[] {
  return PROPS.map(([kind, x, y, s], i) => ({
    key: `t${i}`,
    depth: y,
    node: <use href={`#vt-${kind}`} transform={`translate(${x} ${y}) scale(${s})`} />,
  }));
}

// ---- Ring wall --------------------------------------------------------------------------------------------------
// Drawn in code (not a sprite) because it wraps the whole square. Stage 1: wooden palisade with timber towers;
// stage 2: low stone wall with square towers; stage 3: tall stone wall with round towers, red roofs and banners.

type Pt = readonly [number, number];
const INK = '#2B211C';
const WOOD = { top: '#E4B67C', left: '#B07D46', right: '#714B29', pTop: '#B98F5E', pLeft: '#8E6539', pRight: '#5E3F22' };
const STONE = { top: '#E3DED3', left: '#B3ACA0', right: '#7C756B' };
const ROOF = { light: '#EF9C6E', mid: '#C4623A', dark: '#843A23' };

const f = (n: number) => Math.round(n * 10) / 10;
const pts = (list: Pt[]) => list.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');

function isoBox(
  key: string,
  cx: number,
  cy: number,
  a: number,
  h: number,
  c: { top: string; left: string; right: string },
  sw = 1.5,
): ReactNode {
  const L: Pt = [cx - a, cy];
  const F: Pt = [cx, cy + a / 2];
  const R: Pt = [cx + a, cy];
  const B: Pt = [cx, cy - a / 2];
  const up = (p: Pt): Pt => [p[0], p[1] - h];
  return (
    <g key={key} stroke={INK} strokeWidth={sw} strokeLinejoin="round">
      <path d={`M${pts([L, F, up(F), up(L)])}Z`} fill={c.left} />
      <path d={`M${pts([F, R, up(R), up(F)])}Z`} fill={c.right} />
      <path d={`M${pts([up(L), up(F), up(R), up(B)])}Z`} fill={c.top} />
    </g>
  );
}

function pyramid(key: string, cx: number, cy: number, a: number, rise: number): ReactNode {
  const L: Pt = [cx - a, cy];
  const F: Pt = [cx, cy + a / 2];
  const R: Pt = [cx + a, cy];
  const A: Pt = [cx, cy - rise];
  return (
    <g key={key} stroke={INK} strokeWidth={2} strokeLinejoin="round">
      <path d={`M${pts([L, A, F])}Z`} fill={WOOD.left} />
      <path d={`M${pts([R, A, F])}Z`} fill={WOOD.right} />
      <path d={`M${pts([[cx, cy - rise + 7], A, L])}Z`} fill={WOOD.top} />
    </g>
  );
}

function woodTower(cx: number, cy: number, big: boolean): ReactNode {
  if (!big) {
    return (
      <g>
        {isoBox('b', cx, cy, 5.2, 30, WOOD, 1.4)}
        {pyramid('r', cx, cy - 30, 10.9, 9)}
      </g>
    );
  }
  return (
    <g>
      {isoBox('b', cx, cy, 10.4, 34, WOOD, 1.6)}
      {isoBox('p', cx, cy - 34, 14, 5, { top: WOOD.pTop, left: WOOD.pLeft, right: WOOD.pRight })}
      {pyramid('r', cx, cy - 39, 18.2, 16)}
    </g>
  );
}

function stoneTower(cx: number, cy: number, big: boolean): ReactNode {
  const a = big ? 10 : 6.5;
  const h = big ? 30 : 24;
  const m = a * 0.42;
  return (
    <g>
      {isoBox('b', cx, cy, a, h, STONE, 1.6)}
      {isoBox('m1', cx - a + m, cy - h, m * 0.7, 4.5, STONE, 1.2)}
      {isoBox('m2', cx, cy - h - a / 2 + m / 2, m * 0.7, 4.5, STONE, 1.2)}
      {isoBox('m3', cx + a - m, cy - h, m * 0.7, 4.5, STONE, 1.2)}
      {isoBox('m4', cx, cy - h + a / 2 - m / 2, m * 0.7, 4.5, STONE, 1.2)}
    </g>
  );
}

function roundTower(cx: number, cy: number, big: boolean): ReactNode {
  const r = big ? 10 : 7;
  const h = big ? 42 : 32;
  const rise = big ? 20 : 15;
  const ry = r / 2;
  const top = cy - h;
  const roofR = r + 2.5;
  return (
    <g stroke={INK} strokeLinejoin="round">
      <path d={`M${f(cx - r)} ${f(top)}V${f(cy)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}Z`} fill={STONE.left} strokeWidth={1.6} />
      <path
        d={`M${f(cx + 2)} ${f(top + ry)}V${f(cy + ry)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}Z`}
        fill={STONE.right}
        strokeWidth={0}
      />
      <path d={`M${f(cx - r)} ${f(top)}V${f(cy)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy)}V${f(top)}`} fill="none" strokeWidth={1.6} />
      <path d={`M${f(cx - r * 0.35)} ${f(top + h * 0.45)}v6`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      <path
        d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx - roofR)} ${f(top)}Z`}
        fill={ROOF.mid}
        strokeWidth={1.8}
      />
      <path
        d={`M${f(cx + 1)} ${f(top - rise + 2)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx + 1)} ${f(top + roofR / 2)}Z`}
        fill={ROOF.dark}
        strokeWidth={0}
      />
      <path
        d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx - 3)} ${f(top - rise + 6)}Z`}
        fill={ROOF.light}
        strokeWidth={0}
      />
      <path
        d={`M${f(cx - roofR)} ${f(top)}L${f(cx)} ${f(top - rise)}L${f(cx + roofR)} ${f(top)}A${roofR} ${roofR / 2} 0 0 1 ${f(cx - roofR)} ${f(top)}Z`}
        fill="none"
        strokeWidth={1.8}
      />
      {big && (
        <>
          <path d={`M${f(cx)} ${f(top - rise)}V${f(top - rise - 13)}`} strokeWidth={1.8} strokeLinecap="round" />
          <path d={`M${f(cx + 1)} ${f(top - rise - 13)}h11l-3 3.5l3 3.5h-11z`} fill="#F2B33D" strokeWidth={1.5} />
        </>
      )}
    </g>
  );
}

function stake(x: number, y: number): string {
  // One pointed stake, base centred at (x, y).
  const x0 = x - 3.4;
  return `M${f(x0)} ${f(y)}V${f(y - 21)}L${f(x)} ${f(y - 27.1)}L${f(x0 + 6.8)} ${f(y - 21)}V${f(y)}Z`;
}

interface Edge {
  name: string;
  p: Pt;
  q: Pt;
}

function ringEdges(): Edge[] {
  const { cx, cy, hw, hh } = WALL_RING;
  const T: Pt = [cx, cy - hh];
  const R: Pt = [cx + hw, cy];
  const B: Pt = [cx, cy + hh];
  const L: Pt = [cx - hw, cy];
  return [
    { name: 'tr', p: T, q: R },
    { name: 'tl', p: T, q: L },
    { name: 'lb', p: L, q: B },
    { name: 'rb', p: R, q: B },
  ];
}

/** Runs of wall along an edge between the corner towers and the gate, as [x0, x1] (x0 < x1). */
function edgeRuns(e: Edge, cornerGap: number): [number, number][] {
  const lo = Math.min(e.p[0], e.q[0]) + cornerGap;
  const hi = Math.max(e.p[0], e.q[0]) - cornerGap;
  const mid = (e.p[0] + e.q[0]) / 2;
  const g = WALL_RING.gateHalf;
  return [
    [lo, mid - g],
    [mid + g, hi],
  ];
}

const yAt = (e: Edge, x: number) => e.p[1] + ((x - e.p[0]) * (e.q[1] - e.p[1])) / (e.q[0] - e.p[0]);

/** Painter-sorted pieces of the ring wall for a stage (1–3). */
export function wallItems(stage: Exclude<Stage, 0>): DepthItem[] {
  const items: DepthItem[] = [];
  const edges = ringEdges();
  const { cx, cy, hw, hh } = WALL_RING;
  const corners: Pt[] = [
    [cx, cy - hh],
    [cx - hw, cy],
    [cx + hw, cy],
    [cx, cy + hh],
  ];

  for (const e of edges) {
    const runs = edgeRuns(e, stage === 1 ? 4 : 8);
    // Gate towers or posts at both ends of the gap.
    const mid = (e.p[0] + e.q[0]) / 2;
    const g = WALL_RING.gateHalf;
    for (const gx of [mid - g, mid + g]) {
      const gy = yAt(e, gx);
      const node = stage === 1 ? woodTower(gx, gy, false) : stage === 2 ? stoneTower(gx, gy, false) : roundTower(gx, gy, false);
      items.push({ key: `g-${e.name}-${gx}`, depth: gy + 3, node });
    }
    for (const [x0, x1] of runs) {
      if (stage === 1) {
        // Stakes every 3.6 units, grouped by 7 so trees and buildings can sit between groups.
        const xs: number[] = [];
        for (let x = x0 + 2.5; x <= x1 - 2.5; x += 3.6) xs.push(x);
        for (let i = 0; i < xs.length; i += 7) {
          const group = xs.slice(i, i + 7);
          const first = group[0];
          const last = group[group.length - 1];
          if (first === undefined || last === undefined) continue;
          const base = (x: number) => yAt(e, x) + 1;
          items.push({
            key: `s-${e.name}-${f(first)}`,
            depth: Math.max(base(first), base(last)),
            node: (
              <g>
                {group.map((x) => (
                  <g key={x}>
                    <path d={stake(x, base(x))} fill={WOOD.left} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
                    <path d={`M${f(x + 0.8)} ${f(base(x) - 1)}V${f(base(x) - 21)}H${f(x + 2.6)}V${f(base(x) - 1)}Z`} fill={WOOD.right} />
                  </g>
                ))}
                <path
                  d={`M${f(first)} ${f(base(first) - 15)}L${f(last)} ${f(base(last) - 15)}`}
                  fill="none"
                  stroke={WOOD.pRight}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </g>
            ),
          });
        }
      } else {
        const h = stage === 2 ? 13 : 20;
        const t = stage === 2 ? 6 : 7;
        const up = e.q[1] > e.p[1] === e.q[0] > e.p[0]; // slope +0.5 (tr, lb): visible face faces down-left
        const n: Pt = up ? [-t / 2, t / 4] : [t / 2, t / 4];
        const side = up ? STONE.left : STONE.right;
        const chunk = 24;
        for (let a = x0; a < x1 - 0.5; a += chunk) {
          const b = Math.min(x1, a + chunk);
          const A: Pt = [a, yAt(e, a)];
          const Bp: Pt = [b, yAt(e, b)];
          const add = (p: Pt, v: Pt, dy = 0): Pt => [p[0] + v[0], p[1] + v[1] + dy];
          const neg: Pt = [-n[0], -n[1]];
          const merlons: ReactNode[] = [];
          for (let m = a + 2; m + 3.4 <= b; m += 7) {
            const M0: Pt = [m, yAt(e, m)];
            const M1: Pt = [m + 3.4, yAt(e, m + 3.4)];
            merlons.push(
              <g key={m}>
                <path d={`M${pts([add(M0, n, -h), add(M1, n, -h), add(M1, n, -h - 4.5), add(M0, n, -h - 4.5)])}Z`} fill={side} />
                <path
                  d={`M${pts([add(M0, n, -h - 4.5), add(M1, n, -h - 4.5), add(M1, [n[0] * 0.2, n[1] * 0.2], -h - 4.5), add(M0, [n[0] * 0.2, n[1] * 0.2], -h - 4.5)])}Z`}
                  fill={STONE.top}
                />
              </g>,
            );
          }
          items.push({
            key: `w-${e.name}-${f(a)}`,
            depth: Math.max(A[1], Bp[1]) + t / 4,
            node: (
              <g stroke={INK} strokeWidth={1.5} strokeLinejoin="round">
                <path d={`M${pts([add(A, neg, -h), add(Bp, neg, -h), add(Bp, n, -h), add(A, n, -h)])}Z`} fill={STONE.top} />
                <path d={`M${pts([add(A, n), add(Bp, n), add(Bp, n, -h), add(A, n, -h)])}Z`} fill={side} />
                <path d={`M${pts([add(A, n, -h * 0.5), add(Bp, n, -h * 0.5)])}`} fill="none" strokeWidth={0.8} opacity={0.45} />
                {merlons}
              </g>
            ),
          });
        }
      }
    }
  }
  corners.forEach(([x, y], i) => {
    const node = stage === 1 ? woodTower(x, y, true) : stage === 2 ? stoneTower(x, y, true) : roundTower(x, y, true);
    items.push({ key: `c${i}`, depth: y + 5, node });
  });
  return items;
}

/** Level 0: the planned wall line, drawn flat on the ground. */
export function WallPlan() {
  const { cx, cy, hw, hh } = WALL_RING;
  const d = `M${cx} ${cy - hh}L${cx + hw} ${cy}L${cx} ${cy + hh}L${cx - hw} ${cy}Z`;
  return (
    <>
      <path d={d} fill="none" stroke="#FFF8E8" strokeWidth={1.6} strokeDasharray="5 4" opacity={0.75} />
      {/* Wide invisible stroke so the planned line is easy to click. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke' }} />
    </>
  );
}
