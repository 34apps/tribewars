// Wrightyard v2: an open yard with a hoist (1), a timber shed with a jib crane (2), a two-storey workshop hall with a
// treadwheel crane (3), and the great gilded workshop hall with a crane tower and a finished Firecart (4).
import { INK, f, iso, pt, poly, open, p, ln, box, courses, planksL, planksR, post, rod, barrel, sack, sprite, flag, tufts, brazier, glint, flame,
  wheelU, wheelV, sawhorse, boards, yard, gableV, faceL, faceR, pyramid, bannerPole,
  WOOD, DWOOD, STONE, IRON, THATCH, GOLD, PLUM, ROOF } from './blib.mjs';

const SHINGLE = ['#C9A877', '#9C7448', '#6B4A2A'];
function fence(pts, h = 5, c = WOOD) {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    s += rod([a[0], a[1], h * 0.45], [b[0], b[1], h * 0.45], 1, c[1], 1.2) + rod([a[0], a[1], h * 0.85], [b[0], b[1], h * 0.85], 1, c[1], 1.2);
  }
  for (const q of pts) s += post(q[0], q[1], 0, h, 1.4, c, 0, 1.1);
  return s;
}
/** Cart along u: far wheel, bed, sides (done 0..1), near wheels, drawbar. */
function cart(u, v, len, wid, done, c = WOOD, hub = IRON[1]) {
  const [u0, u1, v0, v1] = [u - len / 2, u + len / 2, v - wid / 2, v + wid / 2], z = 5;
  let s = done > 0.3 ? wheelU(u + len * 0.25, v0 - 0.4, 4.5, 4.6, c, 4, hub) : '';
  s += box(u0, u1, v0, v1, z, z + 1.6, c, 1.2);
  if (done > 0.4) s += box(u0, u1, v0, v0 + 1, z + 1.6, z + 5, c, 1.1);
  if (done > 0.7) s += box(u0, u1, v1 - 1, v1, z + 1.6, z + 5, c, 1.1) + planksL(u0, u1, v1, z + 1.6, z + 5, 5);
  s += rod([u1, v, z + 0.8], [u1 + 7, v, z - 2], 1.2, c[1]);
  if (done > 0.3) s += wheelU(u - len * 0.25, v1 + 0.4, 4.5, 4.8, c, 4, hub) + wheelU(u + len * 0.25, v1 + 0.4, 4.5, 4.8, c, 4, hub);
  else s += post(u - len * 0.3, v1 - 1, 0, 5, 2, DWOOD) + post(u + len * 0.3, v1 - 1, 0, 5, 2, DWOOD);
  return s;
}
function firepot(u, v, z, lit) {
  const [x, y] = iso(u, v, z);
  return p(`M${f(x - 4.5)} ${f(y - 5)}Q${f(x - 4.5)} ${f(y + 1.5)} ${x} ${f(y + 1.5)}Q${f(x + 4.5)} ${f(y + 1.5)} ${f(x + 4.5)} ${f(y - 5)}Z`, IRON[2], 1.2) +
    `<ellipse cx="${x}" cy="${f(y - 5)}" rx="4.5" ry="2" fill="${IRON[1]}" stroke-width="1.1"/><ellipse cx="${x}" cy="${f(y - 5)}" rx="3" ry="1.2" fill="#B5462A" stroke="none"/>` +
    (lit ? flame(x, y - 5, 9) : '');
}
/** Rope from a pulley at (u, v, z) down to z2 with a hook or a hanging plank. */
function rope(u, v, z, z2, gold = false, load = true) {
  const [x, y] = iso(u, v, z), [x2, y2] = iso(u, v, z2);
  return ln(`M${x} ${y}L${x2} ${y2}`, INK, 0.9) + `<circle cx="${x}" cy="${y}" r="2" fill="${gold ? GOLD[1] : IRON[1]}" stroke-width="1"/>` +
    (load ? box(u - 5, u + 5, v - 1.2, v + 1.2, z2 - 2.2, z2, WOOD, 1.1) : ln(`M${f(x2 - 1.5)} ${y2}q1.5 2.5 3 0`, INK, 1.1));
}
/** The workshop hall: ridge along v, the tall gable with doors facing front-left (+v). */
function hall(u0, u1, v0, v1, base, z1, zr, wall, roof, gable, trim = null) {
  let s = '';
  if (base) s += box(u0, u1, v0, v1, 0, base, STONE, 1.3) + courses(u0, u1, v0, v1, 0, base, Math.round(base / 4));
  s += box(u0, u1, v0, v1, base, z1, wall, 1.4) + planksR(v0, v1, u1, base, z1, 8);
  // timber frame on the right face
  let d = '';
  for (const v of [v0 + (v1 - v0) / 3, v0 + (2 * (v1 - v0)) / 3]) d += open([[u1, v, base], [u1, v, z1]]);
  d += open([[u1, v1, (base + z1) / 2], [u1, v0, (base + z1) / 2]]);
  s += ln(d, DWOOD[2], 1.6);
  if (trim) s += ln(open([[u0, v1, z1 - 1], [u1, v1, z1 - 1], [u1, v0, z1 - 1]]), trim, 1.8);
  s += gableV(u0, u1, v0, v1, z1, zr, roof, gable, 2.5);
  return s;
}
/** Doorway, loft door and hoist beam on the +v gable of a hall. */
function front(u0, u1, v1, base, z1, zr, opts = {}) {
  const m = (u0 + u1) / 2, w = (u1 - u0) * 0.28;
  let s = faceL(m - w, m + w, v1, base, base + (z1 - base) * 0.55, '#3B2A1E', 1.4);
  s += faceL(m - w - 3, m - w, v1, base, base + (z1 - base) * 0.55, DWOOD[1], 1.2) + faceL(m + w, m + w + 3, v1, base, base + (z1 - base) * 0.55, DWOOD[1], 1.2);
  if (opts.band) s += ln(open([[m - w - 3, v1, base + 3], [m - w, v1, base + 3]]) + open([[m + w, v1, base + 3], [m + w + 3, v1, base + 3]]), opts.band, 1.4);
  const lz = z1 - 1;
  s += faceL(m - 2.5, m + 2.5, v1, lz - 6, lz + 1, DWOOD[2], 1.2);
  s += rod([m, v1, lz + 3], [m, v1 + 8, lz + 3], 1.4, WOOD[1]) + rope(m, v1 + 7.5, lz + 3, lz - 7, opts.gold, true);
  if (opts.emblem) {
    const [x, y] = iso(m, v1, z1 + (zr - z1) * 0.42);
    s += `<circle cx="${x}" cy="${y}" r="3.6" fill="${GOLD[1]}" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="1.4" fill="${GOLD[2]}" stroke-width="0.8"/>` + glint(x + 3, y - 3, 2, GOLD[0]);
  }
  return s;
}
/** Tall crane tower: two posts with braces, a jib reaching toward +v, a pulley and rope. */
function craneTower(u, v, h, reach, gold) {
  let s = post(u - 3, v, 0, h, 2.4, WOOD) + post(u + 3, v, 0, h, 2.4, WOOD);
  let d = '';
  for (let z = 8; z < h - 6; z += 12) d += open([[u - 3, v + 1.2, z], [u + 3, v + 1.2, z + 12]]) + open([[u + 3, v + 1.2, z], [u - 3, v + 1.2, z + 12]]);
  s += ln(d, WOOD[2], 1.2);
  s += box(u - 4.5, u + 4.5, v - 2, v + 2, h, h + 2.5, DWOOD, 1.3);
  s += rod([u, v, h + 1], [u, v + reach, h + 4], 2, WOOD[1]) + rod([u, v, h - 8], [u, v + reach * 0.6, h + 2], 1.1, WOOD[2], 1.1);
  s += rope(u, v + reach, h + 4, h - 22, gold, true);
  if (gold) s += ln(open([[u - 4.5, v + 2, h + 1.2], [u + 4.5, v + 2, h + 1.2]]), GOLD[1], 1.4);
  return s;
}
function aframe(u, v, h) {
  const [x, y] = iso(u, v, h), [x2, y2] = iso(u, v, h - 14);
  return rod([u, v - 7, 0], [u, v, h], 1.8, WOOD[2]) + rod([u + 6, v, 0], [u, v, h], 1.6, WOOD[2]) + rod([u, v + 7, 0], [u, v, h], 1.8, WOOD[1]) +
    `<circle cx="${x}" cy="${y}" r="1.8" fill="${IRON[1]}" stroke-width="1"/>` + ln(`M${x} ${y}L${x2} ${y2}`, INK, 0.9) + rod([u - 6, v, h - 14.5], [u + 6, v, h - 14.5], 2.6, WOOD[0]);
}
const logpile = (u, v) => [0, 1, 2].map((i) => rod([u, v + i * 2.6, 1.4], [u + 12, v + i * 2.6, 1.4], 2.4, WOOD[0])).join('') + rod([u + 1, v + 1.3, 3.9], [u + 13, v + 1.3, 3.9], 2.4, WOOD[0]);

export default function wrightyard(st) {
  let s = '';
  if (st === 1) {
    s += yard(-22, 22, -20, 18);
    s += fence([[-22, 18], [-22, -20], [22, -20]], 5);
    s += logpile(-18, -15) + aframe(8, -12, 26);
    s += sawhorse(-10, 8, 10, 5) + rod([-17, 8, 7.4], [-2, 8, 7.4], 2.6, WOOD[0]);
    s += cart(8, 4, 14, 7, 0.2) + wheelV(19, 13, 4.5, 4.5, WOOD) + sack(-18, 14, 0.8);
    s += tufts([[-26, 24], [26, -24], [22, 22]]);
    return sprite(s, [6, 30, 50, 25]);
  }
  if (st === 2) {
    s += yard(-26, 26, -24, 22);
    s += fence([[-26, 22], [-26, 4]], 5) + fence([[6, -24], [26, -24]], 5);
    s += hall(-24, -6, -22, 2, 0, 18, 32, WOOD, THATCH, WOOD);
    s += faceL(-19, -11, 2, 0, 11, '#3B2A1E', 1.3) + boards(-22, -12, -18, -12, 2);
    s += flag(-15, -10, 32, 12, ROOF[1]);
    s += post(14, -18, 0, 36, 2.4, WOOD) + rod([14, -18, 35], [14, -6, 38], 1.8, WOOD[1]) + rod([14, -18, 27], [14, -10, 36], 1.1, WOOD[2], 1.1) + rope(14, -6, 38, 24, false, false);
    s += sawhorse(-6, 14, 10, 5) + rod([-13, 14, 7.4], [2, 14, 7.4], 2.6, WOOD[0]);
    s += cart(10, 4, 16, 8, 0.6) + barrel(22, -16, 0, 3, 6) + logpile(-24, 10);
    return sprite(s);
  }
  if (st === 3) {
    s += yard(-28, 28, -26, 23, '#C8A064');
    s += hall(-26, -2, -24, 2, 4, 34, 56, WOOD, SHINGLE, WOOD, IRON[1]);
    s += front(-26, -2, 2, 4, 34, 56, { band: IRON[1] });
    s += rod([-14, -24, 56], [-14, 2, 56], 1.8, IRON[1]) + flag(-14, -11, 56, 14, ROOF[1]);
    // treadwheel crane
    s += craneTower(16, -20, 50, 14, false);
    s += post(22, -14, 0, 12, 1.8, DWOOD) + wheelU(19, -11, 10, 9, WOOD, 6) + post(16, -8, 0, 12, 1.8, DWOOD);
    s += sawhorse(-8, 16, 10, 5) + rod([-15, 16, 7.4], [0, 16, 7.4], 2.6, WOOD[0]);
    s += cart(12, 8, 18, 9, 1, DWOOD) + firepot(13, 8, 11, false);
    s += barrel(-24, 16, 0, 3, 6) + barrel(-20, 20, 0, 3, 6) + bannerPole(27, -4, ROOF[1], 30);
    return sprite(s);
  }
  // stage 4: the great workshop hall
  s += yard(-29, 29, -28, 24, STONE[0]);
  s += box(-29, 29, -28, -26, 0, 3, STONE, 1.2);
  s += hall(-27, 1, -26, 3, 14, 46, 74, WOOD, ROOF, GOLD, GOLD[1]);
  s += front(-27, 1, 3, 14, 46, 74, { band: GOLD[1], gold: true, emblem: true });
  s += faceL(-24, -20, 3, 4, 10, DWOOD[2], 1) + faceL(-4, 0, 3, 4, 10, DWOOD[2], 1);
  s += rod([-13, -28.5, 74], [-13, 5.5, 74], 2, GOLD[1]);
  s += box(-16, -10, -14, -8, 70, 80, WOOD, 1.3) + pyramid(-13, -11, 4.5, 80, 92, GOLD) + flag(-13, -11, 92, 16, PLUM[1]);
  // crane tower with treadwheel
  s += craneTower(17, -22, 74, 16, true) + flag(17, -22, 76.5, 12, GOLD[1]);
  s += post(24, -16, 0, 13, 2, DWOOD) + wheelU(20, -13, 11, 10, WOOD, 8, GOLD[1]) + post(16, -10, 0, 13, 2, DWOOD);
  // the finished Firecart, lit
  s += cart(12, 10, 18, 9, 1, DWOOD, GOLD[1]) + firepot(13, 10, 11, true);
  s += ln(open([[3, 14.5, 9], [21, 14.5, 9]]), GOLD[1], 1.4);
  s += brazier(-4, 22) + brazier(27, -6);
  s += bannerPole(-28, 20, PLUM[1], 40) + bannerPole(27, -15, PLUM[1], 36) + barrel(-22, 17, 0, 3, 6);
  return sprite(s);
}
