import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, PointerEvent } from 'react';
import type { Coords } from '@tribewars/engine';
import { useGame } from '../game.ts';
import { formatCoords } from '../format.ts';
import { MapChunks } from '../map/chunks.ts';
import { MAX_TILE, MIN_TILE, clampView, drawMap, screenToTile } from '../map/render.ts';
import type { View } from '../map/render.ts';
import { TERRAIN_NAME, TerrainCache } from '../map/terrain.ts';
import { TilePanel } from '../map/TilePanel.tsx';

const TAP_SLOP_MOUSE = 4;
const TAP_SLOP_TOUCH = 9;
const NARROW = '(max-width: 767px)';

export function MapView({ active }: { active: boolean }) {
  const { settings, village, mapFocus } = useGame();
  const radius = settings.radius;

  const terrain = useMemo(() => new TerrainCache(settings.seed), [settings.seed]);
  const chunks = useMemo(() => new MapChunks(radius), [radius]);
  const own = useMemo<Coords>(() => ({ x: village.x, y: village.y }), [village.x, village.y]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ cx: village.x + 0.5, cy: village.y + 0.5, tile: 32 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const selectedRef = useRef<Coords | null>(null);
  const hoverRef = useRef<Coords | null>(null);
  const dirtyRef = useRef(false);
  const rafRef = useRef(0);
  const activeRef = useRef(active);
  const ownRef = useRef(own);
  const lastReadout = useRef('');

  const [selected, setSelected] = useState<Coords | null>(null);
  const [version, setVersion] = useState(0);
  const [goX, setGoX] = useState('');
  const [goY, setGoY] = useState('');
  const [goError, setGoError] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = active;
    ownRef.current = own;
  }, [active, own]);

  const ensureChunks = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const v = viewRef.current;
    const halfW = w / (2 * v.tile);
    const halfH = h / (2 * v.tile);
    chunks.ensure(Math.floor(v.cx - halfW) - 1, Math.floor(v.cy - halfH) - 1, Math.floor(v.cx + halfW) + 1, Math.floor(v.cy + halfH) + 1, v.cx, v.cy);
  }, [chunks]);

  const frame = useCallback(() => {
    rafRef.current = 0;
    dirtyRef.current = false;
    const canvas = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || w === 0 || h === 0 || !activeRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const view = viewRef.current;
    ensureChunks();
    drawMap({
      ctx,
      width: w,
      height: h,
      dpr,
      view,
      radius,
      terrain,
      chunks,
      selected: selectedRef.current,
      hover: hoverRef.current,
      own: ownRef.current,
    });
    const el = readoutRef.current;
    if (el) {
      const hov = hoverRef.current;
      let text = `Centre ${formatCoords(Math.floor(view.cx), Math.floor(view.cy))}`;
      if (hov && Math.abs(hov.x) <= radius && Math.abs(hov.y) <= radius) {
        const v = chunks.villageAt(hov.x, hov.y);
        text += ` · ${formatCoords(hov.x, hov.y)} ${v ? v.name : (TERRAIN_NAME[terrain.get(hov.x, hov.y)] ?? '')}`;
      }
      if (text !== lastReadout.current) {
        lastReadout.current = text;
        el.textContent = text;
      }
    }
  }, [chunks, ensureChunks, radius, terrain]);

  const schedule = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = window.requestAnimationFrame(frame);
  }, [frame]);

  // Resize: keep the canvas backing store matched to its CSS size and the device pixel ratio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      schedule();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      window.cancelAnimationFrame(rafRef.current);
      dirtyRef.current = false;
    };
  }, [schedule]);

  // New map data -> redraw (and refresh the panel). Stale chunks are re-requested every few seconds while visible.
  useEffect(() => {
    chunks.attach(() => {
      setVersion((v) => v + 1);
      schedule();
    });
    const id = window.setInterval(() => {
      if (activeRef.current && !document.hidden) ensureChunks();
    }, 5000);
    return () => {
      chunks.detach();
      window.clearInterval(id);
    };
  }, [chunks, schedule, ensureChunks]);

  useEffect(() => {
    if (active) schedule();
  }, [active, schedule]);

  /** Pan so a freshly selected tile is not hidden behind the bottom sheet on phones. */
  const reveal = useCallback((c: Coords) => {
    if (!window.matchMedia(NARROW).matches) return;
    const v = viewRef.current;
    const { h } = sizeRef.current;
    const py = (c.y + 0.5 - v.cy) * v.tile + h / 2;
    if (py > h * 0.42 || py < 0) {
      v.cy = c.y + 0.5 + (0.25 * h) / v.tile;
      clampView(v, radius);
    }
  }, [radius]);

  const select = useCallback(
    (c: Coords | null, opts?: { reveal?: boolean }) => {
      selectedRef.current = c;
      setSelected(c);
      if (c && opts?.reveal) reveal(c);
      schedule();
    },
    [reveal, schedule],
  );

  const centerOn = useCallback(
    (x: number, y: number, minTile?: number) => {
      const v = viewRef.current;
      v.cx = x + 0.5;
      v.cy = y + 0.5;
      if (minTile) v.tile = Math.max(v.tile, minTile);
      clampView(v, radius);
      schedule();
    },
    [radius, schedule],
  );

  // Another tab asked to show a tile (movement target, report village).
  const focusNonce = mapFocus?.nonce;
  useEffect(() => {
    if (!mapFocus) return;
    const c = { x: Math.max(-radius, Math.min(radius, mapFocus.x)), y: Math.max(-radius, Math.min(radius, mapFocus.y)) };
    centerOn(c.x, c.y, 36);
    select(c, { reveal: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const zoomAt = useCallback(
    (px: number, py: number, nextTile: number) => {
      const v = viewRef.current;
      const { w, h } = sizeRef.current;
      const wx = v.cx + (px - w / 2) / v.tile;
      const wy = v.cy + (py - h / 2) / v.tile;
      v.tile = Math.max(MIN_TILE, Math.min(MAX_TILE, nextTile));
      v.cx = wx - (px - w / 2) / v.tile;
      v.cy = wy - (py - h / 2) / v.tile;
      clampView(v, radius);
      schedule();
    },
    [radius, schedule],
  );

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0016;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, viewRef.current.tile * Math.exp(-e.deltaY * unit));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- Pointer gestures: drag to pan, pinch to zoom, tap to select -----------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, multi: false, startX: 0, startY: 0, startT: 0, dist: 0, mx: 0, my: 0 });

  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pair = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best effort (it throws for synthetic or already-ended pointers).
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.moved = false;
      g.multi = false;
      g.startX = p.x;
      g.startY = p.y;
      g.startT = performance.now();
    } else {
      g.multi = true;
      g.moved = true;
      const pr = pair();
      if (pr) {
        g.dist = pr.dist;
        g.mx = pr.mx;
        g.my = pr.my;
      }
    }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const prev = pointers.current.get(e.pointerId);
    const p = local(e);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const tile = screenToTile(viewRef.current, sizeRef.current.w, sizeRef.current.h, p.x, p.y);
        const h = hoverRef.current;
        if (!h || h.x !== tile.x || h.y !== tile.y) {
          hoverRef.current = tile;
          schedule();
        }
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    const v = viewRef.current;
    const g = gesture.current;
    if (pointers.current.size === 1) {
      v.cx -= (p.x - prev.x) / v.tile;
      v.cy -= (p.y - prev.y) / v.tile;
      if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > (e.pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH)) g.moved = true;
      clampView(v, radius);
      schedule();
    } else {
      const pr = pair();
      if (!pr) return;
      v.cx -= (pr.mx - g.mx) / v.tile;
      v.cy -= (pr.my - g.my) / v.tile;
      if (g.dist > 0 && pr.dist > 0) zoomAt(pr.mx, pr.my, v.tile * (pr.dist / g.dist));
      else schedule();
      g.dist = pr.dist;
      g.mx = pr.mx;
      g.my = pr.my;
    }
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (e.type === 'pointerup' && pointers.current.size === 0 && !g.moved && !g.multi && performance.now() - g.startT < 800) {
      const tile = screenToTile(viewRef.current, sizeRef.current.w, sizeRef.current.h, p.x, p.y);
      if (Math.abs(tile.x) <= radius && Math.abs(tile.y) <= radius) select(tile, { reveal: true });
      else select(null);
    }
  }

  function onPointerLeave(e: PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && hoverRef.current) {
      hoverRef.current = null;
      schedule();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLCanvasElement>) {
    const v = viewRef.current;
    const step = (e.shiftKey ? 6 : 2);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': v.cx -= step; break;
      case 'ArrowRight': v.cx += step; break;
      case 'ArrowUp': v.cy -= step; break;
      case 'ArrowDown': v.cy += step; break;
      case '+': case '=': v.tile *= 1.2; break;
      case '-': case '_': v.tile /= 1.2; break;
      case 'Escape': select(null); break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    clampView(v, radius);
    schedule();
  }

  function submitGo(e: FormEvent) {
    e.preventDefault();
    const x = Number(goX);
    const y = Number(goY);
    if (goX.trim() === '' || goY.trim() === '' || !Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > radius || Math.abs(y) > radius) {
      setGoError(`Enter whole numbers from −${radius} to ${radius}.`);
      return;
    }
    setGoError(null);
    centerOn(x, y, 32);
    select({ x, y }, { reveal: true });
  }

  const zoomBy = (factor: number) => {
    const { w, h } = sizeRef.current;
    zoomAt(w / 2, h / 2, viewRef.current.tile * factor);
  };

  // Resolve the selected tile's village on every chunk update (version) or selection change.
  const selectedVillage = useMemo(
    () => (selected ? chunks.villageAt(selected.x, selected.y) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, chunks, version],
  );
  const selectedLoaded = selected ? chunks.isLoaded(selected.x, selected.y) : false;

  return (
    <div className="map-view" hidden={!active}>
      <form className="map-toolbar" onSubmit={submitGo} aria-label="Map controls">
        <button
          type="button"
          className="btn"
          onClick={() => {
            centerOn(own.x, own.y, 28);
          }}
        >
          <span aria-hidden="true">📍</span> My village
        </button>
        <div className="goto">
          <label className="visually-hidden" htmlFor="go-x">X coordinate</label>
          <input id="go-x" className="input input-coord" type="number" placeholder="x" value={goX} onChange={(e) => setGoX(e.target.value)} />
          <span aria-hidden="true" className="goto-sep">|</span>
          <label className="visually-hidden" htmlFor="go-y">Y coordinate</label>
          <input id="go-y" className="input input-coord" type="number" placeholder="y" value={goY} onChange={(e) => setGoY(e.target.value)} />
          <button type="submit" className="btn">Go</button>
        </div>
        {goError && <span className="form-error map-go-error" role="alert">{goError}</span>}
      </form>

      <div className="map-body">
        <div className="map-stage" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="map-canvas"
            tabIndex={0}
            role="application"
            aria-label="World map. Drag to move, scroll or pinch to zoom, tap a tile to select it. Arrow keys move, plus and minus zoom."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown}
          />
          <div className="map-readout" ref={readoutRef} aria-live="off" />
          <div className="map-zoom">
            <button className="btn btn-icon" onClick={() => zoomBy(1.3)} aria-label="Zoom in">+</button>
            <button className="btn btn-icon" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">−</button>
          </div>
        </div>
        {selected && (
          <TilePanel
            tile={selected}
            village={selectedVillage}
            loaded={selectedLoaded}
            terrain={terrain}
            onClose={() => select(null)}
          />
        )}
      </div>
    </div>
  );
}
