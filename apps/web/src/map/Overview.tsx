// Overview on the side of the map page: an isometric DIAMOND of the region round the main map's view (same orientation as the main map,
// so the view is a true upright rectangle), on a thin board with coordinate ticks. Villages are small round tokens in their relation
// colour. It follows the main map; arrows or a drag move the main map. A premium player can expand it (200 fields, the whole world, a large
// view); the whole-world sizes read one light list from the server instead of every map chunk.

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
  OUTLINE_TILE,
  OVERVIEW_ORDER,
  OVERVIEW_REGION,
  OVERVIEW_ROWS,
  OVERVIEW_SIZES,
  OVERVIEW_STALE_MS,
  countPoints,
  diamondLayout,
  diamondToWorld,
  frameRect,
  patchSize,
  regionOf,
  siteHalf,
  tickStep,
  tokenRadius,
  worldToDiamond,
} from './overview.ts';
import type { OverviewPoint, Region } from './overview.ts';
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
  }, [width, height, dw, dpr, region, layout, radius, terrain]);

  // Village tokens and sites on top of the board.
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
    const byKind = new Map<MapAllegiance, Array<{ x: number; y: number }>>();
    for (const p of points) {
      if (p.a === 'neutral' && !showOthers) continue;
      if (p.a === 'abandoned' && !showAbandoned) continue;
      const list = byKind.get(p.a) ?? [];
      list.push(worldToDiamond(layout, region, p.x, p.y));
      byKind.set(p.a, list);
    }
    const outline = tile >= OUTLINE_TILE;
    for (const a of OVERVIEW_ORDER) {
      const list = byKind.get(a);
      if (!list) continue;
      const r = tokenRadius(a, tile);
      for (const p of list) {
        g.beginPath();
        if (a === 'abandoned') {
          // A small hollow grey ring (a plain grey dot when a field is a pixel or less).
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          if (r >= 1.6) {
            g.lineWidth = 1.2;
            g.strokeStyle = '#6E675E';
            g.stroke();
          } else {
            g.fillStyle = '#7A7268';
            g.fill();
          }
        } else if (a === 'own') {
          g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
          g.fillStyle = DOT_INK;
          g.fill();
          g.beginPath();
          g.arc(p.x, p.y, r + 0.9, 0, Math.PI * 2);
          g.fillStyle = '#FFFFFF';
          g.fill();
          g.beginPath();
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.fillStyle = STRONG_COLOR.own;
          g.fill();
          if (r >= 3) {
            g.beginPath();
            g.arc(p.x, p.y, r * 0.32, 0, Math.PI * 2);
            g.fillStyle = '#C4623A';
            g.fill();
          }
        } else {
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.fillStyle = STRONG_COLOR[a];
          g.fill();
          if (outline) {
            g.lineWidth = 1;
            g.strokeStyle = DOT_INK;
            g.stroke();
          }
        }
      }
    }
    // Sites: tiny flames (utility sites tiny diamonds).
    const h = siteHalf(tile);
    for (const st of sitesIn) {
      const p = worldToDiamond(layout, region, st.x, st.y);
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
    drawRef.current?.();
  }, [ground, width, height, dpr, layout, region, points, sitesIn, showOthers, showAbandoned, drawRef]);

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
    const shape = frameRect(layout, r, v, size);
    // The view is an upright rectangle on the diamond (light line over a dark hairline), or just a cross when it covers most of it.
    const P = (x: number, y: number) => worldToDiamond(layout, r, x, y);
    const e = 0.5;
    const t0 = P(r.x0 - e, r.y0 - e);
    const t1 = P(r.x1 + e, r.y0 - e);
    const t2 = P(r.x1 + e, r.y1 + e);
    const t3 = P(r.x0 - e, r.y1 + e);
    g.save();
    g.beginPath();
    g.moveTo(t0.x, t0.y);
    g.lineTo(t1.x, t1.y);
    g.lineTo(t2.x, t2.y);
    g.lineTo(t3.x, t3.y);
    g.closePath();
    g.clip();
    g.lineJoin = 'miter';
    g.beginPath();
    if (shape.kind === 'frame') {
      g.rect(shape.x0, shape.y0, shape.x1 - shape.x0, shape.y1 - shape.y0);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(40,28,18,0.55)';
      g.stroke();
      g.lineWidth = 1.5;
      g.strokeStyle = '#FFFFFF';
      g.stroke();
    }
    const arm = shape.kind === 'frame' ? 3 : 6;
    g.beginPath();
    g.moveTo(shape.cx - arm, shape.cy);
    g.lineTo(shape.cx + arm, shape.cy);
    g.moveTo(shape.cx, shape.cy - arm);
    g.lineTo(shape.cx, shape.cy + arm);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(40,28,18,0.55)';
    g.stroke();
    g.lineWidth = 1.5;
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
  const nudge = (sx: number, sy: number) => {
    const k = Math.max(5, Math.round(region.span / 6));
    const v = viewRef.current;
    // Screen right is +x/-y, screen down is +x/+y, as on the main map.
    onJump(Math.max(-radius, Math.min(radius, v.cx + (sx + sy) * k)), Math.max(-radius, Math.min(radius, v.cy + (sy - sx) * k)));
  };

  const toggles: Array<{ label: string; on: boolean; set: (b: boolean) => void }> = [
    { label: 'Others', on: showOthers, set: setShowOthers },
    { label: 'Abandoned', on: showAbandoned, set: setShowAbandoned },
  ];
  const where = region.whole ? `Whole world, ${region.span} x ${region.span} fields` : `${region.span} x ${region.span} fields around ${Math.round(region.cx)}, ${Math.round(region.cy)}`;
  const arrow = (label: string, sx: number, sy: number, d: string) => (
    <button type="button" className="wm-ov-arrow" onClick={() => nudge(sx, sy)} aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
    </button>
  );

  return (
    <aside className={`wm-side${large ? ' wm-side-large' : ''}`} aria-label="Region overview">
      <h2 className="wm-side-title">Overview</h2>
      <p className="wm-ov-note wm-ov-where">{where}</p>
      <div className="wm-ov-card" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="wm-ov-canvas"
          style={{ width: width || '100%', height: height || undefined }}
          role="img"
          aria-label="Overview of the region around the map view. Click or drag to move the map."
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            jump(e);
          }}
          onPointerMove={(e) => dragging.current && jump(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        />
      </div>
      {loadingRows && <p className="wm-ov-note">Loading the world…</p>}
      {loadingPct !== null && <p className="wm-ov-note">Loading this area… {loadingPct}%</p>}
      {useRows && failed && rows === null && <p className="wm-ov-note">The wide overview could not be loaded. It will try again.</p>}
      <div className="wm-ov-arrows" role="group" aria-label="Move the map">
        {arrow('Move the map up', 0, -1, 'M12 5l7 8H5z')}
        {arrow('Move the map down', 0, 1, 'M12 19l-7-8h14z')}
        {arrow('Move the map left', -1, 0, 'M5 12l8-7v14z')}
        {arrow('Move the map right', 1, 0, 'M19 12l-8 7V5z')}
      </div>
      <h3 className="wm-ov-sub">In this area</h3>
      <ul className="wm-ov-legend">
        {OVERVIEW_ROWS.map((r) => (
          <li key={r.key}>
            <span className={`wm-ov-tok wm-ov-tok-${r.key}`} style={r.key === 'abandoned' ? undefined : { background: STRONG_COLOR[r.key] }} aria-hidden="true" />
            <span className="wm-ov-label">{r.label}</span>
            <b className="wm-ov-count">{counts[r.key]}</b>
          </li>
        ))}
        <li>
          <span className="wm-ov-tok wm-ov-tok-site" aria-hidden="true" />
          <span className="wm-ov-label">Fire sites</span>
          <b className="wm-ov-count">{sitesIn.length}</b>
        </li>
      </ul>
      <div className="wm-ov-toggles">
        {toggles.map((t) => (
          <label key={t.label}>
            <input type="checkbox" checked={t.on} onChange={(e) => t.set(e.target.checked)} /> Show {t.label.toLowerCase()}
          </label>
        ))}
      </div>
      <div className={`wm-ov-expand${premium ? '' : ' is-locked'}`}>
        <h3 className="wm-ov-sub">Expand{!premium && <span className="wm-ov-prem">Premium</span>}</h3>
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
        <button type="button" className={`wm-ov-size wm-ov-large${large ? ' is-on' : ''}`} aria-pressed={large} disabled={!premium} onClick={() => setPref({ large: !prefs.large })}>
          Large view
        </button>
        {!premium && <p className="wm-ov-note">The bigger areas, the whole world and the large view are part of Premium.</p>}
      </div>
    </aside>
  );
}
