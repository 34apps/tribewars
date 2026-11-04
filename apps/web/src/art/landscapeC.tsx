// Village landscape, option C · forest and hills. The village sits at the edge of a wild wooded valley: three layers of
// irregular ridges behind it (pale forested ridges, green hills with a contour-following tree line and rock outcrops, grey
// faceted cliffs with scree), a dense forest that is thickest at the back and on the left, a lake with bays, a point, a
// beach, reeds, a jetty and a boat, and the dirt road from the gate that winds along the lake shore and away between trees.
//
// Same contract as `Landscape` (landscape.tsx): one <g className="vv-land"> drawn BEFORE the plate, so it never covers the
// village and never catches a click. Landforms are drawn straight in screen space from seeded, jittered polygons (no
// circles, domes or plain triangles); trees, lake and road sit on the plate's iso grid so they line up with the village.
//
// Growth: `tier` 0..3. Tier 0 is wild (forest right up to the walls, no clearing). Trees near the plate drop out as the
// village grows (each has a last tier), and a woodcutter's clearing (stumps, logs), the jetty, boat and more animals appear.
//
// Deterministic (seeded) and built once; nothing is random at run time.

import { memo } from 'react';
import type { ReactNode } from 'react';
import { INK, K, LW, LandDefs, RP, curve, f, gp, landBox, poly, pt, reachesPlate, ribbon, rng, slab, wob } from './landscape.tsx';
import type { LandBox, Item, UV, Wood } from './landscape.tsx';

type Rng = () => number;
type XY = readonly [number, number];

// ---- Palette (muted, flat; far = paler and bluer) -------------------------------------------------------------------------
const SKY = '#D3E2D6';
const FAR = { fill: '#BCD2C6', shade: '#A8C1B6', line: '#86A29A' };
const WOODED = { fill: '#A6C5A9', shade: '#90B195', line: '#6B8C7D' };
const GREEN = { fill: '#97B96D', lit: '#A9C880', shade: '#789A58', band: '#5F8B4D', bandLine: '#486F3C' };
const ROCK = { lit: '#DAD5C9', mid: '#B4AE9E', dark: '#887F72', cap: '#ECE8DC', ledge: '#6F685C' };
const FLOOR = '#7C9F59';
const DIRT = '#CDB98C';
const BANK = '#7FA55F';
const PEBBLE = '#B9B2A0';
const PLANK: Wood = { top: K.woodLight, left: K.wood, right: K.woodDark };

// ---- Small helpers ----------------------------------------------------------------------------------------------------------
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sp = (pts: readonly XY[]) => pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');
const shapeD = (pts: readonly XY[]) => `M${sp(pts)}Z`;
const lineD = (pts: readonly XY[]) => `M${sp(pts)}`;
const notNull = <T,>(v: T | null): v is T => v !== null;

const [OX, OY] = gp(0, 0);
/** Screen point on the ground plane -> grid (u, v). */
const toUV = (x: number, y: number): UV => {
  const a = (x - OX) / 2;
  const b = y - OY;
  return [a + b, b - a];
};

/** Where the ground meets the hills: a ^ shape (the back corner of the diamond world is the top). Everything behind it is hills. */
const HZ = (x: number) => -40 + 0.32 * Math.abs(x - OX);

const FIT = landBox(true);

/** y of a polyline (x ascending) at x. */
function yAt(pts: readonly XY[], x: number): number {
  let i = 1;
  while (i < pts.length - 1 && pts[i]![0] < x) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  return b[0] === a[0] ? a[1] : lerp(a[1], b[1], clamp((x - a[0]) / (b[0] - a[0]), 0, 1));
}

/** The polyline sampled every `step` in x. */
function sample(pts: readonly XY[], step: number): XY[] {
  const out: XY[] = [];
  const end = pts[pts.length - 1]![0];
  for (let x = pts[0]![0]; x < end; x += step) out.push([x, yAt(pts, x)]);
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Little conifer spikes between the sample points: a tree line seen from far away. */
function spikes(r: Rng, pts: readonly XY[], hMin: number, hMax: number): XY[] {
  const out: XY[] = [];
  pts.forEach((p, i) => {
    out.push(p);
    const q = pts[i + 1];
    if (!q || r() < 0.18) return;
    out.push([(p[0] + q[0]) / 2 + (r() - 0.5) * 2, (p[1] + q[1]) / 2 - (hMin + r() * (hMax - hMin))]);
  });
  return out;
}

/** An irregular closed polygon around a centre (jittered radii and angles; never a circle). */
function lumpy(r: Rng, cx: number, cy: number, rx: number, ry: number, n: number, jit: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + (r() - 0.5) * 0.6) / n) * Math.PI * 2;
    const k = 1 - jit + r() * jit * 1.6;
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return out;
}

// ---- Ridges ---------------------------------------------------------------------------------------------------------------
// A ridge is a jagged, asymmetric skyline: coarse key points (one main peak off-centre, saddles, flat shoulders), then each
// stretch broken up by random displacement. `keys` index the coarse points inside `top`.

interface Ridge {
  top: XY[];
  keys: number[];
}

function ridge(r: Rng, x0: number, x1: number, base: (x: number) => number, h: number, rough: number): Ridge {
  const span = x1 - x0;
  const n = Math.max(4, Math.round(span / (55 + r() * 35)));
  const peakAt = 0.25 + r() * 0.5;
  const ks: XY[] = [[x0, 0]];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const env = t < peakAt ? Math.pow(t / peakAt, 0.8) : Math.pow((1 - t) / (1 - peakAt), 1.35);
    let hh = h * (0.18 + 0.82 * env * (0.6 + 0.4 * r()));
    if (r() < 0.4) hh *= 0.55 + 0.25 * r(); // a saddle
    const x = x0 + span * (t + ((r() - 0.5) * 0.5) / n);
    ks.push([x, hh]);
    if (r() < 0.3 && i < n - 1) ks.push([x + 8 + r() * 8, hh * (0.86 + 0.1 * r())]); // a flat shoulder
  }
  ks.push([x1, 0]);
  ks.sort((a, b) => a[0] - b[0]);
  const top: XY[] = [];
  const keys: number[] = [];
  ks.forEach(([x, hh], i) => {
    if (i > 0) {
      const [xa, ha] = ks[i - 1]!;
      const len = x - xa;
      const m = Math.max(1, Math.round(len / 13));
      for (let k = 1; k < m; k++) {
        const t = k / m;
        const px = lerp(xa, x, t) + (r() - 0.5) * 3;
        const hx = lerp(ha, hh, t) + (r() - 0.5) * rough * Math.min(18, len * 0.3);
        top.push([px, base(px) - Math.max(0, hx)]);
      }
    }
    keys.push(top.length);
    top.push([x, base(x) - hh]);
  });
  return { top, keys };
}

/** Top indices of the coarse peaks (a key higher than both neighbours). */
function peaks(rd: Ridge): number[] {
  const out: number[] = [];
  for (let k = 1; k < rd.keys.length - 1; k++) {
    const y = rd.top[rd.keys[k]!]![1];
    if (y < rd.top[rd.keys[k - 1]!]![1] && y <= rd.top[rd.keys[k + 1]!]![1]) out.push(rd.keys[k]!);
  }
  return out;
}

/**
 * One side of a peak, from the summit down to the next valley, cut off by a wandering spine line: dir 1 = the shaded right
 * face, -1 = the lit left face. `foot(x)` is the ground under the ridge.
 */
function side(r: Rng, rd: Ridge, p: number, foot: (x: number) => number, dir: 1 | -1, full = false): XY[] | null {
  const ys = rd.keys.map((i) => rd.top[i]![1]);
  const k = rd.keys.indexOf(p);
  let e = k;
  while (e + dir >= 0 && e + dir < ys.length && ys[e + dir]! >= ys[e]! - 0.5) e += dir;
  if (e === k) return null;
  const bi = rd.keys[e]!;
  // The face hugs the slope: its lower edge is the slope shifted down by an amount that is largest at the summit and shrinks
  // to nothing at the valley, so the face tapers out along the slope (no vertical or horizontal cut edge anywhere).
  const run = dir > 0 ? rd.top.slice(p, bi + 1) : rd.top.slice(bi, p + 1).reverse();
  const a = rd.top[p]!;
  const depth = full ? (foot(a[0]) - a[1]) * (0.8 + 0.15 * r()) : Math.min(foot(a[0]) - a[1], 14 + (rd.top[bi]![1] - a[1]) * 0.9) * (0.7 + 0.3 * r());
  const last = run.length - 1;
  const inner: XY[] = run.map(([x, y], i) => [x, y + depth * Math.pow(1 - i / last, full ? 0.7 : 1.2) * (0.85 + 0.3 * r())] as XY);
  inner[0] = [a[0] - dir * depth * (0.25 + 0.2 * r()), a[1] + depth];
  inner[last] = run[last]!;
  const out: XY[] = [...run, ...inner.slice(0, last).reverse()];
  return dir > 0 ? out : out.reverse();
}

/** A pale, irregular summit cap (rock above the soil), its underside ragged. */
function cap(r: Rng, rd: Ridge, p: number): XY[] {
  const top = rd.top;
  const py = top[p]![1];
  const depth = 7 + r() * 6;
  let a = p;
  while (a > 0 && top[a - 1]![1] < py + depth) a--;
  let b = p;
  while (b < top.length - 1 && top[b + 1]![1] < py + depth) b++;
  const under: XY[] = [];
  for (let x = top[b]![0]; x > top[a]![0]; x -= 7 + r() * 5) under.push([x, Math.max(yAt(top, x) + 4, py + depth * (0.55 + 0.5 * r()))]);
  return [...top.slice(a, b + 1), ...under];
}

/** A small rock: five or six vertices with strongly varying radii, flattened for the viewing angle. */
function rockPoly(r: Rng, cx: number, cy: number, s: number): XY[] {
  const n = 5 + Math.floor(r() * 2);
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + r() * 0.5) / n) * Math.PI * 2;
    const rad = s * (0.65 + 0.55 * r());
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.62]);
  }
  return out;
}

/** A faceted outcrop (lit left, shaded right) sitting at (x, y). */
function outcrop(r: Rng, key: string, x: number, y: number, w: number): ReactNode {
  const j = () => (r() - 0.5) * 0.24 * w;
  const p: XY[] = [
    [x - w + j(), y + j() * 0.3],
    [x - w * 0.75 + j(), y - w * 0.55 + j()],
    [x - w * 0.2 + j(), y - w * 0.85 + j()],
    [x + w * 0.35 + j(), y - w * 0.6 + j()],
    [x + w + j(), y - w * 0.2 + j()],
    [x + w * 0.8 + j(), y + w * 0.22],
    [x - w * 0.3 + j(), y + w * 0.3],
  ];
  return (
    <g key={key} stroke={INK} strokeWidth={1.1}>
      <path d={shapeD(p)} fill={ROCK.mid} />
      <path d={shapeD([p[0]!, p[1]!, p[2]!, [p[2]![0] + w * 0.1, p[2]![1] + w * 0.5], p[6]!])} fill={ROCK.lit} stroke="none" />
      <path d={shapeD([p[2]!, p[3]!, p[4]!, p[5]!, p[6]!])} fill={ROCK.dark} stroke="none" />
      <path d={shapeD(p)} fill="none" />
    </g>
  );
}

// ---- Layers behind the ground --------------------------------------------------------------------------------------------

interface Back {
  key: string;
  x0: number;
  x1: number;
  node: ReactNode;
}

/** Overlapping spans along x with random widths. */
function tile(r: Rng, a: number, b: number, wMin: number, wMax: number, over: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = a; x < b; ) {
    const w = wMin + r() * (wMax - wMin);
    out.push([x, x + w]);
    x += w - over * (0.6 + 0.8 * r());
  }
  return out;
}

/** Far ridges: pale, hazy; the nearer of the two layers carries a conifer tree line on top. */
function farRidge(r: Rng, key: string, x0: number, x1: number, h: number, base: (x: number) => number, pal: typeof FAR, wooded: boolean): Back {
  const rd = ridge(r, x0, x1, base, h, wooded ? 0.9 : 0.7);
  const deep = (x: number) => HZ(x) + 140;
  const top = wooded ? spikes(r, sample(rd.top, 9), 3, 8) : rd.top;
  const body: XY[] = [...top, [x1, deep(x1)], [x0, deep(x0)]];
  const shades = peaks(rd).map((p) => side(r, rd, p, base, 1)).filter(notNull);
  return {
    key,
    x0,
    x1,
    node: (
      <g key={key} stroke={pal.line} strokeWidth={1.1}>
        <path d={shapeD(body)} fill={pal.fill} stroke="none" />
        {shades.map((s, i) => (
          <path key={i} d={shapeD(s)} fill={pal.shade} stroke="none" />
        ))}
        <path d={lineD(top)} fill="none" />
      </g>
    ),
  };
}

/** Middle hills: green, lit left / shaded right, a dark tree line that keeps one altitude (so it follows the contour), rock outcrops above it. */
function greenHill(r: Rng, key: string, x0: number, x1: number, h: number): Back {
  const base = (x: number) => HZ(x) + 6;
  const deep = (x: number) => HZ(x) + 60;
  const rd = ridge(r, x0, x1, base, h, 0.8);
  const body: XY[] = [...rd.top, [x1, deep(x1)], [x0, deep(x0)]];
  const pk = peaks(rd);
  const ph = r() * 6;
  const line: XY[] = [];
  for (let x = x0; x < x1 + 11; x += 11) {
    const xx = Math.min(x, x1);
    const alt = base(xx) - h * (0.44 + 0.1 * Math.sin(xx * 0.017 + ph)) + (r() - 0.5) * 6;
    line.push([xx, Math.max(yAt(rd.top, xx) + 5, alt)]);
  }
  const band: XY[] = [...spikes(r, line, 3, 8), [x1, deep(x1)], [x0, deep(x0)]];
  const outcrops: ReactNode[] = [];
  pk.forEach((p, i) => {
    for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
      const x = rd.top[p]![0] + (r() - 0.3) * 24;
      const y = yAt(rd.top, x) + 9 + r() * 10;
      if (y < yAt(line, x) - 8) outcrops.push(outcrop(r, `o${i}${k}`, x, y, 8 + r() * 9));
    }
  });
  return {
    key,
    x0,
    x1,
    node: (
      <g key={key} strokeLinejoin="round">
        <path d={shapeD(body)} fill={GREEN.fill} />
        {pk.map((p, i) => {
          const lit = side(r, rd, p, base, -1);
          return lit && <path key={`l${i}`} d={shapeD(lit)} fill={GREEN.lit} />;
        })}
        {pk.map((p, i) => {
          const sh = side(r, rd, p, base, 1);
          return sh && <path key={`s${i}`} d={shapeD(sh)} fill={GREEN.shade} />;
        })}
        <path d={shapeD(band)} fill={GREEN.band} stroke={GREEN.bandLine} strokeWidth={1} />
        {outcrops}
        <path d={shapeD(body)} fill="none" stroke={INK} strokeWidth={LW} />
      </g>
    ),
  };
}

// ---- Items (sorted by depth with the trees) --------------------------------------------------------------------------------

/** An `Item` that is only shown from tier `tier` up to tier `until`. */
interface Prop extends Item {
  until: number;
}

/** Near grey cliffs: faceted faces, pale summit caps, ledges, scree at the foot. Drawn as an item so trees in front of it stay in front. */
function cliff(r: Rng, key: string, x0: number, x1: number, h: number): Prop {
  const base = (x: number) => HZ(x) + 58;
  const rd = ridge(r, x0, x1, base, h, 1.5);
  const foot: XY[] = [];
  for (let x = x1; x > x0; x -= 18 + r() * 14) foot.push([x, base(x) + 2 + r() * 8]);
  foot.push([x0, base(x0) + 4]);
  const body: XY[] = [...rd.top, ...foot];
  const pk = peaks(rd);
  const ledges: string[] = [];
  const caps: ReactNode[] = [];
  const faces: ReactNode[] = [];
  pk.forEach((p, i) => {
    const lit = side(r, rd, p, base, -1, true);
    const dark = side(r, rd, p, base, 1, true);
    if (lit) faces.push(<path key={`l${i}`} d={shapeD(lit)} fill={ROCK.lit} stroke={ROCK.ledge} strokeWidth={0.9} />);
    if (dark) faces.push(<path key={`d${i}`} d={shapeD(dark)} fill={ROCK.dark} stroke={ROCK.ledge} strokeWidth={0.9} />);
    caps.push(<path key={`c${i}`} d={shapeD(cap(r, rd, p))} fill={ROCK.cap} stroke={INK} strokeWidth={1} />);
    const [px, py] = rd.top[p]!;
    for (let k = 0; k < 3; k++) {
      const x = px + (r() - 0.5) * 50;
      const y = py + 34 + r() * Math.max(10, base(px) - py - 48);
      if (y < yAt(rd.top, x) + 14) continue;
      ledges.push(`M${f(x)} ${f(y)}l${f(9 + r() * 7)} ${f((r() - 0.5) * 4)}l${f(8 + r() * 8)} ${f((r() - 0.3) * 4)}`);
    }
  });
  const scree: ReactNode[] = [];
  for (let k = 0; k < 9; k++) {
    const p = pk.length > 0 && r() < 0.7 ? rd.top[pk[Math.floor(r() * pk.length)]!]![0] + (r() - 0.5) * 80 : x0 + 12 + r() * (x1 - x0 - 24);
    const x = clamp(p, x0 + 8, x1 - 8);
    scree.push(<path key={k} d={shapeD(rockPoly(r, x, base(x) + 4 + r() * 12, 5 + r() * 6))} fill={[ROCK.lit, ROCK.mid, ROCK.dark][k % 3]} stroke={INK} strokeWidth={0.9} />);
  }
  const cx = (x0 + x1) / 2;
  return {
    key,
    x: cx,
    y: base(cx) + 6,
    tier: 0,
    until: 3,
    h: h + 10,
    w: (x1 - x0) / 2,
    node: (
      <g strokeLinejoin="round">
        <path d={shapeD(body)} fill={ROCK.mid} />
        {faces}
        <path d={ledges.join('')} fill="none" stroke={ROCK.ledge} strokeWidth={1.2} strokeLinecap="round" opacity={0.7} />
        {caps}
        <path d={shapeD(body)} fill="none" stroke={INK} strokeWidth={1.6} />
        {scree}
      </g>
    ),
  };
}

// ---- Lake, road, clearing (grid coordinates) --------------------------------------------------------------------------------

/** Hand-placed shoreline: bays on the north side, a point reaching south, a land tongue from the west. Rounded by corner cutting. */
const LAKE_RAW: UV[] = [
  [22, 316], [6, 298], [-22, 304], [-48, 292], [-76, 300], [-108, 290], [-140, 300], [-168, 318],
  [-182, 344], [-166, 364], [-140, 360], [-132, 384], [-158, 398], [-176, 420],
  [-150, 440], [-118, 430], [-100, 458], [-76, 452], [-64, 424], [-36, 432], [-6, 424],
  [12, 402], [16, 376], [26, 350],
];
const LAKE_PTS: UV[] = LAKE_RAW.map(([u, v]) => [-96 + (u + 78) * 1.2, 372 + (v - 372) * 1.25] as UV);

function chaikin(pts: readonly UV[], times: number): UV[] {
  let cur: UV[] = [...pts];
  for (let t = 0; t < times; t++) {
    const next: UV[] = [];
    cur.forEach((a, i) => {
      const b = cur[(i + 1) % cur.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    });
    cur = next;
  }
  return cur;
}
const LAKE = chaikin(LAKE_PTS, 2);
const LAKE_C: UV = [LAKE_PTS.reduce((s, p) => s + p[0], 0) / LAKE_PTS.length, LAKE_PTS.reduce((s, p) => s + p[1], 0) / LAKE_PTS.length];

function segDist(u: number, v: number, a: UV, b: UV): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(u - a[0] - t * dx, v - a[1] - t * dy);
}
/** Distance to the shore: negative inside the lake. */
function lakeGap(u: number, v: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = LAKE.length - 1; i < LAKE.length; j = i++) {
    const a = LAKE[i]!;
    const b = LAKE[j]!;
    d = Math.min(d, segDist(u, v, a, b));
    if (a[1] > v !== b[1] > v && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

/** The road: out of the gate (front-left wall, u = 8), east then south round the lake, and away into the forest. */
const ROAD_PTS: UV[] = [
  [8, RP - 12], [16, 252], [34, 280], [62, 316], [68, 352], [58, 396], [34, 440], [-18, 488],
  [-70, 528], [-132, 566], [-200, 612], [-270, 650], [-296, 668],
];
const ROAD = curve(ROAD_PTS, 6);
const roadHalf = (s: number) => 10.5 - 1.5 * clamp(s / 400, 0, 1) + 0.7 * wob(s, 3);
const onRoad = (u: number, v: number, pad: number) => ROAD.some((q) => Math.hypot(q.u - u, q.v - v) < roadHalf(q.s) + pad);

/** Woodcutter's clearing in the back-left forest (appears at tier 1). */
const CLEAR = { u: -296, v: -32, r: 46 };

// ---- Trees -----------------------------------------------------------------------------------------------------------------

type Kind = 'pineA' | 'pineB' | 'oak' | 'bush' | 'rockA' | 'rockB' | 'rockC';
/** Footprint radius and height at scale 1 (the symbols come from the scene's SceneryDefs). */
const KIND: Record<Kind, { rad: number; h: number }> = {
  pineA: { rad: 8, h: 46 },
  pineB: { rad: 9, h: 38 },
  oak: { rad: 9, h: 38 },
  bush: { rad: 6, h: 12 },
  rockA: { rad: 8, h: 14 },
  rockB: { rad: 6, h: 10 },
  rockC: { rad: 8, h: 14 },
};

/** Forest clusters: screen x, y, half width, tree count. Back and left are thick, the front and right thinner. */
const CLUSTERS: [number, number, number, number][] = [
  [480, 38, 150, 11], [270, 100, 130, 11], [690, 96, 130, 11], [90, 190, 120, 11], [-120, 270, 130, 12],
  [-330, 390, 130, 10], [-250, 560, 120, 8], [-420, 470, 110, 8], [60, 700, 120, 7], [330, 760, 130, 7],
  [600, 800, 150, 7], [930, 250, 130, 11], [1110, 340, 130, 10], [1260, 470, 120, 9], [1100, 600, 130, 8],
  [900, 700, 130, 8], [1280, 760, 130, 7], [1380, 600, 100, 6],
];

interface World {
  back: Back[];
  ground: Back[];
  items: Prop[];
  ticks: XY[];
  blooms: XY[];
}

const BEACH = LAKE.filter(([u, v]) => u > -14 && v > 330);
const GROUND_TOP: XY[] = [];
for (let x = FIT.x0 - 60; x <= FIT.x1 + 60; x += 24) GROUND_TOP.push([x, HZ(x) + 8 + 4 * wob(x, 5)]);

function build(): World {
  const r = rng(2026);
  const back: Back[] = [];
  const ground: Back[] = [];
  const items: Prop[] = [];
  const placed: XY[] = [];
  const inBox = (x: number, y: number) => x > FIT.x0 + 10 && x < FIT.x1 - 10 && y > FIT.y0 + 40 && y < FIT.y1 - 4;

  // Hills, far to near. Taller ridges are drawn first so the shorter ones overlap them.
  const layer = (name: string, wMin: number, wMax: number, over: number, hMin: number, hMax: number, make: (key: string, x0: number, x1: number, h: number) => Back) =>
    tile(r, FIT.x0 - 60, FIT.x1 + 60, wMin, wMax, over)
      .map(([x0, x1]) => ({ x0, x1, h: hMin + r() * (hMax - hMin) }))
      .sort((a, b) => b.h - a.h)
      .forEach((s, i) => back.push(make(`${name}${i}`, s.x0, s.x1, s.h)));
  layer('rf', 300, 460, 90, 130, 220, (k, x0, x1, h) => farRidge(r, k, x0, x1, h, (x) => Math.min(HZ(x) - 50, 40), FAR, false));
  layer('rw', 240, 380, 70, 85, 150, (k, x0, x1, h) => farRidge(r, k, x0, x1, h, (x) => HZ(x) - 10, WOODED, true));
  layer('rg', 220, 340, 60, 55, 105, (k, x0, x1, h) => greenHill(r, k, x0, x1, h));

  // Ground texture (patches, grass ticks, a few flowers).
  for (let i = 0; i < 40; i++) {
    const x = FIT.x0 + r() * (FIT.x1 - FIT.x0);
    const y = HZ(x) + 30 + r() * (FIT.y1 - HZ(x) - 30);
    const w = 50 + r() * 80;
    ground.push({ key: `gp${i}`, x0: x - w, x1: x + w, node: <path key={`gp${i}`} d={shapeD(lumpy(r, x, y, w, w * 0.4, 9, 0.4))} fill={i % 3 ? K.grassLight : K.grassDark} opacity={0.45} /> });
  }
  const ticks: XY[] = [];
  const blooms: XY[] = [];
  for (let i = 0; i < 560; i++) {
    const x = FIT.x0 + r() * (FIT.x1 - FIT.x0);
    const y = HZ(x) + 16 + r() * (FIT.y1 - HZ(x) - 16);
    ticks.push([x, y]);
    if (i % 7 === 0) blooms.push([x + 6, y + 3]);
  }

  // Trees. Each is checked against the plate, lake, road and box; `until` drops the ones near the village as it grows.
  const tryItem = (kind: Kind, x: number, y: number, s: number, key: string, from = 0, sep = 6) => {
    const [u, v] = toUV(x, y);
    const k = KIND[kind];
    const rad = k.rad * s;
    const dpl = Math.max(Math.abs(u), Math.abs(v)) - RP;
    if (dpl < 20 + rad * 0.7 || !inBox(x, y) || y < HZ(x) + 6) return;
    if (lakeGap(u, v) < 14 + rad * 0.8 || onRoad(u, v, rad * 0.7 + 4)) return;
    if (reachesPlate(u, v, x, y, rad * 1.2, k.h * s)) return;
    if (placed.some(([px, py]) => Math.abs(px - x) < sep && Math.abs(py - y) < sep * 0.7)) return;
    let until = dpl < 30 ? 0 : dpl < 60 ? (r() < 0.5 ? 1 : 2) : dpl < 90 ? (r() < 0.5 ? 2 : 3) : 3;
    if (Math.hypot(u - CLEAR.u, v - CLEAR.v) < CLEAR.r + rad * 0.6) until = 0;
    placed.push([x, y]);
    items.push({ key, x, y, tier: from, until: Math.max(until, from), h: k.h * s, w: rad, node: <use href={`#vt-${kind}`} transform={`translate(${f(x)} ${f(y)}) scale(${f(s)})`} /> });
  };
  const pick = (x: number): Kind => {
    const t = r();
    const pine = x < 500 ? 0.62 : 0.46;
    return t < pine * 0.55 ? 'pineA' : t < pine ? 'pineB' : t < 0.93 ? 'oak' : 'bush';
  };
  const scaleAt = (x: number, y: number) => lerp(0.8, 1.5, clamp((y - HZ(x)) / 220, 0, 1)) * (0.85 + r() * 0.4);

  // A continuous tree line at the foot of the hills (three ragged rows).
  for (let k = 0; k < 3; k++) {
    for (let x = FIT.x0 + 20 + r() * 30; x < FIT.x1 - 10; x += 40 + r() * 22) {
      if (r() < 0.15) continue;
      const px = x + (r() - 0.5) * 10;
      const py = HZ(px) + 8 + k * 13 + r() * 6;
      tryItem(pick(px), px, py, scaleAt(px, py), `b${k}-${Math.round(x)}`);
    }
  }
  // Dense canopy masses, each on a darker forest floor patch.
  CLUSTERS.forEach(([cx, cy, rx, n], ci) => {
    ground.push({ key: `fl${ci}`, x0: cx - rx, x1: cx + rx, node: <path key={`fl${ci}`} d={shapeD(lumpy(r, cx, cy, rx * 0.9, rx * 0.4, 12, 0.4))} fill={FLOOR} opacity={0.8} /> });
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r());
      const x = cx + Math.cos(a) * rx * d;
      const y = cy + Math.sin(a) * rx * 0.42 * d;
      tryItem(pick(x), x, y, scaleAt(x, y) * 1.1, `c${ci}-${i}`, 0, 4);
    }
  });
  // Scattered single trees and bushes in the open ground between the masses.
  for (let i = 0, n = 0; i < 900 && n < 50; i++) {
    const x = FIT.x0 + r() * (FIT.x1 - FIT.x0);
    const y = HZ(x) + 14 + r() * (FIT.y1 - HZ(x) - 14);
    const [u, v] = toUV(x, y);
    const dpl = Math.max(Math.abs(u), Math.abs(v)) - RP;
    if (r() > clamp((dpl - 30) / 200, 0.1, 0.6)) continue;
    const before = items.length;
    tryItem(pick(x), x, y, scaleAt(x, y), `s${i}`, 0, 26);
    if (items.length > before) n++;
  }
  // Bushes along the road, rocks at the cliff feet and the shore.
  for (let i = 14; i < ROAD.length; i += 9) {
    const q = ROAD[i]!;
    const o = (i % 2 ? 1 : -1) * (roadHalf(q.s) + 12 + r() * 12);
    const [x, y] = gp(q.u + q.nu * o, q.v + q.nv * o);
    tryItem('bush', x, y, 1 + r() * 0.4, `rb${i}`, (i / 9) % 3 === 0 ? 0 : 1, 10);
  }
  for (let i = 0; i < 14; i++) {
    const t = r();
    const x = t < 0.6 ? 790 + r() * 670 : t < 0.8 ? -540 + r() * 480 : 30 + r() * 210;
    const y = HZ(x) + 66 + r() * 60;
    tryItem((['rockA', 'rockB', 'rockC'] as const)[i % 3]!, x, y, 1.1 + r() * 0.7, `rk${i}`, 0, 14);
  }

  // Cliffs (near layer): the right side is the grandest, a smaller group on the left and one behind the back-left forest.
  const cliffs: [number, number, number][] = [
    [790, 1010, 150], [930, 1230, 200], [1160, 1470, 150], [-540, -270, 130], [-350, -70, 165], [30, 240, 110],
  ];
  cliffs.forEach(([x0, x1, h], i) => items.push(cliff(r, `cl${i}`, x0, x1, h)));

  // Lake: reeds, rocks, lily pads, ducks, deer, jetty boat.
  const outward = (u: number, v: number, d: number): UV => {
    const l = Math.hypot(u - LAKE_C[0], v - LAKE_C[1]) || 1;
    return [u + ((u - LAKE_C[0]) / l) * d, v + ((v - LAKE_C[1]) / l) * d];
  };
  const put = (key: string, sym: string, u: number, v: number, from: number, until = 3, flip = false, sc = 1.15) => {
    const [x, y] = gp(u, v);
    items.push({ key, x, y, tier: from, until, h: 26, w: 14, node: <use href={`#vl-${sym}`} transform={`translate(${f(x)} ${f(y)}) scale(${flip ? -sc : sc} ${sc})`} /> });
  };
  [1, 3, 5, 7, 10, 12, 14, 17].forEach((i, k) => {
    const [u, v] = outward(LAKE_PTS[i]![0], LAKE_PTS[i]![1], 5);
    put(`rd${i}`, 'reeds', u, v, k < 4 ? 0 : 1, 3, k % 2 === 0, 1);
  });
  [[5, 'rockA', 9], [12, 'rockB', 8], [15, 'rockC', 10]].forEach(([i, sym, d]) => {
    const [u, v] = outward(LAKE_PTS[i as number]![0], LAKE_PTS[i as number]![1], d as number);
    const [x, y] = gp(u, v);
    items.push({ key: `lr${i}`, x, y, tier: 0, until: 3, h: 14, w: 8, node: <use href={`#vt-${sym}`} transform={`translate(${f(x)} ${f(y)}) scale(1.2)`} /> });
  });
  [[-150, 330, 0], [-135, 322, 1], [-100, 340, 2], [-120, 410, 3]].forEach(([u, v, t], i) => {
    if (lakeGap(u!, v!) > -12) return;
    const [x, y] = gp(u!, v!);
    items.push({ key: `ly${i}`, x, y: y - 30, tier: t!, until: 3, h: 4, w: 7, node: <use href="#vl-lily" transform={`translate(${f(x)} ${f(y)})`} /> });
  });
  ([[-60, 360, 0], [-30, 395, 0], [-110, 325, 2], [-90, 420, 3]] as const).forEach(([u, v, t], i) => {
    if (lakeGap(u, v) < -12) put(`dk${i}`, 'duck', u, v, t, 3, i % 2 === 1);
  });
  put('deer0', 'deer', -214, 296, 0, 3, true);
  put('deer1', 'deer', -246, 336, 2);
  put('deer2', 'deer', 280, -330, 1, 3, true);
  put('deer3', 'deer', 420, -250, 3);
  const [bx, by] = gp(-12, 396);
  items.push({
    key: 'boat', x: bx, y: by, tier: 2, until: 3, h: 14, w: 17,
    node: (
      <g transform={`translate(${f(bx)} ${f(by)})`} stroke={INK} strokeWidth={1.2} strokeLinejoin="round">
        <ellipse cx={1} cy={3} rx={17} ry={5} fill="#FFFFFF" opacity={0.45} stroke="none" />
        <path d="M-16 -3L16 -3Q13 5 0 6Q-13 5 -16 -3Z" fill="#B8603C" />
        <path d="M-16 -3L16 -3Q14 -1.5 0 -1.5Q-14 -1.5 -16 -3Z" fill="#E4B67C" />
        <path d="M-4 -4L8 -11M8 -11L10 -9" fill="none" strokeWidth={1.4} strokeLinecap="round" />
      </g>
    ),
  });

  // Woodcutter's clearing: stumps and log piles (more of them as the village grows), plus a few at the forest edge.
  const deco = (key: string, sym: string, du: number, dv: number, sc: number, from: number) => {
    const [x, y] = gp(CLEAR.u + du, CLEAR.v + dv);
    items.push({ key, x, y, tier: from, until: 3, h: 14, w: 8, node: <use href={`#vt-${sym}`} transform={`translate(${f(x)} ${f(y)}) scale(${sc})`} /> });
  };
  ([[-18, -12, 1], [14, -22, 1], [22, 8, 2], [-26, 14, 2], [4, 22, 3]] as const).forEach(([a, b, t], i) => deco(`st${i}`, 'stump', a, b, 1.3 + (i % 2) * 0.2, t));
  ([[-6, 4, 1], [28, -10, 2], [-30, -6, 3]] as const).forEach(([a, b, t], i) => deco(`lg${i}`, 'logs', a, b, 1.4, t));
  ([[-70, 20, 2], [64, -14, 2], [56, 52, 3]] as const).forEach(([a, b, t], i) => deco(`es${i}`, i % 2 ? 'logs' : 'stump', a, b, 1.3, t));

  return { back, ground, items, ticks, blooms };
}

let cached: World | null = null;
const world = () => (cached ??= build());
const sortedItems = (() => {
  let list: Prop[] | null = null;
  return () => (list ??= [...world().items].sort((a, b) => a.y - b.y));
})();

// ---- Static pieces --------------------------------------------------------------------------------------------------------

const groundPath = (box: LandBox) => {
  const pts: XY[] = [[box.x0, yAt(GROUND_TOP, box.x0)], ...GROUND_TOP.filter(([x]) => x > box.x0 && x < box.x1), [box.x1, yAt(GROUND_TOP, box.x1)]];
  return { fill: shapeD([...pts, [box.x1, box.y1 + 30], [box.x0, box.y1 + 30]]), edge: lineD(pts) };
};

function lakeNodes(): ReactNode {
  const shore = shapeD(LAKE.map(([u, v]) => gp(u, v)));
  const beach = lineD(BEACH.map(([u, v]) => gp(u, v)));
  let glints = '';
  for (const [u, v] of [[-120, 322], [-60, 340], [-20, 372], [-140, 400], [-80, 392], [-40, 410], [-100, 360]] as const) {
    if (lakeGap(u, v) < -14) glints += `M${pt(u - 8, v)}L${pt(u + 8, v + 1)}`;
  }
  let pebbles = '';
  BEACH.forEach(([u, v], i) => {
    if (i % 3 !== 0) return;
    const [pu, pv] = [u + 7 + (i % 2) * 5, v + ((i * 7) % 9) - 4];
    if (lakeGap(pu, pv) > 5) pebbles += `M${pt(pu, pv)}h0`;
  });
  return (
    <g strokeLinejoin="round" strokeLinecap="round" fill="none">
      <path d={shore} stroke={INK} strokeWidth={14} />
      <path d={shore} stroke={BANK} strokeWidth={11} />
      <path d={beach} stroke={INK} strokeWidth={18} />
      <path d={beach} stroke={K.sand} strokeWidth={15} />
      <path d={pebbles} stroke={PEBBLE} strokeWidth={3} />
      <path d={shore} fill={K.water} stroke="none" />
      <clipPath id="vlc-lake">
        <path d={shore} />
      </clipPath>
      <path d={shore} clipPath="url(#vlc-lake)" stroke={K.waterLight} strokeWidth={9} opacity={0.5} />
      <path d={shore} stroke={K.waterDark} strokeWidth={1.2} opacity={0.5} />
      <path d={glints} stroke={K.waterLight} strokeWidth={2} opacity={0.85} />
    </g>
  );
}

function roadNodes(tier: number): ReactNode {
  const outline = poly(ribbon(ROAD, roadHalf));
  const edge = (sign: 1 | -1, k: number) => lineD(ROAD.map((q) => gp(q.u + q.nu * roadHalf(q.s) * k * sign, q.v + q.nv * roadHalf(q.s) * k * sign)));
  const centre = lineD(ROAD.map((q) => gp(q.u, q.v)));
  let tufts = '';
  ROAD.forEach((q, i) => {
    if (i % 4 !== 0 || i < 8) return;
    const sign = i % 8 === 0 ? 1 : -1;
    const [x, y] = gp(q.u + q.nu * (roadHalf(q.s) + 3) * sign, q.v + q.nv * (roadHalf(q.s) + 3) * sign);
    tufts += `M${f(x)} ${f(y)}l-2 -4M${f(x)} ${f(y)}l0 -5M${f(x)} ${f(y)}l2 -4`;
  });
  const spur = poly(ribbon(curve([[62, 377], [46, 376], [30, 377]], 6), () => 5));
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {tier >= 1 && <path d={spur} fill={K.road} stroke={INK} strokeWidth={LW} />}
      <path d={outline} fill={K.road} stroke={INK} strokeWidth={LW} />
      <path d={edge(1, 0.45)} fill="none" stroke="#B4966A" strokeWidth={1.8} opacity={0.8} />
      <path d={edge(-1, 0.45)} fill="none" stroke="#B4966A" strokeWidth={1.8} opacity={0.8} />
      <path d={centre} fill="none" stroke={K.roadMid} strokeWidth={2.4} strokeDasharray="7 11" opacity={0.85} />
      <path d={tufts} fill="none" stroke={K.tick} strokeWidth={1.4} opacity={0.8} />
    </g>
  );
}

function jetty(): ReactNode {
  const posts = [373, 381].flatMap((v) => [-30, -8, 14].map((u) => slab(`jp${u}${v}`, u - 1.4, u + 1.4, v - 1.4, v + 1.4, -6, 8, PLANK, 1)));
  let planks = '';
  for (let u = -26; u < 28; u += 6) planks += `M${pt(u, 371, 4)}L${pt(u, 383, 4)}`;
  return (
    <g>
      {slab('jd', -32, 30, 371, 383, 0, 4, PLANK, 1.4)}
      <path d={planks} stroke={INK} strokeWidth={0.8} opacity={0.4} fill="none" />
      {posts}
    </g>
  );
}

function clearing(): ReactNode {
  const r = rng(11);
  let marks = '';
  for (let k = 0; k < 6; k++) {
    const u = CLEAR.u + (r() - 0.5) * CLEAR.r * 1.2;
    const v = CLEAR.v + (r() - 0.5) * CLEAR.r * 1.2;
    marks += `M${pt(u - 5, v)}L${pt(u + 5, v + 1)}`;
  }
  const outline = poly(lumpy(r, CLEAR.u, CLEAR.v, CLEAR.r, CLEAR.r, 11, 0.3) as UV[]);
  return (
    <g strokeLinejoin="round">
      <path d={outline} fill={DIRT} stroke={INK} strokeWidth={LW} />
      <path d={marks} fill="none" stroke="#B4966A" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

const STATIC = { lake: lakeNodes(), jetty: jetty(), clearing: clearing(), roads: [0, 1, 2, 3].map((t) => roadNodes(t)) };

// ---- The layer --------------------------------------------------------------------------------------------------------------

/** Option C landscape. `wide`: desktop (large margin) or phone (small margin); `tier`: village size 0..3. */
export const LandscapeC = memo(function LandscapeC({ tier, wide }: { tier: number; wide: boolean }) {
  const box = landBox(wide);
  const w = world();
  const t = clamp(Math.round(tier), 0, 3);
  const seen = (b: Back) => b.x1 > box.x0 && b.x0 < box.x1;
  const shown = sortedItems().filter((it) => it.tier <= t && t <= it.until && it.x + it.w > box.x0 && it.x - it.w < box.x1 && it.y - it.h < box.y1 && it.y > box.y0);
  const g = groundPath(box);
  let ticks = '';
  let blooms = '';
  for (const [x, y] of w.ticks) if (x > box.x0 && x < box.x1 && y < box.y1) ticks += `M${f(x)} ${f(y)}l-2 -4M${f(x)} ${f(y)}l0 -5M${f(x)} ${f(y)}l2 -4`;
  for (const [x, y] of w.blooms) if (x > box.x0 && x < box.x1 && y < box.y1) blooms += `M${f(x)} ${f(y)}h0`;
  const sh = RP + 7;
  return (
    <g className="vv-land" strokeLinejoin="round">
      <LandDefs />
      <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={SKY} />
      {w.back.filter(seen).map((b) => b.node)}
      <path d={g.fill} fill={K.grass} />
      {w.ground.filter(seen).map((b) => b.node)}
      <path d={ticks} fill="none" stroke={K.tick} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
      <path d={blooms} fill="none" stroke={K.bloom} strokeWidth={3.2} strokeLinecap="round" />
      <path d={g.edge} fill="none" stroke={INK} strokeWidth={LW} />
      {t >= 1 && STATIC.clearing}
      {STATIC.lake}
      {STATIC.roads[t]}
      {t >= 1 && STATIC.jetty}
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
