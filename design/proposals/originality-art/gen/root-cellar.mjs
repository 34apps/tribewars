import { INK, f, iso, pt, poly, open, p, ln, box, courses, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint, flame,
  WOOD, DWOOD, STONE, IRON, GOLD, PLUM, TURF, ROOF, EARTH } from './blib.mjs';

/** Grassy mound centred at ground (u, v): screen half-width w, height h. Shaded lit from the top left. */
function mound(u, v, w, h, id) {
  const [x, y] = iso(u, v, 0);
  const d = `M${f(x - w)} ${f(y + h * 0.18)}C${f(x - w)} ${f(y - h * 0.7)} ${f(x - w * 0.45)} ${f(y - h)} ${f(x + w * 0.05)} ${f(y - h)}C${f(x + w * 0.6)} ${f(y - h)} ${f(x + w)} ${f(y - h * 0.6)} ${f(x + w)} ${f(y + h * 0.1)}C${f(x + w * 0.6)} ${f(y + h * 0.55)} ${f(x - w * 0.6)} ${f(y + h * 0.6)} ${f(x - w)} ${f(y + h * 0.18)}Z`;
  return `<defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs><g clip-path="url(#${id})" stroke="none">` +
    `<path d="${d}" fill="${TURF[1]}"/>` +
    `<ellipse cx="${f(x + w * 0.75)}" cy="${f(y + h * 0.1)}" rx="${f(w * 0.75)}" ry="${f(h * 1.1)}" fill="${TURF[2]}"/>` +
    `<ellipse cx="${f(x - w * 0.3)}" cy="${f(y - h * 0.72)}" rx="${f(w * 0.5)}" ry="${f(h * 0.35)}" fill="${TURF[0]}"/>` +
    `</g><path d="${d}" fill="none" stroke-width="1.5"/>`;
}
/** Doorway in the plane v = vd, u from a to b, height h; frame palette, door colour, iron straps. */
function doorway(a, b, vd, h, frame, door, opts = {}) {
  const m = (a + b) / 2, r = (b - a) / 2;
  const arch = (k) => {
    let d = `M${pt(a - k, vd, 0)}L${pt(a - k, vd, h - r)}`;
    for (let i = 0; i <= 8; i++) { const t = Math.PI - (i / 8) * Math.PI; d += `L${pt(m + Math.cos(t) * (r + k), vd, h - r + Math.sin(t) * (r + k) * 1.1)}`; }
    return d + `L${pt(b + k, vd, 0)}Z`;
  };
  let s = p(arch(frame ? 2.2 : 0.8), frame ? frame[1] : DWOOD[2], 1.4);
  if (frame) {
    let d = '';
    for (const z of [h * 0.3, h * 0.65]) d += open([[a - 2.2, vd, z], [a, vd, z]]) + open([[b, vd, z], [b + 2.2, vd, z]]);
    s += ln(d, INK, 0.7, ' opacity="0.5"');
  }
  s += p(arch(0), door, 1.3);
  let pl = '';
  for (let i = 1; i < 3; i++) { const u = a + ((b - a) * i) / 3; pl += open([[u, vd, 0], [u, vd, h - 0.6]]); }
  s += ln(pl, INK, 0.7, ' opacity="0.45"');
  if (opts.iron) s += ln(open([[a, vd, h * 0.25], [b, vd, h * 0.25]]) + open([[a, vd, h * 0.6], [b, vd, h * 0.6]]), opts.iron, 1.5);
  if (opts.ring) { const [x, y] = iso(m + r * 0.45, vd, h * 0.42); s += `<circle cx="${x}" cy="${y}" r="1.3" fill="none" stroke="${opts.ring}" stroke-width="1.2"/>`; }
  return s;
}
/** Sunken steps in front of the doorway (trench toward +v). */
function steps(a, b, vd, len, n, side) {
  let s = p(poly([[a, vd, 0], [b, vd, 0], [b, vd + len, 0], [a, vd + len, 0]]), '#5E3F22', 1.3);
  for (let i = 0; i < n; i++) {
    const v = vd + (len * (i + 0.5)) / n;
    s += p(poly([[a + 0.4, v, 0], [b - 0.4, v, 0], [b - 0.4, v + len / n * 0.55, 0], [a + 0.4, v + len / n * 0.55, 0]]), side ? side[0] : EARTH[0], 0.9);
  }
  if (side) s += box(a - 2, a, vd, vd + len, 0, 2, side, 1.2) + box(b, b + 2, vd, vd + len, 0, 2, side, 1.2);
  return s;
}
const crate = (u, v, z = 0, s = 3) => box(u - s, u + s, v - s, v + s, z, z + s * 1.6, WOOD, 1.2) + ln(open([[u - s, v + s, z], [u + s, v + s, z + s * 1.6]]), INK, 0.7, ' opacity="0.5"');
function lantern(u, v, z) {
  const [x, y] = iso(u, v, z);
  return p(`M${f(x - 2)} ${f(y - 5)}L${f(x + 2)} ${f(y - 5)}L${f(x + 2)} ${y}L${f(x - 2)} ${y}Z`, '#FFDC7A', 1) +
    p(`M${f(x - 2.8)} ${f(y - 5)}L${x} ${f(y - 7.5)}L${f(x + 2.8)} ${f(y - 5)}Z`, IRON[2], 1);
}
function vent(u, v, z, h, c = STONE) { return box(u - 1.6, u + 1.6, v - 1.6, v + 1.6, z, z + h, c, 1.2); }
function veg(u, v) { // a basket of roots
  const [x, y] = iso(u, v, 0);
  return p(`M${f(x - 4)} ${f(y - 4)}L${f(x + 4)} ${f(y - 4)}L${f(x + 3)} ${y}L${f(x - 3)} ${y}Z`, WOOD[1], 1.1) +
    `<circle cx="${f(x - 1.8)}" cy="${f(y - 4.8)}" r="1.7" fill="${ROOF[1]}" stroke-width="0.9"/><circle cx="${f(x + 1.6)}" cy="${f(y - 5)}" r="1.7" fill="#E3BE5C" stroke-width="0.9"/>` +
    ln(`M${f(x - 1.8)} ${f(y - 6.5)}l-1 -2.2M${f(x + 1.6)} ${f(y - 6.7)}l1 -2.2`, TURF[2], 1.2);
}

export default function rootCellar(st) {
  let s = '';
  if (st === 1) {
    s += mound(-6, -8, 36, 30, 'rc1m');
    s += steps(-12, -2, 8, 8, 3);
    s += doorway(-12, -2, 8, 11, null, DWOOD[1]);
    s += tufts([[-16, -16, 28], [2, -20, 25], [-26, 4, 4]], '#3A5E27');
    s += sack(10, 4, 0.9) + sack(14, 0, 0.8) + barrel(14, 10, 0, 3, 6) + veg(4, 16);
    return sprite(s, [6, 30, 50, 25]);
  }
  if (st === 2) {
    s += mound(-6, -8, 42, 36, 'rc2m');
    s += vent(-14, -18, 30, 6);
    s += steps(-13, -1, 9, 9, 3, STONE);
    s += doorway(-12, -2, 9, 13, STONE, DWOOD[1], { iron: IRON[2] });
    s += sack(12, 4, 0.9) + sack(16, 0, 0.8) + sack(9, 0, 0.75) + barrel(16, 12, 0, 3, 6) + barrel(20, 7, 0, 3, 6) + veg(5, 18);
    s += tufts([[-18, -18, 33], [4, -22, 28]], '#3A5E27');
    return sprite(s);
  }
  if (st === 3) {
    s += mound(-6, -8, 46, 42, 'rc3m');
    s += vent(-16, -20, 36, 8) + smoke(...iso(-16, -20, 45), 0.9);
    s += steps(-14, 0, 9, 10, 4, STONE);
    s += doorway(-13, -1, 9, 14, STONE, DWOOD[2], { iron: IRON[1], ring: GOLD[1] });
    s += lantern(-18, 9, 11);
    s += crate(14, 0) + crate(14, 0, 4.8, 2.4) + sack(19, 7, 0.9) + barrel(14, 12, 0, 3, 6) + barrel(19, 15, 0, 3, 6) + veg(5, 19) + veg(9, 21);
    s += tufts([[-22, -16, 38], [6, -24, 32]], '#3A5E27');
    return sprite(s);
  }
  // stage 4: the deep root cellar with a stone front
  s += mound(-6, -8, 50, 48, 'rc4m');
  s += vent(-20, -20, 42, 9) + vent(2, -24, 38, 7) + smoke(...iso(-20, -20, 52), 1);
  s += box(-22, 8, 6, 9, 0, 18, STONE) + courses(-22, 8, 6, 9, 0, 18, 5) + box(-23, 9, 5, 10, 18, 20, STONE, 1.3);
  s += ln(open([[-23, 10, 19], [9, 10, 19]]), GOLD[1], 1.5);
  s += steps(-15, 1, 9, 11, 4, STONE);
  s += doorway(-14, 0, 9, 14, IRON, DWOOD[2], { iron: GOLD[1], ring: GOLD[1] });
  s += glint(...iso(-7, 9, 19.5), 2.4);
  s += brazier(-19, 18) + brazier(4, 21);
  s += crate(16, -2) + crate(16, -2, 4.8, 2.4) + crate(20, 4) + sack(22, 12, 0.9) + barrel(14, 12, 0, 3, 6) + barrel(18, 18, 0, 3, 6) + veg(8, 22);
  s += flag(-24, 4, 20, 14, PLUM[1], 1);
  return sprite(s);
}
