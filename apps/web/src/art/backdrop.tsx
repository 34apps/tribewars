// Backdrop: the land around the village plate. Drawn in code before the ground plate and the depth-sorted items.
// Covers x -170..770, y -190..500 (the biggest view box is -150..750 x -170..482): sky and two mountain rows at the
// back, hills, meadow, a river with a bridge, a pond, fields and dirt paths leaving the village. Flat shapes with
// warm ink outlines (Toy Diorama), no filters; trees and rocks are depth-sorted items from outerItems().

import { memo } from 'react';
import type { ReactNode } from 'react';

const INK = '#2B211C';
type Pt = readonly [number, number];
type Kind = 'pine' | 'round' | 'rock';
const f = (n: number) => Math.round(n * 10) / 10;

const RIVER: Pt[] = [[-80, -10], [-100, 100], [-70, 220], [-20, 300], [50, 370], [105, 430], [135, 505]];
const POND = { x: 665, y: 385, rx: 75, ry: 34 };
const PATHS: Pt[][] = [
  [[40, 215], [-20, 245], [-90, 262], [-175, 285]],
  [[560, 215], [640, 250], [700, 240], [780, 272]],
  [[300, 90], [322, 40], [296, 10], [304, -20]],
  [[300, 340], [318, 400], [285, 450], [300, 510]],
];
const FIELDS: [number, number, number, string][] = [
  [470, 425, 50, '#E8C468'],
  [555, 462, 46, '#A6C964'],
  [130, 40, 40, '#E8C468'],
  [208, 22, 34, '#A6C964'],
  [470, 30, 40, '#A6C964'],
  [548, 52, 36, '#E8C468'],
];

/** Smooth path through the points (Catmull-Rom as cubic Beziers). */
function smooth(pts: readonly Pt[]): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function distToSeg(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
const nearLine = (x: number, y: number, pts: readonly Pt[], r: number) =>
  pts.some((p, i) => i > 0 && distToSeg(x, y, pts[i - 1]!, p) < r);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Keep trees off the village plate, the river, paths, pond and fields. */
function blocked(x: number, y: number): boolean {
  const dy = y - 203;
  if (Math.abs(x - 300) / 300 + Math.abs(dy) / (dy > 0 ? 165 : 150) < 1.12) return true;
  if (nearLine(x, y, RIVER, 30) || PATHS.some((p) => nearLine(x, y, p, 20))) return true;
  if (((x - POND.x) / (POND.rx + 14)) ** 2 + ((y - POND.y) / (POND.ry + 12)) ** 2 < 1) return true;
  return FIELDS.some(([fx, fy, a]) => Math.abs(x - fx) / (a + 8) + Math.abs(y - fy) / (a / 2 + 8) < 1);
}

/** [kind, centre x, centre y, radius x, radius y, count] */
const ZONES: [Kind, number, number, number, number, number][] = [
  ['pine', 20, 80, 120, 40, 12],
  ['round', 190, 70, 70, 25, 5],
  ['pine', 410, 70, 60, 25, 5],
  ['pine', 640, 95, 130, 45, 14],
  ['pine', 700, 215, 65, 65, 10],
  ['round', 700, 300, 50, 40, 5],
  ['pine', -120, 330, 55, 90, 8],
  ['round', -30, 440, 100, 40, 8],
  ['pine', 215, 440, 85, 40, 9],
  ['round', 395, 330, 60, 30, 3],
  ['round', 145, 330, 50, 25, 3],
  ['rock', 580, 125, 80, 30, 6],
  ['rock', -110, 60, 45, 35, 5],
  ['rock', 520, 385, 35, 25, 3],
  ['rock', 250, 400, 60, 25, 3],
  ['rock', -125, 215, 30, 40, 3],
];

const OUTER_PROPS: [Kind, number, number, number][] = (() => {
  const r = rng(7);
  const out: [Kind, number, number, number][] = [];
  for (const [kind, cx, cy, rx, ry, n] of ZONES) {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r());
      const x = cx + Math.cos(a) * rx * d;
      const y = cy + Math.sin(a) * ry * d;
      if (x < -165 || x > 765 || y < -5 || y > 495 || blocked(x, y)) continue;
      out.push([kind, f(x), f(y), f(kind === 'rock' ? 0.7 + r() * 0.6 : 0.7 + r() * 0.3)]);
      i++;
    }
  }
  return out;
})();

/** Trees and rocks outside the walls, for the painter's sort (symbols #vt-* come from SceneryDefs). */
export function outerItems(): { key: string; depth: number; node: ReactNode }[] {
  return OUTER_PROPS.map(([kind, x, y, s], i) => ({
    key: `o${i}`,
    depth: y,
    node: <use href={`#vt-${kind}`} transform={`translate(${x} ${y}) scale(${s})`} />,
  }));
}

function peak(key: string, cx: number, by: number, w: number, h: number, c: { lit: string; shade: string }, snow: boolean) {
  return (
    <g key={key}>
      <path d={`M${cx - w} ${by}L${cx} ${by - h}L${cx} ${by}Z`} fill={c.lit} />
      <path d={`M${cx} ${by - h}L${cx + w} ${by}L${cx} ${by}Z`} fill={c.shade} />
      {snow && (
        <path
          d={`M${cx} ${by - h}L${f(cx - w * 0.3)} ${f(by - h * 0.7)}L${f(cx - w * 0.12)} ${f(by - h * 0.76)}L${cx} ${f(by - h * 0.64)}L${f(cx + w * 0.14)} ${f(by - h * 0.76)}L${f(cx + w * 0.3)} ${f(by - h * 0.7)}Z`}
          fill="#F1E1C2"
        />
      )}
      <path d={`M${cx - w} ${by}L${cx} ${by - h}L${cx + w} ${by}`} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </g>
  );
}

function dome(key: string, cx: number, by: number, rx: number, ry: number, fill: string, hi: string) {
  const arc = `M${cx - rx} ${by}A${rx} ${ry} 0 0 1 ${cx + rx} ${by}`;
  return (
    <g key={key}>
      <path d={arc + 'Z'} fill={fill} />
      <ellipse cx={f(cx - rx * 0.35)} cy={f(by - ry * 0.62)} rx={f(rx * 0.32)} ry={f(ry * 0.16)} fill={hi} opacity="0.75" />
      <path d={arc} fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function field(key: string, cx: number, cy: number, a: number, fill: string) {
  const h = a / 2;
  // Furrows run parallel to the top-left edge: from the lower-left edge to the top-right edge.
  const furrows = [1, 2, 3, 4]
    .map((i) => {
      const t = i / 5;
      return `M${f(cx - a + a * t)} ${f(cy + h * t)}L${f(cx + a * t)} ${f(cy - h + h * t)}`;
    })
    .join('');
  return (
    <g key={key}>
      <path d={`M${cx} ${cy - h}L${cx + a} ${cy}L${cx} ${cy + h}L${cx - a} ${cy}Z`} fill={fill} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d={furrows} fill="none" stroke="#5E8C3A" strokeWidth="1.6" opacity="0.55" strokeLinecap="round" />
    </g>
  );
}

const GREENS = [
  ['#7FB04E', '#A6C964'],
  ['#8DB85A', '#B6D474'],
  ['#6F9F45', '#9CC565'],
] as const;
const SIDE_HILLS = [
  [-170, 250, 85, 60, 0],
  [-165, 495, 95, 55, 1],
  [785, 330, 95, 60, 2],
  [770, 130, 80, 40, 1],
] as const;
const PATCHES = [
  [-60, 150, 120, 30],
  [250, 130, 110, 24],
  [620, 170, 130, 30],
  [60, 320, 110, 28],
  [380, 360, 130, 30],
  [720, 270, 60, 40],
  [200, 470, 120, 24],
  [580, 120, 90, 20],
] as const;

export const Backdrop = memo(function Backdrop() {
  const r = rng(21);
  const far = { lit: '#C5D2CE', shade: '#9FB3B2' };
  const near = { lit: '#BDB7A9', shade: '#8F897E' };
  const farPeaks = [];
  for (let x = -190, i = 0; x < 800; x += 80 + r() * 40, i++) {
    const h = 90 + r() * 70;
    farPeaks.push(peak(`f${i}`, f(x), -5, f(70 + r() * 25), f(h), far, h > 125));
  }
  const nearPeaks = [];
  for (let x = -160, i = 0; x < 800; x += 70 + r() * 40, i++) {
    nearPeaks.push(peak(`n${i}`, f(x), 55, f(60 + r() * 25), f(45 + r() * 45), near, false));
  }
  const hills = [];
  for (let x = -180, i = 0; x < 800; x += 70 + r() * 25, i++) {
    const g = GREENS[i % 3]!;
    hills.push(dome(`h${i}`, f(x), 82, f(60 + r() * 25), f(26 + r() * 22), g[0], g[1]));
  }
  // Meadow texture: dark grass ticks and a few flowers (one path each).
  const tufts: string[] = [];
  const blooms: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = f(-170 + r() * 940);
    const y = f(100 + r() * 400);
    tufts.push(`M${x} ${y}l-2 -4M${x} ${y}l0 -5M${x} ${y}l2 -4`);
    if (i % 3 === 0) blooms.push(`M${f(x + 6)} ${f(y + 5)}l0 0`);
  }
  return (
    <g className="vv-backdrop">
      <rect x="-170" y="-190" width="940" height="260" fill="#CDE8E3" />
      <ellipse cx="90" cy="-120" rx="48" ry="12" fill="#F7F1E3" />
      <ellipse cx="560" cy="-135" rx="56" ry="13" fill="#F7F1E3" />
      {farPeaks}
      {nearPeaks}
      <rect x="-170" y="52" width="940" height="450" fill="#8DB85A" />
      {PATCHES.map(([x, y, rx, ry], i) => (
        <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="#9CC565" opacity="0.7" />
      ))}
      <path d={tufts.join('')} fill="none" stroke="#5E8C3A" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <path d={blooms.join('')} fill="none" stroke="#F7F1E3" strokeWidth="3.4" strokeLinecap="round" />
      {hills}
      {SIDE_HILLS.map(([x, y, rx, ry, g], i) => dome(`s${i}`, x, y, rx, ry, GREENS[g][0], GREENS[g][1]))}
      {/* river: ink bank, water, light dashes */}
      <path d={smooth(RIVER)} fill="none" stroke={INK} strokeWidth="32" strokeLinecap="round" />
      <path d={smooth(RIVER)} fill="none" stroke="#2F9AA0" strokeWidth="27" strokeLinecap="round" />
      <path d={smooth(RIVER)} fill="none" stroke="#7CC9C9" strokeWidth="6" strokeLinecap="round" strokeDasharray="22 26" />
      <ellipse cx={POND.x} cy={POND.y} rx={POND.rx} ry={POND.ry} fill="#2F9AA0" stroke={INK} strokeWidth="3" />
      <ellipse cx={POND.x - 22} cy={POND.y - 8} rx="26" ry="6" fill="#7CC9C9" opacity="0.8" />
      <ellipse cx={POND.x + 28} cy={POND.y + 10} rx="14" ry="3.5" fill="#7CC9C9" opacity="0.8" />
      {FIELDS.map(([x, y, a, c], i) => field(`fl${i}`, x, y, a, c))}
      {/* dirt paths out of the village */}
      {PATHS.map((p, i) => (
        <path key={`pe${i}`} d={smooth(p)} fill="none" stroke={INK} strokeWidth="19" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {PATHS.map((p, i) => (
        <path key={`pf${i}`} d={smooth(p)} fill="none" stroke="#E4B67C" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* plank bridge where the west path crosses the river */}
      <g transform="translate(-46 252) rotate(-62)">
        <rect x="-24" y="-11" width="48" height="22" rx="2" fill="#B07D46" stroke={INK} strokeWidth="2.4" />
        <path d="M-12 -11V11M0 -11V11M12 -11V11" stroke="#714B29" strokeWidth="1.6" />
      </g>
    </g>
  );
});
