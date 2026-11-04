// Canvas drawing for the 2.5D isometric world map (Toy Diorama). Pure function of (scene); the caller
// decides when to redraw. Near zoom blits cached terrain/sprite bitmaps tile by tile in painter's order;
// far zoom blits pre-composited multi-tile blocks (blocks.ts) so thousands of tiles stay cheap.

import type { Coords, MapVillageDto, MovementDto } from '@clanfire/engine';
import { mapStage, ruinStage } from '@clanfire/engine';
import { ALLEGIANCE_STYLE, allegianceOf, villageSprite } from './allegiance.ts';
import { CHUNK } from './chunks.ts';
import type { MapChunks } from './chunks.ts';
import { toScreen } from './iso.ts';
import type { View } from './iso.ts';
import { tileArt } from './blocks.ts';
import type { TerrainBlocks } from './blocks.ts';
import { ArtPainter, BANNER_BASE, CLEARED_TILE, RUIN_TOP, STAGE_TOP, TILE_LIFT, allTilesReady, hitSprite } from './sprites.ts';
import { GRASS, HILLS } from './terrain.ts';
import type { TerrainCache } from './terrain.ts';

export interface Scene {
  ctx: CanvasRenderingContext2D;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  view: View;
  radius: number;
  terrain: TerrainCache;
  /** Far-zoom terrain block cache (one per map). */
  blocks: TerrainBlocks;
  chunks: MapChunks;
  selected: Coords | null;
  hover: Coords | null;
  own: Coords | null;
  movements: readonly MovementDto[];
  /** Server-corrected time (ms) for marching markers. */
  now: number;
  /** Mid-gesture: reuse cached bitmaps from another zoom level instead of rasterising a new one. */
  quick: boolean;
}

/** A drawn village sprite, kept for picking (front-most last). */
/** Abandoned villages are drawn at this share of the player-village size. */
// 1 = the art's own size: the widest stages fill exactly one tile (1.3 spilled onto neighbours; owner, 2026-11-04).
const VILLAGE_DRAW_SCALE = 1;
// Protection dome stays inside its own tile (tile half-width 48, dome radius 50).
const DOME_SCALE = 0.94;
const RUIN_DRAW_SCALE = VILLAGE_DRAW_SCALE; // same scale, so more points always looks bigger

export interface DrawnVillage {
  village: MapVillageDto;
  sprite: string;
  /** Screen position of the tile centre on the village's ground (CSS px). */
  x: number;
  y: number;
  scale: number;
}

export interface FrameResult {
  /** Some bitmaps came from another zoom level; redraw once the gesture ends. */
  stale: boolean;
  villages: DrawnVillage[];
  /** Fastest on-screen marker speed (CSS px per second); -1 when no marker is visible. */
  markerSpeed: number;
}

/** Below this tile width terrain comes from cached multi-tile blocks (far zoom). */
export const FAR_TILE = 52;
/** From this tile width villages get coordinate / tribe-tag labels. */
const LABEL_TILE = 60;

const INK = '#2B211C';
const BONE = '#FFF8E8';
const SUN = '#F2B33D';
const TABLE = '#C99A62';
const PLANK = '#9E6E3E';
const BOARD = '#2E3A20';
const FONT = 'Rubik, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DISPLAY = '"Bagel Fat One", Rubik, system-ui, sans-serif';

/** Flat tile colours while the terrain art loads. */
const FLAT = ['#A6C964', '#7FA94A', '#B4D274', '#E3DED3', '#2F9AA0'] as const;

const MOVE_COLOR: Record<string, string> = { attack: '#C4623A', scout: '#7A3B5E', support: '#2F9AA0', return: '#5E8C3A', shipment: '#B8892B' };

// Shapes from design/style-directions/artboards/MapVillageStages.dc.html, in tile-centre SVG px (tile = 96 wide).
const RING = new Path2D('M-5.4 -19.9Q0 -22.6 5.4 -19.9L39.8 -2.7Q45.1 0 39.8 2.7L5.4 19.9Q0 22.6 -5.4 19.9L-39.8 2.7Q-45.1 0 -39.8 -2.7Z');
const RING_FRONT = new Path2D('M-41.3 -1.9L-45.1 0L0 22.6L45.1 0L41.3 -1.9');
const SELECT = new Path2D('M-7.2 -22.3Q0 -25.9 7.2 -22.3L44.7 -3.6Q51.8 0 44.7 3.6L7.2 22.3Q0 25.9 -7.2 22.3L-44.7 3.6Q-51.8 0 -44.7 -3.6Z');
const POINTER = new Path2D('M-9 -8H9L0 4Z');
const POINTER_HI = new Path2D('M-9 -8H9L7.2 -5.2H-7.2Z');
// Dome: base ellipse fits the tile; tall enough to cover a 1.3x village.
const DOME_BACK = new Path2D('M-50 0A50 25 0 0 1 50 0A50 82 0 0 0 -50 0Z');
const DOME_BACK_RIM = new Path2D('M-50 0A50 25 0 0 1 50 0');
const DOME_FRONT = new Path2D('M-50 0A50 82 0 0 1 50 0A50 25 0 0 1 -50 0Z');
const DOME_FRONT_RIM = new Path2D('M-50 0A50 25 0 0 0 50 0');
const DOME_SHINE = new Path2D('M-38 -34A40 60 0 0 1 -8 -76');
const DOME_SHINE2 = new Path2D('M30 -52A40 60 0 0 1 40 -31');
const SHIELD = new Path2D('M0 -10L9 -7V0C9 6 4 9.5 0 11C-4 9.5 -9 6 -9 0V-7Z');
const SHIELD_SHADE = new Path2D('M0 -10L9 -7V0C9 6 4 9.5 0 11Z');
const SHIELD_TICK = new Path2D('M-4 0.5L-1 3.5L4.5 -3');

const vkey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);

/** Pick a label step so labels stay at least `min` px apart. */
function labelStep(px: number, min: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200]) if (s * px >= min) return s;
  return 500;
}

function shortClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Chunky rounded label centred on (cx, cy), optionally with a coloured chip (tribe tag) at the end. */
function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, bg = INK, fg = BONE, chip?: { text: string; color: string }): void {
  ctx.font = `600 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  let cw = 0;
  if (chip) {
    ctx.font = `700 ${size * 0.86}px ${FONT}`;
    cw = ctx.measureText(chip.text).width + size * 0.8;
  }
  const padX = size * 0.6;
  const h = Math.round(size * 1.7);
  const w = tw + padX * 2 + (chip ? cw + size * 0.35 : 0);
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  roundRect(ctx, x, y + 2, w, h, h / 2);
  ctx.fillStyle = 'rgba(18, 12, 9, 0.55)';
  ctx.fill();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.fillStyle = fg;
  ctx.fillText(text, x + padX, y + h / 2 + 0.5);
  if (chip) {
    const chx = x + padX + tw + size * 0.35;
    const chh = h - 6;
    roundRect(ctx, chx, y + 3, cw, chh, chh / 2);
    ctx.fillStyle = chip.color;
    ctx.fill();
    ctx.font = `700 ${size * 0.86}px ${FONT}`;
    ctx.fillStyle = BONE;
    ctx.fillText(chip.text, chx + size * 0.4, y + h / 2 + 0.5);
  }
}

function withTile(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fn: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  fn();
  ctx.restore();
}

export function drawMap(sc: Scene): FrameResult {
  const { ctx, width: W, height: H, view, radius: R, terrain, dpr } = sc;
  const t = view.tile;
  const s = t / 96;
  const hw = t / 2;
  const hh = t / 4;
  const cu = view.cx - view.cy;
  const cv = view.cx + view.cy;
  // Tile centres snapped to device pixels so bitmaps blit 1:1.
  const snap = (n: number) => Math.round(n * dpr) / dpr;
  const sxy = (u: number, v: number) => ({ x: snap(W / 2 + (u - cu) * hw), y: snap(H / 2 + (v - cv) * hh) });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Bitmaps are drawn at 81-100% of their raster size: bilinear is sharp enough and far cheaper than 'high'.
  ctx.imageSmoothingQuality = 'low';
  ctx.setLineDash([]);

  drawTable(sc);
  const rimShown = drawBoard(sc);

  const far = t < FAR_TILE && allTilesReady();
  const painter = new ArtPainter(ctx, t, dpr, sc.quick);

  // Villages near the view, keyed by tile.
  const villages = new Map<number, MapVillageDto>();
  const vb = { x0: 0, y0: 0, x1: 0, y1: 0 };
  {
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const [px, py] of [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ] as const) {
      const a = (px - W / 2) / hw;
      const b = (py - H / 2) / hh;
      bx0 = Math.min(bx0, view.cx + (a + b) / 2);
      by0 = Math.min(by0, view.cy + (b - a) / 2);
      bx1 = Math.max(bx1, view.cx + (a + b) / 2);
      by1 = Math.max(by1, view.cy + (b - a) / 2);
    }
    const x0 = Math.max(-R, Math.floor(bx0) - 2);
    const y0 = Math.max(-R, Math.floor(by0) - 2);
    const x1 = Math.min(R, Math.ceil(bx1) + 6);
    const y1 = Math.min(R, Math.ceil(by1) + 6);
    Object.assign(vb, { x0, y0, x1, y1 });
    for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) {
      for (let cj = Math.floor(y0 / CHUNK); cj <= Math.floor(y1 / CHUNK); cj++) {
        for (const v of sc.chunks.villagesIn(ci, cj)) if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) villages.set(vkey(v.x, v.y), v);
      }
    }
  }

  // Tile ranges in (u = x - y, v = x + y). Art reaches ~1.4 tiles above its centre and ~0.5 below.
  const uMin = Math.floor(cu - (W / 2 + hw) / hw);
  const uMax = Math.ceil(cu + (W / 2 + hw) / hw);
  const vMin = Math.max(-2 * R, Math.floor(cv - H / 2 / hh - 3));
  const vMax = Math.min(2 * R, Math.ceil(cv + H / 2 / hh + 7));

  const drawn: DrawnVillage[] = [];
  const sel = sc.selected;
  let pointerAt: { x: number; y: number } | null = null;
  let selFrame: { x: number; y: number } | null = null;

  if (far) sc.blocks.draw(ctx, t, dpr, sc.quick, vb, (x, y) => sxy(x - y, x + y), W, H);

  for (let v = vMin; v <= vMax; v++) {
    // |x| <= R and |y| <= R with x = (u + v) / 2, y = (v - u) / 2; u and v share parity.
    let lo = Math.max(uMin, -2 * R - v, v - 2 * R);
    const hi = Math.min(uMax, 2 * R - v, v + 2 * R);
    if (((lo + v) & 1) !== 0) lo += 1;
    if (!far) {
      for (let u = lo; u <= hi; u += 2) {
        const x = (u + v) >> 1;
        const y = (v - u) >> 1;
        const p = sxy(u, v);
        const code = terrain.get(x, y);
        const name = villages.has(vkey(x, y)) ? CLEARED_TILE[code]! : tileArt(code, x, y);
        if (!painter.draw(name, p.x, p.y)) drawFlatTile(ctx, code, p.x, p.y, s);
      }
    }
    // Villages, selection and hover after the whole row, so side neighbours never cut into them.
    for (let u = lo; u <= hi; u += 2) {
      const x = (u + v) >> 1;
      const y = (v - u) >> 1;
      const vil = villages.get(vkey(x, y));
      const isSel = !!sel && sel.x === x && sel.y === y;
      const isHover = !!sc.hover && sc.hover.x === x && sc.hover.y === y;
      if (!vil && !isSel && !isHover) continue;
      const p = sxy(u, v);
      const code = terrain.get(x, y);
      const lift = (vil ? (code === HILLS ? 12 : 0) : (TILE_LIFT[code] ?? 0)) * s;
      const gx = p.x;
      const gy = p.y - lift;
      if (isHover && !isSel) {
        withTile(ctx, gx, gy, s, () => {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(255, 248, 232, 0.85)';
          ctx.stroke(RING);
        });
      }
      if (isSel) {
        // Back half here (behind the sprite); the front half is drawn over the tiles in front later.
        selFrame = { x: gx, y: gy };
        drawSelectFrame(ctx, gx, gy, s, 'back');
      }
      if (vil) {
        drawn.push(drawVillage(ctx, painter, vil, gx, gy, s));
        if (isSel) {
          const top = vil.kind === 'abandoned' ? RUIN_TOP[ruinStage(vil.points) - 1] : STAGE_TOP[mapStage(vil.points) - 1];
          pointerAt = { x: gx, y: gy + ((top ?? -80) * (vil.kind === 'abandoned' ? RUIN_DRAW_SCALE : VILLAGE_DRAW_SCALE) - 16) * s };
        }
      } else if (isSel) {
        pointerAt = { x: gx, y: gy - 34 * s };
      }
    }
  }

  // ---- Overlays (always on top) ----
  if (selFrame) drawSelectFrame(ctx, selFrame.x, selFrame.y, s, 'front');
  drawRoutePreview(sc);
  const markerSpeed = drawMovements(sc);

  const fs = Math.max(10, Math.min(14, t * 0.13));
  for (const d of drawn) {
    const vil = d.village;
    const own = vil.kind === 'own';
    if (!own && t < LABEL_TILE) continue;
    const coords = `${vil.x}|${vil.y}`;
    const ly = d.y + 30 * s + fs * 0.6;
    if (own) pill(ctx, t >= LABEL_TILE ? `${vil.name} ${coords}` : coords, d.x, ly, fs, SUN, INK);
    else pill(ctx, coords, d.x, ly, fs, INK, BONE, vil.tribeTag ? { text: `[${vil.tribeTag}]`, color: ALLEGIANCE_STYLE[allegianceOf(vil)].ring } : undefined);
  }

  if (pointerAt) {
    const k = Math.max(0.8, Math.min(1.5, s * 1.3));
    ctx.save();
    ctx.translate(pointerAt.x, pointerAt.y);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.fillStyle = SUN;
    ctx.fill(POINTER);
    ctx.fillStyle = '#FFDC7A';
    ctx.fill(POINTER_HI);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = INK;
    ctx.stroke(POINTER);
    ctx.restore();
  }

  // The floating coordinate ruler (drawRuler) is no longer drawn: its numbers sat in the middle of the
  // map while panning. The centre coordinates are shown in the map's status line instead.
  void rimShown;

  return { stale: painter.stale, villages: drawn, markerSpeed };
}

/** Sunflower selection frame around a tile, split at the tile's centre line so the sprite sits inside it. */
function drawSelectFrame(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, half: 'back' | 'front'): void {
  ctx.save();
  ctx.beginPath();
  if (half === 'back') ctx.rect(x - 70 * s, y - 40 * s, 140 * s, 40 * s);
  else ctx.rect(x - 70 * s, y, 140 * s, 40 * s);
  ctx.clip();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke(SELECT);
  ctx.lineWidth = 4;
  ctx.strokeStyle = SUN;
  ctx.stroke(SELECT);
  ctx.setLineDash([10, 12]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#FFDC7A';
  ctx.stroke(SELECT);
  ctx.restore();
}

function drawVillage(ctx: CanvasRenderingContext2D, painter: ArtPainter, v: MapVillageDto, x: number, y: number, s: number): DrawnVillage {
  const al = allegianceOf(v);
  const style = ALLEGIANCE_STYLE[al];
  const sprite = villageSprite(v);
  const abandoned = al === 'abandoned';
  const dome = v.protected && !abandoned;

  // Ring (back half is hidden by the sprite) and the dome's back under the sprite.
  withTile(ctx, x, y, s, () => {
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.dash as number[]);
    if (abandoned) {
      ctx.scale(0.94, 0.94);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(110, 103, 94, 0.9)';
      ctx.stroke(RING);
    } else {
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.95)';
      ctx.stroke(RING);
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = style.ring;
      ctx.stroke(RING);
    }
    if (dome) {
      ctx.setLineDash([]);
      ctx.scale(DOME_SCALE, DOME_SCALE);
      ctx.fillStyle = 'rgba(221, 244, 241, 0.28)';
      ctx.fill(DOME_BACK);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(26, 100, 107, 0.6)';
      ctx.stroke(DOME_BACK_RIM);
    }
  });

  // Ruins are drawn smaller than player villages so they never dominate the map.
  const k = abandoned ? RUIN_DRAW_SCALE : VILLAGE_DRAW_SCALE;
  if (!painter.draw(sprite, x, y, k)) {
    ctx.beginPath();
    ctx.arc(x, y - 10 * s, 14 * s, 0, Math.PI * 2);
    ctx.fillStyle = style.ring;
    ctx.fill();
  }

  if (!abandoned) {
    withTile(ctx, x, y, s, () => {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(style.dash as number[]);
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = BONE;
      ctx.stroke(RING_FRONT);
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = style.ring;
      ctx.stroke(RING_FRONT);
    });
    const base = BANNER_BASE[mapStage(v.points) - 1] ?? BANNER_BASE[0]!;
    painter.draw(`banner-${al}`, x + base[0] * s * k, y + base[1] * s * k, 1.15 * k);
  }

  if (dome) {
    withTile(ctx, x, y, s, () => {
      ctx.scale(DOME_SCALE, DOME_SCALE);
      ctx.fillStyle = 'rgba(221, 244, 241, 0.26)';
      ctx.fill(DOME_FRONT);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.stroke(DOME_SHINE);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.stroke(DOME_SHINE2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2F9AA0';
      ctx.stroke(DOME_FRONT_RIM);
      ctx.translate(34, -66);
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#2F9AA0';
      ctx.fill(SHIELD);
      ctx.fillStyle = '#1A646B';
      ctx.fill(SHIELD_SHADE);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = INK;
      ctx.stroke(SHIELD);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = BONE;
      ctx.stroke(SHIELD_TICK);
    });
  }

  return { village: v, sprite, x, y, scale: s * k };
}

function drawFlatTile(ctx: CanvasRenderingContext2D, code: number, x: number, y: number, s: number): void {
  const c = FLAT[code] ?? FLAT[GRASS];
  const cy = y - (TILE_LIFT[code] ?? 0) * s;
  const hw = 46 * s;
  const hh = 23 * s;
  ctx.beginPath();
  ctx.moveTo(x, cy - hh);
  ctx.lineTo(x + hw, cy);
  ctx.lineTo(x, cy + hh);
  ctx.lineTo(x - hw, cy);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
}

/** Wooden table with planks, outside the board. Planks follow the board so panning reads as movement. */
function drawTable(sc: Scene): void {
  const { ctx, width: W, height: H, view } = sc;
  ctx.fillStyle = TABLE;
  ctx.fillRect(0, 0, W, H);
  const gap = Math.max(24, view.tile * 0.5);
  const origin = toScreen(view, { w: W, h: H }, 0, 0).y;
  ctx.beginPath();
  for (let y = ((origin % gap) + gap) % gap; y < H; y += gap) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(W, Math.round(y) + 0.5);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = PLANK;
  ctx.stroke();
}

/** Does the rim face below segment a-b (D px deep) cross the viewport? Clips the segment to the view's x range. */
function segOnScreen(a: { x: number; y: number }, b: { x: number; y: number }, D: number, W: number, H: number): boolean {
  const xa = Math.max(0, Math.min(a.x, b.x));
  const xb = Math.min(W, Math.max(a.x, b.x));
  if (xa > xb) return false;
  const yAt = (x: number) => (b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  const y0 = Math.min(yAt(xa), yAt(xb));
  const y1 = Math.max(yAt(xa), yAt(xb));
  return y1 + D >= 0 && y0 <= H;
}

/** The board: dark underlay and a wooden rim with coordinates on its two front faces. True when a rim face is on screen. */
function drawBoard(sc: Scene): boolean {
  const { ctx, width: W, height: H, view, radius: R, dpr } = sc;
  const size = { w: W, h: H };
  const e = R + 0.5;
  const top = toScreen(view, size, -e, -e);
  const right = toScreen(view, size, e, -e);
  const bottom = toScreen(view, size, e, e);
  const left = toScreen(view, size, -e, e);
  const D = Math.max(16, view.tile * 0.62);

  ctx.beginPath();
  ctx.moveTo(left.x + 10, left.y + D + 12);
  ctx.lineTo(bottom.x + 10, bottom.y + D + 12);
  ctx.lineTo(right.x + 10, right.y + D + 12);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(43, 33, 28, 0.28)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = BOARD;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();

  const leftOn = segOnScreen(left, bottom, D, W, H);
  const rightOn = segOnScreen(bottom, right, D, W, H);
  if (!leftOn && !rightOn) return false;

  const face = (a: { x: number; y: number }, b: { x: number; y: number }, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x, b.y + D);
    ctx.lineTo(a.x, a.y + D);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };
  face(left, bottom, '#B07D46');
  face(bottom, right, '#8A5B30');
  ctx.beginPath();
  ctx.moveTo(left.x, left.y + 2);
  ctx.lineTo(bottom.x, bottom.y + 2);
  ctx.lineTo(right.x, right.y + 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#E4B67C';
  ctx.stroke();

  const step = labelStep(view.tile / 2, 34);
  const fs = Math.max(11, Math.min(20, view.tile * 0.2));
  ctx.font = `400 ${fs}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFF4DE';
  const first = Math.ceil(-R / step) * step;
  const onScreen = (p: { x: number; y: number }) => p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + D + 40;
  if (leftOn) {
    for (let x = first; x <= R; x += step) {
      const p = toScreen(view, size, x, e);
      if (!onScreen(p)) continue;
      ctx.setTransform(dpr, dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + D * 0.5));
      ctx.fillText(String(x), 0, 0);
    }
  }
  if (rightOn) {
    for (let y = first; y <= R; y += step) {
      const p = toScreen(view, size, e, y);
      if (!onScreen(p)) continue;
      ctx.setTransform(dpr, -dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + D * 0.5));
      ctx.fillText(String(y), 0, 0);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

/**
 * Coordinate ruler while the board rim is off screen: a V along the bottom of the view. Its left arm
 * follows a row of tiles (labels = x), its right arm a column (labels = y), like the board rim in the design.
 */
function drawRuler(sc: Scene, sxy: (u: number, v: number) => { x: number; y: number }): void {
  const { ctx, width: W, height: H, view, radius: R, dpr } = sc;
  const hw = view.tile / 2;
  const hh = view.tile / 4;
  const band = Math.max(18, Math.min(26, view.tile * 0.24));
  // World point at the bottom centre, snapped to tile edges.
  const b = (H - band - 6 - H / 2) / hh;
  const Xb = Math.floor(view.cx + b / 2) + 0.5;
  const Yb = Math.floor(view.cy + b / 2) + 0.5;
  const P = sxy(Xb - Yb, Xb + Yb);
  const reach = Math.ceil(W / hw) + 4;
  const L = sxy(Xb - reach - Yb, Xb - reach + Yb);
  const Rr = sxy(Xb - (Yb - reach), Xb + Yb - reach);

  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(P.x, P.y);
  ctx.lineTo(Rr.x, Rr.y);
  ctx.lineTo(Rr.x, Rr.y + band);
  ctx.lineTo(P.x, P.y + band);
  ctx.lineTo(L.x, L.y + band);
  ctx.closePath();
  ctx.fillStyle = 'rgba(43, 33, 28, 0.66)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(P.x, P.y);
  ctx.lineTo(Rr.x, Rr.y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(228, 182, 124, 0.9)';
  ctx.stroke();

  const step = labelStep(hw, 30);
  const fs = Math.max(10, Math.min(15, view.tile * 0.15));
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = BONE;
  const visible = (p: { x: number; y: number }) => p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20;
  // Left arm runs along the row edge y = Yb: column x is labelled at the edge midpoint (x, Yb).
  for (let x = Math.floor(Xb / step) * step; x > Xb - reach; x -= step) {
    if (Math.abs(x) > R) continue;
    const p = sxy(x - Yb, x + Yb);
    if (!visible(p)) continue;
    ctx.setTransform(dpr, dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + band / 2));
    ctx.fillText(String(x), 0, 0);
  }
  for (let y = Math.floor(Yb / step) * step; y > Yb - reach; y -= step) {
    if (Math.abs(y) > R) continue;
    const p = sxy(Xb - y, Xb + y);
    if (!visible(p)) continue;
    ctx.setTransform(dpr, -dpr * 0.5, 0, dpr, dpr * p.x, dpr * (p.y + band / 2));
    ctx.fillText(String(y), 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Dotted line from your village to the selected tile (where troops would march). */
function drawRoutePreview(sc: Scene): void {
  const { ctx, own, selected, view, width: W, height: H } = sc;
  if (!own || !selected || (own.x === selected.x && own.y === selected.y)) return;
  const a = toScreen(view, { w: W, h: H }, own.x, own.y);
  const b = toScreen(view, { w: W, h: H }, selected.x, selected.y);
  ctx.save();
  ctx.globalAlpha = 0.7;
  dots(ctx, a.x, a.y, b.x, b.y, view.tile, BONE);
  ctx.restore();
}

function dots(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, tile: number, fill: string): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const k = Math.max(0.55, Math.min(1.3, tile / 96));
  const gap = 14 * k;
  const r = 3 * k;
  const path = new Path2D();
  // Anchor the dots to the far end so they don't crawl while the marker moves.
  for (let d = len - gap * 0.5; d > gap * 0.5; d -= gap) {
    const f = d / len;
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f;
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.lineWidth = 1.4 * k;
  ctx.strokeStyle = 'rgba(43, 33, 28, 0.85)';
  ctx.stroke(path);
}

/** " · 12 troops · loot 340" for a returning army (troop count, total loot); empty parts are left out. */
function returnCargoText(mv: MovementDto): string {
  let troops = 0;
  for (const n of Object.values(mv.units ?? {})) troops += n ?? 0;
  let loot = 0;
  for (const n of Object.values(mv.loot ?? {})) loot += n ?? 0;
  return `${troops > 0 ? ` · ${troops} troops` : ''}${loot > 0 ? ` · loot ${Math.round(loot)}` : ''}`;
}

/** Marching armies: dotted route ahead of each marker, a toy soldier at its current place. */
function drawMovements(sc: Scene): number {
  const { ctx, view, width: W, height: H, now, movements } = sc;
  const size = { w: W, h: H };
  let fastest = -1;
  const tile = view.tile;
  const m = Math.max(16, Math.min(40, tile * 0.36));
  const labels: Array<() => void> = [];
  for (const mv of movements) {
    const span = mv.arriveAt - mv.departAt;
    if (span <= 0 || now >= mv.arriveAt) continue;
    const f = Math.max(0, Math.min(1, (now - mv.departAt) / span));
    const a0 = toScreen(view, size, mv.origin.x, mv.origin.y);
    const b0 = toScreen(view, size, mv.target.x, mv.target.y);
    // Start and end the march at the village's edge so the marker doesn't sit on top of the village art.
    const full = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const off = full > tile * 1.2 ? tile * 0.5 : 0;
    const ux = full > 0 ? (b0.x - a0.x) / full : 0;
    const uy = full > 0 ? (b0.y - a0.y) / full : 0;
    const a = { x: a0.x + ux * off, y: a0.y + uy * off };
    const b = { x: b0.x - ux * off, y: b0.y - uy * off };
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    if (Math.max(a.x, b.x) + m * 2 < 0 || Math.min(a.x, b.x) - m * 2 > W || Math.max(a.y, b.y) + m * 2 < 0 || Math.min(a.y, b.y) - m * 3 > H) continue;
    fastest = Math.max(fastest, (Math.hypot(b.x - a.x, b.y - a.y) / span) * 1000);
    const incoming = mv.direction === 'incoming';
    ctx.save();
    ctx.globalAlpha = 0.35;
    dots(ctx, a.x, a.y, x, y, tile, BONE);
    ctx.restore();
    dots(ctx, x, y, b.x, b.y, tile, incoming ? '#EF9C6E' : '#FFDC7A');
    pawn(ctx, x, y, m, MOVE_COLOR[mv.kind] ?? '#C4623A', incoming);
    if (tile >= 48) {
      const where = `${mv.target.x}|${mv.target.y}`;
      const left = shortClock(mv.arriveAt - now);
      let text: string;
      if (mv.kind === 'shipment') text = `${incoming ? 'Resources to' : 'Shipment to'} ${where} · ${left}`;
      else if (incoming) text = mv.kind === 'support' ? `Support to ${where} · ${left}` : `Attack on ${where} · ${left}`;
      else if (mv.kind === 'attack') text = `${mv.target.ownerName ? 'Attack on' : 'Raid on'} ${where} · ${left}`;
      else if (mv.kind === 'scout') text = `Scouting ${where} · ${left}`;
      else if (mv.kind === 'support') text = `Support to ${where} · ${left}`;
      else text = `Returning${returnCargoText(mv)} · home in ${left}`;
      const fs = Math.max(10, Math.min(14, tile * 0.13));
      labels.push(() => pill(ctx, text, x, y - m * 1.55 - fs, fs, incoming ? '#C4623A' : SUN, incoming ? BONE : INK));
    }
  }
  for (const l of labels) l();
  return fastest;
}

/** A small vinyl-toy soldier on a round base, carrying a pennant in the mission colour. */
function pawn(ctx: CanvasRenderingContext2D, x: number, y: number, m: number, color: string, incoming: boolean): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const lw = Math.max(1.2, m * 0.06);
  ctx.beginPath();
  ctx.ellipse(m * 0.08, m * 0.06, m * 0.52, m * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(43, 33, 28, 0.3)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, m * 0.44, m * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(m * 0.32, -m * 0.05);
  ctx.lineTo(m * 0.32, -m * 1.45);
  ctx.lineWidth = lw * 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(m * 0.34, -m * 1.45);
  ctx.lineTo(m * 0.8, -m * 1.3);
  ctx.lineTo(m * 0.34, -m * 1.12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.stroke();
  roundRect(ctx, -m * 0.24, -m * 0.88, m * 0.48, m * 0.82, m * 0.2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#714B29';
  ctx.fillRect(-m * 0.22, -m * 0.5, m * 0.44, m * 0.1);
  ctx.beginPath();
  ctx.arc(0, -m * 1.02, m * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = '#F3BE95';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -m * 1.06, m * 0.23, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = '#A39E94';
  ctx.fill();
  ctx.stroke();
  if (incoming) {
    ctx.beginPath();
    ctx.arc(-m * 0.44, -m * 1.25, m * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = '#C4623A';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BONE;
    ctx.font = `700 ${Math.round(m * 0.3)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', -m * 0.44, -m * 1.24);
  }
  ctx.restore();
}

// ---- Picking ----------------------------------------------------------------------------------------

/** Village whose sprite is under the point (front-most first), from the last frame's drawn list. */
export function pickVillage(drawn: readonly DrawnVillage[], px: number, py: number): MapVillageDto | null {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i]!;
    const fx = (px - d.x) / d.scale;
    const fy = (py - d.y) / d.scale;
    if (fx < -64 || fx > 64 || fy < -116 || fy > 40) continue;
    if (hitSprite(d.sprite, fx, fy)) return d.village;
  }
  return null;
}

/** Tile whose (raised or sunken) top face is under the point; front-most wins. */
export function pickTile(view: View, size: { w: number; h: number }, terrain: TerrainCache, px: number, py: number): Coords {
  const hw = view.tile / 2;
  const hh = view.tile / 4;
  const s = view.tile / 96;
  const a = (px - size.w / 2) / hw;
  const b = (py - size.h / 2) / hh;
  const gx = Math.round(view.cx + (a + b) / 2);
  const gy = Math.round(view.cy + (b - a) / 2);
  const cands: Coords[] = [];
  for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) cands.push({ x: gx + dx, y: gy + dy });
  cands.sort((p, q) => q.x + q.y - (p.x + p.y));
  for (const c of cands) {
    const p = toScreen(view, size, c.x, c.y);
    const lift = (TILE_LIFT[terrain.get(c.x, c.y)] ?? 0) * s;
    if (Math.abs(px - p.x) / hw + Math.abs(py - (p.y - lift)) / hh <= 1) return c;
  }
  return { x: gx, y: gy };
}
