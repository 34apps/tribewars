// Shared pieces for the landscape options A (river valley) and B (farmland): seeded tree scatter, a hill skyline, animals,
// a bridge, a dock and a boat. Everything uses the plate's iso grid from landscape.tsx and is deterministic (seeded).

import type { ReactNode } from 'react';
import { INK, K, LW, RP, SHARE, f, gp, landBox, pt, reachesPlate, slab } from './landscape.tsx';
import type { Item, UV, Wood } from './landscape.tsx';

export type Rng = () => number;
export type XY = readonly [number, number];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const FIT = landBox(true);
export const PLANK: Wood = { top: K.woodLight, left: K.wood, right: K.woodDark };

const [OX, OY] = gp(0, 0);
/** Screen point on the ground plane -> grid (u, v). */
export const toUV = (x: number, y: number): UV => {
  const a = (x - OX) / 2;
  const b = y - OY;
  return [a + b, b - a];
};
export const inFit = (x: number, y: number) => x > FIT.x0 + 14 && x < FIT.x1 - 14 && y > FIT.y0 + 40 && y < FIT.y1 - 6;

/** Distance of a grid point from the plate's edge (negative on the plate). */
export const plateGap = (u: number, v: number) => Math.max(Math.abs(u), Math.abs(v)) - RP;

// ---- Trees and rocks ----------------------------------------------------------------------------------------------------
export type Kind = 'pineA' | 'pineB' | 'oak' | 'bush' | 'rockA' | 'rockB' | 'rockC';
/** Symbols come from the scene's SceneryDefs (#vt-…); footprint radius and height at scale 1. */
export const KIND: Record<Kind, { rad: number; h: number }> = {
  pineA: { rad: 8, h: 46 },
  pineB: { rad: 9, h: 38 },
  oak: { rad: 9, h: 38 },
  bush: { rad: 6, h: 12 },
  rockA: { rad: 8, h: 14 },
  rockB: { rad: 6, h: 10 },
  rockC: { rad: 8, h: 14 },
};

/** [kinds, centre u, centre v, spread u, spread v, count, min scale, max scale]. */
export type Zone = [Kind[], number, number, number, number, number, number, number];

/** Places one prop at grid (u, v) if it fits (inside the box, off the plate, not blocked, not on top of another). */
export function placeProp(items: Item[], kind: Kind, u: number, v: number, s: number, key: string, tier: number, blocked: (u: number, v: number, rad: number) => boolean, sep = 4): Item | null {
  const k = KIND[kind];
  const rad = k.rad * s;
  const [x, y] = gp(u, v);
  if (plateGap(u, v) < 22 + rad || !inFit(x, y) || blocked(u, v, rad)) return null;
  if (reachesPlate(u, v, x, y, rad * 1.2, k.h * s)) return null;
  if (items.some((it) => (it.gr ?? 0) > 0 && Math.hypot(u - it.gu!, v - it.gv!) < rad + it.gr! + sep)) return null;
  const it: Item = { key, x, y, tier, h: k.h * s, w: rad, gu: u, gv: v, gr: rad, node: <use href={`#vt-${kind}`} transform={`translate(${f(x)} ${f(y)}) scale(${f(s)})`} /> };
  items.push(it);
  return it;
}

/** Scatters zones of props; inside each zone the first few are always there and the rest arrive as the village grows. */
export function scatterZones(items: Item[], r: Rng, zones: readonly Zone[], blocked: (u: number, v: number, rad: number) => boolean): void {
  zones.forEach(([kinds, cu, cv, su, sv, n, s0, s1], zi) => {
    const zone: Item[] = [];
    for (let i = 0, tries = 0; i < n && tries < n * 60; tries++) {
      const kind = kinds[Math.floor(r() * kinds.length)]!;
      const it = placeProp(items, kind, cu + (r() * 2 - 1) * su, cv + (r() * 2 - 1) * sv, s0 + r() * (s1 - s0), `z${zi}-${i}`, 0, blocked);
      if (it) {
        zone.push(it);
        i++;
      }
    }
    zone.forEach((it, i) => (it.tier = SHARE.findIndex((sh) => i / zone.length < sh)));
  });
}

/** A row of bushes or trees along a grid line, from `a` to `b`. */
export function propRow(items: Item[], r: Rng, key: string, kinds: Kind[], a: UV, b: UV, gap: number, s: number, tierAt: (i: number) => number, blocked: (u: number, v: number, rad: number) => boolean): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.floor(len / gap));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    placeProp(items, kinds[Math.floor(r() * kinds.length)]!, lerp(a[0], b[0], t) + (r() - 0.5) * 3, lerp(a[1], b[1], t) + (r() - 0.5) * 3, s * (0.9 + r() * 0.3), `${key}${i}`, tierAt(i), blocked, 1);
  }
}

/** A symbol (animal, haystack, ...) from LandDefs at a grid point. */
export function put(items: Item[], key: string, sym: string, u: number, v: number, tier: number, flip = false, sc = 1.15): void {
  const [x, y] = gp(u, v);
  items.push({ key, x, y, tier, h: 24, w: 14, node: <use href={`#vl-${sym}`} transform={`translate(${f(x)} ${f(y)}) scale(${flip ? -sc : sc} ${sc})`} /> });
}

// ---- Hill skyline -------------------------------------------------------------------------------------------------------------
export interface HillRow {
  /** Screen y the hills stand on. */
  base: (x: number) => number;
  /** Hill height at x. */
  height: (x: number) => number;
  fill: string;
  shade: string;
  line: string;
  /** Conifer spikes along the crest (a wooded row). */
  wooded?: boolean;
}

/** One smooth, bumpy range: a filled skyline with a shaded lower band and a light crest highlight. */
export function hillRow(r: Rng, key: string, x0: number, x1: number, row: HillRow): ReactNode {
  const ph = [r() * 6, r() * 6, r() * 6];
  const top: XY[] = [];
  for (let x = x0; x <= x1 + 18; x += 18) {
    const bump = 0.55 + 0.3 * Math.sin(x * 0.011 + ph[0]!) + 0.2 * Math.sin(x * 0.027 + ph[1]!) + 0.12 * Math.sin(x * 0.061 + ph[2]!);
    let y = row.base(x) - row.height(x) * clamp(bump, 0.15, 1.1);
    top.push([x, y]);
    if (row.wooded && r() > 0.2) {
      y -= 4 + r() * 5;
      top.push([x + 9, y]);
    }
  }
  const pts = top.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');
  const crest = top.map(([x, y]) => `${f(x)} ${f(y + 5)}`).join('L');
  const foot = Math.max(...top.map((p) => row.base(p[0]))) + 70;
  const body = `M${pts}L${f(top[top.length - 1]![0])} ${f(foot)}L${f(top[0]![0])} ${f(foot)}Z`;
  return (
    <g key={key} strokeLinejoin="round">
      <path d={body} fill={row.fill} />
      <path d={`M${pts}L${f(top[top.length - 1]![0])} ${f(foot)}L${f(top[0]![0])} ${f(foot)}Z`} fill={row.shade} opacity={0.35} transform="translate(0 28)" />
      <path d={`M${crest}`} fill="none" stroke="#FFFFFF" strokeWidth={3} opacity={0.22} strokeLinecap="round" />
      <path d={body} fill="none" stroke={row.line} strokeWidth={1.2} />
    </g>
  );
}

// ---- Wooden things -------------------------------------------------------------------------------------------------------------

/** A plank bridge whose deck runs along v (road direction) and is 2*hu wide in u, centred on (u, v). */
export function bridge(u: number, v: number, hu: number, hv: number): ReactNode {
  const planks: string[] = [];
  for (let s = v - hv + 6; s < v + hv - 2; s += 7) planks.push(`M${pt(u - hu, s, 6)}L${pt(u + hu, s, 6)}`);
  const posts = (uu: number) => [v - hv + 3, v - hv / 3, v + hv / 3, v + hv - 3].map((s) => slab(`p${uu}${s}`, uu - 1.6, uu + 1.6, s - 1.6, s + 1.6, 0, 15, PLANK, 1.1));
  const stone = { top: '#CFC8B8', left: '#A8A294', right: '#807A6E' };
  return (
    <g>
      {slab('ab0', u - hu - 1, u + hu + 1, v - hv - 2, v - hv + 4, 0, 5, stone)}
      {slab('ab1', u - hu - 1, u + hu + 1, v + hv - 4, v + hv + 2, 0, 5, stone)}
      {posts(u - hu + 1.6)}
      {slab('rail0', u - hu, u - hu + 3, v - hv, v + hv, 11, 14, PLANK, 1.1)}
      {slab('deck', u - hu, u + hu, v - hv, v + hv, 2, 6, PLANK, 1.5)}
      <path d={planks.join('')} stroke={INK} strokeWidth={0.8} opacity={0.4} fill="none" />
      {posts(u + hu - 1.6)}
      {slab('rail1', u + hu - 3, u + hu, v - hv, v + hv, 11, 14, PLANK, 1.1)}
    </g>
  );
}

/** A short jetty from (u, v0) running to v1 (v0 < v1), 2*hu wide. */
export function jetty(u: number, v0: number, v1: number, hu = 8): ReactNode {
  const posts = [v0 + 2, (v0 + v1) / 2, v1 - 2].flatMap((s) => [u - hu + 1.5, u + hu - 1.5].map((uu) => slab(`jp${uu}${s}`, uu - 1.4, uu + 1.4, s - 1.4, s + 1.4, -6, 8, PLANK, 1)));
  let planks = '';
  for (let s = v0 + 5; s < v1 - 1; s += 6) planks += `M${pt(u - hu, s, 4)}L${pt(u + hu, s, 4)}`;
  return (
    <g>
      {slab('jd', u - hu, u + hu, v0, v1, 0, 4, PLANK, 1.4)}
      <path d={planks} stroke={INK} strokeWidth={0.8} opacity={0.4} fill="none" />
      {posts}
    </g>
  );
}

/** A rowboat on the water at grid point (u, v). */
export function boat(u: number, v: number): ReactNode {
  const [x, y] = gp(u, v);
  return (
    <g transform={`translate(${f(x)} ${f(y)})`} stroke={INK} strokeWidth={1.2} strokeLinejoin="round">
      <ellipse cx={1} cy={3} rx={17} ry={5} fill="#FFFFFF" opacity={0.45} stroke="none" />
      <path d="M-16 -3L16 -3Q13 5 0 6Q-13 5 -16 -3Z" fill="#B8603C" />
      <path d="M-16 -3L16 -3Q14 -1.5 0 -1.5Q-14 -1.5 -16 -3Z" fill="#E4B67C" />
      <path d="M-4 -4L8 -11M8 -11L10 -9" fill="none" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

/** Meadow texture over a box: lighter and darker patches, grass ticks and white flowers. */
export function meadowTexture(seed: number, x0: number, y0: number, x1: number, y1: number, patches = 50, ticks = 460): ReactNode {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pa: ReactNode[] = [];
  for (let i = 0; i < patches; i++) {
    const rx = 40 + r() * 90;
    pa.push(<ellipse key={i} cx={f(x0 + r() * (x1 - x0))} cy={f(y0 + r() * (y1 - y0))} rx={f(rx)} ry={f(rx * 0.42)} fill={i % 3 ? K.grassLight : K.grassDark} opacity={0.5} />);
  }
  let t = '';
  let b = '';
  for (let i = 0; i < ticks; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    t += `M${f(x)} ${f(y)}l-2 -4M${f(x)} ${f(y)}l0 -5M${f(x)} ${f(y)}l2 -4`;
    if (i % 6 === 0) b += `M${f(x + 6)} ${f(y + 3)}h0`;
  }
  return (
    <g>
      {pa}
      <path d={t} fill="none" stroke={K.tick} strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
      <path d={b} fill="none" stroke={K.bloom} strokeWidth={3.2} strokeLinecap="round" />
    </g>
  );
}

export { LW };
