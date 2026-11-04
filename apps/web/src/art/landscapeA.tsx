// Village landscape, option A · river valley. The village stands on the bank of a broad river that comes down out of the
// hills at the back right, wraps round the right side and the front of the village, and leaves to the left. Three ranges of
// hills close the valley behind (pale far ridge, wooded ridge, green foothills), taller towards the edges so the middle opens
// up like a valley. The dirt road from the gate crosses the river on a plank bridge; willows and reeds follow the banks, a
// forest fills the left bank, small fields and pasture sit on the near bank.
//
// Same contract as `Landscape` (landscape.tsx): one <g className="vv-land"> drawn BEFORE the plate, so it never covers the
// village and never catches a click. Growth: `tier` 0..3. Tier 0 is a hamlet on the river (bridge, a few trees, two ducks);
// later tiers add trees, two fields, sheep and cows, a jetty and rowboats, sandbars with reeds, more animals.
//
// Deterministic (seeded) and built once; nothing is random at run time.

import { memo } from 'react';
import type { ReactNode } from 'react';
import { INK, K, LW, LandDefs, RP, curve, f, gp, landBox, poly, pt, rectPath, ribbon, rng, wob } from './landscape.tsx';
import type { Item, UV } from './landscape.tsx';
import { FIT, boat, bridge, clamp, hillRow, inFit, jetty, meadowTexture, placeProp, plateGap, put, scatterZones } from './landscapeKit.tsx';
import type { XY, Zone } from './landscapeKit.tsx';

const SKY = '#D6E4DC';
const FAR = { fill: '#BED3C8', shade: '#A9C2B8', line: '#88A39B' };
const WOODED = { fill: '#A8C6AB', shade: '#92B197', line: '#6C8D7E' };
const FOOTHILL = { fill: '#97B96D', shade: '#789A58', line: '#5F8B4D' };
const BANK = '#7FA55F';

const [OX] = gp(0, 0);
/** Ground meets the hills here: a shallow V, so the valley is open in the middle and the hills rise towards the sides. */
const HZ = (x: number) => -10 + 0.22 * Math.abs(x - OX);
const side = (x: number) => Math.abs(x - OX) / 974;

// ---- The river -------------------------------------------------------------------------------------------------------------
const RIVER_PTS: UV[] = [
  [330, -640], [370, -480], [360, -330], [390, -190], [350, -40], [372, 110], [330, 230], [240, 320], [130, 350],
  [10, 342], [-110, 392], [-240, 376], [-360, 420], [-470, 400], [-580, 440],
];
const RIVER = curve(RIVER_PTS, 8);
const riverHalf = (s: number) => 26 + 4 * wob(s, 1);
const onRiver = (u: number, v: number, pad: number) => RIVER.some((q) => Math.hypot(q.u - u, q.v - v) < riverHalf(q.s) + 9 + pad);

/** The road: out of the gate (front-left wall, u = 8), down to the bridge and away to the front left. */
const ROAD_PTS: UV[] = [[8, RP - 12], [10, 270], [12, 310], [9, 345], [2, 385], [-12, 440], [-40, 520], [-80, 610]];
const ROAD = curve(ROAD_PTS, 5);
const ROAD_HALF = 11;
const onRoad = (u: number, v: number, pad: number) => ROAD.some((q) => Math.hypot(q.u - u, q.v - v) < ROAD_HALF + 3 + pad);
const BRIDGE = { u: 9, v: 343, hu: 14, hv: 44 };

interface Plot {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  crop: 'wheat' | 'greens' | 'pasture';
  tier: number;
}
/** Small fields on the near bank, between the wall and the river. */
const PLOTS: Plot[] = [
  { u0: 44, u1: 112, v0: 258, v1: 308, crop: 'wheat', tier: 1 },
  { u0: 124, u1: 190, v0: 236, v1: 290, crop: 'greens', tier: 2 },
  { u0: -118, u1: -46, v0: 262, v1: 320, crop: 'pasture', tier: 2 },
];
const onPlot = (u: number, v: number, pad: number) => PLOTS.some((p) => u > p.u0 - pad && u < p.u1 + pad && v > p.v0 - pad && v < p.v1 + pad);
const blocked = (u: number, v: number, rad: number) => onRiver(u, v, rad) || onRoad(u, v, rad + 4) || onPlot(u, v, rad + 6);

// ---- Items -----------------------------------------------------------------------------------------------------------------
const ZONES: Zone[] = [
  // Forest on the left bank and back left, thick near the wall.
  [['pineA', 'pineB', 'pineA', 'oak'], -330, 20, 90, 250, 62, 1.1, 1.6],
  [['pineA', 'pineB', 'oak'], -300, -250, 100, 90, 24, 1.1, 1.5],
  [['pineA', 'pineB', 'pineA'], -520, 120, 80, 260, 28, 1.2, 1.7],
  // Back, towards the hills: rocks and pines.
  [['rockA', 'rockC', 'rockB', 'pineB'], 60, -340, 150, 50, 14, 1.2, 2],
  [['pineA', 'pineB', 'oak'], 190, -420, 120, 80, 18, 1.1, 1.5],
  // Far bank (right of the river): a wood and meadow bushes.
  [['pineA', 'oak', 'pineB', 'oak'], 470, -60, 60, 260, 26, 1.1, 1.6],
  [['pineB', 'oak', 'pineA'], 520, 280, 70, 120, 12, 1.1, 1.5],
  // Near meadows, low things only.
  [['bush', 'oak', 'bush'], 250, 180, 50, 120, 7, 1, 1.3],
  [['bush', 'bush', 'oak', 'rockB'], -250, 330, 120, 40, 8, 1, 1.4],
  [['bush', 'oak', 'bush'], 120, 470, 200, 70, 14, 1, 1.4],
];

function build(): Item[] {
  const r = rng(4242);
  const items: Item[] = [];
  scatterZones(items, r, ZONES, blocked);
  // Willows and reeds along both banks.
  RIVER.forEach((q, i) => {
    if (i % 5 !== 2) return;
    const sd = i % 10 === 2 ? 1 : -1;
    const o = sd * (riverHalf(q.s) + 16);
    placeProp(items, 'oak', q.u + q.nu * o, q.v + q.nv * o, 1.1 + r() * 0.3, `wl${i}`, i % 3, (u, v, rad) => onRoad(u, v, rad + 4) || onPlot(u, v, rad + 4));
  });
  RIVER.forEach((q, i) => {
    if (i % 4 !== 1) return;
    const sd = i % 8 === 1 ? 1 : -1;
    const o = sd * (riverHalf(q.s) + 5);
    const u = q.u + q.nu * o;
    const v = q.v + q.nv * o;
    const [x, y] = gp(u, v);
    if (Math.abs(q.u - BRIDGE.u) < 50 && Math.abs(q.v - BRIDGE.v) < 50) return;
    if (plateGap(u, v) < 24 || !inFit(x, y)) return;
    items.push({ key: `rd${i}`, x, y, tier: i % 8 === 1 ? 0 : 1, h: 16, w: 8, node: <use href="#vl-reeds" transform={`translate(${f(x)} ${f(y)})`} /> });
  });
  // Animals and farm bits.
  put(items, 'duck0', 'duck', -140, 394, 0);
  put(items, 'duck1', 'duck', 70, 352, 0, true);
  put(items, 'duck2', 'duck', 365, 80, 1);
  put(items, 'duck3', 'duck', -250, 372, 2, true);
  put(items, 'duck4', 'duck', 372, -120, 3);
  put(items, 'deer0', 'deer', -296, 70, 1);
  put(items, 'deer1', 'deer', -318, 104, 2, true);
  put(items, 'deer2', 'deer', 330, -330, 3);
  put(items, 'sheepR0', 'sheep', 225, 215, 0);
  put(items, 'sheepR1', 'sheep', 250, 236, 0, true);
  ([[0.3, 0.3], [0.7, 0.4], [0.45, 0.75]] as const).forEach(([a, b], i) => {
    const p = PLOTS[2]!;
    put(items, `sh${i}`, 'sheep', p.u0 + a * (p.u1 - p.u0), p.v0 + b * (p.v1 - p.v0), 2, i % 2 === 0, 1.2);
  });
  put(items, 'cow0', 'cow', 420, 190, 3, false, 1.05);
  put(items, 'cow1', 'cow', 445, 218, 3, true, 1.05);
  put(items, 'hay0', 'hay', 36, 244, 1, false, 1.1);
  put(items, 'hay1', 'hay', 205, 262, 2, true, 1.1);
  put(items, 'scare', 'scarecrow', PLOTS[0]!.u0 + 30, PLOTS[0]!.v0 + 24, 2, false, 1.05);
  return items.sort((a, b) => a.y - b.y);
}

let cached: Item[] | null = null;
const allItems = () => (cached ??= build());

// ---- Static pieces --------------------------------------------------------------------------------------------------------
const GROUND_TOP: XY[] = [];
for (let x = FIT.x0 - 60; x <= FIT.x1 + 60; x += 24) GROUND_TOP.push([x, HZ(x) + 4 * wob(x, 5)]);
const groundPath = () => `M${GROUND_TOP.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}L${FIT.x1 + 60} ${FIT.y1 + 30}L${FIT.x0 - 60} ${FIT.y1 + 30}Z`;

function hills(): ReactNode[] {
  const r = rng(91);
  const x0 = FIT.x0 - 60;
  const x1 = FIT.x1 + 60;
  const rows = [
    hillRow(r, 'far', x0, x1, { base: (x) => HZ(x) - 20, height: (x) => 110 + 120 * side(x), fill: FAR.fill, shade: FAR.shade, line: FAR.line }),
    hillRow(r, 'wood', x0, x1, { base: (x) => HZ(x) + 4, height: (x) => 60 + 100 * side(x), fill: WOODED.fill, shade: WOODED.shade, line: WOODED.line, wooded: true }),
    hillRow(r, 'foot', x0, x1, { base: (x) => HZ(x) + 26, height: (x) => 30 + 70 * side(x), fill: FOOTHILL.fill, shade: FOOTHILL.shade, line: FOOTHILL.line }),
  ];
  return rows;
}

function riverNodes(): ReactNode {
  const water = poly(ribbon(RIVER, riverHalf));
  const shallow = poly(ribbon(RIVER, (s) => riverHalf(s) - 7));
  const bank = poly(ribbon(RIVER, (s) => riverHalf(s) + 9));
  const grass = poly(ribbon(RIVER, (s) => riverHalf(s) + 13));
  let glints = '';
  RIVER.forEach((q, i) => {
    if (i % 3 !== 0 || (Math.abs(q.u - BRIDGE.u) < 40 && Math.abs(q.v - BRIDGE.v) < 40)) return;
    const o = riverHalf(q.s) * 0.45 * (i % 2 ? 1 : -1);
    const u = q.u + q.nu * o;
    const v = q.v + q.nv * o;
    glints += `M${pt(u - 8, v)}L${pt(u + 8, v + 1)}`;
  });
  return (
    <g strokeLinejoin="round">
      <path d={grass} fill={BANK} stroke={INK} strokeWidth={LW} />
      <path d={bank} fill={K.sand} stroke={INK} strokeWidth={LW} />
      <path d={water} fill={K.water} />
      <path d={shallow} fill={K.waterLight} opacity={0.4} />
      <path d={water} fill="none" stroke={K.waterDark} strokeWidth={1.2} opacity={0.5} />
      <path d={glints} fill="none" stroke={K.waterLight} strokeWidth={2} strokeLinecap="round" opacity={0.9} />
    </g>
  );
}

/** Sandbars inside the river: low sand lenses with a little grass tuft (from tier 1). */
function sandbars(): ReactNode {
  const bars: UV[] = [[344, 190], [-170, 388], [-300, 398]];
  return (
    <g stroke={INK} strokeWidth={LW} strokeLinejoin="round">
      {bars.map(([u, v], i) => {
        const [x, y] = gp(u, v);
        return (
          <g key={i}>
            <ellipse cx={f(x)} cy={f(y)} rx={26} ry={8} fill={K.sand} />
            <path d={`M${f(x - 6)} ${f(y - 1)}l-2 -5M${f(x - 6)} ${f(y - 1)}l0 -6M${f(x - 6)} ${f(y - 1)}l2 -5`} fill="none" stroke="#5F8A3A" strokeWidth={1.4} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
}

function roadNode(): ReactNode {
  const line = ROAD.map((q) => pt(q.u, q.v)).join('L');
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${line}`} stroke={INK} strokeWidth={ROAD_HALF * 2.1 + 3} />
      <path d={`M${line}`} stroke={K.road} strokeWidth={ROAD_HALF * 2.1} />
      <path d={`M${line}`} stroke={K.roadMid} strokeWidth={ROAD_HALF * 0.5} strokeDasharray="9 11" opacity={0.8} />
    </g>
  );
}

function plotNode(p: Plot, i: number): ReactNode {
  const [fill, row] = p.crop === 'wheat' ? [K.wheat, K.wheatRow] : p.crop === 'greens' ? [K.greens, K.greensRow] : [K.meadow, K.grassDark];
  let rows = '';
  if (p.crop === 'pasture') {
    for (let k = 0; k < 12; k++) {
      const u = p.u0 + 6 + ((k * 37) % 100) * ((p.u1 - p.u0 - 12) / 100);
      const v = p.v0 + 6 + ((k * 53) % 100) * ((p.v1 - p.v0 - 12) / 100);
      rows += `M${pt(u, v)}l-2 -4M${pt(u, v)}l0 -5M${pt(u, v)}l2 -4`;
    }
  } else {
    for (let v = p.v0 + 6; v <= p.v1 - 4; v += 6) rows += `M${pt(p.u0 + 3, v)}L${pt(p.u1 - 3, v)}`;
  }
  return (
    <g key={i}>
      <path d={rectPath(p.u0, p.u1, p.v0, p.v1)} fill={fill} stroke={INK} strokeWidth={LW} strokeLinejoin="round" />
      <path d={rows} fill="none" stroke={row} strokeWidth={p.crop === 'pasture' ? 1.4 : 2} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

const STATIC = {
  hills: hills(),
  ground: groundPath(),
  river: riverNodes(),
  bars: sandbars(),
  road: roadNode(),
  bridge: bridge(BRIDGE.u, BRIDGE.v, BRIDGE.hu, BRIDGE.hv),
  jetty: jetty(-122, 346, 378),
};
const MEADOW = meadowTexture(7, FIT.x0, -20, FIT.x1, FIT.y1);

// ---- The layer --------------------------------------------------------------------------------------------------------------

/** Option A landscape. `wide`: desktop (large margin) or phone (small margin); `tier`: village size 0..3. */
export const LandscapeA = memo(function LandscapeA({ tier, wide }: { tier: number; wide: boolean }) {
  const box = landBox(wide);
  const t = clamp(Math.round(tier), 0, 3);
  const shown = allItems().filter((it) => it.tier <= t && it.x + it.w > box.x0 && it.x - it.w < box.x1 && it.y - it.h < box.y1 && it.y > box.y0);
  const sh = RP + 7;
  return (
    <g className="vv-land" strokeLinejoin="round">
      <LandDefs />
      <clipPath id="vla-ground">
        <path d={STATIC.ground} />
      </clipPath>
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={SKY} />
      {STATIC.hills}
      <path d={STATIC.ground} fill={K.grass} />
      <g clipPath="url(#vla-ground)">{MEADOW}</g>
      {PLOTS.filter((p) => p.tier <= t).map(plotNode)}
      {STATIC.river}
      {t >= 1 && STATIC.bars}
      {STATIC.road}
      {STATIC.bridge}
      {t >= 1 && STATIC.jetty}
      {t >= 1 && boat(-112, 398)}
      {t >= 3 && boat(190, 336)}
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
