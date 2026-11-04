// Village landscape, option B · farmland. The village is the centre of a patchwork of farms: a wide, gently rolling plain with
// fields of wheat, greens and plough and pasture, each edged by a hedgerow, split by a farm lane that crosses the road from the
// gate. A farmstead (barn, silo, haystacks) stands to the front left, a duck pond to the left, rows of windbreak trees mark the
// edges, and two soft ranges of hills lie far behind.
//
// Same contract as `Landscape` (landscape.tsx): one <g className="vv-land"> drawn BEFORE the plate, so it never covers the
// village and never catches a click. Growth: `tier` 0..3. Tier 0 is the first ring of fields right at the walls; each higher
// tier adds the next ring outwards (more fields, hedges, scarecrows, haystacks, sheep and cows, the silo).
//
// Deterministic (seeded) and built once; nothing is random at run time.

import { memo } from 'react';
import type { ReactNode } from 'react';
import { INK, K, LW, LandDefs, RP, curve, f, gp, landBox, poly, pt, rectPath, rng, slab, wob } from './landscape.tsx';
import type { Item, UV, Wood } from './landscape.tsx';
import { FIT, clamp, hillRow, meadowTexture, placeProp, plateGap, propRow, put } from './landscapeKit.tsx';
import type { XY } from './landscapeKit.tsx';

const SKY = '#DCE7D8';
const FAR = { fill: '#C9DAC2', shade: '#B4C9AE', line: '#93AD8C' };
const NEAR = { fill: '#A9C77B', shade: '#8FB063', line: '#6F9450' };
const HEDGE = '#5F8A3A';

const [OX] = gp(0, 0);
const HZ = (x: number) => -30 + 0.14 * Math.abs(x - OX);
const side = (x: number) => Math.abs(x - OX) / 974;

// ---- The road and the lane --------------------------------------------------------------------------------------------------
const ROAD_PTS: UV[] = [[8, RP - 12], [10, 290], [10, 380], [14, 470], [20, 560], [26, 650]];
const ROAD = curve(ROAD_PTS, 5);
const ROAD_HALF = 11;
const onRoad = (u: number, v: number, pad: number) => ROAD.some((q) => Math.hypot(q.u - u, q.v - v) < ROAD_HALF + 3 + pad);
/** A farm lane across the front, between the first and second band of fields. */
const LANE_PTS: UV[] = [[-420, 342], [-250, 340], [-100, 343], [10, 340], [140, 338], [300, 342], [470, 340]];
const LANE = curve(LANE_PTS, 8);
const LANE_HALF = 7;

// ---- Fields ----------------------------------------------------------------------------------------------------------------
type Crop = 'wheat' | 'greens' | 'plough' | 'pasture' | 'pond' | 'yard';
interface Cell {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  crop: Crop;
  tier: number;
}

const CROPS: Crop[] = ['wheat', 'greens', 'plough', 'pasture', 'wheat', 'plough', 'greens', 'wheat'];

function cells(): Cell[] {
  const out: Cell[] = [];
  let n = 0;
  const grid = (us: [number, number][], vs: [number, number][]) => {
    for (const [u0, u1] of us) {
      for (const [v0, v1] of vs) {
        const cu = (u0 + u1) / 2;
        const cv = (v0 + v1) / 2;
        const corners: UV[] = [[u0, v0], [u1, v0], [u0, v1], [u1, v1], [cu, cv]];
        if (corners.some(([u, v]) => onRoad(u, v, 6))) continue;
        if (LANE.some((q) => Math.abs(q.u - cu) < (u1 - u0) / 2 + 4 && Math.abs(q.v - cv) < (v1 - v0) / 2 + LANE_HALF + 4)) continue;
        const gap = plateGap(cu, cv);
        const tier = gap < 75 ? 0 : gap < 150 ? 1 : gap < 225 ? 2 : 3;
        out.push({ u0, u1, v0, v1, crop: CROPS[n++ % CROPS.length]!, tier });
      }
    }
  };
  // Right of the village (along the front-right wall), left, behind, and the two bands in front.
  grid([[256, 330], [344, 418], [432, 506]], [[-240, -160], [-150, -70], [-60, 20], [30, 110], [120, 200]]);
  grid([[-330, -256], [-420, -346]], [[-200, -120], [-110, -30], [-20, 60], [70, 150], [160, 236]]);
  grid([[-200, -130], [-120, -50], [-40, 30], [40, 110], [130, 200]], [[-330, -256]]);
  grid([[-330, -250], [-240, -160], [-150, -72], [-62, -16], [34, 110], [120, 196], [206, 282]], [[252, 324], [356, 428], [460, 532]]);
  // The farmstead yard (front left, behind the lane) and the pond (left): they replace the field in that spot.
  const swap = (u: number, v: number, crop: Crop, tier: number) => {
    const c = out.find((q) => u > q.u0 && u < q.u1 && v > q.v0 && v < q.v1);
    if (c) {
      c.crop = crop;
      c.tier = tier;
    }
  };
  swap(-110, 392, 'yard', 0);
  swap(-383, 110, 'pond', 0);
  return out;
}
const CELLS = cells();
const YARD = CELLS.find((c) => c.crop === 'yard');
const POND = CELLS.find((c) => c.crop === 'pond');
const onCell = (u: number, v: number, pad: number) => CELLS.some((c) => u > c.u0 - pad && u < c.u1 + pad && v > c.v0 - pad && v < c.v1 + pad);
const onLane = (u: number, v: number, pad: number) => LANE.some((q) => Math.hypot(q.u - u, q.v - v) < LANE_HALF + 3 + pad);
const blocked = (u: number, v: number, rad: number) => onRoad(u, v, rad + 4) || onLane(u, v, rad + 2) || onCell(u, v, rad * 0.3);

// ---- Items -----------------------------------------------------------------------------------------------------------------
function build(): Item[] {
  const r = rng(555);
  const items: Item[] = [];
  const free = (u: number, v: number, rad: number) => onRoad(u, v, rad + 4) || onLane(u, v, rad + 2) || (POND ? u > POND.u0 - 10 && u < POND.u1 + 10 && v > POND.v0 - 10 && v < POND.v1 + 10 : false);
  // Windbreaks: rows of trees at the outer edges of the farmland, growing in from tier 0.
  propRow(items, r, 'wr', ['pineA', 'pineB', 'oak'], [530, -240], [530, 230], 26, 1.2, (i) => (i % 3 === 0 ? 0 : i % 3), free);
  propRow(items, r, 'wl', ['pineA', 'pineB', 'oak'], [-450, -240], [-450, 240], 26, 1.2, (i) => (i % 3 === 0 ? 0 : i % 3), free);
  propRow(items, r, 'wb', ['pineA', 'oak', 'pineB'], [-240, -360], [240, -360], 28, 1.2, (i) => i % 3, free);
  propRow(items, r, 'wf', ['oak', 'pineB', 'oak'], [-420, 570], [300, 570], 30, 1.2, (i) => 1 + (i % 3 === 0 ? 0 : 1), free);
  // A tree or bush now and then in the hedgerow corners of the fields.
  CELLS.forEach((c, i) => {
    if (c.crop === 'pond' || c.crop === 'yard') return;
    if (r() < 0.55) placeProp(items, r() < 0.7 ? 'oak' : 'bush', c.u1 + 6, c.v0 - 6, 1 + r() * 0.3, `hc${i}`, c.tier, free, 1);
  });
  // Pond: reeds, lilies, ducks.
  if (POND) {
    const cu = (POND.u0 + POND.u1) / 2;
    const cv = (POND.v0 + POND.v1) / 2;
    [[-34, -26, 0], [30, -30, 1], [-36, 24, 1], [34, 26, 2], [0, 34, 2]].forEach(([du, dv, t], i) => {
      const [x, y] = gp(cu + du!, cv + dv!);
      items.push({ key: `pr${i}`, x, y, tier: t!, h: 16, w: 8, node: <use href="#vl-reeds" transform={`translate(${f(x)} ${f(y)})`} /> });
    });
    [[-8, -4, 0], [12, 6, 1], [-4, 12, 2]].forEach(([du, dv, t], i) => {
      const [x, y] = gp(cu + du!, cv + dv!);
      items.push({ key: `pl${i}`, x, y: y - 30, tier: t!, h: 4, w: 7, node: <use href="#vl-lily" transform={`translate(${f(x)} ${f(y)})`} /> });
    });
    put(items, 'duck0', 'duck', cu - 12, cv + 4, 0);
    put(items, 'duck1', 'duck', cu + 14, cv - 8, 0, true);
    put(items, 'duck2', 'duck', cu + 2, cv + 14, 2, true);
  }
  // Animals and farm bits in their fields.
  CELLS.forEach((c, i) => {
    const cu = (c.u0 + c.u1) / 2;
    const cv = (c.v0 + c.v1) / 2;
    if (c.crop === 'pasture') {
      const cow = i % 2 === 0;
      ([[0.3, 0.3], [0.7, 0.45], [0.45, 0.75]] as const).forEach(([a, b], k) => {
        if (cow && k === 2) return;
        put(items, `an${i}-${k}`, cow ? 'cow' : 'sheep', c.u0 + a * (c.u1 - c.u0), c.v0 + b * (c.v1 - c.v0), Math.min(3, c.tier + (k > 0 ? 1 : 0)), k % 2 === 0, cow ? 1.05 : 1.2);
      });
    } else if (c.crop === 'wheat' && i % 3 === 0) {
      put(items, `hy${i}`, 'hay', c.u0 + 14, c.v1 - 10, c.tier, i % 2 === 0, 1.1);
      if (i % 6 === 0) put(items, `sc${i}`, 'scarecrow', cu, cv, Math.min(3, c.tier + 1), false, 1.05);
    }
  });
  put(items, 'deer0', 'deer', -120, -420, 1);
  put(items, 'deer1', 'deer', 90, -430, 3, true);
  // Farmstead: barn from the start, silo and haystacks as the village grows.
  if (YARD) {
    const bu = YARD.u0 + 8;
    const bv = YARD.v0 + 10;
    const [bx, by] = gp(bu + 36, bv + 40);
    items.push({ key: 'barn', x: bx, y: by, tier: 0, h: 44, w: 40, node: barn(bu, bv) });
    const [sx, sy] = gp(YARD.u1 - 12, YARD.v0 + 18);
    items.push({ key: 'silo', x: sx, y: sy, tier: 2, h: 40, w: 12, node: silo(sx, sy) });
    put(items, 'yh0', 'hay', YARD.u1 - 18, YARD.v1 - 12, 1, false, 1.1);
    put(items, 'yh1', 'hay', YARD.u0 + 16, YARD.v1 - 8, 3, true, 1.1);
    put(items, 'yc0', 'cow', YARD.u1 - 30, YARD.v1 - 24, 3, true, 1.05);
  }
  return items.sort((a, b) => a.y - b.y);
}

const BARN: Wood = { top: '#C9B08A', left: '#B8603C', right: '#8F4328' };
const ROOF = { slope: '#7C5A44', gable: '#8F4328', edge: '#5E4130' };

/** A red barn with a gable roof running along u, its low corner at (u, v), 36 wide in u and 28 deep in v. */
function barn(u: number, v: number): ReactNode {
  const u1 = u + 36;
  const v1 = v + 28;
  const vm = v + 14;
  const q = (pts: readonly (readonly [number, number, number])[]) => `M${pts.map(([a, b, z]) => pt(a, b, z)).join('L')}Z`;
  return (
    <g strokeLinejoin="round" stroke={INK} strokeWidth={LW}>
      {slab('bw', u, u1, v, v1, 0, 18, BARN, LW)}
      <path d={q([[u1, v1, 18], [u1, v, 18], [u1, vm, 29]])} fill={BARN.right} />
      <path d={q([[u - 3, v1 + 3, 17], [u1 + 3, v1 + 3, 17], [u1 + 3, vm, 30], [u - 3, vm, 30]])} fill={ROOF.slope} />
      <path d={`M${pt(u - 3, vm, 30)}L${pt(u1 + 3, vm, 30)}`} fill="none" stroke={ROOF.edge} strokeWidth={2} />
      <path d={q([[u + 14, v1, 0], [u + 24, v1, 0], [u + 24, v1, 12], [u + 14, v1, 12]])} fill="#5A3A28" />
      <path d={`M${pt(u + 14, v1, 0)}L${pt(u + 24, v1, 12)}M${pt(u + 24, v1, 0)}L${pt(u + 14, v1, 12)}`} fill="none" strokeWidth={0.9} />
    </g>
  );
}

/** A grain silo at screen point (x, y): a drum with a domed top. */
function silo(x: number, y: number): ReactNode {
  return (
    <g strokeLinejoin="round" stroke={INK} strokeWidth={LW} transform={`translate(${f(x)} ${f(y)})`}>
      <ellipse cx={2} cy={2} rx={13} ry={4.4} fill={INK} opacity={0.2} stroke="none" />
      <path d="M-9 0L-9 -30Q0 -38 9 -30L9 0Q0 5 -9 0Z" fill="#D9D4C6" />
      <path d="M2 -35Q9 -33 9 -30L9 0Q5 2 2 2.5Z" fill="#B5AF9F" stroke="none" />
      <path d="M-9 -30Q0 -25 9 -30" fill="none" />
      <path d="M-9 -20Q0 -15 9 -20M-9 -10Q0 -5 9 -10" fill="none" strokeWidth={0.8} opacity={0.5} />
    </g>
  );
}

let cached: Item[] | null = null;
const allItems = () => (cached ??= build());

// ---- Static pieces ----------------------------------------------------------------------------------------------------------
const GROUND_TOP: XY[] = [];
for (let x = FIT.x0 - 60; x <= FIT.x1 + 60; x += 24) GROUND_TOP.push([x, HZ(x) + 3 * wob(x, 5)]);
const GROUND = `M${GROUND_TOP.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}L${FIT.x1 + 60} ${FIT.y1 + 30}L${FIT.x0 - 60} ${FIT.y1 + 30}Z`;

function hills(): ReactNode[] {
  const r = rng(33);
  const x0 = FIT.x0 - 60;
  const x1 = FIT.x1 + 60;
  return [
    hillRow(r, 'far', x0, x1, { base: (x) => HZ(x) - 6, height: (x) => 70 + 80 * side(x), fill: FAR.fill, shade: FAR.shade, line: FAR.line }),
    hillRow(r, 'near', x0, x1, { base: (x) => HZ(x) + 18, height: (x) => 38 + 46 * side(x), fill: NEAR.fill, shade: NEAR.shade, line: NEAR.line }),
  ];
}

const FILL: Record<Crop, [string, string]> = {
  wheat: [K.wheat, K.wheatRow],
  greens: [K.greens, K.greensRow],
  plough: [K.plough, K.ploughRow],
  pasture: [K.meadow, K.grassDark],
  pond: [K.sand, K.sand],
  yard: ['#D8C9A4', '#B4966A'],
};

function cellNode(c: Cell, i: number): ReactNode {
  const [fill, row] = FILL[c.crop];
  const w = c.u1 - c.u0;
  const h = c.v1 - c.v0;
  let rows = '';
  if (c.crop === 'pasture') {
    for (let k = 0; k < 12; k++) {
      const u = c.u0 + 6 + ((k * 37) % 100) * ((w - 12) / 100);
      const v = c.v0 + 6 + ((k * 53) % 100) * ((h - 12) / 100);
      rows += `M${pt(u, v)}l-2 -4M${pt(u, v)}l0 -5M${pt(u, v)}l2 -4`;
    }
  } else if (c.crop === 'wheat' || c.crop === 'greens' || c.crop === 'plough') {
    // Rows run along u in some fields and along v in others, so the patchwork reads as different farms.
    if (i % 2 === 0) for (let v = c.v0 + 6; v <= c.v1 - 4; v += 6) rows += `M${pt(c.u0 + 3, v)}L${pt(c.u1 - 3, v)}`;
    else for (let u = c.u0 + 6; u <= c.u1 - 4; u += 6) rows += `M${pt(u, c.v0 + 3)}L${pt(u, c.v1 - 3)}`;
  }
  const hedge = `M${pt(c.u0, c.v1, 3)}L${pt(c.u0, c.v0, 3)}L${pt(c.u1, c.v0, 3)}`;
  return (
    <g key={i}>
      <path d={rectPath(c.u0, c.u1, c.v0, c.v1)} fill={fill} stroke={INK} strokeWidth={LW} strokeLinejoin="round" />
      <path d={rows} fill="none" stroke={row} strokeWidth={c.crop === 'pasture' ? 1.4 : 2} strokeLinecap="round" opacity={0.7} />
      {c.crop !== 'pond' && c.crop !== 'yard' && (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={hedge} stroke={INK} strokeWidth={7} />
          <path d={hedge} stroke={HEDGE} strokeWidth={4.6} />
        </g>
      )}
    </g>
  );
}

function pondNode(c: Cell): ReactNode {
  const cu = (c.u0 + c.u1) / 2;
  const cv = (c.v0 + c.v1) / 2;
  const ring = (grow: number): UV[] =>
    Array.from({ length: 28 }, (_, k) => {
      const a = (k / 28) * Math.PI * 2;
      const m = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 5 + 2);
      return [cu + Math.cos(a) * ((c.u1 - c.u0) * 0.4 * m + grow), cv + Math.sin(a) * ((c.v1 - c.v0) * 0.4 * m + grow)] as UV;
    });
  return (
    <g strokeLinejoin="round">
      <path d={poly(ring(5))} fill={K.sand} stroke={INK} strokeWidth={LW} />
      <path d={poly(ring(0))} fill={K.water} stroke={K.waterDark} strokeWidth={1.2} />
      <path d={`M${pt(cu - 20, cv - 8)}L${pt(cu - 6, cv - 7)}M${pt(cu + 6, cv + 8)}L${pt(cu + 20, cv + 9)}`} stroke={K.waterLight} strokeWidth={2} strokeLinecap="round" fill="none" />
    </g>
  );
}

/** A dirt track as one stroked line (with the dark outline under it). */
function track(sm: { u: number; v: number }[], half: number): ReactNode {
  const line = sm.map((q) => pt(q.u, q.v)).join('L');
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${line}`} stroke={INK} strokeWidth={half * 2.1 + 3} />
      <path d={`M${line}`} stroke={K.road} strokeWidth={half * 2.1} />
      <path d={`M${line}`} stroke={K.roadMid} strokeWidth={half * 0.5} strokeDasharray="9 11" opacity={0.8} />
    </g>
  );
}

const STATIC = { hills: hills(), lane: track(LANE, LANE_HALF), road: track(ROAD, ROAD_HALF) };
const MEADOW = meadowTexture(11, FIT.x0, -30, FIT.x1, FIT.y1, 40, 420);

// ---- The layer --------------------------------------------------------------------------------------------------------------

/** Option B landscape. `wide`: desktop (large margin) or phone (small margin); `tier`: village size 0..3. */
export const LandscapeB = memo(function LandscapeB({ tier, wide }: { tier: number; wide: boolean }) {
  const box = landBox(wide);
  const t = clamp(Math.round(tier), 0, 3);
  const shown = allItems().filter((it) => it.tier <= t && it.x + it.w > box.x0 && it.x - it.w < box.x1 && it.y - it.h < box.y1 && it.y > box.y0);
  const vis = (c: Cell) => {
    const [x0] = gp(c.u0, c.v1);
    const [x1] = gp(c.u1, c.v0);
    const [, y0] = gp(c.u0, c.v0);
    const [, y1] = gp(c.u1, c.v1);
    return c.tier <= t && x1 > box.x0 && x0 < box.x1 && y1 > box.y0 && y0 < box.y1;
  };
  const sh = RP + 7;
  return (
    <g className="vv-land" strokeLinejoin="round">
      <LandDefs />
      <clipPath id="vlb-ground">
        <path d={GROUND} />
      </clipPath>
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={SKY} />
      {STATIC.hills}
      <path d={GROUND} fill={K.grass} />
      <g clipPath="url(#vlb-ground)">{MEADOW}</g>
      {CELLS.map((c, i) => ({ c, i }))
        .filter(({ c }) => vis(c))
        .map(({ c, i }) => (c.crop === 'pond' ? <g key={i}>{pondNode(c)}</g> : cellNode(c, i)))}
      {STATIC.lane}
      {STATIC.road}
      {/* contact shadow under the plate, falling to the lower right */}
      <path d={poly([[-sh, -sh], [sh, -sh], [sh, sh], [-sh, sh]])} transform="translate(9 7)" fill={INK} opacity={0.18} />
      {shown.map((it) => (
        <g key={it.key}>{it.node}</g>
      ))}
      {/* a flat veil keeps everything out here a little softer than the village (no gradient) */}
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={K.haze} opacity={0.12} />
    </g>
  );
});
