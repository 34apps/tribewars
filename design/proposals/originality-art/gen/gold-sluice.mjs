import { INK, f, iso, pt, poly, open, p, ln, box, courses, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint, flame,
  wheelV, wheelU, gableU, gableV, planksL, planksR,
  WOOD, DWOOD, STONE, IRON, GOLD, PLUM, TURF, ROOF, TEAL, EARTH, THATCH } from './blib.mjs';

/** A little stream running along v across the tile, centre line at u = uc(v). */
function stream(w = 6) {
  const vs = [-30, -18, -6, 6, 18, 30];
  const uc = (v) => 4 + Math.sin(v / 9) * 3;
  const a = vs.map((v) => [uc(v) - w, v, 0]), b = vs.map((v) => [uc(v) + w, v, 0]).reverse();
  let s = p(poly([...a, ...b]), TEAL[1], 1.3);
  s += p(poly([...vs.map((v) => [uc(v) - w + 1.2, v, 0]), ...vs.map((v) => [uc(v) - w + 3, v, 0]).reverse()]), TEAL[0], 0, ' stroke="none" opacity="0.8"');
  let rip = '';
  for (const v of [-22, -4, 14]) rip += `M${pt(uc(v) - 1, v, 0)}l3 1.5`;
  s += ln(rip, '#FFF8E8', 1.1);
  // pebbles on the banks
  for (const [u, v] of [[uc(-12) + w + 1, -12], [uc(10) - w - 1.5, 10], [uc(24) + w + 1.2, 24]]) {
    const [x, y] = iso(u, v, 0); s += `<ellipse cx="${x}" cy="${y}" rx="2" ry="1.2" fill="${STONE[1]}" stroke-width="1"/>`;
  }
  return s;
}
/** Open sluice trough along u from u0 to u1 (sloping down to +u), between v0 and v1. */
function trough(u0, u1, v0, v1, za, zb, h, c = WOOD, riffles = 4, band = null) {
  const z = (u) => za + ((zb - za) * (u - u0)) / (u1 - u0);
  let s = p(poly([[u0, v0, z(u0)], [u1, v0, z(u1)], [u1, v0, z(u1) + h], [u0, v0, z(u0) + h]]), c[0], 1.2); // inner back wall
  s += p(poly([[u0, v0, z(u0) + 1], [u1, v0, z(u1) + 1], [u1, v1, z(u1) + 1], [u0, v1, z(u0) + 1]]), TEAL[1], 1);
  let rf = '';
  for (let i = 1; i <= riffles; i++) { const u = u0 + ((u1 - u0) * i) / (riffles + 1); rf += open([[u, v0, z(u) + 1], [u, v1, z(u) + 1]]); }
  s += ln(rf, TEAL[2], 1.1) + ln(`M${pt(u0 + 2, (v0 + v1) / 2, z(u0 + 2) + 1)}L${pt(u1 - 2, (v0 + v1) / 2, z(u1 - 2) + 1)}`, '#FFF8E8', 0.9, ' opacity="0.8"');
  s += p(poly([[u0, v1, z(u0) - 0.5], [u1, v1, z(u1) - 0.5], [u1, v1, z(u1) + h], [u0, v1, z(u0) + h]]), c[1], 1.2); // near wall
  s += p(poly([[u1, v1, z(u1) - 0.5], [u1, v0, z(u1) - 0.5], [u1, v0, z(u1) + h], [u1, v1, z(u1) + h]]), c[2], 1.2); // end
  if (band) {
    let d = '';
    for (const t of [0.2, 0.55, 0.9]) { const u = u0 + (u1 - u0) * t; d += open([[u, v1, z(u) - 0.5], [u, v1, z(u) + h]]); }
    s += ln(d, band, 1.5);
  }
  // water spilling out of the end into the stream
  const [x, y] = iso(u1, (v0 + v1) / 2, z(u1) + 1);
  s += p(`M${f(x - 1.6)} ${y}Q${f(x + 2)} ${f(y + 2)} ${f(x + 1.5)} ${f(y + z(u1) + 1)}L${f(x + 4.5)} ${f(y + z(u1) + 1)}Q${f(x + 4.5)} ${f(y + 1)} ${f(x + 1.8)} ${f(y - 1.4)}Z`, TEAL[0], 1);
  return s;
}
/** Shallow round panning tray with gold flecks at (u, v). */
function tray(u, v, z = 0, s = 1) {
  const [x, y] = iso(u, v, z);
  return `<ellipse cx="${x}" cy="${f(y + 0.8)}" rx="${f(5.5 * s)}" ry="${f(2.8 * s)}" fill="${DWOOD[2]}" stroke-width="1.2"/>` +
    `<ellipse cx="${x}" cy="${y}" rx="${f(5.5 * s)}" ry="${f(2.8 * s)}" fill="${WOOD[1]}" stroke-width="1.2"/>` +
    `<ellipse cx="${x}" cy="${f(y + 0.3)}" rx="${f(3.6 * s)}" ry="${f(1.7 * s)}" fill="${TEAL[0]}" stroke-width="0.8"/>` +
    `<circle cx="${f(x - 0.8)}" cy="${f(y + 0.5)}" r="0.9" fill="${GOLD[1]}" stroke="none"/><circle cx="${f(x + 1.2)}" cy="${f(y)}" r="0.7" fill="${GOLD[1]}" stroke="none"/>`;
}
function nugget(u, v, z = 0, s = 1) {
  const [x, y] = iso(u, v, z);
  return p(`M${f(x - 2.5 * s)} ${y}L${f(x - 1.8 * s)} ${f(y - 2.2 * s)}L${f(x + 0.6 * s)} ${f(y - 2.8 * s)}L${f(x + 2.6 * s)} ${f(y - 1.2 * s)}L${f(x + 2 * s)} ${f(y + 0.6 * s)}Z`, GOLD[1], 1) +
    p(`M${f(x - 1.8 * s)} ${f(y - 2.2 * s)}L${f(x + 0.6 * s)} ${f(y - 2.8 * s)}L${f(x + 0.4 * s)} ${f(y - 1.2 * s)}Z`, GOLD[0], 0, ' stroke="none"');
}
const ingot = (u, v, z) => box(u - 2.5, u + 2.5, v - 1.4, v + 1.4, z, z + 1.8, GOLD, 1);
function bucket(u, v) {
  const [x, y] = iso(u, v, 0);
  return p(`M${f(x - 2.6)} ${f(y - 5)}L${f(x + 2.6)} ${f(y - 5)}L${f(x + 2)} ${y}L${f(x - 2)} ${y}Z`, WOOD[1], 1.1) +
    `<ellipse cx="${x}" cy="${f(y - 5)}" rx="2.6" ry="1.2" fill="${TEAL[0]}" stroke-width="1"/>` + ln(`M${f(x - 2.6)} ${f(y - 5)}Q${x} ${f(y - 10)} ${f(x + 2.6)} ${f(y - 5)}`, INK, 0.8);
}
/** Trestle legs under the trough at u. */
const legs = (u, v0, v1, z, c = WOOD, foot = null) =>
  (foot ? box(u - 1.5, u + 1.5, v0 - 1, v1 + 1, 0, 2.5, foot, 1.1) : '') +
  post(u, v0, 0, z, 1.4, c, 0, 1.1) + post(u, v1, 0, z, 1.4, c, 0, 1.1) + rod([u, v0, z * 0.5], [u, v1, z * 0.5], 0.7, c[2], 1);

function shovel(u, v) {
  const [x, y] = iso(u, v, 0);
  return ln(`M${x} ${f(y - 2)}L${f(x + 3)} ${f(y - 15)}`, INK, 2.6) + ln(`M${x} ${f(y - 2)}L${f(x + 3)} ${f(y - 15)}`, WOOD[1], 1.2) +
    p(`M${f(x - 2.2)} ${f(y - 4)}L${f(x + 1.8)} ${f(y - 3)}L${f(x + 1)} ${f(y + 1)}L${f(x - 1)} ${f(y + 1.6)}Z`, IRON[1], 1);
}
function hut(u0, v0, z0, roof, gable, foot = null) {
  const [u1, v1] = [u0 + 11, v0 + 11];
  let s = foot ? box(u0 - 1, u1 + 1, v0 - 1, v1 + 1, 0, z0, foot, 1.3) : '';
  s += box(u0, u1, v0, v1, z0, z0 + 9, WOOD) + planksR(v0, v1, u1, z0, z0 + 9, 4);
  s += p(poly([[u1, v0 + 3, z0], [u1, v0 + 8, z0], [u1, v0 + 8, z0 + 6.5], [u1, v0 + 3, z0 + 6.5]]), DWOOD[2], 1.2);
  s += gableV(u0, u1, v0, v1, z0 + 9, z0 + 17, roof, gable, 1.5);
  return s;
}

export default function goldSluice(st) {
  let s = stream(st >= 3 ? 7 : 6);
  if (st === 1) {
    s += legs(-20, -9, 0, 14) + legs(-6, -9, 0, 9);
    s += trough(-26, 2, -9, 0, 17, 6, 4, WOOD, 4);
    s += tray(18, 6, 0, 1.1) + tray(-4, 16, 0, 1) + bucket(-14, 10) + shovel(20, -14) + nugget(22, 14, 0, 1) + glint(...iso(18, 6, 7), 3.4);
    s += tufts([[-24, 22], [24, -22], [-24, -22]]);
    return sprite(s, [6, 30, 52, 26]);
  }
  if (st === 2) {
    s += legs(-22, -10, -1, 18, WOOD, STONE) + legs(-10, -10, -1, 13.5, WOOD, STONE) + legs(-1, -10, -1, 10, WOOD, STONE);
    s += trough(-28, 2, -10, -1, 21, 8, 4.4, WOOD, 6);
    s += barrel(-27, -6, 21, 4.4, 5, WOOD);
    s += tray(18, 6, 0, 1.1) + tray(22, 14, 0, 1) + tray(-6, 16, 0, 1) + bucket(-16, 12) + sack(-20, 20, 0.9) + shovel(22, -14);
    s += nugget(20, 22, 0, 1.1) + nugget(-2, 22, 0, 0.9) + glint(...iso(18, 6, 7), 3.4) + glint(...iso(-26, 20, 12), 2.4);
    return sprite(s);
  }
  if (st === 3) {
    s += post(5, -27, 0, 13, 2, DWOOD) + wheelV(5, -20, 12, 10.5, WOOD, 6, IRON[1]) + post(5, -13, 0, 13, 2, DWOOD);
    s += legs(-22, -10, -1, 19, DWOOD, STONE) + legs(-10, -10, -1, 14.5, DWOOD, STONE) + legs(-1, -10, -1, 11, DWOOD, STONE);
    s += trough(-28, 2, -10, -1, 22, 9, 4.6, WOOD, 6, IRON[1]);
    s += hut(-27, 9, 0, THATCH, WOOD);
    s += tray(18, 6, 0, 1.1) + tray(-4, 18, 0, 1) + bucket(22, -2) + sack(16, 18, 0.9) + sack(21, 21, 0.85);
    s += ingot(24, 12, 0) + ingot(24, 12, 1.8) + nugget(18, 25) + glint(...iso(18, 6, 7), 3.4) + glint(...iso(24, 12, 7), 2.8);
    s += flag(-16, 9, 9, 14, GOLD[1]);
    return sprite(s);
  }
  // stage 4: gold-ringed wheel, stone-footed long sluice, a strongbox and ingots
  s += post(5, -28, 0, 15, 2.4, STONE) + wheelV(5, -20, 14, 12.5, WOOD, 8, GOLD[1], ) + post(5, -12, 0, 15, 2.4, STONE);
  s += legs(-23, -10, -1, 21, DWOOD, STONE) + legs(-11, -10, -1, 16, DWOOD, STONE) + legs(-1, -10, -1, 12, DWOOD, STONE);
  s += trough(-29, 2, -10, -1, 24, 10, 4.6, WOOD, 7, GOLD[1]);
  s += hut(-27, 9, 3, ROOF, GOLD, STONE) + glint(...iso(-21, 20, 23), 2.4);
  s += box(15, 23, 12, 18, 0, 5, DWOOD, 1.3) + ln(open([[15, 18, 2.5], [23, 18, 2.5], [23, 12, 2.5]]), GOLD[1], 1.4) + p(poly([[15, 12, 5], [23, 12, 5], [23, 18, 5], [15, 18, 5]]), GOLD[0], 1.2);
  s += nugget(18, 14, 5, 1.1) + nugget(21, 16, 5, 1);
  s += ingot(24, 22, 0) + ingot(24, 22, 1.8) + ingot(20, 24, 0) + ingot(22, 23, 3.6);
  s += tray(18, 4, 0, 1.1) + tray(-4, 19, 0, 1) + bucket(24, -4) + brazier(-6, 26);
  s += glint(...iso(22, 23, 9), 3.8) + glint(...iso(18, 4, 7), 3.2) + glint(...iso(19, 15, 11), 2.8) + glint(...iso(5, -20, 28), 2.6);
  s += flag(-16, 9, 12, 14, PLUM[1]) + flag(-28, -10, 28, 10, GOLD[1]);
  return sprite(s);
}
