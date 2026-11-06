// The village ring wall in style D (Toy Diorama), drawn in code by its look: a palisade with watchtowers (look 1), stone
// walls with square towers (2), terracotta-roofed round towers (3) and the grand gold-capped wall (4, max level). It runs
// along the plate's edge (WALL_RING.plate) and is cut by the four gates in GATES (./buildings.ts), one in the middle of each
// wall: closed double doors with gate towers on both sides (the main gate is the biggest and grandest), and, in front of the
// two front gates, an earth ramp down from the raised plate to the land. Flat 3-tone block shading lit from the top left.
// Pieces are returned as painter-sorted depth items for the village scene.

import type { ReactNode } from 'react';
import { GATES, LAND_Z, SIDE_STREET_W, STREET_W, WALL_RING, iso } from './buildings.ts';
import type { Gate, WallLook, WallSide } from './buildings.ts';
import type { DepthItem } from './scenery.tsx';

const INK = '#2B211C';
const RP = WALL_RING.plate;

type P3 = readonly [number, number, number];
const f = (n: number) => Math.round(n * 10) / 10;
const pt = (u: number, v: number, z = 0) => {
  const [x, y] = iso(u, v, z);
  return `${f(x)} ${f(y)}`;
};
const poly = (pts: readonly P3[]) => `M${pts.map(([u, v, z]) => pt(u, v, z)).join('L')}Z`;

// ---- Ring wall ------------------------------------------------------------------------------------------------
// Drawn in code (not a sprite) because it wraps the whole village, split into pieces for the painter's sort.
// Stage 4 (the wall's max level only): the stage-3 wall made grand: gold tile caps, buttresses, taller gold-ringed towers, a crest on the gate.
// Stage 1: wooden palisade with timber watchtowers; stage 2: low stone wall with square towers; stage 3: tall stone
// wall with round towers, terracotta roofs and sunflower flags (as the approved building-stages artboard).

type Pt = readonly [number, number];
const WOOD = { top: '#E4B67C', left: '#B07D46', right: '#714B29', pTop: '#B98F5E', pLeft: '#8E6539', pRight: '#5E3F22' };
const STONE = { top: '#E3DED3', left: '#B3ACA0', right: '#7C756B' };
const ROOF = { light: '#EF9C6E', mid: '#C4623A', dark: '#843A23' };
const SUN = '#F2B33D';
/** Gold trim of the grand (last-levels) wall. */
const GOLD = { light: '#FFE08F', mid: '#F2B33D', dark: '#B9791F' };
const GOLD_BOX = { top: GOLD.light, left: GOLD.mid, right: GOLD.dark };

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
function flag(key: string, x: number, y: number, h = 13, big = false): ReactNode {
  const len = big ? 19 : 11;
  const half = big ? 5.5 : 3.5;
  return (
    <g key={key}>
      <path d={`M${f(x)} ${f(y)}V${f(y - h)}`} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d={`M${f(x + 1)} ${f(y - h)}h${len}l-3 ${half}l3 ${half}h-${len}z`} fill={SUN} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      {big && <path d={`M${f(x + 4)} ${f(y - h + half)}h${len - 8}`} stroke={ROOF.mid} strokeWidth={2} strokeLinecap="round" />}
    </g>
  );
}

/** Round stone tower with a terracotta cone roof (screen space, base centre (cx, cy)). */
function roundTower(cx: number, cy: number, r: number, h: number, rise: number, withFlag: boolean, gallery = false, grand = false): ReactNode {
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
      {grand && (
        <>
          {/* A gold band round the shaft */}
          <path d={`M${f(cx - r)} ${f(cy - h * 0.62)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy - h * 0.62)}`} stroke={INK} strokeWidth={4.2} fill="none" />
          <path d={`M${f(cx - r)} ${f(cy - h * 0.62)}A${r} ${ry} 0 0 0 ${f(cx + r)} ${f(cy - h * 0.62)}`} stroke={GOLD.mid} strokeWidth={2.2} fill="none" />
        </>
      )}
      {/* Arrow slits on the lit side and a lookout window higher up */}
      <path d={`M${f(cx - r * 0.55)} ${f(top + h * 0.5)}v6M${f(cx - r * 0.1)} ${f(top + h * 0.34)}v7`} strokeWidth={2.4} strokeLinecap="round" />
      <path d={`M${f(cx + r * 0.42)} ${f(top + h * 0.5)}v6`} strokeWidth={2.4} strokeLinecap="round" />
      {/* Corbelled gallery ring under the roof */}
      {gallery && (
        <>
          <path d={`M${f(cx - r - 3.5)} ${f(top)}V${f(top + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}Z`} fill={STONE.left} strokeWidth={1.6} />
          <path d={`M${f(cx + 2)} ${f(top + (r + 3.5) / 2 + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}H${f(cx + 2)}Z`} fill={STONE.right} strokeWidth={0} />
          <path d={`M${f(cx - r - 3.5)} ${f(top)}V${f(top + 5)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 5)}V${f(top)}`} fill="none" strokeWidth={1.6} />
          {grand && <path d={`M${f(cx - r - 3.5)} ${f(top + 2.4)}A${r + 3.5} ${(r + 3.5) / 2} 0 0 0 ${f(cx + r + 3.5)} ${f(top + 2.4)}`} stroke={GOLD.mid} strokeWidth={1.8} fill="none" />}
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
      {grand && (
        <>
          {/* Gold ring round the roof's foot, a gold ball on the tip */}
          <path d={`M${f(cx - roofR * 0.86)} ${f(top - rise * 0.14)}A${roofR * 0.86} ${roofR * 0.43} 0 0 0 ${f(cx + roofR * 0.86)} ${f(top - rise * 0.14)}`} stroke={INK} strokeWidth={4.2} fill="none" strokeLinecap="round" />
          <path d={`M${f(cx - roofR * 0.86)} ${f(top - rise * 0.14)}A${roofR * 0.86} ${roofR * 0.43} 0 0 0 ${f(cx + roofR * 0.86)} ${f(top - rise * 0.14)}`} stroke={GOLD.mid} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <circle cx={f(cx)} cy={f(top - rise - 1.5)} r={3.4} fill={GOLD.mid} strokeWidth={1.5} />
          <circle cx={f(cx - 1)} cy={f(top - rise - 2.5)} r={1.1} fill={GOLD.light} strokeWidth={0} />
        </>
      )}
      {withFlag && (grand ? flag('fl', cx, top - rise - 4, 19, true) : flag('fl', cx, top - rise, 13))}
    </g>
  );
}

/** Stone tower: square with merlons (stage 2), or round with a terracotta roof (stage 3, when `roof` is set). */
function stoneTower(key: string, cu: number, cv: number, a: number, h: number, o: { roof?: number; flag?: boolean; banner?: 'l' | 'r'; plinth?: number; turret?: boolean; grand?: boolean }) {
  if (o.roof) {
    // A square footing fills the whole footprint (flush with the plate edge and the walls), the round tower stands on it.
    const pl = o.plinth ?? 0;
    const [x, y] = iso(cu, cv, pl);
    const band = o.grand ? { z0: pl - 4.4, z1: pl, left: GOLD.mid, right: GOLD.dark } : { z0: pl - 3.4, z1: pl, left: ROOF.mid, right: ROOF.dark };
    return (
      <g key={key}>
        {pl > 0 && box('pl', cu - a, cu + a, cv - a, cv + a, 0, pl, STONE, { sw: 1.6, courses: Math.max(3, Math.round(pl / 5)), band })}
        {/* The grand footing wears a terracotta banner on its lit face. */}
        {pl > 0 && o.grand && gateBanner('pb', cu, cv + a, pl - 8, 1.5)}
        {roundTower(x, y, a * 1.4, h, o.roof * 0.8, !!o.flag, true, !!o.grand)}
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
function stoneRun(key: string, along: 'u' | 'v', c: number, a: number, b: number, h: number, t: number, stage: 2 | 3 | 4, pilaster = false): ReactNode {
  const lo = c - t / 2;
  const hi = c + t / 2;
  // Stage 3 wears a terracotta tile cap under the battlements, the grand stage a gold one.
  const opts = {
    courses: Math.max(2, Math.round(h / 5)),
    band: stage === 4 ? { z0: h - 4, z1: h, left: GOLD.mid, right: GOLD.dark } : stage === 3 ? { z0: h - 3.4, z1: h, left: ROOF.mid, right: ROOF.dark } : undefined,
  };
  const body = along === 'u' ? box('w', a, b, lo, hi, 0, h, STONE, opts) : box('w', lo, hi, a, b, 0, h, STONE, opts);
  // Arrow slits on the visible long face of walls tall enough to hold them.
  let slits = '';
  if (h >= 14) {
    for (let s = a + 6; s < b - 2; s += 12) slits += along === 'u' ? `M${pt(s, hi, h * 0.4)}L${pt(s, hi, h * 0.4 + 5)}` : `M${pt(hi, s, h * 0.4)}L${pt(hi, s, h * 0.4 + 5)}`;
  }
  // Grand stage: a buttress with a gold cap at the end of the run (the back walls show it on their inner side).
  let post: ReactNode = null;
  if (pilaster) {
    const p0 = b - 6;
    const ext = c < 0 ? 2.6 : 0;
    const cap = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, k: string) =>
      along === 'u' ? box(k, u0, u1, v0, v1, z0, z1, GOLD_BOX, { sw: 1.3 }) : box(k, v0, v1, u0, u1, z0, z1, GOLD_BOX, { sw: 1.3 });
    post = (
      <g key="pil">
        {along === 'u' ? box('pb', p0, b - 1, lo + 1, hi + ext, 0, h + 3, STONE, { sw: 1.4, courses: Math.round(h / 6) }) : box('pb', lo + 1, hi + ext, p0, b - 1, 0, h + 3, STONE, { sw: 1.4, courses: Math.round(h / 6) })}
        {cap(p0 - 0.8, b - 0.2, lo + 0.2, hi + ext + 0.8, h + 3, h + 6.5, 'pc')}
      </g>
    );
  }
  return (
    <g key={key}>
      {body}
      {slits && <path d={slits} stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />}
      {merlonRows(along, a, b, lo, hi, h, stage >= 3 ? 5 : 4.2)}
      {post}
    </g>
  );
}

/** Colours and line weights of the gate doors (Toy Diorama). */
const G = { sw: 1.5, merlonSw: 1.2, wood: '#B07D46', plank: '#714B29', lit: '#E4B67C', iron: '#4A4440', band: 2, stud: 0.75, studFill: '#E3DED3', bar: '#8E6539', lock: '#F2B33D', arch: '#7C756B' };

type Along = 'u' | 'v';
/** A point `s` along a wall and `w` across it (w is the wall's middle line plus an offset), as grid (u, v). */
const sw = (along: Along, s: number, w: number): [number, number] => (along === 'u' ? [s, w] : [w, s]);
const at3 = (along: Along, s: number, w: number, z = 0) => {
  const [u, v] = sw(along, s, w);
  return pt(u, v, z);
};
/** `box` with the roles of the two ground axes given along/across the wall (s0..s1 along, w0..w1 across). */
function wbox(along: Along, key: string, s0: number, s1: number, w0: number, w1: number, z0: number, z1: number, c: Colors, o: Parameters<typeof box>[8] = {}): ReactNode {
  return along === 'u' ? box(key, s0, s1, w0, w1, z0, z1, c, o) : box(key, w0, w1, s0, s1, z0, z1, c, o);
}

/** A terracotta banner with a sunflower flame hanging on a gatehouse face (the plane w = cw of a wall running `along`). */
function gateBanner(key: string, cs: number, cw: number, ztop: number, k = 1, along: Along = 'u'): ReactNode {
  const w = 3.2 * k;
  const hh = 10 * k;
  const p = (s: number, z: number): P3 => {
    const [u, v] = sw(along, s, cw);
    return [u, v, z];
  };
  const d = poly([p(cs - w, ztop), p(cs + w, ztop), p(cs + w, ztop - hh), p(cs, ztop - hh + 3 * k), p(cs - w, ztop - hh)]);
  const [x, y] = iso(...sw(along, cs, cw), ztop - hh / 2 + 1 * k);
  return (
    <g key={key}>
      <path d={d} fill="#C4623A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={`M${f(x)} ${f(y + 2 * k)}q-${1.8 * k} -${1.4 * k} 0 -${4.2 * k}q${1.8 * k} ${2.8 * k} 0 ${4.2 * k}Z`} fill={SUN} stroke={INK} strokeWidth={0.6} />
    </g>
  );
}

/** Half width of a gate's closed doors: a third wider than the road's gap, so the doors read clearly. */
const gateW = (g: Gate) => g.half * 1.3;
/** Half size of the towers (posts) beside a gate: the main gate's are a third bigger, so it reads as the village's front door. */
const gatePostHalf = (g: Gate, post: number) => (g.main ? Math.round(post * 1.3) : post);

/**
 * A closed gate between its gate towers: wooden double doors with iron bands, studs, a crossbar and a lock, drawn on the wall's
 * camera-facing plane. The main gate is the full construction; side gates are the same scaled to their width, with a gatehouse
 * about 75% as tall and at most one banner. `wallH` is the height of the wall the gate sits in (a back gatehouse stays above it).
 */
function closedGate(key: string, stage: Exclude<WallLook, 0>, e: Edge, t: number, gt: Gate, wallH: number): ReactNode {
  const { along, c } = e;
  const main = gt.main;
  const mid = gt.at;
  const stone = stage > 1;
  const grand = stage === 4;
  const W = gateW(gt);
  const u0 = mid - W;
  const u1 = mid + W;
  // The face the camera sees: the outer face of the front walls, the inner face of the back walls (both at c + t/2).
  const V = stone ? c + t / 2 : c + 1;
  const ds = main ? 1 : 0.75;
  const Hd = (stage === 2 ? 13 : 19) * ds;
  const rise = stone ? 4 * ds : 0;
  // The gatehouse stands clearly taller than the (low) front wall beside it; side gatehouses 75% of the main one, and a
  // back gatehouse always clears its (tall) wall.
  const mainTop = stage === 1 ? 0 : stage === 2 ? 22 : stage === 3 ? 35 : 46;
  const top = stone ? Math.max(mainTop * (main ? 1 : 0.75), c < 0 ? wallH + 4 : 0) : 0;
  const a = u0 + (stone ? 2 : 0.5);
  const b = u1 - (stone ? 2 : 0.5);
  const q = (s: number, z: number) => at3(along, s, V, z);
  const parts: ReactNode[] = [];
  if (stone) {
    // Gatehouse block over the opening, with merlons on the camera side.
    parts.push(
      wbox(along, 'gh', u0, u1, c - t / 2, c + t / 2, 0, top, STONE, {
        courses: Math.round(top / 5),
        band: grand ? { z0: top - 4, z1: top, left: GOLD.mid, right: GOLD.dark } : stage === 3 ? { z0: top - 3.4, z1: top, left: ROOF.mid, right: ROOF.dark } : undefined,
      }),
    );
    parts.push(...merlonRows(along, u0, u1, c - t / 2, c + t / 2, top, stage >= 3 ? 5 : 4.2));
  }
  // Door outline: straight sides, arched (stone) or stake-pointed (timber) top.
  const n = 12;
  const topAt = (s: number) => {
    if (stone) return Hd + rise * Math.sin((Math.PI * (s - a)) / (b - a));
    const k = Math.floor((s - a) / 3.4);
    const m = a + k * 3.4 + 1.7;
    return Hd + 3 - Math.abs(s - m) * 1.6;
  };
  const arc: string[] = [];
  if (stone) for (let i = n; i >= 0; i--) arc.push(q(a + ((b - a) * i) / n, topAt(a + ((b - a) * i) / n)));
  else for (let s = b; s >= a - 0.01; s -= 0.85) arc.push(q(s, topAt(s)));
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
  for (let s = a + 3; s < b - 1; s += 3) planks += `M${q(s, 0.4)}L${q(s, topAt(s) - 0.6)}`;
  parts.push(<path key="pl" d={planks} stroke={G.plank} strokeWidth={0.7} fill="none" />);
  parts.push(<path key="lit" d={`M${q(a + 1, 0.6)}L${q(a + 1, topAt(a + 1) - 0.8)}`} stroke={G.lit} strokeWidth={0.9} fill="none" />);
  parts.push(<path key="sp" d={`M${q(mid, 0)}L${q(mid, topAt(mid))}`} stroke={INK} strokeWidth={G.sw} fill="none" />);
  // Iron bands with studs.
  const studs: ReactNode[] = [];
  let bands = '';
  for (const zb of [Hd * 0.22, Hd * 0.74]) {
    bands += `M${q(a + 0.4, zb)}L${q(b - 0.4, zb)}`;
    for (let s = a + 1.6; s < b - 1; s += 3.2) {
      const [x, y] = iso(...sw(along, s, V), zb);
      studs.push(<circle key={`s${f(s)}-${f(zb)}`} cx={f(x)} cy={f(y)} r={G.stud} fill={G.studFill} stroke={INK} strokeWidth={0.3} />);
    }
  }
  parts.push(<path key="bd" d={bands} stroke={grand ? GOLD.mid : G.iron} strokeWidth={grand ? G.band + 0.6 : G.band} strokeLinecap="round" fill="none" />);
  parts.push(...studs);
  // Crossbar in iron brackets, and a big padlock hanging from it.
  const zc = Hd * 0.47;
  parts.push(
    <path key="cb" d={`M${q(a - 0.6, zc - 1.5)}L${q(b + 0.6, zc - 1.5)}L${q(b + 0.6, zc + 1.5)}L${q(a - 0.6, zc + 1.5)}Z`} fill={G.bar} stroke={INK} strokeWidth={G.sw * 0.8} strokeLinejoin="round" />,
  );
  let brackets = '';
  for (const s of [a + 3, b - 3]) brackets += `M${q(s - 0.8, zc - 2.3)}L${q(s - 0.8, zc + 2.3)}M${q(s + 0.8, zc - 2.3)}L${q(s + 0.8, zc + 2.3)}`;
  parts.push(<path key="bk" d={brackets} stroke={G.iron} strokeWidth={1.1} fill="none" />);
  const [lx, ly] = iso(...sw(along, mid, V), zc - 1.6);
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
    parts.push(wbox(along, 'ln', u0 - 2, u1 + 2, c - 1.2, c + 1.2, Hd + 4, Hd + 7, { top: G.lit, left: G.wood, right: G.plank }, { sw: G.sw }));
  }
  // Stage 3: one banner above the doors (smaller on the side gates, which have only this one).
  if (stage === 3) parts.push(main ? gateBanner('gb', mid, V, top - 2.5, 1, along) : gateBanner('gb', mid, V, top - 1.2, 0.55, along));
  if (grand) {
    // The main gate: two banners flank a gold sunflower crest above the doors. Side gates carry the crest alone.
    if (main) parts.push(gateBanner('gl', mid - 15, V, top - 6, 1.3, along), gateBanner('gr', mid + 15, V, top - 6, 1.3, along));
    const [x, y] = iso(...sw(along, mid, V), main ? 35 : top - 7.5);
    const rays = Array.from({ length: 10 }, (_, i) => {
      const an = (i / 10) * Math.PI * 2;
      return `M${f(Math.cos(an) * 4.2)} ${f(Math.sin(an) * 4.2)}L${f(Math.cos(an) * 6.6)} ${f(Math.sin(an) * 6.6)}`;
    }).join('');
    // The crest lies flat on the wall face: sheared along +u on a plane v = const, along +v (mirrored) on a plane u = const.
    parts.push(
      <g key="crest" transform={`matrix(${along === 'u' ? 1 : -1} 0.5 0 1 ${f(x)} ${f(y)})${main ? '' : ' scale(0.8)'}`} strokeLinejoin="round" strokeLinecap="round">
        <path d={rays} stroke={INK} strokeWidth={4} fill="none" />
        <path d={rays} stroke={GOLD.mid} strokeWidth={1.8} fill="none" />
        <circle r={4.4} fill={GOLD.mid} stroke={INK} strokeWidth={1.5} />
        <circle r={2.2} fill={ROOF.mid} stroke={INK} strokeWidth={1} />
      </g>,
    );
  }
  return <g key={key}>{parts}</g>;
}

/** How far a ramp runs out from the plate edge, in grid units. */
const RAMP_LEN = 44;
/**
 * The earthen ramp in front of a front gate: a sloping road wedge from the doorway threshold (the plate edge, z = 0) down to
 * the land (LAND_Z). Its top is as wide as the street; only the side facing the camera shows (the +s side), shaded on the
 * front-left ramp and lit on the front-right one, so it reads as an earth causeway like the plate's own sides.
 */
function gateRamp(key: string, e: Edge, gt: Gate): ReactNode {
  const { along } = e;
  const hw = (gt.main ? STREET_W : SIDE_STREET_W) + 3.2;
  const w0 = RP;
  const w1 = RP + RAMP_LEN;
  const s0 = gt.at - hw;
  const s1 = gt.at + hw;
  const p = (s: number, w: number, z: number) => at3(along, s, w, z);
  const side = `M${p(s1, w0, 0)}L${p(s1, w0, LAND_Z)}L${p(s1, w1, LAND_Z)}Z`;
  const top = `M${p(s0, w0, 0)}L${p(s1, w0, 0)}L${p(s1, w1, LAND_Z)}L${p(s0, w1, LAND_Z)}Z`;
  return (
    <g key={key} strokeLinejoin="round" strokeLinecap="round">
      <path d={side} fill={along === 'u' ? '#714B29' : '#B07D46'} stroke={INK} strokeWidth={2.4} />
      <path d={top} fill="#D9B98A" stroke={INK} strokeWidth={2.4} />
      <path d={`M${p(gt.at, w0 + 2, -0.5)}L${p(gt.at, w1 - 2, LAND_Z)}`} stroke="#E8D3A4" strokeWidth={hw * 0.5} strokeDasharray="9 11" strokeLinecap="butt" opacity={0.8} fill="none" />
    </g>
  );
}

interface Edge {
  name: WallSide;
  /** Runs along u (at v = c) or along v (at u = c). */
  along: Along;
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

/** Painter-sorted pieces of the ring wall for a stage (1-4): corner towers, four walls, a gate (with towers) in each wall, ramps at the front gates. */
export function wallItems(stage: Exclude<WallLook, 0>): DepthItem[] {
  const hit = wallCache.get(stage);
  if (hit) return hit;
  const items: DepthItem[] = [];
  // Half-size of the corner towers' footprint (towers stand inside the corner, flush with both edges).
  const grand = stage === 4;
  const corner = stage === 1 ? 9 : stage === 2 ? 13 : grand ? 18 : 16;
  const post = stage === 1 ? 3 : stage === 2 ? 8 : grand ? 11 : 10;
  const t = stage === 1 ? 2 : stage === 2 ? 7 : grand ? 10 : 9;
  // The two walls facing the camera stay low so the village inside shows over them; the two far walls stand tall.
  const hBack = stage === 2 ? 18 : grand ? 34 : 30;
  const hFront = stage === 2 ? 9 : grand ? 18 : 16;
  const chunk = 24;
  const end = RP - 2 * corner + 1;

  for (const e of edges(t)) {
    const near = e.c > 0;
    const h = near ? hFront : hBack;
    const gates = GATES.filter((g) => g.side === e.name).sort((p, q) => p.at - q.at);
    // The wall is split around each gate: it ends at the middle of the gate tower on either side.
    const runs: [number, number][] = [];
    let from = near ? -end : -end + 1; // back walls start exactly at the back tower's face (it is drawn first)
    for (const g of gates) {
      runs.push([from, g.at - gateW(g) - gatePostHalf(g, post)]);
      from = g.at + gateW(g) + gatePostHalf(g, post);
    }
    runs.push([from, end]);
    for (const [a0, b0] of runs) {
      for (let a = a0; a < b0 - 0.5; a += chunk) {
        const b = Math.min(b0, a + chunk);
        const node = stage === 1 ? palisade('p', e.along, e.c, a, b, near ? 0.72 : 1) : stoneRun('s', e.along, e.c, a, b, h, t, stage, grand && b - a > chunk - 0.5 && b < b0 - 3);
        items.push({ key: `w-${e.name}-${f(a)}`, depth: runDepth(e, b, t), node });
      }
    }
    for (const g of gates) {
      // The closed gate, then the gate towers (or posts) on both sides of it, inside the plate edge.
      const gp = gatePostHalf(g, post);
      items.push({ key: `gate-${e.name}`, depth: runDepth(e, g.at + gateW(g), t), node: closedGate(`gate-${e.name}`, stage, e, t, g, h) });
      for (const side of [-1, 1] as const) {
        const s = g.at + side * (gateW(g) + gp);
        const w = (near ? 1 : -1) * (RP - Math.max(gp, t / 2 + 0.3));
        const [u, v] = sw(e.along, s, w);
        const node =
          stage === 1
            ? gatePost('g', u, v, gp)
            : stoneTower('g', u, v, gp, stage === 2 ? 34 : 22, {
                roof: stage >= 3 ? (grand ? 26 : 20) : undefined,
                plinth: stage >= 3 ? (grand ? 40 : 30) : undefined,
                grand,
                banner: stage >= 2 ? 'l' : undefined,
                flag: stage === 2,
              });
        items.push({ key: `g-${e.name}-${side}`, depth: iso(u + gp, v + gp)[1], node });
      }
      // Front gates stand on the raised plate: an earth ramp leads down to the land (the back walls hide the back gates').
      if (near) {
        const hw = (g.main ? STREET_W : SIDE_STREET_W) + 3.2;
        // Sorted by its front-most ground point (the far corner on the visible side), in front of the gate and its towers.
        items.push({ key: `ramp-${e.name}`, depth: iso(...sw(e.along, g.at + hw, RP + RAMP_LEN))[1], node: gateRamp(`ramp-${e.name}`, e, g) });
      }
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
        : stoneTower(`c${i}`, u, v, corner, stage === 2 ? 38 : grand ? 34 : 24, {
            roof: stage >= 3 ? (grand ? 40 : 30) : undefined,
            // The footing rises clearly above the tall back walls (30 + 5 merlons), so the walls butt into its side.
            plinth: stage >= 3 ? (grand ? 48 : 42) : undefined,
            grand,
            turret: stage === 2,
            flag: true,
          });
    // The back tower stands BEHIND the first wall pieces on both sides (they run out in front of its inner faces), so it
    // is sorted by its centre; by its front corner it tied with them (level 13-17) or was drawn over them (max level),
    // which made the walls look like they slid behind the tower's base.
    items.push({ key: `c${i}`, depth: i === 0 ? iso(u, v)[1] : iso(u + corner, v + corner)[1], node });
  });
  wallCache.set(stage, items);
  return items;
}
