// Overview on the side of the map page: an isometric DIAMOND of the region round the main map's view (same orientation as the main map,
// so the view is a true upright rectangle), on a thin board with coordinate ticks. The free 100 x 100 region shows round village tokens;
// the premium sizes (200 x 200, the whole world) show the TERRITORY MAP: cells tinted by the relation holding the most villages, soft
// borders between areas, a hatch for abandoned villages and gold pins for the player's own. It follows the main map; four small arrow
// notches on the diamond's edges or a drag move the main map. The wide sizes read one light list from the server instead of every chunk.
// Performance: cells are computed once per data refresh, the board lives in an offscreen canvas, a frame is one drawImage plus the view frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { SiteDto } from '@clanfire/engine';
import { useOverviewRows } from '../hooks/useOverviewRows.ts';
import { isUtilitySite } from '../sites.ts';
import { allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import { CHUNK } from './chunks.ts';
import type { MapChunks } from './chunks.ts';
import { DOT_INK, STRONG_COLOR } from './dots.ts';
import type { Size, View } from './iso.ts';
import {
  NOTCH_HIT,
  OUTLINE_TILE,
  OVERVIEW_HINT,
  OVERVIEW_ORDER,
  OVERVIEW_REGION,
  OVERVIEW_ROWS,
  OVERVIEW_SIZES,
  OVERVIEW_STALE_MS,
  countPoints,
  diamondLayout,
  diamondToWorld,
  viewShape,
  notchSpots,
  patchSize,
  regionOf,
  siteHalf,
  tickStep,
  tokenRadius,
  worldToDiamond,
} from './overview.ts';
import type { Notch, OverviewPoint, Region } from './overview.ts';
import { BORDERED, borderSides, buildCells, cellSize, hatchLevel, ownPins, showsCount, tintAlpha } from './territory.ts';
import type { TintRelation } from './territory.ts';
import { FOREST, GRASS, HILLS, LAKE, MOUNTAIN } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

/** Soft flat terrain tints on the parchment board. */
const TINT = { [GRASS]: '#E9EBC8', [FOREST]: '#CCDDA6', [HILLS]: '#E3D6AB', [MOUNTAIN]: '#CBC2B0', [LAKE]: '#B4DADC' } as Record<number, string>;
const FACE_L = '#B07D46';
const FACE_R = '#8A5B30';
const RIM_HI = '#E4B67C';
const LABEL = '#FFF4DE';
const DISPLAY = '"Bagel Fat One", Rubik, system-ui, sans-serif';
const RIM = 14;
const TOP = 4;
const PREF_KEY = 'clanfire.overview';
/** Darker shade of each relation colour: token edges and the soft area borders of the territory map. */
const DARK: Record<TintRelation, string> = { tribe: '#0F6B20', ally: '#0A6E8C', nap: '#9A1F6E', enemy: '#9C1A12', neutral: '#8F8266' };
const HATCH_INK = '#3A352F';
/** Hatch per density level 1..3: line spacing (px) and strength. */
const HATCH = [null, { sp: 3.6, alpha: 0.35 }, { sp: 2.8, alpha: 0.65 }, { sp: 2.2, alpha: 0.95 }] as const;
const TERRAIN_ALPHA_TERRITORY = 0.55;

/** The gold pin of an own village: the tip is at (x, y), the head above it (white ring, gold, ink edge, small flame dot). */
function drawPin(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const path = (rr: number, dy: number) => {
    g.beginPath();
    g.moveTo(x, y + dy);
    g.lineTo(x - rr * 0.8, y - r * 1.1);
    g.arc(x, y - r * 1.7, rr, Math.PI * 0.8, Math.PI * 0.2, false);
    g.closePath();
  };
  path(r, 0.5);
  g.fillStyle = '#FFFFFF';
  g.fill();
  path(r * 0.82, -0.2);
  g.fillStyle = STRONG_COLOR.own;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = DOT_INK;
  g.stroke();
  g.beginPath();
  g.arc(x, y - r * 1.7, r * 0.3, 0, Math.PI * 2);
  g.fillStyle = '#C4623A';
  g.fill();
}

/** A repeating diagonal hatch (drawn at device resolution, scaled back so the line spacing is in CSS px). */
function hatchPattern(g: CanvasRenderingContext2D, sp: number, alpha: number, dpr: number): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(2, Math.round(sp * 2 * dpr));
  const h = c.getContext('2d');
  if (!h) return null;
  h.scale(dpr, dpr);
  h.strokeStyle = HATCH_INK;
  h.globalAlpha = alpha;
  h.lineWidth = 1;
  h.beginPath();
  h.moveTo(0, sp * 2);
  h.lineTo(sp * 2, 0);
  h.moveTo(-sp, sp);
  h.lineTo(sp, -sp);
  h.moveTo(sp, sp * 3);
  h.lineTo(sp * 3, sp);
  h.stroke();
  const p = g.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().scale(1 / dpr));
  return p;
}

interface Prefs {
  span: number;
  large: boolean;
}
function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return { span: OVERVIEW_SIZES.some((s) => s.span === p.span) ? (p.span as number) : OVERVIEW_REGION, large: p.large === true };
  } catch {
    return { span: OVERVIEW_REGION, large: false };
  }
}

interface Props {
  chunks: MapChunks;
  terrain: TerrainCache;
  radius: number;
  sites: readonly SiteDto[];
  /** Bumps whenever map data arrived. */
  version: number;
  /** The Map tab is shown: the overview only fetches while it is. */
  active: boolean;
  /** Premium extra "wide overview". The server checks it again on the whole-world list. */
  premium: boolean;
  viewRef: MutableRefObject<View>;
  sizeRef: MutableRefObject<{ w: number; h: number }>;
  /** The main map registers its "redraw the frame" function here and calls it after each of its own frames. */
  drawRef: MutableRefObject<(() => void) | null>;
  onJump: (x: number, y: number) => void;
}

export function Overview({ chunks, terrain, radius, sites, version, active, premium, viewRef, sizeRef, drawRef, onJump }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [showOthers, setShowOthers] = useState(true);
  const [showAbandoned, setShowAbandoned] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const dragging = useRef(false);

  const span = premium ? prefs.span : OVERVIEW_REGION;
  const large = premium && prefs.large;
  const setPref = (next: Partial<Prefs>) => {
    setPrefs((p) => {
      const n = { ...p, ...next };
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(n));
      } catch {
        // private window: the choice just lasts this visit
      }
      return n;
    });
  };

  // The region follows the main view in steps of a few fields; the draw hook below updates it.
  const [centre, setCentre] = useState(() => ({ x: viewRef.current.cx, y: viewRef.current.cy }));
  const region: Region = useMemo(() => regionOf(span, radius, centre.x, centre.y), [span, radius, centre.x, centre.y]);
  const regionRef = useRef(region);
  regionRef.current = region;
  const spanRef = useRef(span);
  spanRef.current = span;

  const useRows = premium && span !== OVERVIEW_REGION;
  const { rows, failed } = useOverviewRows(active && useRows);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setWidth(Math.floor(box.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Chunks of the region only (through the normal cache), and only while the Map tab is shown and the page visible.
  useEffect(() => {
    if (useRows || !active) {
      chunks.clearRegion();
      return;
    }
    const ask = () => {
      if (!document.hidden) chunks.ensureRegion(region.x0, region.y0, region.x1, region.y1, OVERVIEW_STALE_MS);
    };
    ask();
    const id = window.setInterval(ask, 5000);
    return () => {
      window.clearInterval(id);
      chunks.clearRegion();
    };
  }, [chunks, active, useRows, region.x0, region.y0, region.x1, region.y1]);

  const dpr = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1);
  const dw = Math.max(0, width - 4);
  const height = width > 0 ? TOP + Math.round(dw / 2) + RIM + 6 : 0;
  const layout = useMemo(() => ({ ...diamondLayout(region, dw, TOP), ox: width / 2 }), [region, dw, width]);

  // Villages in the region: from the premium list for the wide sizes, else from the cached chunks.
  const points = useMemo<OverviewPoint[]>(() => {
    void version;
    const out: OverviewPoint[] = [];
    const inside = (x: number, y: number) => x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
    if (useRows) {
      for (const p of rows ?? []) if (inside(p.x, p.y)) out.push(p);
      return out;
    }
    for (let ci = Math.floor(region.x0 / CHUNK); ci <= Math.floor(region.x1 / CHUNK); ci++) {
      for (let cj = Math.floor(region.y0 / CHUNK); cj <= Math.floor(region.y1 / CHUNK); cj++) {
        for (const v of chunks.villagesIn(ci, cj)) if (inside(v.x, v.y)) out.push({ x: v.x, y: v.y, a: allegianceOf(v) });
      }
    }
    return out;
  }, [chunks, version, region, rows, useRows]);
  const counts = useMemo(() => countPoints(points), [points]);
  const loadingPct = useMemo(() => {
    void version;
    if (useRows) return null;
    const c = chunks.coverage(region.x0, region.y0, region.x1, region.y1);
    return c.loaded < c.total ? Math.round((c.loaded / Math.max(1, c.total)) * 100) : null;
  }, [chunks, version, region, useRows]);
  const loadingRows = useRows && rows === null && !failed;
  const sitesIn = useMemo(() => sites.filter((s) => s.x >= region.x0 && s.x <= region.x1 && s.y >= region.y0 && s.y <= region.y1), [sites, region]);

  // Territory cells: computed once per data refresh (the list, the toggles or the cell size), never per frame. Cells are keyed on the whole
  // world, so moving the 200 region only changes which of them are drawn.
  const cs = cellSize(region.span, dw, region.whole);
  const grid = useMemo(() => {
    if (!useRows || !rows) return null;
    return buildCells(
      rows.filter((p) => (p.a !== 'neutral' || showOthers) && (p.a !== 'abandoned' || showAbandoned)),
      cs,
      radius,
    );
  }, [useRows, rows, showOthers, showAbandoned, cs, radius]);

  // Board and terrain: redrawn only when the region or the size changes.
  const ground = useMemo(() => {
    if (width <= 0 || dw <= 0) return null;
    const c = document.createElement('canvas');
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d');
    if (!g) return null;
    g.scale(dpr, dpr);
    const P = (x: number, y: number) => worldToDiamond(layout, region, x, y);
    const e = 0.5;
    const top = P(region.x0 - e, region.y0 - e);
    const right = P(region.x1 + e, region.y0 - e);
    const bottom = P(region.x1 + e, region.y1 + e);
    const left = P(region.x0 - e, region.y1 + e);
    // Slab: two wooden front faces, a highlight on the top edge, then the board.
    const face = (a: { x: number; y: number }, b: { x: number; y: number }, fill: string) => {
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.lineTo(b.x, b.y + RIM);
      g.lineTo(a.x, a.y + RIM);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = DOT_INK;
      g.stroke();
    };
    face(left, bottom, FACE_L);
    face(bottom, right, FACE_R);
    const board = () => {
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(right.x, right.y);
      g.lineTo(bottom.x, bottom.y);
      g.lineTo(left.x, left.y);
      g.closePath();
    };
    board();
    g.fillStyle = TINT[GRASS]!;
    g.fill();
    g.save();
    board();
    g.clip();
    g.globalAlpha = useRows ? TERRAIN_ALPHA_TERRITORY : 1;
    const b = patchSize(region.span, dw);
    const half = Math.floor(b / 2);
    const clampR = (n: number) => Math.max(-radius, Math.min(radius, n));
    for (let gx = Math.floor(region.x0 / b) * b; gx <= region.x1; gx += b) {
      for (let gy = Math.floor(region.y0 / b) * b; gy <= region.y1; gy += b) {
        const t = terrain.get(clampR(gx + half), clampR(gy + half));
        if (t === GRASS) continue;
        const a = P(gx - e, gy - e);
        const r = P(gx + b - e, gy - e);
        const d = P(gx + b - e, gy + b - e);
        const l = P(gx - e, gy + b - e);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(r.x, r.y);
        g.lineTo(d.x, d.y);
        g.lineTo(l.x, l.y);
        g.closePath();
        g.fillStyle = TINT[t] ?? TINT[GRASS]!;
        g.fill();
        g.lineWidth = 0.7;
        g.strokeStyle = TINT[t] ?? TINT[GRASS]!;
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.restore();
    board();
    g.lineJoin = 'round';
    g.lineWidth = 2;
    g.strokeStyle = DOT_INK;
    g.stroke();
    g.beginPath();
    g.moveTo(left.x, left.y + 2);
    g.lineTo(bottom.x, bottom.y + 2);
    g.lineTo(right.x, right.y + 2);
    g.lineWidth = 1.5;
    g.strokeStyle = RIM_HI;
    g.stroke();
    // Coordinate ticks on the two front faces, like the main map's rim.
    const step = tickStep(layout.tile, 40);
    g.font = `400 9px ${DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = LABEL;
    for (let x = Math.ceil(region.x0 / step) * step; x <= region.x1; x += step) {
      const p = P(x, region.y1 + e);
      g.setTransform(dpr, dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + RIM * 0.5 + 1));
      g.fillText(String(x), 0, 0);
    }
    for (let y = Math.ceil(region.y0 / step) * step; y <= region.y1; y += step) {
      const p = P(region.x1 + e, y);
      g.setTransform(dpr, -dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + RIM * 0.5 + 1));
      g.fillText(String(y), 0, 0);
    }
    return c;
  }, [width, height, dw, dpr, region, layout, radius, terrain, useRows]);

  // What sits on the board: round tokens and sites (100 x 100), or the territory cells with gold pins (200 x 200, whole world).
  useEffect(() => {
    if (!ground || width <= 0) return;
    const base = (baseRef.current ??= document.createElement('canvas'));
    base.width = Math.round(width * dpr);
    base.height = Math.round(height * dpr);
    const g = base.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(ground, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tile = layout.tile;
    const P = (x: number, y: number) => worldToDiamond(layout, region, x, y);
    const e = 0.5;
    const own = ownPins(points);
    if (useRows) {
      if (grid) {
        const board = [P(region.x0 - e, region.y0 - e), P(region.x1 + e, region.y0 - e), P(region.x1 + e, region.y1 + e), P(region.x0 - e, region.y1 + e)];
        g.save();
        g.beginPath();
        board.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.clip();
        const size = grid.size;
        const origin = -grid.radius - e;
        const visible = grid.cells.filter((c) => {
          const cx0 = origin + c.i * size;
          const cy0 = origin + c.j * size;
          return cx0 <= region.x1 + e && cx0 + size >= region.x0 - e && cy0 <= region.y1 + e && cy0 + size >= region.y0 - e;
        });
        const quad = (c: { i: number; j: number }) => {
          const a = P(origin + c.i * size, origin + c.j * size);
          const b = P(origin + (c.i + 1) * size, origin + c.j * size);
          const d = P(origin + (c.i + 1) * size, origin + (c.j + 1) * size);
          const l = P(origin + c.i * size, origin + (c.j + 1) * size);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.lineTo(d.x, d.y);
          g.lineTo(l.x, l.y);
          g.closePath();
        };
        // Tints.
        for (const c of visible) {
          if (!c.tint) continue;
          quad(c);
          g.globalAlpha = tintAlpha(c.tint, c.players);
          g.fillStyle = STRONG_COLOR[c.tint];
          g.fill();
          g.lineWidth = 0.5;
          g.strokeStyle = STRONG_COLOR[c.tint];
          g.stroke();
        }
        g.globalAlpha = 1;
        // Abandoned hatch: denser with the count, from a low threshold on.
        const patterns = HATCH.map((h) => (h ? hatchPattern(g, h.sp, h.alpha, dpr) : null));
        for (const c of visible) {
          const lv = hatchLevel(c.abandoned, size);
          const pat = lv ? patterns[lv] : null;
          if (!pat) continue;
          quad(c);
          g.fillStyle = pat;
          g.fill();
        }
        // Soft borders where the tint changes (tribe, ally, pact and enemy areas).
        g.lineCap = 'round';
        g.lineJoin = 'round';
        for (const rel of BORDERED) {
          g.beginPath();
          for (const c of visible) {
            if (c.tint !== rel) continue;
            const x = origin + c.i * size;
            const y = origin + c.j * size;
            const sides: Array<[number, number, number, number]> = [
              [x, y, x + size, y],
              [x + size, y, x + size, y + size],
              [x, y + size, x + size, y + size],
              [x, y, x, y + size],
            ];
            for (const side of borderSides(grid, c)) {
              const [ax, ay, bx, by] = sides[side]!;
              const A = P(ax, ay);
              const B = P(bx, by);
              g.moveTo(A.x, A.y);
              g.lineTo(B.x, B.y);
            }
          }
          g.strokeStyle = DARK[rel];
          g.lineWidth = region.whole ? 1.4 : 2;
          g.globalAlpha = 0.75;
          g.stroke();
          g.globalAlpha = 1;
        }
        // Abandoned counts on the busiest cells (fine cells only).
        g.font = `400 9px ${DISPLAY}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 2.5;
        for (const c of visible) {
          if (!showsCount(c.abandoned, size)) continue;
          const m = P(origin + (c.i + 0.5) * size, origin + (c.j + 0.5) * size);
          g.strokeStyle = '#FFFAF0';
          g.strokeText(String(c.abandoned), m.x, m.y + 0.5);
          g.fillStyle = DOT_INK;
          g.fillText(String(c.abandoned), m.x, m.y + 0.5);
        }
        g.restore();
      }
      // Own villages: gold pins on top of everything.
      const pr = (region.whole ? 3 : 4.2) * (dw > 400 ? 1.25 : 1);
      for (const p of own) {
        const q = P(p.x, p.y);
        drawPin(g, q.x, q.y, pr);
      }
    } else {
      const byKind = new Map<MapAllegiance, Array<{ x: number; y: number }>>();
      for (const p of points) {
        if (p.a === 'neutral' && !showOthers) continue;
        if (p.a === 'abandoned' && !showAbandoned) continue;
        const list = byKind.get(p.a) ?? [];
        list.push(P(p.x, p.y));
        byKind.set(p.a, list);
      }
      const outline = tile >= OUTLINE_TILE;
      for (const a of OVERVIEW_ORDER) {
        const list = byKind.get(a);
        if (!list) continue;
        const r = tokenRadius(a, tile);
        for (const p of list) {
          if (a === 'own') {
            drawPin(g, p.x, p.y, Math.max(3.4, r * 0.8));
            continue;
          }
          g.beginPath();
          if (a === 'abandoned') {
            // A small hollow ring in the hatch's ink (a plain dot when a field is a pixel or less).
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            if (r >= 1.6) {
              g.lineWidth = 1.2;
              g.strokeStyle = STRONG_COLOR.abandoned;
              g.stroke();
            } else {
              g.fillStyle = STRONG_COLOR.abandoned;
              g.fill();
            }
          } else {
            // A relation token: a pale halo, the relation colour and an edge in its darker shade (like the territory areas).
            if (outline) {
              g.arc(p.x, p.y, r + 1.1, 0, Math.PI * 2);
              g.fillStyle = 'rgba(255,250,240,0.85)';
              g.fill();
              g.beginPath();
            }
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            g.fillStyle = STRONG_COLOR[a];
            g.fill();
            if (outline) {
              g.lineWidth = 1;
              g.strokeStyle = DARK[a as TintRelation];
              g.stroke();
            }
          }
        }
      }
      // Sites: tiny flames (utility sites tiny diamonds).
      const h = siteHalf(tile);
      for (const st of sitesIn) {
        const p = P(st.x, st.y);
        g.beginPath();
        if (isUtilitySite(st.kind)) {
          g.moveTo(p.x, p.y - h);
          g.lineTo(p.x + h, p.y);
          g.lineTo(p.x, p.y + h);
          g.lineTo(p.x - h, p.y);
          g.closePath();
        } else {
          g.moveTo(p.x, p.y - h * 1.7);
          g.bezierCurveTo(p.x + h * 1.2, p.y - h * 0.4, p.x + h * 0.95, p.y + h, p.x, p.y + h);
          g.bezierCurveTo(p.x - h * 0.95, p.y + h, p.x - h * 1.2, p.y - h * 0.4, p.x, p.y - h * 1.7);
          g.closePath();
        }
        g.fillStyle = st.awake && !isUtilitySite(st.kind) ? '#FFB52E' : '#F4F1EA';
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = DOT_INK;
        g.stroke();
      }
    }
    drawRef.current?.();
  }, [ground, width, height, dpr, dw, layout, region, points, sitesIn, showOthers, showAbandoned, drawRef, useRows, grid]);

  const draw = useCallback(() => {
    // Follow the main map: when its centre drifts out of the region's step, move the region.
    const v = viewRef.current;
    const want = regionOf(spanRef.current, radius, v.cx, v.cy);
    const have = regionRef.current;
    if (want.x0 !== have.x0 || want.y0 !== have.y0) setCentre({ x: v.cx, y: v.cy });
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base || width <= 0) return;
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = sizeRef.current;
    if (w <= 0 || h <= 0) return;
    const size: Size = { w, h };
    const r = regionRef.current;
    const shape = viewShape(layout, r, v, size);
    // The view: its footprint clipped to the board diamond (so nothing outside the world is drawn), a thin light line over a dark
    // hairline; only a centre cross (kept on the board) when the view covers most of the board or hardly any of it is inside.
    const P = (x: number, y: number) => worldToDiamond(layout, r, x, y);
    const t0 = P(r.x0 - 0.5, r.y0 - 0.5);
    const t1 = P(r.x1 + 0.5, r.y0 - 0.5);
    const t2 = P(r.x1 + 0.5, r.y1 + 0.5);
    const t3 = P(r.x0 - 0.5, r.y1 + 0.5);
    g.save();
    g.beginPath();
    g.moveTo(t0.x, t0.y);
    g.lineTo(t1.x, t1.y);
    g.lineTo(t2.x, t2.y);
    g.lineTo(t3.x, t3.y);
    g.closePath();
    g.clip();
    g.lineJoin = 'miter';
    if (shape.kind === 'frame') {
      g.beginPath();
      shape.poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = 'rgba(40,28,18,0.6)';
      g.stroke();
      g.lineWidth = 1.2;
      g.strokeStyle = '#FFFFFF';
      g.stroke();
    }
    const arm = shape.kind === 'frame' ? 3 : 6;
    g.beginPath();
    g.moveTo(shape.cx - arm, shape.cy);
    g.lineTo(shape.cx + arm, shape.cy);
    g.moveTo(shape.cx, shape.cy - arm);
    g.lineTo(shape.cx, shape.cy + arm);
    g.lineWidth = 2.4;
    g.strokeStyle = 'rgba(40,28,18,0.6)';
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeStyle = '#FFFFFF';
    g.stroke();
    g.restore();
  }, [width, dpr, radius, layout, viewRef, sizeRef]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
    return () => {
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, [draw, drawRef]);

  const jump = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = diamondToWorld(layout, regionRef.current, ((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height, radius);
    onJump(w.x, w.y);
  };
  const nudge = (n: Notch) => {
    const k = Math.max(5, Math.round(region.span / 4));
    const v = viewRef.current;
    onJump(Math.max(-radius, Math.min(radius, v.cx + n.dx * k)), Math.max(-radius, Math.min(radius, v.cy + n.dy * k)));
  };
  const notches = useMemo(() => (width > 0 ? notchSpots(layout, region, RIM) : []), [layout, region, width]);

  const toggles: Array<{ label: string; on: boolean; set: (b: boolean) => void }> = [
    { label: 'Others', on: showOthers, set: setShowOthers },
    { label: 'Abandoned', on: showAbandoned, set: setShowAbandoned },
  ];
  const where = region.whole ? `Whole world, ${region.span} x ${region.span} fields` : `${region.span} x ${region.span} fields around ${Math.round(region.cx)}, ${Math.round(region.cy)}`;
  const territoryRows = OVERVIEW_ROWS.filter((r) => r.key !== 'abandoned');

  return (
    <aside className={`wm-side${large ? ' wm-side-large' : useRows ? ' wm-side-wide' : ''}`} aria-label="Region overview">
      <div className="wm-ov-card">
        <div className="wm-ov-head">
          <h2 className="wm-side-title">Overview</h2>
          <div className={`wm-ov-expand${premium ? '' : ' is-locked'}`}>
            <span className="wm-ov-expand-label">Expand</span>
            <div className="wm-ov-sizes" role="radiogroup" aria-label="Area shown">
              {OVERVIEW_SIZES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={span === s.span}
                  className={`wm-ov-size${span === s.span ? ' is-on' : ''}`}
                  disabled={!premium}
                  onClick={() => setPref({ span: s.span })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="wm-ov-board" ref={boxRef}>
          <canvas
            ref={canvasRef}
            className="wm-ov-canvas"
            style={{ width: width || '100%', height: height || undefined }}
            role="img"
            aria-label={`Overview of ${where}. Click or drag to move the map.`}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              jump(e);
            }}
            onPointerMove={(e) => dragging.current && jump(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          />
          {notches.map((n) => (
            <button
              key={n.key}
              type="button"
              className="wm-ov-notch"
              style={{ left: n.x - NOTCH_HIT / 2, top: n.y - NOTCH_HIT / 2, width: NOTCH_HIT, height: NOTCH_HIT }}
              aria-label={`Move the map ${n.key}`}
              onClick={() => nudge(n)}
            >
              <svg viewBox="-8 -8 16 16" aria-hidden="true" style={{ transform: `rotate(${n.angle}rad)` }}>
                <path d="M5.5 0L-3.5 -5L-3.5 5Z" />
              </svg>
            </button>
          ))}
        </div>
        <p className="wm-ov-hint">{OVERVIEW_HINT}</p>
        {loadingRows && <p className="wm-ov-note">Loading the world…</p>}
        {loadingPct !== null && <p className="wm-ov-note">Loading this area… {loadingPct}%</p>}
        {useRows && failed && rows === null && <p className="wm-ov-note">The wide overview could not be loaded. It will try again.</p>}
        <h3 className="wm-ov-sub">{region.whole ? 'In the whole world' : 'In this area'}</h3>
        <ul className="wm-ov-legend">
          {(useRows ? territoryRows : OVERVIEW_ROWS).map((r) => (
            <li key={r.key}>
              <Swatch kind={r.key} territory={useRows} />
              <span className="wm-ov-label">{r.label}</span>
              <b className="wm-ov-count">{counts[r.key].toLocaleString('en')}</b>
            </li>
          ))}
          {useRows ? (
            <>
              <li>
                <Swatch kind="abandoned" territory />
                <span className="wm-ov-label">Abandoned<span className="wm-ov-opt"> (hatch)</span></span>
                <b className="wm-ov-count">{counts.abandoned.toLocaleString('en')}</b>
              </li>
              <li>
                <Swatch kind="open" territory />
                <span className="wm-ov-label">Open ground</span>
                <b className="wm-ov-count wm-ov-count-soft">empty</b>
              </li>
            </>
          ) : (
            <li>
              <span className="wm-ov-tok wm-ov-tok-site" aria-hidden="true" />
              <span className="wm-ov-label">Fire sites</span>
              <b className="wm-ov-count">{sitesIn.length}</b>
            </li>
          )}
        </ul>
        <div className="wm-ov-toggles">
          {toggles.map((t) => (
            <label key={t.label}>
              <input type="checkbox" checked={t.on} onChange={(e) => t.set(e.target.checked)} /> Show {t.label.toLowerCase()}
            </label>
          ))}
          <button type="button" className={`wm-ov-size wm-ov-large${large ? ' is-on' : ''}`} aria-pressed={large} disabled={!premium} onClick={() => setPref({ large: !prefs.large })}>
            Large view
          </button>
        </div>
        {!premium && <p className="wm-ov-note">Expand (200, World) and the large view are part of Premium.</p>}
      </div>
    </aside>
  );
}

/** Legend swatch: gold pin (own), relation-coloured diamond (territory) or round token (100 x 100), hatched diamond, open ground. */
function Swatch({ kind, territory }: { kind: MapAllegiance | 'open'; territory: boolean }) {
  if (kind === 'own') {
    return (
      <svg className="wm-ov-sw" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 18.5L5.6 10.4A5.2 5.2 0 1 1 14.4 10.4Z" fill={STRONG_COLOR.own} stroke={DOT_INK} strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="10" cy="7" r="1.7" fill="#C4623A" />
      </svg>
    );
  }
  if (kind === 'open' || (kind === 'abandoned' && territory)) {
    const hatch = kind === 'abandoned';
    return (
      <svg className="wm-ov-sw" viewBox="0 0 20 20" aria-hidden="true">
        {hatch && (
          <defs>
            <pattern id="wm-ov-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="3" stroke={HATCH_INK} strokeWidth="1.1" />
            </pattern>
          </defs>
        )}
        <path d="M10 3L18 10L10 17L2 10Z" fill={hatch ? 'url(#wm-ov-hatch)' : '#E9EBC8'} stroke={hatch ? STRONG_COLOR.abandoned : '#B9A98A'} strokeWidth="1.3" strokeLinejoin="round" strokeDasharray={hatch ? undefined : '2 2'} />
      </svg>
    );
  }
  if (territory) {
    const c = STRONG_COLOR[kind];
    return (
      <svg className="wm-ov-sw" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 3L18 10L10 17L2 10Z" fill={c} fillOpacity="0.72" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  return <span className={`wm-ov-tok wm-ov-tok-${kind}`} style={kind === 'abandoned' ? undefined : { background: STRONG_COLOR[kind] }} aria-hidden="true" />;
}
