// The isometric village diorama: ground, ring wall, trees, market square and the ten buildings drawn by level,
// with real <button>s laid over each building (label, level badge, build timer). Desktop fits the scene into its
// panel; phones get a bigger scene that pans with a finger (pointer events, bounded).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import {
  PLACEMENT,
  SCAFFOLD_URL,
  UNDER_CONSTRUCTION_URL,
  WALL_HIT,
  buildingStage,
  footprintFront,
  loadSprite,
  placementDepth,
  readySprite,
  sceneViewBox,
  scopeIds,
  spriteUrl,
} from '../../art/buildings.ts';
import type { Box, Stage } from '../../art/buildings.ts';
import { GROUND_URL, MARKET_DEPTH, MARKET_URL, SceneryDefs, WallPlan, sceneryItems, wallItems } from '../../art/scenery.tsx';
import type { DepthItem } from '../../art/scenery.tsx';
import { Icon } from '../../art/Icon.tsx';
import { formatDuration } from '../../format.ts';
import { useGame } from '../../game.ts';

type ViewBox = ReturnType<typeof sceneViewBox>;
const SHORT_NAME: Partial<Record<BuildingId, string>> = { lumber: 'Lumber', vault: 'Vault' };

/** What the scene draws for one building. */
interface ArtState {
  stage: Stage;
  /** Has a job in the build queue. */
  queued: boolean;
}

export type Arts = Record<BuildingId, ArtState>;

// ---- Sprites inside the scene ----------------------------------------------------------------------------------

/** The sprite for `url` once loaded (null until then); re-renders when it arrives. */
function useSpriteData(url: string) {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (readySprite(url)) return;
    let alive = true;
    loadSprite(url).then(
      () => alive && setLoaded((n) => n + 1),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return readySprite(url);
}

/** One sprite placed in the scene (ground tile stripped). Reports its drawn box in scene units. */
function SceneSprite({
  url,
  id,
  prefix,
  onBox,
}: {
  url: string;
  id: BuildingId;
  prefix: string;
  onBox?: (id: BuildingId, box: Box) => void;
}) {
  const data = useSpriteData(url);
  const inner = useRef<SVGGElement>(null);
  const { x, y, scale } = PLACEMENT[id];
  // Sprite markup comes only from our own bundled .svg files (see art/buildings.ts), never from players.
  const html = useMemo(() => (data ? scopeIds(data.ground, prefix) : ''), [data, prefix]);
  useLayoutEffect(() => {
    if (!html || !onBox || !inner.current) return;
    const b = inner.current.getBBox();
    if (b.width > 0) onBox(id, { x: x + b.x * scale, y: y + b.y * scale, w: b.width * scale, h: b.height * scale });
  }, [html, onBox, id, x, y, scale]);
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g ref={inner} dangerouslySetInnerHTML={{ __html: html }} />
    </g>
  );
}

/** The SVG layer. Memoised: it only changes when a building's look, the queue or the selection changes. */
export const SceneArt = memo(function SceneArt({
  arts,
  vb,
  selected,
  onBox,
  onPick,
}: {
  arts: Arts;
  vb: ViewBox;
  selected: BuildingId | null;
  onBox: (id: BuildingId, box: Box) => void;
  /** Click on a building's drawing (pixel-accurate; the overlay labels are the keyboard targets). */
  onPick: (id: BuildingId) => void;
}) {
  const items: DepthItem[] = [...sceneryItems()];
  items.push({ key: 'market', depth: MARKET_DEPTH, node: <image href={MARKET_URL} x={10} y={-4} width={580} height={376} /> });
  const wall = arts.wall;
  if (wall.stage > 0) {
    for (const it of wallItems(wall.stage as Exclude<Stage, 0>)) {
      items.push({
        ...it,
        node: (
          <g className="vv-b" onClick={() => onPick('wall')}>
            {it.node}
          </g>
        ),
      });
    }
  }
  for (const id of BUILDING_IDS) {
    const art = arts[id];
    // The wall itself is drawn above; its sprite slot only shows building work (and nothing while unbuilt).
    if (id === 'wall' && !art.queued) continue;
    let url = spriteUrl(id, art.stage);
    if (id === 'wall' && art.stage > 0) url = SCAFFOLD_URL;
    else if (art.stage === 0 && art.queued) url = UNDER_CONSTRUCTION_URL;
    const node = (
      <g className="vv-b" onClick={() => onPick(id)}>
        <SceneSprite url={url} id={id} prefix={`s-${id}-`} onBox={id === 'wall' ? undefined : onBox} />
        {art.queued && art.stage > 0 && id !== 'wall' && <SceneSprite url={SCAFFOLD_URL} id={id} prefix={`sc-${id}-`} />}
      </g>
    );
    items.push({ key: `b-${id}`, depth: placementDepth(id), node });
  }
  items.sort((a, b) => a.depth - b.depth);
  return (
    <svg className="vv-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} aria-hidden="true" focusable="false">
      <defs>
        <SceneryDefs />
      </defs>
      <image href={GROUND_URL} x={10} y={-4} width={580} height={376} />
      {wall.stage === 0 && (
        <g className="vv-b" onClick={() => onPick('wall')}>
          <WallPlan />
        </g>
      )}
      {items.map((it) => (
        <g key={it.key}>{it.node}</g>
      ))}
      {selected && (
        <g className="vv-select" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={footprintFront(selected)} stroke="#2B211C" strokeWidth={7} />
          <path d={footprintFront(selected)} stroke="#FFDC7A" strokeWidth={3.6} strokeDasharray="8 6" />
        </g>
      )}
    </svg>
  );
});

// ---- Overlay buttons -----------------------------------------------------------------------------------------

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function defaultBox(id: BuildingId): Box {
  if (id === 'wall') return WALL_HIT;
  const { x, y, scale } = PLACEMENT[id];
  return { x: x - 54 * scale, y: y - 60 * scale, w: 108 * scale, h: 116 * scale };
}

function BuildingHit({
  id,
  vb,
  box,
  level,
  selected,
  finishIn,
  queuedNotStarted,
  onSelect,
  wasDrag,
}: {
  id: BuildingId;
  vb: ViewBox;
  box: Box;
  level: number;
  selected: boolean;
  finishIn: number | null;
  queuedNotStarted: boolean;
  onSelect: (id: BuildingId) => void;
  wasDrag: () => boolean;
}) {
  const name = BUILDINGS[id].name;
  const upgrading = finishIn !== null;
  const aria = `${name}, level ${level}${level === 0 ? ', not built' : ''}${upgrading ? `, building, ${formatDuration(finishIn)} left` : queuedNotStarted ? ', queued' : ''}`;
  const cx = pct(box.x + box.w / 2 - vb.x, vb.w);
  return (
    <>
      <button
        type="button"
        className={`vv-hit${selected ? ' is-selected' : ''}${level === 0 ? ' is-empty' : ''}`}
        style={{ left: cx, top: pct(box.y - vb.y, vb.h) }}
        aria-label={aria}
        aria-pressed={selected}
        onClick={() => {
          if (!wasDrag()) onSelect(id);
        }}
      >
        {selected && (
          <span className="vv-marker" aria-hidden="true">
            <Icon name="marker" size={26} />
          </span>
        )}
        <span className="vv-label" aria-hidden="true">
          <span className="vv-label-full">{name}</span>
          <span className="vv-label-short">{SHORT_NAME[id] ?? name}</span>
          <span className="vv-lv">{level}</span>
        </span>
      </button>
      {(upgrading || queuedNotStarted) && (
        <span className="vv-timer" style={{ left: cx, top: pct(box.y + box.h * 0.6 - vb.y, vb.h) }} aria-hidden="true">
          <Icon name="time" size={16} />
          {upgrading ? formatDuration(finishIn) : 'Next'}
        </span>
      )}
    </>
  );
}

// ---- Scene ---------------------------------------------------------------------------------------------------

export function VillageScene({
  mode,
  selected,
  onSelect,
  bottomInset = 0,
  onPanned,
}: {
  mode: 'fit' | 'pan';
  selected: BuildingId | null;
  onSelect: (id: BuildingId) => void;
  /** Phone: pixels covered by the bottom sheet, so the selected building can be panned above it. */
  bottomInset?: number;
  onPanned?: () => void;
}) {
  const { live, now } = useGame();
  const [boxes, setBoxes] = useState<Partial<Record<BuildingId, Box>>>({});
  const onBox = useCallback((id: BuildingId, box: Box) => {
    setBoxes((prev) => {
      const old = prev[id];
      if (
        old &&
        Math.abs(old.x - box.x) < 0.5 &&
        Math.abs(old.y - box.y) < 0.5 &&
        Math.abs(old.w - box.w) < 0.5 &&
        Math.abs(old.h - box.h) < 0.5
      )
        return prev;
      return { ...prev, [id]: box };
    });
  }, []);

  const queue = live.buildQueue;
  const artKey = BUILDING_IDS.map(
    (id) => `${buildingStage(id, live.buildings[id])}${queue.some((j) => j.building === id) ? 'q' : ''}`,
  ).join(',');
  const arts = useMemo(() => {
    const out = {} as Arts;
    const parts = artKey.split(',');
    BUILDING_IDS.forEach((id, i) => {
      const p = parts[i] ?? '0';
      out[id] = { stage: Number(p[0]) as Stage, queued: p.endsWith('q') };
    });
    return out;
  }, [artKey]);

  const hallStage = arts.hall.stage;
  const vb = useMemo(() => sceneViewBox(hallStage), [hallStage]);
  const VB = vb;

  // Hit buttons in painter's order, so the building in front wins where boxes overlap.
  const order = useMemo(() => [...BUILDING_IDS].sort((a, b) => placementDepth(a) - placementDepth(b)), []);

  // ---- Panning (phone) ----
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Scene size on phones: big enough to read labels, bounded so panning stays short.
  const scale = mode === 'pan' && view.h > 0 ? Math.min(1.85, Math.max(1.35, (view.h * 0.9) / VB.h)) : 1;
  const stageW = VB.w * scale;
  const stageH = VB.h * scale;

  const clamp = useCallback(
    (x: number, y: number) => {
      const minX = Math.min(0, view.w - stageW);
      // Leave room under the village name pill at the top.
      const maxY = Math.max(52, (view.h - bottomInset - stageH) / 2);
      const minY = Math.min(maxY, view.h - bottomInset - stageH);
      return { x: Math.max(minX, Math.min(0, x)), y: Math.max(minY, Math.min(maxY, y)) };
    },
    [view.w, view.h, stageW, stageH, bottomInset],
  );

  const centreOn = useCallback(
    (sx: number, sy: number) => clamp(view.w / 2 - (sx - VB.x) * scale, (view.h - bottomInset) / 2 - (sy - VB.y) * scale),
    [clamp, view.w, view.h, bottomInset, scale],
  );

  // First layout: look at the market square.
  useEffect(() => {
    if (mode === 'pan' && view.w > 0 && pan === null) setPan(centreOn(300, 140));
  }, [mode, view.w, pan, centreOn]);

  // Keep the selected building in view above the bottom sheet.
  useEffect(() => {
    if (mode !== 'pan' || !selected || view.w === 0) return;
    const b = boxes[selected] ?? defaultBox(selected);
    setPan(centreOn(b.x + b.w / 2, b.y + b.h / 2));
    // Only when the selection, the sheet or the viewport changes, not on every measurement.
  }, [mode, selected, bottomInset, view.w, view.h]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'pan' || !pan || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 8) return;
    if (!d.moved) {
      d.moved = true;
      viewRef.current?.setPointerCapture(e.pointerId);
      onPanned?.();
    }
    setPan(clamp(d.px + dx, d.py + dy));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    dragged.current = d.moved;
    drag.current = null;
    // The click that follows this pointerup (if any) reads the flag first; then it is cleared.
    if (d.moved) window.setTimeout(() => (dragged.current = false), 0);
  };
  const wasDrag = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);
  const pick = useCallback(
    (id: BuildingId) => {
      if (!wasDrag()) selectRef.current(id);
    },
    [wasDrag],
  );

  const stageStyle: CSSProperties =
    mode === 'pan'
      ? {
          width: stageW,
          height: stageH,
          transform: pan ? `translate3d(${pan.x}px, ${pan.y}px, 0)` : undefined,
          visibility: pan ? undefined : 'hidden',
        }
      : ({ '--vb-ratio': VB.w / VB.h } as CSSProperties);

  return (
    <div
      ref={viewRef}
      className={`vv-view vv-${mode}${mode === 'fit' && view.w > 0 && Math.min(view.w, (view.h * VB.w) / VB.h) < 820 ? ' is-compact' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="vv-stage" style={stageStyle}>
        <SceneArt arts={arts} vb={vb} selected={selected} onBox={onBox} onPick={pick} />
        <div className="vv-hits">
          {order.map((id) => {
            const jobs = queue.filter((j) => j.building === id);
            const active = jobs.find((j) => now >= j.startAt);
            return (
              <BuildingHit
                key={id}
                id={id}
                vb={vb}
                box={boxes[id] ?? defaultBox(id)}
                level={live.buildings[id]}
                selected={selected === id}
                finishIn={active ? active.finishAt - now : null}
                queuedNotStarted={!active && jobs.length > 0}
                onSelect={onSelect}
                wasDrag={wasDrag}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
