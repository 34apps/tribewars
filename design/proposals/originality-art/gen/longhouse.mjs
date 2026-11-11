// Longhouse v2: grows from a small turf hut (1) to a long clan house (2), a raised clan hall (3) and the great
// gilded hall with stacked roofs and dragon-head gables (4), like Town Hall / Barracks grow.
import { INK, f, iso, poly, open, p, ln, box, courses, planksL, planksR, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint,
  faceL, faceR, dragon, pyramid, bannerPole,
  WOOD, DWOOD, STONE, IRON, THATCH, TURF, GOLD, PLUM, TEAL, ROOF } from './blib.mjs';

const SHINGLE = ['#C9A877', '#9C7448', '#6B4A2A'];
/** Gable roof with the ridge along u: back slope, +u gable, front slope with rows; returns the roof surface too. */
function roofU(u0, u1, v0, v1, z1, zr, c, g, o = 2.5, rows = 2, ridge = null) {
  const vm = (v0 + v1) / 2, ze = z1 - o * 0.6, half = (v1 - v0) / 2 + o;
  let s = p(poly([[u1, v0, z1], [u1, vm, zr], [u1, v1, z1]]), g[2], 1.4);
  s += p(poly([[u0 - o, vm, zr], [u1 + o, vm, zr], [u1 + o, v1 + o, ze], [u0 - o, v1 + o, ze]]), c[1], 1.5);
  let d = '';
  for (let i = 1; i <= rows; i++) { const t = i / (rows + 1); d += open([[u0 - o, vm + half * t, zr - (zr - ze) * t], [u1 + o, vm + half * t, zr - (zr - ze) * t]]); }
  s += ln(d, c[2], 1, ' opacity="0.6"');
  if (ridge) s += rod([u0 - o, vm, zr], [u1 + o, vm, zr], 1.8, ridge);
  const zs = (v) => zr - (Math.abs(v - vm) / half) * (zr - ze);
  const end = (u) => iso(u, vm, zr);
  return { s, zs, vm, end };
}
/** A raised storey standing on a roof (its walls start on the roof surface). */
function tier(R, u0, u1, v0, v1, zt, wall, win = DWOOD[2]) {
  const vm = R.vm;
  let s = p(poly([[u0, v1, R.zs(v1)], [u1, v1, R.zs(v1)], [u1, v1, zt], [u0, v1, zt]]), wall[1], 1.4);
  s += p(poly([[u1, v1, R.zs(v1)], [u1, vm, R.zs(vm)], [u1, v0, R.zs(vm)], [u1, v0, zt], [u1, v1, zt]]), wall[2], 1.4);
  for (let u = u0 + 2.5; u < u1 - 2; u += 5) s += faceL(u, u + 2.4, v1, zt - 8, zt - 3, win, 1);
  return s;
}
function door(u, v0, v1, z0, h, col = DWOOD[2], band = null) {
  const m = (v0 + v1) / 2;
  let s = p(poly([[u, v0, z0], [u, v1, z0], [u, v1, z0 + h], [u, m, z0 + h + 2], [u, v0, z0 + h]]), col, 1.3);
  if (band) s += ln(open([[u, v0, z0 + h * 0.3], [u, v1, z0 + h * 0.3]]) + open([[u, v0, z0 + h * 0.72], [u, v1, z0 + h * 0.72]]), band, 1.5) + ln(open([[u, m, z0], [u, m, z0 + h + 2]]), INK, 0.8);
  return s;
}
function shield(u, v, z, col, rad = 2.8) {
  const [x, y] = iso(u, v, z);
  return `<ellipse cx="${x}" cy="${y}" rx="${f(rad * 0.75)}" ry="${rad}" fill="${col}" stroke-width="1.1"/><circle cx="${x}" cy="${y}" r="0.9" fill="${GOLD[1]}" stroke-width="0.7"/>`;
}
const braces = (u0, u1, v, z0, z1, n, col = DWOOD[2]) => {
  let d = '';
  for (let i = 0; i < n; i++) { const a = u0 + ((u1 - u0) * i) / n, b = u0 + ((u1 - u0) * (i + 1)) / n; d += open([[a, v, z0], [b, v, z1]]) + open([[b, v, z0], [a, v, z1]]); }
  return ln(d, col, 1.2);
};
function logs(u, v, n = 3) {
  let s = '';
  for (let i = 0; i < n; i++) for (let j = 0; j <= (i + 1) % 2; j++) { const [x, y] = iso(u + i * 2.6, v, 1.6 + j * 3); s += `<circle cx="${x}" cy="${y}" r="1.7" fill="${WOOD[0]}" stroke-width="1"/>`; }
  return s;
}
const pad = (u0, u1, v0, v1, col) => p(poly([[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]]), col, 1.2);

export default function longhouse(st) {
  let s = '';
  if (st === 1) {
    // a small turf-roofed hut
    s += pad(-19, 19, -11, 13, '#C8A064');
    s += box(-15, 11, -7, 7, 0, 10, WOOD, 1.4) + planksL(-15, 11, 7, 0, 10, 8);
    s += faceL(-8, -5, 7, 4, 7.5, DWOOD[2], 1);
    const R = roofU(-15, 11, -7, 7, 10, 24, TURF, WOOD, 2.5, 1);
    s += R.s + door(11, -2.5, 2.5, 0, 7.5) + tufts([[-8, 0, 24], [4, 3, 19]], '#3A5E27');
    s += smoke(...iso(-3, 0, 25), 0.9) + logs(-14, 10, 3) + sack(15, 9, 0.85) + post(17, -5, 0, 3, 3, DWOOD);
    s += tufts([[-24, 16], [22, -16], [20, 20]]);
    return sprite(s, [6, 30, 44, 22]);
  }
  if (st === 2) {
    // the long clan house: stone footing, plank walls, turf roof, crossed gable boards, a porch
    s += pad(-26, 26, -12, 14, '#C8A064');
    s += box(-22, 14, -9, 9, 0, 3, STONE, 1.3) + box(-22, 14, -9, 9, 3, 14, WOOD, 1.4) + planksL(-22, 14, 9, 3, 14, 10);
    for (const u of [-16, -6, 4]) s += faceL(u, u + 3, 9, 7, 11, DWOOD[2], 1);
    s += shield(-11, 9, 9, ROOF[1]) + shield(-1, 9, 9, TEAL[1]);
    const R = roofU(-22, 14, -9, 9, 14, 34, TURF, WOOD, 3, 2, TURF[2]);
    s += R.s + tufts([[-14, 0, 34.5], [2, 0, 34.5], [-20, 6, 21]], '#3A5E27');
    for (const [u, k] of [[-25, -1], [17, 1]]) { const [x, y] = iso(u, 0, 34); s += rod([u, 4, 30], [u, -3, 38], 1.8, WOOD[1]) + rod([u, -4, 30], [u, 3, 38], 1.8, WOOD[1]); }
    s += box(14, 22, -5, 5, 0, 1.5, STONE, 1.2) + door(14, -3, 3, 0, 9);
    s += post(21, -4, 1.5, 12, 1.8, WOOD) + post(21, 4, 1.5, 12, 1.8, WOOD);
    s += roofU(13, 21, -5.5, 5.5, 12, 18, THATCH, WOOD, 1, 1).s;
    s += smoke(...iso(-6, 0, 36), 1) + logs(-21, 13, 4) + barrel(22, -11, 0, 3, 6) + sack(24, 9, 0.85);
    return sprite(s);
  }
  if (st === 3) {
    // the raised clan hall: stone plinth, framed walls, shingle roof with a raised middle storey, dragon heads
    s += pad(-28, 28, -14, 15, '#C8A064');
    s += box(-25, 17, -11, 11, 0, 2.5, STONE, 1.3);
    s += box(-24, 16, -10, 10, 2.5, 7, STONE, 1.3) + courses(-24, 16, -10, 10, 2.5, 7, 2);
    s += box(-24, 16, -10, 10, 7, 19, WOOD, 1.4) + braces(-24, 16, 10, 7, 19, 5);
    s += ln(open([[-24, 10, 18], [16, 10, 18], [16, -10, 18]]), IRON[1], 1.6);
    for (const [u, c] of [[-20, ROOF[1]], [-12, TEAL[1]], [-4, PLUM[1]], [4, ROOF[1]], [11, TEAL[1]]]) s += shield(u, 10, 12, c, 3);
    const R = roofU(-24, 16, -10, 10, 19, 40, SHINGLE, WOOD, 3, 2, IRON[1]);
    s += dragon(...R.end(-27), -1, 1.1) + R.s;
    s += tier(R, -12, 4, -6, 6, 52, WOOD);
    const T = roofU(-12, 4, -6, 6, 52, 66, SHINGLE, WOOD, 2, 1, GOLD[1]);
    s += dragon(...T.end(-14), -1, 0.9, GOLD[1]) + T.s + dragon(...T.end(6), 1, 0.9, GOLD[1]);
    s += flag(-4, 0, 66, 14, PLUM[1]);
    s += dragon(...R.end(19), 1, 1.1);
    s += box(16, 24, -5.5, 5.5, 0, 2, STONE, 1.2) + door(16, -3.5, 3.5, 2, 11, DWOOD[2], IRON[1]);
    s += bannerPole(25, -12, PLUM[1], 32) + bannerPole(-26, 14, ROOF[1], 30) + barrel(24, 11, 0, 3, 6) + logs(-22, 13, 3);
    return sprite(s);
  }
  // stage 4: the great gilded hall
  s += pad(-29, 29, -16, 17, STONE[0]);
  s += box(-27, 21, -13, 13, 0, 3, STONE, 1.3);
  s += box(-25, 18, -11, 11, 3, 13, STONE, 1.3) + courses(-25, 18, -11, 11, 3, 13, 3);
  s += box(-25, 18, -11, 11, 13, 25, WOOD, 1.4) + braces(-25, 18, 11, 13, 25, 6);
  s += ln(open([[-25, 11, 24], [18, 11, 24], [18, -11, 24]]), GOLD[1], 2) + ln(open([[-25, 11, 13], [18, 11, 13], [18, -11, 13]]), GOLD[2], 1.4);
  for (const [u, c] of [[-21, ROOF[1]], [-14, TEAL[1]], [-7, PLUM[1]], [0, ROOF[1]], [7, TEAL[1]], [13, PLUM[1]]]) s += shield(u, 11, 18.5, c, 3.2);
  const R = roofU(-25, 18, -11, 11, 25, 48, ROOF, WOOD, 3, 2, GOLD[1]);
  s += dragon(...R.end(-28), -1, 1.3, GOLD[1]) + R.s;
  s += tier(R, -14, 6, -7.5, 7.5, 64, WOOD);
  s += ln(open([[-14, 7.5, 63], [6, 7.5, 63]]), GOLD[1], 1.6);
  const T = roofU(-14, 6, -7.5, 7.5, 64, 82, ROOF, WOOD, 2.5, 1, GOLD[1]);
  s += dragon(...T.end(-16.5), -1, 1.1, GOLD[1]) + T.s;
  s += tier(T, -7, -1, -3.5, 3.5, 92, WOOD);
  s += pyramid(-4, 0, 4.5, 92, 106, GOLD) + flag(-4, 0, 106, 15, PLUM[1]);
  s += dragon(...T.end(8.5), 1, 1.1, GOLD[1]) + dragon(...R.end(21), 1, 1.3, GOLD[1]);
  // gilded porch and steps
  s += box(18, 28, -7, 7, 0, 1.5, STONE, 1.2) + box(18, 25, -6, 6, 1.5, 3, STONE, 1.2);
  s += door(18, -4, 4, 3, 13, DWOOD[2], GOLD[1]);
  s += post(24, -5.5, 3, 18, 2.2, WOOD) + post(24, 5.5, 3, 18, 2.2, WOOD);
  s += roofU(17, 24.5, -7, 7, 18, 27, ROOF, GOLD, 1.5, 1, GOLD[1]).s + glint(...iso(24.5, 0, 22), 2.2);
  s += brazier(28, -10) + brazier(28, 10);
  s += bannerPole(23, -15, PLUM[1], 40) + bannerPole(-28, 15, PLUM[1], 40) + bannerPole(-6, 16, TEAL[1], 34);
  return sprite(s);
}
