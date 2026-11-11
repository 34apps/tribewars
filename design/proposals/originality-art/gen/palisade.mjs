// Palisade corner piece: the same structure as wall-1..4.svg (two runs meeting at a back corner with a tower), so it can
// stand in for the Wall in building panels. The village ring itself is drawn in code (apps/web/src/art/wall.tsx).
import { INK, f, iso, pt, poly, open, p, ln, box, courses, post, rod, sprite, flag, tufts, smoke, brazier, glint, flame,
  gableU, gableV, planksL, planksR,
  WOOD, DWOOD, STONE, IRON, GOLD, PLUM, ROOF, THATCH, TURF } from './blib.mjs';

const C = -22; // the back corner at (C, C)
const LOG = ['#E4B67C', '#B07D46', '#714B29'];
/** One sharpened log stake (only the visible faces: no top, the point covers it). */
export function stake(u, v, z0, h, st) {
  const k = 2.1, z1 = z0 + h, tip = st === 4 ? GOLD : LOG;
  return p(poly([[u - k, v + k, z0], [u + k, v + k, z0], [u + k, v + k, z1], [u - k, v + k, z1]]), LOG[1], 1.2) +
    p(poly([[u + k, v + k, z0], [u + k, v - k, z0], [u + k, v - k, z1], [u + k, v + k, z1]]), LOG[2], 1.2) +
    p(poly([[u - k, v + k, z1], [u + k, v + k, z1], [u, v, z1 + 5]]), tip[1], 1.2) +
    p(poly([[u + k, v + k, z1], [u + k, v - k, z1], [u, v, z1 + 5]]), tip[2], 1.2);
}
/** Watch tower at the corner: four posts, a plank platform with a rail, a roof from stage 2. */
function tower(st) {
  const [u0, u1, v0, v1] = [C - 6, C + 6, C - 6, C + 6];
  const h = 26 + st * 3;
  let s = '';
  if (st >= 2) s += box(u0 - 1, u1 + 1, v0 - 1, v1 + 1, 0, 5, STONE) + courses(u0 - 1, u1 + 1, v0 - 1, v1 + 1, 0, 5, 2);
  for (const [u, v] of [[u0, v1], [u1, v1], [u1, v0]]) s += post(u, v, 0, h, 2.2, WOOD);
  s += rod([u0, v1, 4], [u1, v1, h - 4], 0.9, WOOD[2], 1.1) + rod([u1, v1, 4], [u1, v0, h - 4], 0.9, WOOD[2], 1.1);
  s += box(u0 - 1.5, u1 + 1.5, v0 - 1.5, v1 + 1.5, h, h + 2, DWOOD, 1.3);
  s += box(u0 - 1.5, u1 + 1.5, v1, v1 + 1.5, h + 2, h + 6, WOOD, 1.2) + box(u1, u1 + 1.5, v0 - 1.5, v1, h + 2, h + 6, WOOD, 1.2);
  if (st >= 3) s += ln(open([[u0 - 1.5, v1 + 1.5, h + 4], [u1 + 1.5, v1 + 1.5, h + 4], [u1 + 1.5, v0 - 1.5, h + 4]]), st === 4 ? GOLD[1] : IRON[1], 1.3);
  if (st === 1) {
    s += post(u0, v0, h + 2, h + 10, 1.4, WOOD) + post(u1, v1, h + 6, h + 10, 1.4, WOOD);
    s += flag(C, C, h + 6, 10, ROOF[1]);
  } else {
    for (const [u, v] of [[u0 - 1, v1 + 1], [u1 + 1, v1 + 1], [u1 + 1, v0 - 1]]) s += post(u, v, h + 6, h + 11, 1.4, WOOD);
    const roof = st === 2 ? THATCH : st === 3 ? ['#C9A877', '#B98F5E', '#714B29'] : ROOF;
    s += pyramid(C, C, 9, h + 11, h + 22 + st, roof);
    s += flag(C, C, h + 22 + st, 10, st === 4 ? PLUM[1] : ROOF[1]);
  }
  return s;
}
function pyramid(u, v, r, z0, z1, c) {
  return p(poly([[u - r, v + r, z0], [u + r, v + r, z0], [u, v, z1]]), c[1], 1.4) + p(poly([[u + r, v + r, z0], [u + r, v - r, z0], [u, v, z1]]), c[2], 1.4);
}
/** The gate in the right run (v = C), between u = a and b. */
export function gate(a, b, st, V = C) {
  const h = 18 + st;
  let s = post(a - 2, V, 0, h + 4, 3.4, WOOD) ;
  const m = (a + b) / 2;
  for (const [x0, x1] of [[a, m], [m, b]]) {
    s += p(poly([[x0, V + 1, 0], [x1, V + 1, 0], [x1, V + 1, h - 3], [x0, V + 1, h - 3]]), st >= 3 ? DWOOD[1] : WOOD[1], 1.3);
    let pl = '';
    for (let i = 1; i < 3; i++) { const u = x0 + ((x1 - x0) * i) / 3; pl += open([[u, V + 1, 0], [u, V + 1, h - 3]]); }
    s += ln(pl, INK, 0.7, ' opacity="0.45"');
    if (st >= 3) {
      s += ln(open([[x0, V + 1, 3.5], [x1, V + 1, 3.5]]) + open([[x0, V + 1, h - 7], [x1, V + 1, h - 7]]), st === 4 ? GOLD[1] : IRON[1], 1.8);
      for (const z of [3.5, h - 7]) for (const t of [0.25, 0.75]) { const [x, y] = iso(x0 + (x1 - x0) * t, V + 1, z); s += `<circle cx="${x}" cy="${y}" r="0.7" fill="${INK}" stroke="none"/>`; }
    } else s += rod([x0 + 0.5, V + 1.2, 3], [x1 - 0.5, V + 1.2, h - 6], 0.9, WOOD[2], 1);
  }
  s += post(b + 2, V, 0, h + 4, 3.4, WOOD);
  // lintel
  s += box(a - 4, b + 4, V - 1.5, V + 1.5, h + 4, h + 6.5, st >= 2 ? DWOOD : WOOD, 1.3);
  if (st === 4) {
    const [x, y] = iso(m, V + 1.5, h + 9);
    s += `<circle cx="${x}" cy="${y}" r="3.4" fill="${GOLD[1]}" stroke-width="1.2"/>` + glint(x, y, 2.2, GOLD[0]);
    s += ln(open([[a - 4, V + 1.5, h + 5.2], [b + 4, V + 1.5, h + 5.2]]), GOLD[1], 1.2);
  }
  if (st >= 3) {
    for (const u of [a - 4.5, b + 4.5]) { const [x, y] = iso(u, V + 2.5, h - 4); s += ln(`M${x} ${f(y + 4)}L${x} ${y}`, INK, 1.4) + flame(x, y, 5); }
  }
  return s;
}

export default function palisade(st) {
  let s = '';
  const H = 15 + st; // stake height
  const z0 = st >= 2 ? 4 : 0;
  // stone footing under both runs (stage 2+)
  const items = [];
  for (let v = C + 8; v <= 26; v += 4.2) items.push([C + v, () => stake(C, v, z0, H - (v > 20 ? 1 : 0), st)]);
  for (let u = C + 8; u <= 26; u += 4.2) {
    if (u > 2 && u < 17) continue; // the gate gap
    items.push([C + u, () => stake(u, C, z0, H, st)]);
  }
  if (st >= 2) {
    s += box(C - 2.5, C + 2.5, C + 6, 28, 0, 4, STONE, 1.3) + courses(C - 2.5, C + 2.5, C + 6, 28, 0, 4, 2);
    s += box(C + 6, 28, C - 2.5, C + 2.5, 0, 4, STONE, 1.3) + courses(C + 6, 28, C - 2.5, C + 2.5, 0, 4, 2);
  }
  s += tower(st);
  items.push([C + 9.5, () => gate(4, 15, st)]);
  items.sort((a, b) => a[0] - b[0]);
  // binding rails behind the stakes
  s += rod([C, C + 6, z0 + H * 0.6], [C, 28, z0 + H * 0.6], 1.2, LOG[2], 1.2) + rod([C + 6, C, z0 + H * 0.6], [28, C, z0 + H * 0.6], 1.2, LOG[2], 1.2);
  for (const [, fn] of items) s += fn();
  if (st >= 3) {
    const col = st === 4 ? GOLD[2] : IRON[2];
    let d = '';
    for (const t of [0.3, 0.78]) d += open([[C + 2.1, C + 6, z0 + H * t], [C + 2.1, 28, z0 + H * t]]) + open([[C + 6, C + 2.1, z0 + H * t], [2, C + 2.1, z0 + H * t]]) + open([[17, C + 2.1, z0 + H * t], [28, C + 2.1, z0 + H * t]]);
    s += ln(d, col, 1.3);
  }
  if (st === 4) s += banner(C, 14, z0 + H - 2, PLUM[1]) + banner(22, C, z0 + H - 2, ROOF[1]) + brazier(0, -12) + brazier(18, -12);
  s += tufts([[C + 4, 26], [26, C + 4], [0, 10], [14, 18]]);
  return sprite(s, [6, 30, 49.4, 24.7]);
}
export function banner(u, v, z, col) {
  const [x, y] = iso(u, v, z);
  return p(`M${f(x - 3.5)} ${y}L${f(x + 3.5)} ${y}L${f(x + 3.5)} ${f(y + 11)}L${x} ${f(y + 8.5)}L${f(x - 3.5)} ${f(y + 11)}Z`, col, 1.1) +
    ln(`M${f(x - 4.5)} ${y}L${f(x + 4.5)} ${y}`, GOLD[1], 1.8) + ln(`M${f(x - 1.5)} ${f(y + 4)}L${f(x + 1.5)} ${f(y + 4)}`, GOLD[0], 1.2);
}
