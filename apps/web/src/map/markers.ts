// Pure placement rules for map markers (no drawing): where the protection shield sits and which labels survive collisions.

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.y0 < b.y1 + gap && a.y1 > b.y0 - gap;
}

/** Protection shield: low on the left tip of the village base (tile-centre SVG px), far from the pole and the cloth, which sit above the roof. */
export const SHIELD_SPOT = { x: -42, y: 3 } as const;
/** Half-size of the shield drawing (SVG px, before its own scale). */
export const SHIELD_HALF = { w: 11, h: 12 } as const;

/** Screen box of the shield for a village drawn at (x, y) with scale s. */
export function shieldBox(x: number, y: number, s: number): Rect {
  const cx = x + SHIELD_SPOT.x * s;
  const cy = y + SHIELD_SPOT.y * s;
  return { x0: cx - SHIELD_HALF.w * s, y0: cy - SHIELD_HALF.h * s, x1: cx + SHIELD_HALF.w * s, y1: cy + SHIELD_HALF.h * s };
}

export interface LabelRequest {
  /** Centre and size of the label in CSS px. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Lower number wins: own villages 0, sites 1, other villages 2. */
  priority: number;
  /** Vertical nudges (px, tried in order after 0) when the label collides; empty = skip instead. */
  nudges?: readonly number[];
  /** Own-village labels stay put over neighbours' banners (the banner is drawn under them). */
  overBanners?: boolean;
}

export const LABEL_PRIORITY = { own: 0, site: 1, other: 2 } as const;

/**
 * Decide which labels are drawn and where. Labels are handled in priority order; one that overlaps an obstacle (banner
 * cloth) or an already placed label is nudged (own villages, sites) or dropped. Returns the final centre per request,
 * `null` when dropped, in the order of the input.
 */
export function placeLabels(reqs: readonly LabelRequest[], obstacles: readonly Rect[] = [], gap = 1): Array<{ cx: number; cy: number } | null> {
  const order = reqs.map((_, i) => i).sort((a, b) => reqs[a]!.priority - reqs[b]!.priority || a - b);
  const out: Array<{ cx: number; cy: number } | null> = reqs.map(() => null);
  const placed: Rect[] = [];
  for (const i of order) {
    const r = reqs[i]!;
    for (const dy of [0, ...(r.nudges ?? [])]) {
      const box: Rect = { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, y0: r.cy + dy - r.h / 2, y1: r.cy + dy + r.h / 2 };
      if (placed.some((p) => rectsOverlap(box, p, gap)) || (!r.overBanners && obstacles.some((o) => rectsOverlap(box, o)))) continue;
      placed.push(box);
      out[i] = { cx: r.cx, cy: r.cy + dy };
      break;
    }
  }
  return out;
}
