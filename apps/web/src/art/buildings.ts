// Building art for the village scene — the one place that maps a building + level to its picture.
//
// Swapping art: drop new files into ./buildings/ with the same names (`<file>-<stage>.svg`, plus
// `empty-plot.svg`, `under-construction.svg` and `scaffold.svg`) and they are used everywhere. Every sprite shares
// one frame: viewBox "-70 -122 140 190", a 2:1 isometric ground tile centred on (0, 26), lit from the top left.
// The scene strips that ground tile (the first three <path>s in the tile colours) and places the rest at
// PLACEMENT[id] (scene units, see SCENE_VIEWBOX); panels show the whole sprite. Labels and click areas are
// measured from the drawn sprite at runtime, so taller or wider art needs no number changes here.
// Sprites load on demand as plain .svg assets (not in the JS bundle) and are cached per URL.

import { BUILDINGS } from '@clanfire/engine';
import type { BuildingId } from '@clanfire/engine';

const FILES = import.meta.glob('./buildings/*.svg', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;

function fileUrl(name: string): string {
  const url = FILES[`./buildings/${name}.svg`];
  if (!url) throw new Error(`Missing building sprite ${name}.svg`);
  return url;
}

/** Sprite file stem per building. */
const FILE: Record<BuildingId, string> = {
  hall: 'town-hall',
  lumber: 'lumber-camp',
  farm: 'farm',
  longhouse: 'longhouse',
  mine: 'iron-mine',
  goldmine: 'gold-mine',
  storehouse: 'storehouse',
  barracks: 'barracks',
  stables: 'stables',
  wrightyard: 'wrightyard',
  wall: 'wall',
  vault: 'hidden-vault',
  market: 'market',
  drillyard: 'drillyard',
  // Placeholder drawings (a timber hall with banners) until the final art exists: replace banner-hall-<stage>.svg.
  bannerhall: 'banner-hall',
};

/**
 * Last level of stage 1 and stage 2. Stage 3 runs from the next level up to one below the max level; stage 4 is the
 * max level only (owner, 2026-11-06: four looks per building, the fourth only at the very last level).
 */
export const STAGE_TOPS: Record<BuildingId, readonly [number, number]> = {
  hall: [6, 15],
  lumber: [6, 15],
  farm: [6, 15],
  longhouse: [6, 15],
  mine: [6, 15],
  storehouse: [6, 15],
  barracks: [5, 12],
  wall: [5, 13],
  goldmine: [4, 10],
  stables: [4, 10],
  vault: [3, 7],
  wrightyard: [3, 7],
  market: [3, 7],
  drillyard: [3, 6],
  bannerhall: [1, 2],
};

export type Stage = 0 | 1 | 2 | 3 | 4;

/** 0 = not built, then the four looks (the fourth only at the building's max level). */
export function buildingStage(id: BuildingId, level: number): Stage {
  if (level <= 0) return 0;
  const [a, b] = STAGE_TOPS[id];
  if (level >= BUILDINGS[id].maxLevel) return 4;
  return level <= a ? 1 : level <= b ? 2 : 3;
}

/** The ring wall's look: same as its building stage (its grand look, drawn in code, is stage 4 = max level). */
export type WallLook = Stage;

export function wallLook(level: number): WallLook {
  return buildingStage('wall', level);
}

/** First level that shows look `stage` (1..4) of a building. */
export function lookStartLevel(id: BuildingId, stage: Exclude<Stage, 0>): number {
  const [a, b] = STAGE_TOPS[id];
  return stage === 1 ? 1 : stage === 2 ? a + 1 : stage === 3 ? b + 1 : BUILDINGS[id].maxLevel;
}

/** "7–15" style level range of a stage, for captions ("25" for a single level). */
export function stageRange(id: BuildingId, stage: Exclude<Stage, 0>): string {
  const [a, b] = STAGE_TOPS[id];
  const max = BUILDINGS[id].maxLevel;
  const [lo, hi] = stage === 1 ? [1, a] : stage === 2 ? [a + 1, b] : stage === 3 ? [b + 1, max - 1] : [max, max];
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** True when the building has its own drawing for this stage (stage 4 falls back to stage 3 until it is drawn). */
export function hasOwnStageArt(id: BuildingId, stage: Exclude<Stage, 0>): boolean {
  return `./buildings/${FILE[id]}-${stage}.svg` in FILES;
}

export function spriteUrl(id: BuildingId, stage: Stage): string {
  if (stage === 0) return EMPTY_PLOT_URL;
  const s = stage === 4 && !hasOwnStageArt(id, 4) ? 3 : stage;
  return fileUrl(`${FILE[id]}-${s}`);
}

export const EMPTY_PLOT_URL = fileUrl('empty-plot');
export const UNDER_CONSTRUCTION_URL = fileUrl('under-construction');
/** Scaffolding drawn over a building while it upgrades (same frame as the sprites, no ground tile). */
export const SCAFFOLD_URL = fileUrl('scaffold');

// ---- Scene layout -------------------------------------------------------------------------------------------
// The village is laid out on an isometric grid: ground point (u, v) sits at screen (C.x + u - v, C.y + (u + v) / 2),
// the same 2:1 projection the sprites use. The ground plate is the square |u|, |v| <= WALL_RING.plate and the ring wall
// runs along its very edge. The Town Hall stands in the middle on a small paved square; the core buildings form a ring
// around it, joined by dirt roads radiating from the hall; the resource sites sit out in the four corners (forest, rocks,
// fields). Owner 2026-11-06: the town looked crowded, so the plate grew from 234 to 273 (14 land tiles). 2026-11-11: 312 (16 tiles)
// for the Longhouse and the Wrightyard (351 made every building ~22% smaller on a desktop; the owner wants the old size), with
// the plots spread in about the same arrangement: no two drawings touch at any of their four looks (painted shapes measured from the art,
// test/village-layout.test.tsx).

/** Ring centre in scene units (both multiples of 4, the layout test's grid). */
const C = { x: 2 * 312 + 8, y: 312 + 140 } as const;

/** Screen point of the ground point (u, v), lifted by z. */
export function iso(u: number, v: number, z = 0): [number, number] {
  return [C.x + u - v, C.y + (u + v) / 2 - z];
}

/** Height of the land around the plate: the foot of the plate's earth sides (the plate stands this much proud of it). */
export const LAND_Z = -24;

/** A wall of the ring: 'front-left' (v = +plate), 'front-right' (u = +plate), 'back-left' (u = -plate), 'back-right' (v = -plate). */
export type WallSide = 'front-left' | 'front-right' | 'back-left' | 'back-right';

export interface Gate {
  side: WallSide;
  /** Centre along the wall: u on the front-left and back-right walls, v on the other two. */
  at: number;
  /** Half width of the doorway (grid units). */
  half: number;
  /** The main gate (bigger, the road to the world map). */
  main: boolean;
}

/** The gates in the ring wall (the wall code can draw one on any wall); the village has its one main gate. */
export const GATES: readonly Gate[] = [{ side: 'front-left', at: 8, half: 16, main: true }];

/**
 * The ground plate (half-side `plate` in grid units) and the ring wall on its edge (`r`: the wall's middle line).
 * One gate, `gateHalf` wide each way, where the main road leaves through the front-left wall at u = `gateU`.
 */
export const WALL_RING = { cx: C.x, cy: C.y, r: 307, plate: 312, gateHalf: 16, gateU: 8 } as const;

/** Where the phone view first looks: the Town Hall. */
export const SCENE_FOCUS = { x: C.x, y: C.y - 26 } as const;

/**
 * Scene coordinate space: the ground plate plus its edge, with the same empty headroom above it at EVERY wall level.
 * The tallest thing is the grand (max wall level) back corner tower: plate corner 294 above the centre (312 - 18) +
 * footing 48 + shaft 34 + roof 32 + flag pole 4 + 19 = 431 units, plus pen width; 452 leaves ~21 units spare. Below the
 * centre: the plate's front corner (312), its earth side (24) and a few units. Sideways: the side corners (624) + 8.
 * One fixed box (not one per wall look) means the village never changes size or position when the wall is upgraded,
 * and nothing is clipped at any level. The phone pans over this box.
 */
export const SCENE_VIEWBOX = { x: 0, y: 0, w: 2 * C.x, h: C.y + 312 + 29 } as const;

/**
 * What the desktop village picture fits (contain): every building drawing at every look with a margin, the whole front of
 * the plate, and as much of the back as the frame's shape allows. The side corners of the ring (empty wall tips) and the top of the
 * grand back tower paint past it (the scene draws outside its box; the frame clips). Its shape is the 1440x900 frame's
 * picture (648 x 410 px), so there the village is 648 / 1104 = 0.587 px per unit, the size it had at plate 273.
 */
export const SCENE_FIT_BOX = { x: C.x - 541, y: C.y - 360, w: 1104, h: 698 } as const;

/** Height the phone zoom is based on (kept from the smaller village, so buildings stay as big on a phone as before). */
export const SCENE_BASE_H = 250 + 262;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  /** Sprite origin in scene units; the ground tile centre sits at (x, y + 26 * scale). */
  x: number;
  y: number;
  scale: number;
}

/** A plot whose ground-tile centre is the grid point (u, v) at height z. A sprite's pad covers 28 * scale grid units each way. */
function plot(u: number, v: number, scale: number, z = 0): Placement {
  const [x, y] = iso(u, v, z);
  return { x, y: y - 26 * scale, scale };
}

/** Buildings standing outside the wall, on the land (none: every building is inside the ring). */
export const OUTSIDE: ReadonlySet<BuildingId> = new Set<BuildingId>();

/** Where each building stands (all four looks checked: no two drawings touch). */
export const PLACEMENT: Record<BuildingId, Placement> = {
  // The heart of the village: the Town Hall in the middle (a little forward, so its tower clears the Banner Hall behind).
  hall: plot(26, 26, 1.21),
  // Core buildings in a ring around it; the Drill Yard beside the Barracks, on the left of the square.
  barracks: plot(-244, -40, 1.365),
  drillyard: plot(-96, 40, 1.31),
  storehouse: plot(244, -112, 1.365),
  stables: plot(52, -220, 1.32),
  vault: plot(-148, -216, 1.155),
  // Either side of the main street from the gate: the Market on the right, the Wrightyard on the left (carts roll straight out).
  market: plot(76, 196, 1.26),
  wrightyard: plot(-148, 152, 1.3),
  // The Banner Hall stands at the back behind the hall, on its own road straight up from the square.
  bannerhall: plot(0, -148, 0.945),
  // The Longhouse, the clan's great hall, at the front right, clear of the front corner tower.
  longhouse: plot(236, 128, 1.35),
  // Resource sites out to the sides: gold in the back rocks, iron on the right, timber on the left, the Farm on the right.
  goldmine: plot(-216, -144, 1.26),
  mine: plot(240, -236, 1.365),
  lumber: plot(-248, 204, 1.365),
  farm: plot(224, 4, 1.365),
  // The wall's own plot (building work only) sits on the front-right wall beside the Storehouse.
  wall: plot(307, -40, 0.6),
};

/** Half width of the main street and the road out of the main gate (the land tile road is as wide). */
export const STREET_W = 12.1;
/** Half width of the cross streets to the three side gates and their roads outside. */
export const SIDE_STREET_W = 10;
/** Half width of a branch to a door. */
export const BRANCH_W = 8;

export interface RoadDef {
  key: string;
  /** Corner points (u, v) in grid units; every leg runs along u or v. */
  pts: readonly (readonly [number, number])[];
  /** Half width in grid units. */
  w: number;
  /** The building it leads to (null: always shown). */
  to: BuildingId | null;
}

/** Ground point (u, v) of a building's plot centre. */
export function plotUV(id: BuildingId): { u: number; v: number } {
  const p = PLACEMENT[id];
  const z = OUTSIDE.has(id) ? LAND_Z : 0;
  const dx = p.x - C.x;
  const s = 2 * (p.y + 26 * p.scale - C.y + z);
  return { u: (dx + s) / 2, v: (s - dx) / 2 };
}

/** Where a path ends at a building's door: the middle of its front-left (+v) face, a little in under the pad. */
export function doorUV(id: BuildingId): { u: number; v: number } {
  const { u, v } = plotUV(id);
  return { u, v: v + 28 * PLACEMENT[id].scale - 3 };
}

/**
 * How far in from its tile corner each drawing first covers its door line (sprite units along v' on the line u' = 0, from the
 * tile's front-left face at v' = 26 towards the middle), per look 1..4: where the building or its yard begins (the first painted
 * stretch at least 3 units deep, so a lone lamp or sack in front does not count).
 * Measured from the painted masks (test/sprite-boxes.json); the layout test fails when a drawing changed and this did not.
 */
export const DOOR_DEPTH: Record<Exclude<BuildingId, 'wall' | 'hall'>, readonly [number, number, number, number]> = {
  lumber: [30, 23.5, 26, 26],
  farm: [14, 23.5, 23.5, 23.5],
  longhouse: [15.5, 15.5, 18, 22],
  mine: [26, 26, 26, 26],
  goldmine: [26, 26, 26, 26],
  storehouse: [15.5, 22, 15.5, 15.5],
  barracks: [23.5, 23.5, 26, 26],
  stables: [15.5, 7.5, 15.5, 22],
  wrightyard: [22, 23.5, 26, 26],
  vault: [32, 32, 23.5, 32],
  market: [15.5, 22, 26, 22],
  drillyard: [23.5, 23.5, 26, 30],
  bannerhall: [26, 31.5, 31.5, 32],
};
/** The road runs this far (sprite units) in under the drawing's front, so it reads as walking straight in. */
export const DOOR_TUCK = 4;

/**
 * Buildings whose drawing has open ground in front (horses, a paddock): from these looks on the whole lot is a paved yard in
 * the road's own surface (half side in sprite units, 0 = none), and the road runs onto it (owner 2026-11-17: the Stables road
 * stopped short with grass between it and the stable, the horses on the grass).
 */
export const YARD: Partial<Record<BuildingId, readonly [number, number, number, number]>> = {
  stables: [0, 25, 25, 25],
};

/** Half side (grid units) of a building's paved yard at a look, or 0. */
export function yardHalf(id: BuildingId, stage: number): number {
  const h = YARD[id]?.[Math.min(4, Math.max(1, stage)) - 1] ?? 0;
  return h * PLACEMENT[id].scale;
}

/**
 * Where a building's road ends at a look (1..4): on its door line, just in under the front of the drawing (never past the door
 * point), or just onto its yard when it has one.
 */
export function roadEnd(id: BuildingId, stage: number): { u: number; v: number } {
  const d = doorUV(id);
  if (id === 'wall' || id === 'hall') return d;
  const { v } = plotUV(id);
  const yard = yardHalf(id, stage);
  if (yard) return { u: d.u, v: v + yard - 1.5 * PLACEMENT[id].scale };
  const k = DOOR_DEPTH[id][Math.min(4, Math.max(1, stage)) - 1]!;
  return { u: d.u, v: Math.min(d.v, v + (k - DOOR_TUCK) * PLACEMENT[id].scale) };
}

/** Roads on the land outside the wall to buildings standing there (none now; the main road belongs to the landscape). */
export const OUTER_ROADS: readonly RoadDef[] = [];

/**
 * Where each drawing's roof or tower ends, in sprite units (y, up is negative), per stage 1..3 (stage 4 uses the stage 3 value). Flag poles, flags, weather
 * vanes and smoke are left out on purpose: the label and its pointer sit on the building itself, not on a thin pole far
 * above it (the Town Hall's flag reaches 108 units up, its dome only 82). Measured from the art with a ruler.
 */
const ROOF_TOP: Record<Exclude<BuildingId, 'wall'>, readonly [number, number, number]> = {
  hall: [-62, -80, -82],
  lumber: [-50, -50, -62],
  farm: [-20, -30, -38],
  longhouse: [-20, -34, -60],
  mine: [-38, -62, -58],
  goldmine: [-40, -54, -68],
  storehouse: [-14, -17, -20],
  barracks: [-46, -54, -86],
  stables: [-28, -45, -52],
  wrightyard: [-10, -32, -58],
  vault: [-22, -25, -29],
  market: [-22, -32, -36],
  drillyard: [-20, -30, -40],
  bannerhall: [-22, -34, -36],
};

/** Scene point just on top of a built building (stage 1..4): where its label badge and pointer attach. */
export function labelAnchor(id: Exclude<BuildingId, 'wall'>, stage: Exclude<Stage, 0>): { x: number; y: number } {
  const { x, y, scale } = PLACEMENT[id];
  return { x, y: y + ROOF_TOP[id][Math.min(stage, 3) - 1]! * scale };
}

/** Painter's order: things further down the screen are drawn later. */
export function placementDepth(id: BuildingId): number {
  const p = PLACEMENT[id];
  return p.y + 26 * p.scale;
}

/** Ring on the ground round the selected building: its whole pad (a little bigger), so it frames the building on all sides. */
export function footprint(id: Exclude<BuildingId, 'wall'>): string {
  const { u, v } = plotUV(id);
  const z = OUTSIDE.has(id) ? LAND_Z : 0;
  const h = 28 * PLACEMENT[id].scale + 13;
  const pts: [number, number][] = [
    [u - h, v - h],
    [u + h, v - h],
    [u + h, v + h],
    [u - h, v + h],
  ];
  return `M${pts.map(([a, b]) => iso(a, b, z).map((n) => Math.round(n * 10) / 10).join(' ')).join('L')}Z`;
}

/** Highlight under the selected wall: the two front edges along its outer foot. */
export function footprintFront(id: BuildingId): string {
  if (id === 'wall') {
    // Along the outer foot of the two front walls (the plate's front edges).
    const r = WALL_RING.plate + 1;
    const [lx, ly] = iso(-r, r);
    const [fx, fy] = iso(r, r);
    const [rx, ry] = iso(r, -r);
    return `M${lx} ${ly}L${fx} ${fy}L${rx} ${ry}`;
  }
  const { x, y, scale } = PLACEMENT[id];
  const cy = y + 26 * scale;
  const hw = 52 * scale;
  const hh = 26 * scale;
  return `M${x - hw} ${cy}L${x} ${cy + hh}L${x + hw} ${cy}`;
}

/** Label area for the wall: on the front-right wall, beside the Storehouse. */
export const WALL_HIT: Box = (() => {
  const [x, y] = iso(WALL_RING.r, -40);
  return { x: x - 20, y: y - 44, w: 40, h: 40 };
})();

// ---- Sprite loading ----------------------------------------------------------------------------------------

export interface SpriteData {
  viewBox: string;
  /** Whole drawing (inner SVG markup). */
  body: string;
  /** Drawing without the ground tile, for the scene. */
  ground: string;
}

// Quotes may be ' or " (Vite rewrites small SVGs it inlines as data: URLs).
const TILE_RE = /^\s*(?:<path\b[^>]*\bfill=["']#(?:5E8C3A|3A5E27|A6C964)["'][^>]*>(?:\s*<\/path>)?\s*){3}/i;
const cache = new Map<string, Promise<SpriteData>>();
const ready = new Map<string, SpriteData>();

/** Fetch + parse a sprite once. Only URLs from this module (our own bundled files) are ever loaded. */
export function loadSprite(url: string): Promise<SpriteData> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`sprite ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const m = /<svg\b[^>]*\bviewBox=["']([^"']+)["'][^>]*>([\s\S]*)<\/svg>/i.exec(text);
        const body = m?.[2] ?? '';
        const data: SpriteData = { viewBox: m?.[1] ?? '-70 -122 140 190', body, ground: body.replace(TILE_RE, '') };
        ready.set(url, data);
        return data;
      });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Already-loaded sprite, if any (lets components render without a blank first frame). */
export function readySprite(url: string): SpriteData | null {
  return ready.get(url) ?? null;
}

/** Make the sprite's internal ids unique per drawing so two copies on one page do not clash. */
export function scopeIds(markup: string, prefix: string): string {
  return markup
    .replace(/\bid=(["'])([^"']+)\1/g, (_m, q: string, id: string) => `id=${q}${prefix}${id}${q}`)
    .replace(/href=(["'])#([^"']+)\1/g, (_m, q: string, id: string) => `href=${q}#${prefix}${id}${q}`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}${id})`);
}
