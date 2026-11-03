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
  market: 'storehouse', // placeholder art: reuses the storehouse sprites until a Market sprite is drawn
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

/** Scene coordinate space (approved artboard VillageViewDesktop: x 10–590, ground ends at y 372). */
export const SCENE_VIEWBOX = { x: 10, y: -4, w: 580, h: 376 } as const;

/** The scene grows upwards when the Town Hall gets taller (its label must stay inside). */
export function sceneViewBox(hallStage: Stage): { x: number; y: number; w: number; h: number } {
  // Extra 30 units of headroom keep the bobbing selection arrow above the Town Hall label from being clipped.
  const top = (hallStage >= 3 ? -50 : hallStage === 2 ? -34 : -10) - 30;
  return { x: SCENE_VIEWBOX.x, y: top, w: SCENE_VIEWBOX.w, h: SCENE_VIEWBOX.y + SCENE_VIEWBOX.h - top };
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

/** Where each building stands. Wall: the anchor of its plot/scaffold on the front-right wall edge. */
export const PLACEMENT: Record<BuildingId, Placement> = {
  hall: { x: 300, y: 126.3, scale: 1.3 },
  barracks: { x: 392.3, y: 172.5, scale: 1.15 },
  storehouse: { x: 209, y: 173.1, scale: 1.15 },
  lumber: { x: 76.4, y: 174.4, scale: 1.1 },
  mine: { x: 524.9, y: 177.6, scale: 1.05 },
  vault: { x: 357.2, y: 212.1, scale: 0.62 },
  goldmine: { x: 454.7, y: 216.7, scale: 1 },
  stables: { x: 300, y: 221.2, scale: 1.1 },
  farm: { x: 300, y: 287.5, scale: 1.1 },
  wall: { x: 372, y: 238.5, scale: 0.55 },
  market: { x: 190, y: 250, scale: 0.95 },
  drillyard: { x: 90, y: 262, scale: 0.9 },
};

/** Painter's order: things further down the screen are drawn later. */
export function placementDepth(id: BuildingId): number {
  const p = PLACEMENT[id];
  return p.y + 26 * p.scale;
}

/** Highlight under the selected building: the two front edges of its ground tile. */
export function footprintFront(id: BuildingId): string {
  if (id === 'wall') {
    const { cx, cy, hw, hh } = WALL_RING;
    return `M${cx - hw} ${cy + 5}L${cx} ${cy + hh + 5}L${cx + hw} ${cy + 5}`;
  }
  const { x, y, scale } = PLACEMENT[id];
  const cy = y + 26 * scale;
  const hw = 52 * scale;
  const hh = 26 * scale;
  return `M${x - hw} ${cy}L${x} ${cy + hh}L${x + hw} ${cy}`;
}

/** The ring wall around the market square: an isometric diamond. Gates sit where the roads cross each edge. */
export const WALL_RING = { cx: 300, cy: 205.6, hw: 166.4, hh: 83.2, gateHalf: 11 } as const;

/** Label area for the wall: on the front-right edge, between the vault and the gold mine. */
export const WALL_HIT: Box = { x: 352, y: 236, w: 40, h: 30 };

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
