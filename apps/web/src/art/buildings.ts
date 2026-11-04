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
  mine: 'iron-mine',
  goldmine: 'gold-mine',
  storehouse: 'storehouse',
  barracks: 'barracks',
  stables: 'stables',
  wall: 'wall',
  vault: 'hidden-vault',
  market: 'market',
  drillyard: 'drillyard',
};

/** Last level of stage 1 and stage 2; stage 3 runs to max level (design/style-directions/renders/E-building-stages.webp). */
const STAGE_TOPS: Record<BuildingId, readonly [number, number]> = {
  hall: [5, 12],
  lumber: [5, 12],
  farm: [5, 12],
  mine: [5, 12],
  storehouse: [5, 12],
  barracks: [5, 12],
  wall: [5, 12],
  goldmine: [5, 10],
  stables: [5, 10],
  vault: [3, 7],
  market: [3, 6],
  drillyard: [3, 6],
};

export type Stage = 0 | 1 | 2 | 3;

/** 0 = not built, then the three looks. */
export function buildingStage(id: BuildingId, level: number): Stage {
  if (level <= 0) return 0;
  const [a, b] = STAGE_TOPS[id];
  return level <= a ? 1 : level <= b ? 2 : 3;
}

/** "Lv 6–12" style range for a stage, for captions. */
export function stageRange(id: BuildingId, stage: Exclude<Stage, 0>): string {
  const [a, b] = STAGE_TOPS[id];
  const max = BUILDINGS[id].maxLevel;
  return stage === 1 ? `1–${a}` : stage === 2 ? `${a + 1}–${b}` : `${b + 1}–${max}`;
}

export function spriteUrl(id: BuildingId, stage: Stage): string {
  return stage === 0 ? EMPTY_PLOT_URL : fileUrl(`${FILE[id]}-${stage}`);
}

export const EMPTY_PLOT_URL = fileUrl('empty-plot');
export const UNDER_CONSTRUCTION_URL = fileUrl('under-construction');
/** Scaffolding drawn over a building while it upgrades (same frame as the sprites, no ground tile). */
export const SCAFFOLD_URL = fileUrl('scaffold');

// ---- Scene layout -------------------------------------------------------------------------------------------
// The village is laid out on an isometric grid: ground point (u, v) sits at screen (C.x + u - v, C.y + (u + v) / 2),
// the same 2:1 projection the sprites use. The ring wall is the square |u|, |v| <= WALL_RING.r; the town square with
// the campfire is in the middle; the buildings stand on a 4 x 4 grid around it (the four middle cells are the square)
// with open ground and paths between every two plots, so nothing touches even at the last stage.

/** Ring centre in scene units. */
const C = { x: 474, y: 330 } as const;

/** Screen point of the ground point (u, v), lifted by z. */
export function iso(u: number, v: number, z = 0): [number, number] {
  return [C.x + u - v, C.y + (u + v) / 2 - z];
}

/** The ring wall (half-side r in grid units), the ground plate around it and the gaps for the four gates. */
export const WALL_RING = { cx: C.x, cy: C.y, r: 212, plate: 234, gateHalf: 16 } as const;

/** Where the phone view first looks (a little above the campfire, so the Town Hall is in view). */
export const SCENE_FOCUS = { x: C.x, y: C.y - 70 } as const;

/** Scene coordinate space: the ground plate plus its edge; the top grows with the Town Hall and the wall towers. */
export const SCENE_VIEWBOX = { x: C.x - 474, y: C.y - 250, w: 948, h: 250 + 262 } as const;

/** The scene grows upwards when the Town Hall or the wall gets taller (labels and towers must stay inside). */
export function sceneViewBox(hallStage: Stage, wallStage: Stage = 0): { x: number; y: number; w: number; h: number } {
  // Extra headroom keeps the bobbing selection arrow above the Town Hall label from being clipped.
  const hall = hallStage >= 3 ? 371 : hallStage === 2 ? 312 : 296;
  const wall = wallStage >= 3 ? 318 : wallStage === 2 ? 270 : wallStage === 1 ? 265 : 250;
  const top = C.y - Math.max(hall, wall);
  const bottom = SCENE_VIEWBOX.y + SCENE_VIEWBOX.h;
  return { x: SCENE_VIEWBOX.x, y: top, w: SCENE_VIEWBOX.w, h: bottom - top };
}

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

/** A plot whose ground-tile centre is the grid point (u, v). A sprite's pad covers about 28 * scale grid units each way. */
function plot(u: number, v: number, scale: number): Placement {
  const [x, y] = iso(u, v);
  return { x, y: y - 26 * scale, scale };
}

/** Where each building stands (grid cells at +-60 / +-156; the corner plots sit a little inwards from the towers). */
export const PLACEMENT: Record<BuildingId, Placement> = {
  // Back row: the Town Hall in the far corner, the Storehouse and Barracks beside it.
  hall: plot(-154, -154, 1.45),
  storehouse: plot(-156, -60, 1.3),
  barracks: plot(-60, -156, 1.3),
  // Left: the Drill Yard and, in the left corner, the Lumber Camp at the edge of its grove (the cell in front is forest).
  drillyard: plot(-156, 60, 1.25),
  lumber: plot(-150, 154, 1.3),
  // Right: Stables, the Iron Mine in its rocky corner, the Hidden Vault tucked away beside it.
  stables: plot(60, -156, 1.3),
  mine: plot(154, -150, 1.3),
  vault: plot(156, -60, 1.05),
  // Front: Farm, Gold Mine in the near corner, Market by the front-left road.
  farm: plot(156, 60, 1.3),
  goldmine: plot(148, 148, 1.25),
  market: plot(60, 156, 1.2),
  // The wall's own plot (building work only) sits on the front-right wall between the Farm and the Gold Mine.
  wall: plot(212, 108, 0.6),
};

/** Painter's order: things further down the screen are drawn later. */
export function placementDepth(id: BuildingId): number {
  const p = PLACEMENT[id];
  return p.y + 26 * p.scale;
}

/** Highlight under the selected building: the two front edges of its ground tile. */
export function footprintFront(id: BuildingId): string {
  if (id === 'wall') {
    // Along the outer foot of the two front walls.
    const r = WALL_RING.r + 9;
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

/** Label area for the wall: on the front-right wall, between the Farm and the Gold Mine. */
export const WALL_HIT: Box = (() => {
  const [x, y] = iso(WALL_RING.r, 108);
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
