// World overview on the side of the map page: a flat top-down square of the whole world with every village as a small
// coloured square, a frame for what the main map shows, and a count per relation. Click or drag to move the main map.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { SiteDto } from '@clanfire/engine';
import { isUtilitySite } from '../sites.ts';
import { allegianceOf } from './allegiance.ts';
import type { MapAllegiance } from './allegiance.ts';
import { CHUNK } from './chunks.ts';
import type { MapChunks } from './chunks.ts';
import { DOT_INK, STRONG_COLOR } from './dots.ts';
import type { Size, View } from './iso.ts';
import { OVERVIEW_ORDER, OVERVIEW_ROWS, countVillages, frameCorners, overviewScale, overviewToWorld, squareSize, worldToOverview } from './overview.ts';
import { FOREST, GRASS, HILLS, LAKE, MOUNTAIN } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

const GROUND = { [GRASS]: '#E3EBC2', [FOREST]: '#C6D9A0', [HILLS]: '#DDD3A8', [MOUNTAIN]: '#BDB6A6', [LAKE]: '#A6D2D6' } as Record<number, string>;

interface Props {
  chunks: MapChunks;
  terrain: TerrainCache;
  radius: number;
  sites: readonly SiteDto[];
  /** Bumps whenever map data arrived. */
  version: number;
  viewRef: MutableRefObject<View>;
  sizeRef: MutableRefObject<{ w: number; h: number }>;
  /** The main map registers its "redraw the frame" function here and calls it after each of its own frames. */
  drawRef: MutableRefObject<(() => void) | null>;
  onJump: (x: number, y: number) => void;
}

export function Overview({ chunks, terrain, radius, sites, version, viewRef, sizeRef, drawRef, onJump }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [px, setPx] = useState(0);
  const [showOthers, setShowOthers] = useState(true);
  const [showAbandoned, setShowAbandoned] = useState(true);
  const dragging = useRef(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setPx(Math.floor(box.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const dpr = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1);

  // Ground layer: one flat square of the terrain, drawn once per size.
  const ground = useMemo(() => {
    if (px <= 0) return null;
    const c = document.createElement('canvas');
    c.width = Math.round(px * dpr);
    c.height = Math.round(px * dpr);
    const g = c.getContext('2d');
    if (!g) return null;
    g.scale(dpr, dpr);
    const sc = overviewScale(radius, px);
    const cell = Math.max(1, Math.ceil(sc));
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        g.fillStyle = GROUND[terrain.get(x, y)] ?? GROUND[GRASS]!;
        g.fillRect((x + radius) * sc, (y + radius) * sc, cell, cell);
      }
    }
    return c;
  }, [px, dpr, radius, terrain]);

  // Counts and the village layer.
  const { counts, coverage } = useMemo(() => {
    void version;
    const all = [];
    for (let ci = Math.floor(-radius / CHUNK); ci <= Math.floor(radius / CHUNK); ci++) {
      for (let cj = Math.floor(-radius / CHUNK); cj <= Math.floor(radius / CHUNK); cj++) all.push(...chunks.villagesIn(ci, cj));
    }
    return { counts: countVillages(all), coverage: chunks.coverage() };
  }, [chunks, radius, version]);

  useEffect(() => {
    if (!ground || px <= 0) return;
    const base = (baseRef.current ??= document.createElement('canvas'));
    base.width = Math.round(px * dpr);
    base.height = Math.round(px * dpr);
    const g = base.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(ground, 0, 0, px, px);
    const sc = overviewScale(radius, px);
    const byKind = new Map<MapAllegiance, Array<{ x: number; y: number }>>();
    for (let ci = Math.floor(-radius / CHUNK); ci <= Math.floor(radius / CHUNK); ci++) {
      for (let cj = Math.floor(-radius / CHUNK); cj <= Math.floor(radius / CHUNK); cj++) {
        for (const v of chunks.villagesIn(ci, cj)) {
          const a = allegianceOf(v);
          if (a === 'neutral' && !showOthers) continue;
          if (a === 'abandoned' && !showAbandoned) continue;
          const list = byKind.get(a) ?? [];
          list.push(worldToOverview(v.x, v.y, radius, px));
          byKind.set(a, list);
        }
      }
    }
    g.lineJoin = 'round';
    for (const a of OVERVIEW_ORDER) {
      const list = byKind.get(a);
      if (!list) continue;
      const z = squareSize(a, sc);
      for (const p of list) {
        const x = Math.round(p.x - z / 2);
        const y = Math.round(p.y - z / 2);
        if (a === 'own') {
          g.fillStyle = DOT_INK;
          g.fillRect(x - 2, y - 2, z + 4, z + 4);
          g.fillStyle = '#FFFFFF';
          g.fillRect(x - 1, y - 1, z + 2, z + 2);
        } else if (a !== 'abandoned') {
          g.fillStyle = DOT_INK;
          g.fillRect(x - 1, y - 1, z + 2, z + 2);
        }
        g.fillStyle = STRONG_COLOR[a];
        g.fillRect(x, y, z, z);
      }
    }
    // Sites: tiny diamonds (utility sites tiny squares).
    for (const st of sites) {
      const p = worldToOverview(st.x, st.y, radius, px);
      g.beginPath();
      if (isUtilitySite(st.kind)) g.rect(p.x - 2, p.y - 2, 4, 4);
      else {
        g.moveTo(p.x, p.y - 4);
        g.lineTo(p.x + 3.5, p.y);
        g.lineTo(p.x, p.y + 4);
        g.lineTo(p.x - 3.5, p.y);
        g.closePath();
      }
      g.fillStyle = st.awake && !isUtilitySite(st.kind) ? '#FFF2B8' : '#F4F1EA';
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = DOT_INK;
      g.stroke();
    }
    drawRef.current?.();
  }, [ground, px, dpr, radius, chunks, version, sites, showOthers, showAbandoned, drawRef]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base || px <= 0) return;
    if (canvas.width !== base.width) {
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
    const pts = frameCorners(viewRef.current, size).map((c) => worldToOverview(c.x, c.y, radius, px));
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 4;
    g.strokeStyle = DOT_INK;
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = '#FFFFFF';
    g.stroke();
  }, [px, dpr, radius, viewRef, sizeRef]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
    return () => {
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, [draw, drawRef]);

  const jump = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = overviewToWorld(((e.clientX - r.left) / r.width) * px, ((e.clientY - r.top) / r.height) * px, radius, px);
    onJump(w.x, w.y);
  };

  const loading = coverage.loaded < coverage.total;
  const toggles: Array<{ label: string; on: boolean; set: (b: boolean) => void }> = [
    { label: 'Others', on: showOthers, set: setShowOthers },
    { label: 'Abandoned', on: showAbandoned, set: setShowAbandoned },
  ];

  return (
    <aside className="wm-side" aria-label="World overview">
      <h2 className="wm-side-title">World overview</h2>
      <div className="wm-ov" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="wm-ov-canvas"
          style={{ width: px || '100%', height: px || undefined }}
          role="img"
          aria-label="Flat overview of the whole world. Click or drag to move the map."
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
      {loading && <p className="wm-ov-note">Loading the world… {Math.round((coverage.loaded / coverage.total) * 100)}%</p>}
      <ul className="wm-ov-legend">
        {OVERVIEW_ROWS.map((r) => (
          <li key={r.key}>
            <span className={`wm-ov-sw${r.key === 'own' ? ' wm-ov-sw-own' : ''}${r.key === 'abandoned' ? ' wm-ov-sw-small' : ''}`} style={{ background: STRONG_COLOR[r.key] }} aria-hidden="true" />
            <span className="wm-ov-label">{r.label}</span>
            <b className="wm-ov-count">{counts[r.key]}</b>
          </li>
        ))}
        <li>
          <span className="wm-ov-sw wm-ov-sw-site" aria-hidden="true" />
          <span className="wm-ov-label">Fire sites</span>
          <b className="wm-ov-count">{sites.length}</b>
        </li>
      </ul>
      <div className="wm-ov-toggles">
        {toggles.map((t) => (
          <label key={t.label}>
            <input type="checkbox" checked={t.on} onChange={(e) => t.set(e.target.checked)} /> Show {t.label.toLowerCase()}
          </label>
        ))}
      </div>
    </aside>
  );
}
