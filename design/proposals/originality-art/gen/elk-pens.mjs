import { INK, f, iso, pt, poly, open, p, ln, box, courses, post, rod, barrel, sack, sprite, flag, tufts, smoke, brazier, glint, flame,
  gableU, gableV, planksL, planksR,
  WOOD, DWOOD, STONE, IRON, GOLD, PLUM, ROOF, THATCH, TURF, TEAL, SACK } from './blib.mjs';

const ELK = { body: '#8B5835', dark: '#5B371F', light: '#B07D46', rump: '#E3CFA6', leg: '#6B4A36', hoof: '#2A1E16', ant: '#F1E1C2', antD: '#C6AF88' };
/**
 * A small toy elk in building scale, facing right in local units (feet on y 0), placed at ground (u, v).
 * k = scale (negative flips to face left). cloth = saddle-cloth colour or null.
 */
export function elk(u, v, k = 1, cloth = null, gold = false) {
  const [x, y] = iso(u, v, 0);
  const E = ELK;
  let s = `<ellipse cx="0" cy="0.5" rx="17" ry="2.6" fill="${INK}" stroke="none" opacity="0.18"/>`;
  // far legs
  s += p('M-11 -14L-8 -14L-8.5 -1L-11 -1Z', E.dark, 1.1) + p('M5 -14L8 -14L7.5 -1L5 -1Z', E.dark, 1.1);
  // body with a shoulder hump, pale rump
  s += p('M-15 -21Q-16 -27 -9 -27L1 -27Q5 -31 10 -29Q14 -26 13 -19Q12 -13 7 -13L-10 -13Q-15 -14 -15 -21Z', E.body, 1.3);
  s += p('M-15 -21Q-16 -27 -10 -27L-9 -13L-10 -13Q-15 -14 -15 -21Z', E.rump, 0, ' stroke="none"');
  s += p('M2 -27Q5 -31 10 -29Q14 -26 13 -19L9 -18Q10 -24 2 -27Z', E.dark, 0, ' stroke="none" opacity="0.55"');
  s += p('M-15 -21Q-16 -27 -9 -27L1 -27Q5 -31 10 -29Q14 -26 13 -19Q12 -13 7 -13L-10 -13Q-15 -14 -15 -21Z', 'none', 1.3);
  s += p('M-16 -25L-18.5 -22L-15.5 -21Z', E.dark, 1);
  if (cloth) s += p('M-6 -27.5L5 -28.5L6 -17L-5 -16Z', cloth, 1.2) + ln('M-5.5 -17L5.5 -18', gold ? GOLD[1] : '#F2B33D', 1.4);
  // near legs + hooves
  s += p('M-13 -15L-9.5 -15L-9.5 -1.5L-12.5 -1.5Z', E.leg, 1.1) + p('M3 -15L6.5 -15L6 -1.5L3 -1.5Z', E.leg, 1.1);
  s += p('M-13 -1.8L-9.2 -1.8L-9 0.4L-13.2 0.4Z', E.hoof, 0.9) + p('M2.8 -1.8L6.4 -1.8L6.6 0.4L2.6 0.4Z', E.hoof, 0.9);
  // neck and long drooping head
  s += p('M6 -26Q9 -33 14 -35L18 -32Q15 -26 13 -19Z', E.dark, 1.2);
  s += p('M12 -36Q16 -39 20 -36L27 -30Q29.5 -27 26.5 -25.5L23 -25.5Q19 -27 15 -30Z', E.body, 1.2);
  s += p('M24.5 -29Q28 -29 28.4 -27Q28 -25.4 26 -25.4Z', E.dark, 0.9);
  s += p('M18 -28Q18.5 -23 16.6 -22Q15.5 -24.5 16 -28.5Z', E.dark, 1);
  s += `<circle cx="18.6" cy="-33" r="0.9" fill="${INK}" stroke="none"/>`;
  s += p('M13 -36L10.5 -38.5L14.5 -37.5Z', E.body, 0.9);
  // palmate antlers: a far one (darker) and a near one
  s += p('M16 -37Q20 -41 25 -42L24.5 -40L27 -39.5L24.5 -37.8Q20.5 -37 17.2 -35.8Z', E.antD, 1);
  s += p('M14.5 -37Q8.5 -38.5 6.5 -44L8.6 -43.5L8.8 -46.5L10.8 -43.8L12.6 -46.6L13.6 -43Q16 -40.5 15.6 -37.4Z', gold ? GOLD[0] : E.ant, 1);
  return `<g transform="translate(${x} ${y}) scale(${k} ${Math.abs(k)})">${s}</g>`;
}
function rails(pts, h = 6, c = WOOD) {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    s += rod([a[0], a[1], h * 0.45], [b[0], b[1], h * 0.45], 1, c[1], 1.2) + rod([a[0], a[1], h * 0.9], [b[0], b[1], h * 0.9], 1, c[1], 1.2);
  }
  for (const q of pts) s += post(q[0], q[1], 0, h + 0.8, 1.5, c, 0, 1.1);
  return s;
}
function hay(u, v, k = 1) {
  const [x, y] = iso(u, v, 0);
  const q = (n) => f(n * k);
  return p(`M${f(x - 7 * k)} ${y}Q${f(x - 6 * k)} ${f(y - 7 * k)} ${x} ${f(y - 8 * k)}Q${f(x + 6 * k)} ${f(y - 7 * k)} ${f(x + 7 * k)} ${y}Q${x} ${f(y + 3 * k)} ${f(x - 7 * k)} ${y}Z`, THATCH[1], 1.2) +
    ln(`M${f(x - 3 * k)} ${f(y - 5 * k)}l${q(2)} ${q(-1.5)}M${f(x + 1 * k)} ${f(y - 2 * k)}l${q(2.5)} ${q(-1)}`, THATCH[2], 1);
}
function waterTrough(u, v, c = WOOD) {
  return box(u - 5, u + 5, v - 2, v + 2, 0, 3, c, 1.2) + p(poly([[u - 4.2, v - 1.2, 3], [u + 4.2, v - 1.2, 3], [u + 4.2, v + 1.2, 3], [u - 4.2, v + 1.2, 3]]), TEAL[0], 0.8);
}
const ground = (u0, u1, v0, v1) => p(poly([[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]]), '#C8A064', 1.2);

export default function elkPens(st) {
  let s = '';
  if (st === 1) {
    s += ground(-24, 22, -22, 22);
    s += rails([[-24, 22], [-24, -22], [22, -22]]);
    s += hay(-14, -12, 1) + waterTrough(10, -14);
    s += elk(-2, 6, 0.8);
    s += rails([[-24, 22], [-2, 22]]) + rails([[8, 22], [22, 22], [22, -22]]);
    s += tufts([[-28, 26], [26, -27], [27, 26]]);
    return sprite(s, [6, 30, 54, 27]);
  }
  if (st === 2) {
    s += ground(-25, 24, -24, 23);
    // open shelter on the back
    s += box(-25, 8, -24, -21, 0, 3, STONE) + box(-25, 8, -24, -21, 3, 14, WOOD, 1.3) + planksL(-25, 8, -21, 3, 14, 8);
    s += post(-24, -11, 0, 13, 2, WOOD) + post(7, -11, 0, 13, 2, WOOD);
    s += gableU(-26, 9, -24, -10, 14, 22, THATCH, WOOD, 2);
    s += rails([[-25, 23], [-25, -10]]) + rails([[9, -24], [24, -24], [24, -2]]);
    s += hay(-16, -14, 1) + waterTrough(15, -12, WOOD);
    s += elk(-14, 12, 0.75) + elk(17, 2, -0.75);
    s += rails([[-25, 23], [-3, 23]]) + rails([[8, 23], [24, 23], [24, -2]]);
    return sprite(s);
  }
  const s3 = st === 3;
  s += ground(-26, 25, -26, 24);
  // stable barn on the back left with an iron-banded door
  s += box(-27, 6, -27, -12, 0, 4, STONE) + courses(-27, 6, -27, -12, 0, 4, 2);
  s += box(-26, 5, -26, -13, 4, 17, WOOD, 1.3) + planksL(-26, 5, -13, 4, 17, 9);
  s += p(poly([[-14, -13, 4], [-4, -13, 4], [-4, -13, 14], [-14, -13, 14]]), DWOOD[2], 1.3);
  s += ln(open([[-14, -13, 7], [-4, -13, 7]]) + open([[-14, -13, 11.5], [-4, -13, 11.5]]), s3 ? IRON[1] : GOLD[1], 1.6);
  s += gableU(-28, 7, -27, -12, 17, 28, s3 ? ['#C9A877', '#B98F5E', '#714B29'] : ROOF, s3 ? WOOD : GOLD, 2);
  if (!s3) {
    // gilded antler crest over the barn end
    const [x, y] = iso(7, -19.5, 25);
    s += p(`M${x} ${f(y + 1)}Q${f(x - 7)} ${f(y - 1)} ${f(x - 8)} ${f(y - 7)}L${f(x - 6)} ${f(y - 6)}L${f(x - 6)} ${f(y - 9)}L${f(x - 4)} ${f(y - 6)}L${f(x - 2)} ${f(y - 9)}L${f(x - 1)} ${f(y - 4)}Q${x} ${f(y - 2)} ${f(x + 1)} ${f(y - 4)}L${f(x + 2)} ${f(y - 9)}L${f(x + 4)} ${f(y - 6)}L${f(x + 6)} ${f(y - 9)}L${f(x + 6)} ${f(y - 6)}L${f(x + 8)} ${f(y - 7)}Q${f(x + 7)} ${f(y - 1)} ${x} ${f(y + 1)}Z`, GOLD[1], 1.1);
  }
  s += rails([[-26, 24], [-26, -12]], 7, s3 ? WOOD : DWOOD) + rails([[7, -26], [25, -26], [25, -4]], 7, s3 ? WOOD : DWOOD);
  // tack rack
  s += post(14, -22, 0, 9, 1.4, WOOD) + post(22, -22, 0, 9, 1.4, WOOD) + rod([14, -22, 8], [22, -22, 8], 1, WOOD[1]);
  s += p(poly([[16, -21, 8], [19, -21, 8], [19, -21, 4], [16, -21, 4]]), s3 ? ROOF[1] : PLUM[1], 1);
  s += hay(-18, -6, 1.1) + waterTrough(16, -10, s3 ? DWOOD : STONE);
  s += elk(-14, 12, 0.78, s3 ? ROOF[1] : PLUM[1], !s3) + elk(17, 2, -0.78, s3 ? null : PLUM[1], !s3);
  // iron-banded gate in the front fence
  s += rails([[-26, 24], [-4, 24]], 7, s3 ? WOOD : DWOOD) + rails([[8, 24], [25, 24], [25, -4]], 7, s3 ? WOOD : DWOOD);
  s += p(poly([[-4, 24, 0.5], [2, 24, 0.5], [2, 24, 6.5], [-4, 24, 6.5]]), DWOOD[1], 1.2) + ln(open([[-4, 24, 2.3], [2, 24, 2.3]]) + open([[-4, 24, 5], [2, 24, 5]]), s3 ? IRON[1] : GOLD[1], 1.4);
  if (!s3) s += brazier(10, 28) + brazier(-26, 28) + flag(-27, -27, 17, 14, PLUM[1]);
  else s += flag(-27, -27, 17, 12, ROOF[1]);
  return sprite(s);
}
