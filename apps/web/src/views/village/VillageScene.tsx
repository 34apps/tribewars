// The isometric village diorama: ground, ring wall, trees, market square and the ten buildings drawn by level,
// with real <button>s laid over each building (label, level badge, build timer). Desktop fits the scene into its
// panel; phones get a bigger scene that pans with a finger (pointer events, bounded).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, PointerEvent as ReactPointerEvent, ReactElement, SetStateAction } from 'react';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';
import {
  PLACEMENT,
  SCAFFOLD_URL,
  SCENE_FOCUS,
  UNDER_CONSTRUCTION_URL,
  WALL_HIT,
  buildingStage,
  footprint,
  footprintFront,
  labelAnchor,
  loadSprite,
  lookStartLevel,
  placementDepth,
  readySprite,
  SCENE_BASE_H,
  SCENE_VIEWBOX,
  scopeIds,
  spriteUrl,
  wallLook,
} from '../../art/buildings.ts';
import type { Box, Stage, WallLook } from '../../art/buildings.ts';
import { villageTier } from '../../art/landscape.tsx';
import { LandscapeLayer, type LandscapeChoice } from '../../art/landscapes.tsx';
import { Ground, SceneryDefs, fireItem, sceneryItems, wallItems } from '../../art/scenery.tsx';
import type { DepthItem } from '../../art/scenery.tsx';
import { Icon } from '../../art/Icon.tsx';
import { Workers } from '../../art/workers.tsx';
import { formatDuration } from '../../format.ts';
import { unmetRequirements } from '../../rules.ts';
import { useGame } from '../../game.ts';

type ViewBox = { x: number; y: number; w: number; h: number };
const SHORT_NAME: Partial<Record<BuildingId, string>> = { lumber: 'Lumber', vault: 'Vault', bannerhall: 'Banners' };
const MAX_LEVELS = Object.fromEntries(BUILDING_IDS.map((id) => [id, BUILDINGS[id].maxLevel])) as Record<BuildingId, number>;

/** What the scene draws for one building. */
interface ArtState {
  /** 0-3 for every building; the wall also has a fourth, grand look. */
  stage: WallLook;
  /** Has a job in the build queue. */
  queued: boolean;
  /** Its job is running now (not just waiting in the queue): builders are at work. */
  active: boolean;
  /** Not built and its requirements are not met yet: drawn as a faded plot with a lock. */
  locked: boolean;
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

/** Length of the "new look" build moment (ms); keep in step with the 1.6s animations in village.css. */
const MOMENT_MS = 1600;

/** Length of the scaffold rising when work starts / fading when it ends without a new look (ms); see village.css. */
const START_MS = 700;
const END_MS = 900;

/**
 * Dust puff and gold sparkles for the build moment. Offsets are in scene units around the ground point (gx, gy);
 * the keyframes in village.css move and fade them. Decoration only: no pointer events. `sparks` off: dust only
 * (start and finish of work, owner 2026-11-06).
 */
function MomentFx({ gx, gy, roof, sparks: withSparks = true }: { gx: number; gy: number; roof: number; sparks?: boolean }) {
  const puffs = [
    { dx: -30, dy: -2, r: 10, to: [-26, -16] },
    { dx: -10, dy: 3, r: 13, to: [-8, -24] },
    { dx: 12, dy: 2, r: 12, to: [10, -22] },
    { dx: 32, dy: -3, r: 9, to: [28, -14] },
  ];
  const sparks = [
    { dx: -28, dy: 0, r: 5 },
    { dx: 4, dy: -14, r: 6 },
    { dx: 30, dy: 2, r: 4.5 },
    { dx: -8, dy: 12, r: 3.5 },
  ];
  return (
    <g className="vv-moment-fx" pointerEvents="none">
      {puffs.map((p, i) => (
        <circle
          key={`p${i}`}
          className="vv-moment-puff"
          cx={gx + p.dx}
          cy={gy + p.dy}
          r={p.r}
          style={{ '--mx': `${p.to[0]}px`, '--my': `${p.to[1]}px`, animationDelay: `${i * 60}ms` } as CSSProperties}
          fill={i % 2 ? '#F7F1E3' : '#E8D3A4'}
        />
      ))}
      {(withSparks ? sparks : []).map((p, i) => (
        <circle
          key={`s${i}`}
          className="vv-moment-spark"
          cx={gx + p.dx}
          cy={roof + p.dy}
          r={p.r}
          style={{ animationDelay: `${500 + i * 110}ms` }}
          fill="#FFDC7A"
        />
      ))}
    </g>
  );
}

/** The SVG layer. Memoised: it only changes when a building's look, the queue or the selection changes. */
/** Look and queued flag last shown per village (memoryKey) during this page visit; see the build moments in SceneArt. */
const SEEN_LOOKS = new Map<string, Partial<Record<BuildingId, { s: number; q: boolean }>>>();

export const SceneArt = memo(function SceneArt({
  arts,
  vb,
  tier,
  wide,
  landscape,
  selected,
  hearthOut,
  onBox,
  onPick,
  memoryKey,
}: {
  arts: Arts;
  vb: ViewBox;
  /** Village size 0..3: how much landscape grows outside the walls. */
  tier: number;
  /** Desktop (paints a wide margin round the scene) or phone (a small one). */
  wide: boolean;
  /** Which landscape to draw (design preview picks; everyone else gets 'tiles'). */
  landscape: LandscapeChoice;
  selected: BuildingId | null;
  /** The village's hearth is out: the square's campfire is cold ash (no flames, no smoke). */
  hearthOut: boolean;
  onBox: (id: BuildingId, box: Box) => void;
  /** Click on a building's drawing (pixel-accurate; the overlay labels are the keyboard targets). */
  onPick: (id: BuildingId) => void;
  /** Which village (and mode) the looks belong to, for the build moment's memory across visits. */
  memoryKey: string;
}) {
  // Build moment (owner 2026-11-06: "the designs change all of a sudden"). When a building's look changes while this
  // scene is on screen, show scaffolding over it for a moment and let the new look grow in, instead of an instant swap.
  // The looks last shown are remembered per village for this page visit (SEEN_LOOKS), so an upgrade that finished while the
  // player was on another screen plays its moment on the way back; after a page load nothing is remembered, so opening the
  // game never animates everything.
  // Start and finish of work (owner 2026-11-06: "users can't tell when an upgrade finishes"): when a building becomes queued the
  // scaffold rises from the ground with a dust puff (starts); when it stops being queued without a new look, the scaffold fades
  // with a dust puff (ends; a new look gets the look moment above instead). Same per-village memory, so a page load never animates.
  const prevStage = useRef<Partial<Record<BuildingId, { s: number; q: boolean }>> | null>(null);
  const prevKey = useRef<string | null>(null);
  const [moments, setMoments] = useState<Partial<Record<BuildingId, number>>>({});
  const [starts, setStarts] = useState<Partial<Record<BuildingId, number>>>({});
  const [ends, setEnds] = useState<Partial<Record<BuildingId, number>>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useLayoutEffect(() => {
    const prev = prevKey.current === memoryKey ? prevStage.current : (SEEN_LOOKS.get(memoryKey) ?? null);
    prevKey.current = memoryKey;
    prevStage.current = Object.fromEntries(BUILDING_IDS.map((id) => [id, { s: arts[id].stage, q: arts[id].queued }]));
    SEEN_LOOKS.set(memoryKey, prevStage.current);
    if (!prev) return;
    const looks: BuildingId[] = [];
    const began: BuildingId[] = [];
    const ended: BuildingId[] = [];
    for (const id of BUILDING_IDS) {
      const was = prev[id] ?? { s: 0, q: false };
      const now = arts[id];
      const lookChanged = id !== 'wall' && now.stage > 0 && was.s !== now.stage;
      if (lookChanged) looks.push(id);
      if (!was.q && now.queued) began.push(id);
      else if (was.q && !now.queued && !lookChanged) ended.push(id);
    }
    const play = (
      ids: BuildingId[],
      kind: string,
      set: Dispatch<SetStateAction<Partial<Record<BuildingId, number>>>>,
      ms: number,
    ) => {
      if (ids.length === 0) return;
      set((m) => {
        const next = { ...m };
        for (const id of ids) next[id] = (m[id] ?? 0) + 1;
        return next;
      });
      for (const id of ids) {
        clearTimeout(timers.current[kind + id]);
        timers.current[kind + id] = setTimeout(() => {
          set((m) => {
            const next = { ...m };
            delete next[id];
            return next;
          });
        }, ms);
      }
    };
    play(looks, 'm', setMoments, MOMENT_MS);
    play(began, 's', setStarts, START_MS);
    play(ended, 'e', setEnds, END_MS);
  }, [arts, memoryKey]);
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const k of Object.keys(t)) clearTimeout(t[k]);
    };
  }, []);
  const items: DepthItem[] = [...sceneryItems(), fireItem(hearthOut)];
  const wall = arts.wall;
  if (wall.stage > 0) {
    for (const it of wallItems(wall.stage as Exclude<WallLook, 0>)) {
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
    const ending = ends[id];
    if (id === 'wall' && !art.queued && !ending) continue;
    // Unbuilt buildings show nothing at all (no empty plot): they are started from the Town Hall list.
    if (art.stage === 0 && !art.queued && !ending) continue;
    let url = spriteUrl(id, art.stage as Stage);
    if (id === 'wall' && art.stage > 0) url = SCAFFOLD_URL;
    else if (art.stage === 0 && art.queued) url = UNDER_CONSTRUCTION_URL;
    const moment = id !== 'wall' && art.stage > 0 ? moments[id] : undefined;
    const { x: px, y: py, scale: ps } = PLACEMENT[id];
    const gx = px;
    const gy = py + 26 * ps;
    const start = starts[id];
    // The scaffold (or the under-construction sprite / the wall's slot) rises from the ground when work starts.
    const rise = (el: ReactElement) =>
      start ? (
        <g key={`r${start}`} className="vv-start-rise" style={{ transformOrigin: `${gx}px ${gy}px` }}>
          {el}
        </g>
      ) : (
        el
      );
    // Finished without a new look: the scaffold stays a moment longer and fades. An unbuilt one that stopped fades the site.
    const fade = !art.queued && ending && !moment ? (art.stage === 0 ? UNDER_CONSTRUCTION_URL : SCAFFOLD_URL) : null;
    const sprite =
      fade && (id === 'wall' || art.stage === 0) ? null : id === 'wall' || art.stage === 0 ? rise(<SceneSprite url={url} id={id} prefix={`s-${id}-`} onBox={id === 'wall' ? undefined : onBox} />) : (
        <SceneSprite url={url} id={id} prefix={`s-${id}-`} onBox={onBox} />
      );
    const node = (
      <g
        className={`vv-b${art.locked ? ' is-locked' : ''}${selected === id && id !== 'wall' ? ' is-selected' : ''}`}
        filter={selected === id && id !== 'wall' ? 'url(#vv-sel)' : undefined}
        onClick={() => onPick(id)}
      >
        {moment ? (
          <g
            key={`m${moment}`}
            className="vv-moment-grow"
            style={{ transformOrigin: `${gx}px ${gy}px` }}
          >
            {sprite}
          </g>
        ) : (
          sprite
        )}
        {moment && (
          <g key={`ms${moment}`} className="vv-moment-scaffold" pointerEvents="none">
            <SceneSprite url={SCAFFOLD_URL} id={id} prefix={`sm-${id}-`} />
          </g>
        )}
        {moment && <MomentFx key={`mf${moment}`} gx={gx} gy={gy} roof={py - 100 * ps} />}
        {art.queued && art.stage > 0 && id !== 'wall' && !moment && rise(<SceneSprite url={SCAFFOLD_URL} id={id} prefix={`sc-${id}-`} />)}
        {fade && (
          <g key={`e${ending}`} className="vv-end-scaffold" pointerEvents="none">
            <SceneSprite url={fade} id={id} prefix={`se-${id}-`} />
          </g>
        )}
        {(start || ending) && !moment && <MomentFx key={`f${start ?? ''}${ending ?? ''}`} gx={gx} gy={gy} roof={py - 100 * ps} sparks={false} />}
        {art.active && <Workers id={id} />}
      </g>
    );
    items.push({ key: `b-${id}`, depth: placementDepth(id), node });
  }
  items.sort((a, b) => a.depth - b.depth);
  return (
    <svg className="vv-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} aria-hidden="true" focusable="false">
      <defs>
        <SceneryDefs />
        {/* Selected building outline: an ink line and a gold line round the drawing's own shape. An SVG filter (not a CSS
            drop-shadow, which Safari ignores on SVG parts). */}
        <filter id="vv-sel" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="4" result="outer" />
          <feFlood floodColor="#2B211C" />
          <feComposite in2="outer" operator="in" result="ink" />
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="inner" />
          <feFlood floodColor="#FFDC7A" />
          <feComposite in2="inner" operator="in" result="gold" />
          <feMerge>
            <feMergeNode in="ink" />
            <feMergeNode in="gold" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <LandscapeLayer choice={landscape} tier={tier} wide={wide} />
      <Ground built={BUILDING_IDS.filter((id) => arts[id].stage > 0 || arts[id].queued).join(',')} />
      {/* Selected building: a glowing ring round its whole pad on the ground (the building stands in it, so nothing is cut
          in half), plus a gold outline on the drawing itself (CSS .vv-b.is-selected). */}
      {selected && selected !== 'wall' && (
        <g className="vv-ring" pointerEvents="none" strokeLinejoin="round">
          <path className="vv-ring-fill" d={footprint(selected)} fill="#FFDC7A" opacity={0.38} />
          <path d={footprint(selected)} fill="none" stroke="#2B211C" strokeWidth={7} />
          <path className="vv-ring-edge" d={footprint(selected)} fill="none" stroke="#FFDC7A" strokeWidth={3.6} />
        </g>
      )}
      {items.map((it) => (
        <g key={it.key}>{it.node}</g>
      ))}
      {selected === 'wall' && (
        <g className="vv-select" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={footprintFront(selected)} stroke="#2B211C" strokeWidth={7} />
          <path d={footprintFront(selected)} stroke="#FFDC7A" strokeWidth={3.6} />
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
  anchor,
  level,
  locked,
  selected,
  finishIn,
  queuedNotStarted,
  onSelect,
  wasDrag,
}: {
  id: BuildingId;
  vb: ViewBox;
  box: Box;
  /** Where the label badge and pointer attach: the roof or tower top of a built building (null: use the drawing's box). */
  anchor: { x: number; y: number } | null;
  level: number;
  locked: boolean;
  selected: boolean;
  finishIn: number | null;
  queuedNotStarted: boolean;
  onSelect: (id: BuildingId) => void;
  wasDrag: () => boolean;
}) {
  const name = BUILDINGS[id].name;
  const upgrading = finishIn !== null;
  const aria = `${name}, level ${level}${level === 0 ? (locked ? ', locked, requirements not met' : ', not built') : ''}${upgrading ? `, building, ${formatDuration(finishIn)} left` : queuedNotStarted ? ', queued' : ''}`;
  const cx = pct((anchor ? anchor.x : box.x + box.w / 2) - vb.x, vb.w);
  const top = pct((anchor ? anchor.y : box.y) - vb.y, vb.h);
  return (
    <>
      <button
        type="button"
        className={`vv-hit${selected ? ' is-selected' : ''}${level === 0 ? ' is-empty' : ''}${locked ? ' is-locked' : ''}`}
        style={{ left: cx, top }}
        aria-label={aria}
        aria-pressed={selected}
        onClick={() => {
          if (!wasDrag()) onSelect(id);
        }}
      >
        <span className="vv-label" aria-hidden="true">
          <span className="vv-name">
            <span className="vv-label-full">{name}</span>
            <span className="vv-label-short">{SHORT_NAME[id] ?? name}</span>
          </span>
          <span className="vv-lv">{locked ? <Icon name="lock" size={13} /> : level}</span>
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
  levelOverride,
}: {
  mode: 'fit' | 'pan';
  selected: BuildingId | null;
  onSelect: (id: BuildingId) => void;
  /** Phone: pixels covered by the bottom sheet, so the selected building can be panned above it. */
  bottomInset?: number;
  onPanned?: () => void;
  /**
   * Design preview. building = null ("All buildings"): every building at min(level, its max), or at the first level of
   * `look` when one is picked (no queue work). building = an id: that building alone at min(level, its max); the others keep
   * their real levels and work. `work` (owner 2026-11-06): every building the preview shows (all of them, or the picked one)
   * counts as queued and running, so it shows its scaffold and builders; switching it on or off plays the start / finish.
   */
  levelOverride?: {
    building: BuildingId | null;
    level: number;
    landscape: LandscapeChoice;
    look?: 1 | 2 | 3 | 4 | null;
    work?: boolean;
  } | null;
}) {
  const { live, now, village } = useGame();
  const ov = levelOverride ?? null;
  const levels = !ov
    ? live.buildings
    : ov.building
      ? { ...live.buildings, [ov.building]: Math.min(ov.level, BUILDINGS[ov.building].maxLevel) }
      : (Object.fromEntries(
          BUILDING_IDS.map((id) => [id, ov.look ? lookStartLevel(id, ov.look) : Math.min(ov.level, BUILDINGS[id].maxLevel)]),
        ) as typeof live.buildings);
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

  // No scaffolding on the building being previewed; other buildings keep their real queue work in single-building mode.
  const queue = !ov ? live.buildQueue : ov.building ? live.buildQueue.filter((j) => j.building !== ov.building) : [];
  // 'q' = has a job, 'a' = a job is running now (builders at work); the preview's "Building work" switch fakes both.
  const faked = (id: BuildingId) => !!ov?.work && (!ov.building || ov.building === id);
  const artKey = BUILDING_IDS.map(
    (id) =>
      `${id === 'wall' ? wallLook(levels[id]) : buildingStage(id, levels[id])}${faked(id) || queue.some((j) => j.building === id) ? 'q' : ''}${
        faked(id) || queue.some((j) => j.building === id && now >= j.startAt) ? 'a' : ''
      }${
        levels[id] === 0 && unmetRequirements(levels, BUILDINGS[id].requires).length > 0 ? 'l' : ''
      }`,
  ).join(',');
  const arts = useMemo(() => {
    const out = {} as Arts;
    const parts = artKey.split(',');
    BUILDING_IDS.forEach((id, i) => {
      const p = parts[i] ?? '0';
      out[id] = { stage: Number(p[0]) as WallLook, queued: p.includes('q'), active: p.includes('a'), locked: p.includes('l') };
    });
    return out;
  }, [artKey]);

  // Landscape outside the walls grows with the village (whole-village progress or the wall's, whichever is further).
  const tier = villageTier(levels, MAX_LEVELS);

  // One fixed scene box for every wall level: it always holds the headroom for the grandest towers and flags, so the
  // village never changes size or position when the wall is upgraded and nothing is clipped at the top.
  const vb = SCENE_VIEWBOX;
  const VB = vb;

  // Hit buttons in painter's order, so the building in front wins where boxes overlap.
  const order = useMemo(() => [...BUILDING_IDS].sort((a, b) => placementDepth(a) - placementDepth(b)), []);

  // ---- Panning (phone) ----
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; px: number; py: number; moved: boolean; last?: { x: number; y: number } } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  // The scale comes from the height without the headroom above the plate (SCENE_BASE_H), so the village keeps the size
  // it had before the headroom existed; the stage is taller by the headroom and panning reaches it.
  // Owner 2026-11-06 (iPhone): 1.35-1.85 showed one building at a time and made every look round a long drag; now a few
  // buildings fit on screen (the labels are HTML, so they stay readable at any zoom).
  const scale = mode === 'pan' && view.h > 0 ? Math.min(1.05, Math.max(0.8, (view.h * 0.72) / SCENE_BASE_H)) : 1;
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
    if (mode === 'pan' && view.w > 0 && pan === null) setPan(centreOn(SCENE_FOCUS.x, SCENE_FOCUS.y));
  }, [mode, view.w, pan, centreOn]);

  // Keep the selected building in view above the bottom sheet.
  useEffect(() => {
    if (mode !== 'pan' || !selected || view.w === 0) return;
    const b = boxes[selected] ?? defaultBox(selected);
    // A little above the middle of the drawing, so its label stays clear of the village name at the top.
    setPan(centreOn(b.x + b.w / 2, b.y + b.h * 0.42));
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
      viewRef.current?.classList.add('is-dragging');
      onPanned?.();
    }
    // While the finger moves, move the stage directly (no React render per move: phones stayed smooth only this way);
    // the position is committed to state when the drag ends.
    const p = clamp(d.px + dx, d.py + dy);
    d.last = p;
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    dragged.current = d.moved;
    drag.current = null;
    viewRef.current?.classList.remove('is-dragging');
    if (d.last) setPan(d.last);
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
      <div ref={stageRef} className="vv-stage" style={stageStyle}>
        <SceneArt arts={arts} vb={vb} tier={tier} wide={mode === 'fit'} landscape={ov?.landscape ?? 'tiles'} selected={selected} hearthOut={!!village.hearth} onBox={onBox} onPick={pick} memoryKey={`${village.id}${ov ? ':preview' : ''}`} />
        <div className="vv-hits">
          {order.map((id) => {
            const jobs = queue.filter((j) => j.building === id);
            if (levels[id] === 0 && jobs.length === 0) return null;
            const active = jobs.find((j) => now >= j.startAt);
            return (
              <BuildingHit
                key={id}
                id={id}
                vb={vb}
                box={boxes[id] ?? defaultBox(id)}
                anchor={id !== 'wall' && arts[id].stage > 0 ? labelAnchor(id, arts[id].stage as Exclude<Stage, 0>) : null}
                level={levels[id]}
                locked={arts[id].locked}
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
