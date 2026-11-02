import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, PointerEvent } from 'react';
import type { Coords, Mission, MovementDto } from '@clanfire/engine';
import { useGame } from '../game.ts';
import { formatCoords } from '../format.ts';
import { TerrainBlocks } from '../map/blocks.ts';
import { MapChunks } from '../map/chunks.ts';
import { DEFAULT_TILE, clampView, panBy, rectOnScreen, toScreen, visibleTileBounds, zoomAround } from '../map/iso.ts';
import type { View } from '../map/iso.ts';
import { drawMap, pickTile, pickVillage } from '../map/render.ts';
import type { DrawnVillage } from '../map/render.ts';
import { loadMapArt } from '../map/sprites.ts';
import { TERRAIN_NAME, TerrainCache } from '../map/terrain.ts';
import { Legend } from '../map/Legend.tsx';
import { TilePanel } from '../map/TilePanel.tsx';
import '../map/map.css';

const TAP_SLOP_MOUSE = 4;
const TAP_SLOP_TOUCH = 9;
const NARROW = '(max-width: 767px)';
/** After the last wheel/pinch step, wait this long before rasterising sprites for the new zoom level. */
const ZOOM_SETTLE_MS = 160;

declare global {
  interface Window {
    /** Dev builds only: recent map frame times (ms) for performance checks. */
    __mapFrames?: number[];
  }
}

export function MapView({ active }: { active: boolean }) {
  const { settings, village, mapFocus, tribeVersion, player, movements, now } = useGame();
  const radius = settings.radius;

  const terrain = useMemo(() => new TerrainCache(settings.seed), [settings.seed]);
  const blocks = useMemo(() => new TerrainBlocks(terrain, radius), [terrain, radius]);
  const chunks = useMemo(() => new MapChunks(radius), [radius]);
  const own = useMemo<Coords>(() => ({ x: village.x, y: village.y }), [village.x, village.y]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ cx: village.x, cy: village.y, tile: DEFAULT_TILE });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const selectedRef = useRef<Coords | null>(null);
  const hoverRef = useRef<Coords | null>(null);
  const dirtyRef = useRef(false);
  const rafRef = useRef(0);
  const activeRef = useRef(active);
  const ownRef = useRef(own);
  const movementsRef = useRef<readonly MovementDto[]>(movements);
  /** Server time minus local time, so markers move smoothly between the 1 s game ticks. */
  const clockOffset = useRef(now - Date.now());
  const drawnRef = useRef<DrawnVillage[]>([]);
  /** The view as last drawn (zoom snapped to device pixels), for picking. */
  const drawnViewRef = useRef<View>(viewRef.current);
  const zoomedAt = useRef(0);
  const settleTimer = useRef(0);
  const marchTimer = useRef(0);
  const lastReadout = useRef('');

  const [selected, setSelected] = useState<Coords | null>(null);
  /** Mission asked for by the tab that sent us here (tribe alert -> support); cleared by any tap on the map. */
  const [preferred, setPreferred] = useState<{ x: number; y: number; mission: Mission; nonce: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [goX, setGoX] = useState('');
  const [goY, setGoY] = useState('');
  const [goError, setGoError] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = active;
    ownRef.current = own;
    movementsRef.current = movements;
    clockOffset.current = now - Date.now();
  }, [active, own, movements, now]);

  const size = () => ({ w: sizeRef.current.w, h: sizeRef.current.h });

  const ensureChunks = useCallback(() => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const v = viewRef.current;
    const b = visibleTileBounds(v, { w, h }, 3);
    chunks.ensure(b.x0, b.y0, b.x1, b.y1, v.cx, v.cy, (x0, y0, x1, y1) => rectOnScreen(v, { w, h }, x0, y0, x1, y1, v.tile * 2));
  }, [chunks]);

  // `schedule` is defined below; frames re-arm themselves through this ref.
  const scheduleRef = useRef<() => void>(() => {});

  const frame = useCallback(() => {
    rafRef.current = 0;
    dirtyRef.current = false;
    const canvas = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || w === 0 || h === 0 || !activeRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Draw with whole device pixels per tile so cached bitmaps blit 1:1 without resampling;
    // the precise zoom stays in viewRef so small wheel steps still add up.
    const view = { ...viewRef.current, tile: Math.round(viewRef.current.tile * dpr) / dpr };
    drawnViewRef.current = view;
    ensureChunks();
    const t0 = performance.now();
    const quick = t0 - zoomedAt.current < ZOOM_SETTLE_MS;
    const res = drawMap({
      ctx,
      width: w,
      height: h,
      dpr,
      view,
      radius,
      terrain,
      blocks,
      chunks,
      selected: selectedRef.current,
      hover: hoverRef.current,
      own: ownRef.current,
      movements: movementsRef.current,
      now: Date.now() + clockOffset.current,
      quick,
    });
    if (import.meta.env.DEV) {
      const list = (window.__mapFrames ??= []);
      list.push(performance.now() - t0);
      if (list.length > 600) list.splice(0, list.length - 600);
    }
    drawnRef.current = res.villages;
    if (res.stale || quick) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => scheduleRef.current(), ZOOM_SETTLE_MS);
    }
    // Marching markers: redraw about when the fastest one has moved a pixel (and every second for the clocks).
    window.clearTimeout(marchTimer.current);
    if (res.markerSpeed >= 0) {
      const ms = Math.max(120, Math.min(1000, 1000 / Math.max(0.001, res.markerSpeed)));
      marchTimer.current = window.setTimeout(() => scheduleRef.current(), ms);
    }
    const el = readoutRef.current;
    if (el) {
      const hov = hoverRef.current;
      let text = `Centre ${formatCoords(Math.round(view.cx), Math.round(view.cy))}`;
      if (hov && Math.abs(hov.x) <= radius && Math.abs(hov.y) <= radius) {
        const v = chunks.villageAt(hov.x, hov.y);
        text += ` · ${formatCoords(hov.x, hov.y)} ${v ? v.name : (TERRAIN_NAME[terrain.get(hov.x, hov.y)] ?? '')}`;
      }
      if (text !== lastReadout.current) {
        lastReadout.current = text;
        el.textContent = text;
      }
    }
  }, [blocks, chunks, ensureChunks, radius, terrain]);

  const schedule = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = window.requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  // Sprites and fonts arrive asynchronously: redraw as they do.
  useEffect(() => {
    const stop = loadMapArt(schedule);
    const fonts = document.fonts as FontFaceSet | undefined;
    fonts?.addEventListener?.('loadingdone', schedule);
    return () => {
      stop();
      fonts?.removeEventListener?.('loadingdone', schedule);
    };
  }, [schedule]);

  // Resize: keep the canvas backing store matched to its CSS size and the device pixel ratio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
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
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(marchTimer.current);
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
  }, [active, schedule, movements]);

  // My tribe or a diplomatic relation changed: villages change banners and tags, so refetch the visible chunks.
  const tribeId = player.tribe?.id ?? 0;
  useEffect(() => {
    chunks.invalidate();
    schedule();
  }, [chunks, schedule, tribeVersion, tribeId]);

  /** Pan so a freshly selected tile is not hidden behind the bottom sheet on phones. */
  const reveal = useCallback((c: Coords) => {
    if (!window.matchMedia(NARROW).matches) return;
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const p = toScreen(v, { w, h }, c.x, c.y);
    if (p.y > h * 0.4 || p.y < v.tile) {
      panBy(v, w / 2 - p.x, h * 0.34 - p.y);
      clampView(v, radius);
    }
  }, [radius]);

  const select = useCallback(
    (c: Coords | null, opts?: { reveal?: boolean; mission?: Mission; nonce?: number }) => {
      selectedRef.current = c;
      setSelected(c);
      setPreferred(c && opts?.mission ? { x: c.x, y: c.y, mission: opts.mission, nonce: opts.nonce ?? 0 } : null);
      if (c && opts?.reveal) reveal(c);
      schedule();
    },
    [reveal, schedule],
  );

  const centerOn = useCallback(
    (x: number, y: number, minTile?: number) => {
      const v = viewRef.current;
      v.cx = x;
      v.cy = y;
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
    centerOn(c.x, c.y, 72);
    select(c, { reveal: true, mission: mapFocus.mission, nonce: mapFocus.nonce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const zoomAt = useCallback(
    (px: number, py: number, nextTile: number) => {
      zoomedAt.current = performance.now();
      zoomAround(viewRef.current, size(), px, py, nextTile, radius);
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

  /** Village sprite under the point first (tall castles cover tiles behind them), else the tile. */
  const tileAt = (x: number, y: number): Coords => {
    const v = pickVillage(drawnRef.current, x, y);
    return v ? { x: v.x, y: v.y } : pickTile(drawnViewRef.current, size(), terrain, x, y);
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
        const tile = tileAt(p.x, p.y);
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
      panBy(v, p.x - prev.x, p.y - prev.y);
      if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > (e.pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH)) g.moved = true;
      clampView(v, radius);
      schedule();
    } else {
      const pr = pair();
      if (!pr) return;
      panBy(v, pr.mx - g.mx, pr.my - g.my);
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
      const tile = tileAt(p.x, p.y);
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
    const step = v.tile * (e.shiftKey ? 4 : 1.5);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': panBy(v, step, 0); break;
      case 'ArrowRight': panBy(v, -step, 0); break;
      case 'ArrowUp': panBy(v, 0, step / 2); break;
      case 'ArrowDown': panBy(v, 0, -step / 2); break;
      case '+': case '=': zoomedAt.current = performance.now(); v.tile *= 1.2; break;
      case '-': case '_': zoomedAt.current = performance.now(); v.tile /= 1.2; break;
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
    centerOn(x, y, 72);
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
    <div className={`wm${selected ? ' wm-has-panel' : ''}`} hidden={!active}>
      <div className="wm-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="wm-canvas"
          tabIndex={0}
          role="application"
          aria-label="World map. Drag to move, scroll or pinch to zoom, tap a village or tile to select it. Arrow keys move, plus and minus zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        />
        <div className="wm-top">
          <form className="wm-toolbar" onSubmit={submitGo} aria-label="Map controls">
            <button type="button" className="wm-btn wm-btn-sun" onClick={() => centerOn(own.x, own.y, 72)}>
              <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
              </svg>
              <span>My village</span>
            </button>
            <div className="wm-goto">
              <label className="visually-hidden" htmlFor="go-x">X coordinate</label>
              <input id="go-x" className="wm-input" type="number" inputMode="numeric" placeholder="x" value={goX} onChange={(e) => setGoX(e.target.value)} />
              <span aria-hidden="true" className="wm-goto-sep">|</span>
              <label className="visually-hidden" htmlFor="go-y">Y coordinate</label>
              <input id="go-y" className="wm-input" type="number" inputMode="numeric" placeholder="y" value={goY} onChange={(e) => setGoY(e.target.value)} />
              <button type="submit" className="wm-btn">Go</button>
            </div>
            {goError && (
              <span className="wm-go-error" role="alert">
                {goError}
              </span>
            )}
          </form>
          <Legend />
        </div>
        <div className="wm-readout" ref={readoutRef} aria-live="off" />
        <div className="wm-zoom">
          <button type="button" className="wm-btn wm-btn-icon" onClick={() => zoomBy(1.3)} aria-label="Zoom in">
            <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button type="button" className="wm-btn wm-btn-icon" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">
            <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button type="button" className="wm-btn wm-btn-icon wm-btn-sun" onClick={() => centerOn(own.x, own.y)} aria-label="Centre on my village">
            <svg className="wm-ico" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
        </div>
      </div>
      {selected && (
        <TilePanel
          tile={selected}
          village={selectedVillage}
          loaded={selectedLoaded}
          terrain={terrain}
          preferred={preferred && preferred.x === selected.x && preferred.y === selected.y ? preferred : null}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}
