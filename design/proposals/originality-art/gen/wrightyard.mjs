import { INK, f, iso, pt, poly, open, p, ln, box, courses, planksL, planksR, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint, flame,
  wheelU, wheelV, sawhorse, boards, yard, gableU, gableV,
  WOOD, DWOOD, STONE, IRON, THATCH, TURF, GOLD, PLUM, TEAL, ROOF } from './blib.mjs';

/** Rail fence along a run of ground points (posts + two rails). */
function fence(pts, h = 5, c = WOOD) {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    s += rod([a[0], a[1], h * 0.45], [b[0], b[1], h * 0.45], 1, c[1], 1.2) + rod([a[0], a[1], h * 0.85], [b[0], b[1], h * 0.85], 1, c[1], 1.2);
  }
  for (const q of pts) s += post(q[0], q[1], 0, h, 1.4, c, 0, 1.1);
  return s;
}
/** A cart chassis along u (bed + side boards) at height z, the wheels on the near (+v) side. */
function cartFrame(u, v, z, len, wid, done = 0.5, c = WOOD) {
  const [u0, u1, v0, v1] = [u - len / 2, u + len / 2, v - wid / 2, v + wid / 2];
  let s = '';
  // far wheel
  s += wheelU(u + len * 0.15, v0 - 0.5, z - 0.5, 4, c);
  s += box(u0, u1, v0, v1, z, z + 1.6, c, 1.2);
  if (done > 0.4) s += box(u0, u1, v0, v0 + 1, z + 1.6, z + 4.5, c, 1.1);
  if (done > 0.7) s += box(u0, u1, v1 - 1, v1, z + 1.6, z + 4.5, c, 1.1) + planksL(u0, u1, v1, z + 1.6, z + 4.5, 5);
  else s += rod([u0, v1 - 0.5, z + 1.6], [u0, v1 - 0.5, z + 5], 0.9, c[1], 1.1) + rod([u0 + len * 0.4, v1 - 0.5, z + 1.6], [u0 + len * 0.4, v1 - 0.5, z + 5], 0.9, c[1], 1.1);
  // drawbar
  s += rod([u1, v, z + 0.8], [u1 + 7, v, z - 1.5], 1.2, c[1]);
  return s;
}
/** Simple A-frame hoist: two legs splayed along v, a crossbar and a hanging hook/log. */
function hoist(u, v, h, wide = 7, c = WOOD, metal = IRON) {
  let s = rod([u, v - wide, 0], [u, v, h], 1.6, c[2]) + rod([u, v + wide, 0], [u, v, h], 1.6, c[1]);
  return s;
}
/** Jib crane: mast at (u, v), arm reaching toward +u, rope and load. */
function jibCrane(u, v, h, reach, c = WOOD, gold = false, load = '') {
  let s = post(u, v, 0, h, 2.4, c) + rod([u, v, h - 1], [u + reach, v, h + 2], 1.8, c[1]) + rod([u, v, h - 8], [u + reach * 0.55, v, h + 0.5], 1.1, c[2], 1.2);
  const [x, y] = iso(u + reach, v, h + 2);
  const [x2, y2] = iso(u + reach, v, h - 12);
  s += ln(`M${x} ${y}L${x2} ${y2}`, INK, 0.9);
  s += `<circle cx="${x}" cy="${y}" r="1.8" fill="${gold ? GOLD[1] : IRON[1]}" stroke-width="1"/>`;
  s += load || ln(`M${f(x2 - 1.5)} ${f(y2)}q1.5 2.5 3 0`, INK, 1.1);
  return s;
}
/** Treadwheel at (u, v): a big wheel in the plane u = const with an axle frame. */
function treadwheel(u, v, z, rad, c = WOOD) {
  return post(u, v - rad - 1, 0, z + 1, 1.6, c) + wheelV(u, v, z, rad, c, 6) + post(u, v + rad + 1, 0, z + 1, 1.6, c) + rod([u, v - rad - 1, z], [u, v + rad + 1, z], 1, c[2], 1.1);
}
/** The iron fire pot of the Firecart. */
function firepot(u, v, z, lit = true) {
  const [x, y] = iso(u, v, z);
  let s = p(`M${f(x - 4.5)} ${f(y - 5)}Q${f(x - 4.5)} ${f(y + 1.5)} ${x} ${f(y + 1.5)}Q${f(x + 4.5)} ${f(y + 1.5)} ${f(x + 4.5)} ${f(y - 5)}Z`, IRON[2], 1.2) +
    `<ellipse cx="${x}" cy="${f(y - 5)}" rx="4.5" ry="2" fill="${IRON[1]}" stroke-width="1.1"/>` +
    `<ellipse cx="${x}" cy="${f(y - 5)}" rx="3" ry="1.2" fill="#B5462A" stroke="none"/>`;
  if (lit) s += flame(x, y - 5, 8);
  return s;
}

/** Open work shed along the back-left edge: ridge along v, posts in front, a back wall. */
function shed(z1, zr, roof, gable, wall = WOOD, band = null) {
  const [u0, u1, v0, v1] = [-27, -13, -22, 14];
  let s = box(u0, u0 + 3, v0, v1, 0, z1, wall, 1.3) + planksL(u0, u0 + 3, v1, 0, z1, 2) + planksR(v0, v1, u0 + 3, 0, z1, 9);
  // tools on the back wall
  s += [[-14, 9, 1], [-6, 11, 0], [2, 8, 1]].map(([v, z, k]) => rod([u0 + 3.2, v, z], [u0 + 3.2, v + 1.5, z + 5], 0.8, k ? IRON[1] : WOOD[1], 1)).join('');
  s += boards(u0 + 4, u0 + 9, -18, -6, 2);
  for (const v of [v0 + 1, (v0 + v1) / 2, v1 - 1]) {
    s += post(u1, v, 0, z1, 2, wall);
    if (band) s += ln(open([[u1 + 1, v + 1, z1 * 0.45], [u1 + 1, v + 1, z1 * 0.55]]), band, 1.6);
  }
  s += gableV(u0, u1, v0, v1, z1, zr, roof, gable, 2);
  return s;
}
/** Tall A-frame hoist (legs splayed along v) with a log hanging from it. */
function aframe(u, v, h, c = WOOD) {
  const [x, y] = iso(u, v, h), [x2, y2] = iso(u, v, h - 14);
  return rod([u, v - 7, 0], [u, v, h], 1.8, c[2]) + rod([u + 6, v, 0], [u, v, h], 1.6, c[2]) + rod([u, v + 7, 0], [u, v, h], 1.8, c[1]) +
    `<circle cx="${x}" cy="${y}" r="1.8" fill="${IRON[1]}" stroke-width="1"/>` + ln(`M${x} ${y}L${x2} ${y2}`, INK, 0.9) +
    rod([u - 6, v, h - 14.5], [u + 6, v, h - 14.5], 2.6, c[0]);
}

export default function wrightyard(st) {
  let s = '';
  if (st === 1) {
    s += yard(-26, 26, -24, 22);
    s += fence([[-26, 22], [-26, -24], [26, -24]], 5);
    s += boards(-22, -10, -20, -15, 3);
    s += aframe(8, -14, 30);
    s += sawhorse(-12, 10, 10, 5) + rod([-19, 10, 7.4], [-4, 10, 7.4], 2.6, WOOD[0]);
    s += cartFrame(8, 4, 4, 16, 8, 0.3);
    s += post(4, 8, 0, 4, 1.5, WOOD) + post(12, 8, 0, 4, 1.5, WOOD);
    s += wheelV(21, 14, 4.5, 4.5, WOOD);
    s += sack(-20, 18, 0.8) + tufts([[-28, 26], [28, -27], [24, 24]]);
    return sprite(s, [6, 30, 54, 27]);
  }
  if (st === 2) {
    s += yard(-27, 26, -25, 22);
    s += shed(16, 25, THATCH, WOOD);
    s += jibCrane(10, -18, 28, 11);
    s += sawhorse(-4, 14, 10, 5) + rod([-11, 14, 7.4], [4, 14, 7.4], 2.6, WOOD[0]);
    s += cartFrame(10, 2, 4.5, 18, 9, 0.6) + wheelU(5, 6.8, 4, 4.4, WOOD);
    s += wheelV(22, 15, 4.5, 4.5, WOOD);
    s += barrel(20, -22, 0, 3, 6) + tufts([[28, -27], [26, 25]]);
    return sprite(s);
  }
  if (st === 3) {
    s += yard(-27, 27, -26, 22);
    s += box(-28, 27, -27, -25, 0, 2.5, STONE, 1.2);
    s += shed(18, 28, ROOF, WOOD, WOOD, IRON[1]);
    s += treadwheel(20, -14, 10, 9);
    s += jibCrane(8, -20, 31, 12);
    s += sawhorse(-4, 15, 10, 5) + rod([-11, 15, 7.4], [4, 15, 7.4], 2.6, WOOD[0]);
    s += cartFrame(9, 3, 5, 18, 9, 1, DWOOD) + firepot(10, 3, 9.5, false);
    s += wheelU(4, 7.8, 4.5, 4.8, DWOOD) + wheelU(14, 7.8, 4.5, 4.8, DWOOD);
    s += ln(open([[0, 7.8, 6.5], [18, 7.8, 6.5]]), IRON[1], 1.4);
    s += barrel(22, 18, 0, 3, 6) + barrel(17, 21, 0, 3, 6);
    s += flag(-27, -22, 18, 14, ROOF[1]);
    return sprite(s);
  }
  // stage 4: the great wrightyard, gilded
  s += yard(-28, 28, -27, 23);
  s += box(-29, 28, -28, -26, 0, 3, STONE, 1.2) + courses(-29, 28, -28, -26, 0, 3, 2);
  s += shed(20, 31, ROOF, GOLD, WOOD, GOLD[1]) + rod([-20, -24, 31], [-20, 16, 31], 1.8, GOLD[1]);
  s += treadwheel(21, -14, 11, 10);
  s += jibCrane(7, -21, 35, 14, WOOD, true, box(19, 23, -23, -19, 19, 22, WOOD, 1.1));
  s += sawhorse(-4, 16, 10, 5) + rod([-11, 16, 7.4], [4, 16, 7.4], 2.6, WOOD[0]);
  s += cartFrame(9, 3, 5, 18, 9, 1, DWOOD) + firepot(10, 3, 9.5, true);
  s += wheelU(4, 7.8, 4.5, 4.8, DWOOD, 4, GOLD[1]) + wheelU(14, 7.8, 4.5, 4.8, DWOOD, 4, GOLD[1]);
  s += ln(open([[0, 7.8, 6.5], [18, 7.8, 6.5]]), GOLD[1], 1.4);
  s += brazier(24, 20, 0) + brazier(-24, 20, 0) + barrel(22, -24, 0, 3, 6);
  s += flag(-27, -22, 20, 16, PLUM[1]) + flag(-27, 14, 20, 12, GOLD[1], -1);
  return sprite(s);
}
