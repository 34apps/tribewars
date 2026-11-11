import { gableU, INK, f, iso, pt, poly, open, p, ln, box, courses, planksL, planksR, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint,
  WOOD, DWOOD, STONE, IRON, THATCH, TURF, GOLD, PLUM, TEAL, ROOF } from './blib.mjs';

/** Bowed roof with the ridge along u: higher in the middle, like a clan longhouse. */
function bowRoof(u0, u1, v0, v1, z1, zr, bow, c, g, o = 2.5, n = 8) {
  const vm = (v0 + v1) / 2, um = (u0 + u1) / 2, L = (u1 - u0) / 2 + o;
  const zAt = (u) => zr - bow * ((u - um) / L) ** 2;
  const us = Array.from({ length: n + 1 }, (_, i) => u0 - o + ((u1 - u0 + 2 * o) * i) / n);
  const ridge = us.map((u) => [u, vm, zAt(u)]);
  const eave = us.map((u) => [u, v1 + o, z1 - o * 0.6 - bow * 0.25 * ((u - um) / L) ** 2]).reverse();
  const front = p(poly([...ridge, ...eave]), c[1], 1.5);
  const gable = p(poly([[u1, v0, z1], [u1, vm, zAt(u1)], [u1, v1, z1]]), g[2], 1.5);
  // thatch / turf rows on the slope
  let rows = '';
  for (const t of [0.3, 0.55, 0.8]) {
    rows += open(us.map((u) => {
      const zr0 = zAt(u), ze = z1 - o * 0.6 - bow * 0.25 * ((u - um) / L) ** 2;
      return [u, vm + (v1 + o - vm) * t, zr0 + (ze - zr0) * t];
    }));
  }
  const ridgeLine = open(ridge);
  return { gable, front: front + ln(rows, c[2], 1, ' opacity="0.7"'), ridge: ridgeLine, zAt, vm };
}

/** Crossed barge boards above the gable end at u, ridge height z. gold = gilded tips. */
function horns(u, vm, z, s = 1, col = WOOD[1], tip = null) {
  const a = [u, vm + 6 * s, z - 6 * s], b = [u, vm - 4 * s, z + 5 * s];
  const c2 = [u, vm - 6 * s, z - 6 * s], d = [u, vm + 4 * s, z + 5 * s];
  let s1 = rod(a, b, 2.2, col) + rod(c2, d, 2.2, col);
  if (tip) for (const q of [b, d]) { const [x, y] = iso(...q); s1 += `<circle cx="${x}" cy="${y}" r="${f(2 * s)}" fill="${tip}" stroke-width="1"/>`; }
  return s1;
}

function door(u, v0, v1, z1, col = DWOOD[2], iron = false) {
  let s = p(poly([[u, v0, 0], [u, v1, 0], [u, v1, z1], [u, (v0 + v1) / 2, z1 + 1.5], [u, v0, z1]]), col, 1.3);
  if (iron) s += ln(open([[u, v0, z1 * 0.3], [u, v1, z1 * 0.3]]) + open([[u, v0, z1 * 0.72], [u, v1, z1 * 0.72]]), IRON[1], 1.4) +
    ln(open([[u, (v0 + v1) / 2, 0], [u, (v0 + v1) / 2, z1 + 1.5]]), INK, 0.8);
  return s;
}
function shield(u, v, z, col, rim = WOOD[0], rad = 2.6) {
  const [x, y] = iso(u, v, z);
  return `<ellipse cx="${x}" cy="${y}" rx="${f(rad * 0.75)}" ry="${rad}" fill="${col}" stroke="${INK}" stroke-width="1.1"/>` +
    `<circle cx="${x}" cy="${y}" r="0.9" fill="${rim}" stroke-width="0.7"/>`;
}
function woodpile(u, v, n = 3) {
  let s = '';
  for (let i = 0; i < n; i++) for (let j = 0; j <= i % 2; j++) {
    const [x, y] = iso(u + i * 2.6, v, 1.6 + j * 3);
    s += `<circle cx="${x}" cy="${y}" r="1.7" fill="${WOOD[0]}" stroke-width="1"/>`;
  }
  return s;
}

export default function longhouse(st) {
  let s = '';
  if (st === 1) {
    const [u0, u1, v0, v1] = [-22, 16, -8, 8];
    s += p(poly([[u0 - 3, v0 - 3, 0], [u1 + 7, v0 - 3, 0], [u1 + 7, v1 + 4, 0], [u0 - 3, v1 + 4, 0]]), '#C8A064', 1.2);
    s += box(u0, u1, v0, v1, 0, 12, WOOD) + planksL(u0, u1, v1, 0, 12, 10) + planksR(v0, v1, u1, 0, 12, 4);
    const R = bowRoof(u0, u1, v0, v1, 12, 31, 4, THATCH, WOOD, 2);
    s += R.gable + door(u1, -3, 3, 8.5) + R.front + rod([u0 - 2.5, R.vm, R.zAt(u0 - 2.5)], [u1 + 2.5, R.vm, R.zAt(u1 + 2.5)], 1.6, THATCH[2]);
    s += horns(u1 + 1.2, R.vm, R.zAt(u1 + 2), 0.8);
    s += smoke(...iso(-3, 0, 34), 0.9);
    s += woodpile(u1 + 3, v1 + 2, 3) + sack(-12, v1 + 5, 0.8) + barrel(u1 + 6, -7, 0, 3, 6);
    s += tufts([[-26, 14], [22, -12], [10, 18]]);
    return sprite(s, [6, 30, 50, 25]);
  }
  if (st === 2) {
    const [u0, u1, v0, v1] = [-25, 18, -9, 9];
    s += p(poly([[u0 - 3, v0 - 3, 0], [u1 + 8, v0 - 3, 0], [u1 + 8, v1 + 4, 0], [u0 - 3, v1 + 4, 0]]), '#C8A064', 1.2);
    s += box(u0, u1, v0, v1, 0, 3.5, STONE) + courses(u0, u1, v0, v1, 0, 3.5, 2);
    s += box(u0, u1, v0, v1, 3.5, 13, WOOD, 1.4) + planksL(u0, u1, v1, 3.5, 13, 12) + planksR(v0, v1, u1, 3.5, 13, 4);
    // shuttered windows
    for (const u of [-16, -4, 8]) s += p(poly([[u, v1, 6.5], [u + 3, v1, 6.5], [u + 3, v1, 10.5], [u, v1, 10.5]]), DWOOD[2], 1.1);
    const R = bowRoof(u0, u1, v0, v1, 13, 34, 4.5, TURF, WOOD, 2.5);
    s += R.gable + door(u1, -3, 3, 9.5) + R.front + rod([u0 - 3, R.vm, R.zAt(u0 - 3)], [u1 + 3, R.vm, R.zAt(u1 + 3)], 1.8, TURF[2]);
    s += tufts([[-14, R.vm, R.zAt(-14) + 0.5], [2, R.vm, R.zAt(2) + 0.5], [-26, 4, 12], [10, 7, 18]], '#3A5E27');
    s += horns(u1 + 1.5, R.vm, R.zAt(u1 + 2), 1, WOOD[1]);
    s += smoke(...iso(-5, 0, 37), 1);
    // porch posts at the door
    s += post(u1 + 6, -3.5, 0, 11, 1.8, WOOD) + post(u1 + 6, 3.5, 0, 11, 1.8, WOOD);
    s += p(poly([[u1, -5, 12], [u1 + 7.5, -5, 11], [u1 + 7.5, 5, 11], [u1, 5, 12]]), THATCH[1], 1.2) + p(poly([[u1, 5, 12], [u1 + 7.5, 5, 11], [u1 + 7.5, 5, 10], [u1, 5, 11]]), THATCH[2], 1);
    s += woodpile(-20, v1 + 3, 4) + barrel(u1 + 6, -12, 0, 3, 6) + sack(u1 + 8, 10, 0.8);
    return sprite(s);
  }
  if (st === 3) {
    const [u0, u1, v0, v1] = [-26, 18, -10, 9];
    s += p(poly([[u0 - 3, v0 - 3, 0], [u1 + 9, v0 - 3, 0], [u1 + 9, v1 + 5, 0], [u0 - 3, v1 + 5, 0]]), '#C8A064', 1.2);
    // lean-to annex at the back left
    s += box(-22, -8, -18, v0, 0, 9, DWOOD, 1.3) + p(poly([[-23, -19, 10], [-7, -19, 10], [-7, v0, 15], [-23, v0, 15]]), DWOOD[0], 1.2);
    s += box(u0, u1, v0, v1, 0, 4, STONE) + courses(u0, u1, v0, v1, 0, 4, 2);
    s += box(u0, u1, v0, v1, 4, 14, WOOD, 1.4) + planksL(u0, u1, v1, 4, 14, 12) + planksR(v0, v1, u1, 4, 14, 4);
    // iron straps at the corners and a band under the eaves
    s += ln(open([[u1, v1, 4], [u1, v1, 14]]) + open([[u0, v1, 4], [u0, v1, 14]]) + open([[u0, v1, 12.5], [u1, v1, 12.5], [u1, v0, 12.5]]), IRON[1], 1.6);
    for (const [u, c] of [[-19, ROOF[1]], [-9, TEAL[1]], [1, PLUM[1]], [11, ROOF[1]]]) s += shield(u, v1, 9, c, GOLD[1], 3);
    const R = bowRoof(u0, u1, v0, v1, 14, 37, 5, ['#C9A877', '#B98F5E', '#714B29'], WOOD, 3);
    s += R.gable + door(u1, -3.5, 3.5, 10, DWOOD[2], true) + R.front;
    s += rod([u0 - 3, R.vm, R.zAt(u0 - 3)], [u1 + 3, R.vm, R.zAt(u1 + 3)], 2.2, GOLD[1]);
    s += horns(u1 + 1.5, R.vm, R.zAt(u1 + 2), 1.1, WOOD[1], GOLD[1]) + horns(u0 - 1.5, R.vm, R.zAt(u0 - 2), 1.1, WOOD[1], GOLD[1]);
    s += smoke(...iso(-6, 0, 40), 1);
    s += post(u1 + 7, -4, 0, 12, 2, WOOD) + post(u1 + 7, 4, 0, 12, 2, WOOD);
    s += p(poly([[u1, -6, 13.5], [u1 + 8.5, -6, 12], [u1 + 8.5, 6, 12], [u1, 6, 13.5]]), '#B98F5E', 1.2) + p(poly([[u1, 6, 13.5], [u1 + 8.5, 6, 12], [u1 + 8.5, 6, 10.8], [u1, 6, 12.3]]), DWOOD[2], 1);
    s += flag(u1 + 8, -6, 12, 14, PLUM[1]);
    s += barrel(u1 + 8, -13, 0, 3, 6) + barrel(u1 + 3, -15, 0, 3, 6) + woodpile(-22, v1 + 3, 4);
    return sprite(s);
  }
  // stage 4: the great clan hall
  const [u0, u1, v0, v1] = [-27, 19, -11, 10];
  s += p(poly([[u0 - 3, v0 - 4, 0], [u1 + 10, v0 - 4, 0], [u1 + 10, v1 + 5, 0], [u0 - 3, v1 + 5, 0]]), STONE[0], 1.2);
  s += box(u0 - 1, u1 + 1, v0 - 1, v1 + 1, 0, 2, STONE, 1.3);
  s += box(u0, u1, v0, v1, 2, 7, STONE) + courses(u0, u1, v0, v1, 2, 7, 2);
  s += box(u0, u1, v0, v1, 7, 17, WOOD, 1.4) + planksL(u0, u1, v1, 7, 17, 12) + planksR(v0, v1, u1, 7, 17, 4);
  s += ln(open([[u0, v1, 15.5], [u1, v1, 15.5], [u1, v0, 15.5]]), GOLD[1], 1.8);
  for (const [u, c] of [[-20, ROOF[1]], [-11, TEAL[1]], [-2, PLUM[1]], [7, ROOF[1]], [14, TEAL[1]]]) s += shield(u, v1, 10.5, c, GOLD[1], 3.2);
  const R = bowRoof(u0, u1, v0, v1, 17, 42, 6, TURF, WOOD, 3);
  s += R.gable + R.front;
  s += tufts([[-18, R.vm, R.zAt(-18) + 0.5], [8, R.vm, R.zAt(8) + 0.5], [-24, 6, 17]], '#3A5E27');
  // raised smoke lantern on the ridge with gold cap
  s += box(-9, -1, -3, 3, R.zAt(-5) - 2, R.zAt(-5) + 4, WOOD, 1.3) + p(poly([[-10, -4, R.zAt(-5) + 4], [0, -4, R.zAt(-5) + 4], [0, 4, R.zAt(-5) + 4], [-10, 4, R.zAt(-5) + 4]]), GOLD[1], 1.2);
  s += rod([u0 - 3.5, R.vm, R.zAt(u0 - 3.5)], [-10, R.vm, R.zAt(-10)], 2.2, GOLD[1]) + rod([0, R.vm, R.zAt(0)], [u1 + 3.5, R.vm, R.zAt(u1 + 3.5)], 2.2, GOLD[1]);
  s += smoke(...iso(-5, 0, R.zAt(-5) + 6), 1.1);
  s += horns(u1 + 2, R.vm, R.zAt(u1 + 2.5), 1.3, WOOD[1], GOLD[1]) + horns(u0 - 2, R.vm, R.zAt(u0 - 2.5), 1.3, WOOD[1], GOLD[1]);
  // gilded porch
  s += box(u1, u1 + 9, -6, 6, 0, 2, STONE, 1.3);
  s += door(u1, -4, 4, 12, DWOOD[2], true);
  s += post(u1 + 8, -5, 2, 15, 2.2, WOOD) + post(u1 + 8, 5, 2, 15, 2.2, WOOD);
  s += gableU(u1 - 1, u1 + 8, -6.5, 6.5, 15, 23, TURF, GOLD, 1.5) + glint(...iso(u1 + 8, 0, 18.5), 2.2);
  s += brazier(u1 + 11, -11, 0) + brazier(u1 + 11, 10, 0);
  s += bannerPole(u1 + 13, -15, PLUM[1]) + bannerPole(u0 + 1, v1 + 5, ROOF[1]);
  return sprite(s);
}
function gablePorch(u0, u1, v0, v1, z1, zr) {
  const vm = (v0 + v1) / 2;
  return p(poly([[u1, v0, z1], [u1, vm, zr], [u1, v1, z1]]), GOLD[2], 1.3) +
    p(poly([[u0, vm, zr], [u1 + 1, vm, zr], [u1 + 1, v1 + 1, z1 - 0.6], [u0, v1 + 1, z1 - 0.6]]), TURF[1], 1.3) +
    `<circle cx="${iso(u1, vm, zr - 3)[0]}" cy="${iso(u1, vm, zr - 3)[1]}" r="1.6" fill="${GOLD[0]}" stroke-width="0.9"/>`;
}
function bannerPole(u, v, col) {
  const [x, y] = iso(u, v, 0);
  return ln(`M${x} ${y}L${x} ${f(y - 34)}`, INK, 2.6) + ln(`M${x} ${y}L${x} ${f(y - 34)}`, WOOD[1], 1.2) +
    p(`M${f(x - 0.5)} ${f(y - 32)}L${f(x + 7)} ${f(y - 32)}L${f(x + 7)} ${f(y - 19)}L${f(x + 3.2)} ${f(y - 22)}L${f(x - 0.5)} ${f(y - 19)}Z`, col, 1.1) +
    ln(`M${f(x + 1.5)} ${f(y - 29)}L${f(x + 5.5)} ${f(y - 29)}`, GOLD[1], 1.2) +
    `<circle cx="${x}" cy="${f(y - 34)}" r="1.5" fill="${GOLD[1]}" stroke-width="0.9"/>`;
}
