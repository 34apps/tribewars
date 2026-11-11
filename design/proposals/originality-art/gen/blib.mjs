// Toy Diorama building helpers for the originality-pass sprites. Same frame as apps/web/src/art/buildings/*.svg:
// viewBox "-70 -122 140 190", 2:1 isometric ground tile centred on (0, 26), lit from the top left.
// Ground point (u, v, z): u runs down-right, v runs down-left, z up. Visible box faces: left (+v, lit), right (+u, shade), top.
export const INK = '#2B211C';
const r = (n) => Math.round(n * 10) / 10;
export const f = r;
export const iso = (u, v, z = 0) => [r(u - v), r(26 + (u + v) / 2 - z)];
export const pt = (u, v, z = 0) => iso(u, v, z).join(' ');
/** Closed polygon through ground points. */
export const poly = (pts) => 'M' + pts.map((p) => pt(...p)).join('L') + 'Z';
export const open = (pts) => 'M' + pts.map((p) => pt(...p)).join('L');
export const p = (d, fill, sw, extra = '') => `<path d="${d}" fill="${fill}"${sw != null ? ` stroke-width="${sw}"` : ''}${extra}/>`;
export const ln = (d, col = INK, sw = 1, extra = '') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}"${extra}/>`;

// Palettes [top/light, left/mid, right/dark]
export const WOOD = ['#E4B67C', '#B07D46', '#714B29'];
export const DWOOD = ['#B98F5E', '#8E6539', '#5E3F22'];
export const STONE = ['#E3DED3', '#B3ACA0', '#7C756B'];
export const IRON = ['#E0DCD3', '#A39E94', '#665F57'];
export const ROOF = ['#EF9C6E', '#C4623A', '#843A23'];
export const THATCH = ['#F2D77A', '#E3BE5C', '#B88A32'];
export const TURF = ['#A6C964', '#7FAE4A', '#5E8C3A'];
export const GOLD = ['#FFE08F', '#F2B33D', '#B9791F'];
export const TEAL = ['#7FC7CB', '#2F9AA0', '#1A646B'];
export const PLUM = ['#B86C92', '#7A3B5E', '#4A213C'];
export const SACK = ['#F1E1C2', '#D9C29A', '#B09872'];
export const EARTH = ['#C8A064', '#B58B50', '#8E6539'];

/** Box u0..u1 x v0..v1 x z0..z1: left (+v), right (+u), top faces. */
export function box(u0, u1, v0, v1, z0, z1, c, sw = 1.5) {
  return (
    p(poly([[u0, v1, z0], [u1, v1, z0], [u1, v1, z1], [u0, v1, z1]]), c[1], sw) +
    p(poly([[u1, v1, z0], [u1, v0, z0], [u1, v0, z1], [u1, v1, z1]]), c[2], sw) +
    p(poly([[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]]), c[0], sw)
  );
}
/** Faint horizontal plank / course lines on the two visible faces of a box. */
export function courses(u0, u1, v0, v1, z0, z1, n, op = 0.45) {
  let d = '';
  for (let i = 1; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    d += open([[u0, v1, z], [u1, v1, z], [u1, v0, z]]);
  }
  return ln(d, INK, 0.7, ` opacity="${op}"`);
}
/** Vertical plank lines on the left (+v) face. */
export function planksL(u0, u1, v1, z0, z1, n, op = 0.4) {
  let d = '';
  for (let i = 1; i < n; i++) { const u = u0 + ((u1 - u0) * i) / n; d += open([[u, v1, z0], [u, v1, z1]]); }
  return ln(d, INK, 0.7, ` opacity="${op}"`);
}
export function planksR(v0, v1, u1, z0, z1, n, op = 0.4) {
  let d = '';
  for (let i = 1; i < n; i++) { const v = v0 + ((v1 - v0) * i) / n; d += open([[u1, v, z0], [u1, v, z1]]); }
  return ln(d, INK, 0.7, ` opacity="${op}"`);
}
/**
 * Gable roof with the ridge along u (over v0..v1, eaves at z1, ridge at zr, overhang o).
 * Draws the front (+v) slope, the +u gable triangle and a fascia; c = roof palette, g = gable wall palette.
 */
export function gableU(u0, u1, v0, v1, z1, zr, c, g, o = 2, sw = 1.5) {
  const vm = (v0 + v1) / 2;
  const back = p(poly([[u0 - o, vm, zr], [u1 + o, vm, zr], [u1 + o, v0 - o, z1 - o * 0.6], [u0 - o, v0 - o, z1 - o * 0.6]]), c[0], sw);
  const gable = p(poly([[u1, v0, z1], [u1, vm, zr], [u1, v1, z1]]), g[2], sw);
  const front = p(poly([[u0 - o, vm, zr], [u1 + o, vm, zr], [u1 + o, v1 + o, z1 - o * 0.6], [u0 - o, v1 + o, z1 - o * 0.6]]), c[1], sw);
  return back + gable + front;
}
/** Gable roof with the ridge along v: slope facing +u (shade) and the +v gable triangle (lit). */
export function gableV(u0, u1, v0, v1, z1, zr, c, g, o = 2, sw = 1.5) {
  const um = (u0 + u1) / 2;
  const back = p(poly([[um, v0 - o, zr], [um, v1 + o, zr], [u0 - o, v1 + o, z1 - o * 0.6], [u0 - o, v0 - o, z1 - o * 0.6]]), c[0], sw);
  const gable = p(poly([[u0, v1, z1], [um, v1, zr], [u1, v1, z1]]), g[1], sw);
  const front = p(poly([[um, v0 - o, zr], [um, v1 + o, zr], [u1 + o, v1 + o, z1 - o * 0.6], [u1 + o, v0 - o, z1 - o * 0.6]]), c[1], sw);
  return back + gable + front;
}
/** Square post (w wide) from z0 to z1, optional pointed top of height tip. */
export function post(u, v, z0, z1, w, c, tip = 0, sw = 1.3) {
  const h = w / 2;
  let s = box(u - h, u + h, v - h, v + h, z0, z1, c, sw);
  if (tip) {
    s += p(poly([[u - h, v + h, z1], [u + h, v + h, z1], [u, v, z1 + tip]]), c[1], sw) +
      p(poly([[u + h, v + h, z1], [u + h, v - h, z1], [u, v, z1 + tip]]), c[2], sw);
  }
  return s;
}
/** Round log between two ground points (an ink stroke under a coloured one). */
export function rod(a, b, w, col, sw = 1.6) {
  const d = `M${pt(...a)}L${pt(...b)}`;
  return ln(d, INK, w + sw) + ln(d, col, w);
}
/** Upright barrel at (u, v) standing on z0, radius rad, height h. */
export function barrel(u, v, z0, rad, h, c = WOOD, band = IRON[2]) {
  const [x, y] = iso(u, v, z0);
  const ry = rad / 2, top = y - h;
  const body = `M${r(x - rad)} ${r(top)}L${r(x - rad)} ${r(y)}A${rad} ${ry} 0 0 0 ${r(x + rad)} ${r(y)}L${r(x + rad)} ${r(top)}Z`;
  const hl = `M${r(x)} ${r(top + ry)}L${r(x)} ${r(y + ry)}A${rad} ${ry} 0 0 0 ${r(x + rad)} ${r(y)}L${r(x + rad)} ${r(top)}Z`;
  const bands = [0.3, 0.75].map((t) => `M${r(x - rad)} ${r(y - h * t)}A${rad} ${ry} 0 0 0 ${r(x + rad)} ${r(y - h * t)}`).join('');
  return p(body, c[1], 1.3) + p(hl, c[2], 0, ' stroke="none" opacity="0.8"') + ln(bands, band, 1.1) +
    `<ellipse cx="${r(x)}" cy="${r(top)}" rx="${rad}" ry="${ry}" fill="${c[0]}" stroke-width="1.3"/>`;
}
/** A plump sack at (u, v). */
export function sack(u, v, s = 1, c = SACK) {
  const [x, y] = iso(u, v, 0);
  const q = (n) => r(n * s);
  return `<g transform="translate(${x} ${y})">` +
    p(`M${q(-5)} 0Q${q(-7)} ${q(-6)} ${q(-3)} ${q(-9)}L${q(-2)} ${q(-11)}L${q(2)} ${q(-11)}L${q(3)} ${q(-9)}Q${q(7)} ${q(-6)} ${q(5)} 0Q0 ${q(2)} ${q(-5)} 0Z`, c[1], 1.2) +
    p(`M${q(1)} ${q(-9)}Q${q(6)} ${q(-6)} ${q(4.5)} ${q(-0.5)}Q${q(2)} ${q(0.8)} 0 ${q(1)}Q${q(3)} ${q(-4)} ${q(1)} ${q(-9)}Z`, c[2], 0, ' stroke="none"') +
    ln(`M${q(-2.5)} ${q(-9.5)}L${q(2.5)} ${q(-9.5)}`, INK, 1) + `</g>`;
}
/** The standard ground tile (stripped in the village scene) + soft shadow. */
export function tile(shadow = [6, 30, 54.6, 27.3]) {
  return '<path d="M-59.8 26L0 55.9L0 62.9L-59.8 33Z" fill="#5E8C3A" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>' +
    '<path d="M59.8 26L0 55.9L0 62.9L59.8 33Z" fill="#3A5E27" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>' +
    '<path d="M0 -3.9L59.8 26L0 55.9L-59.8 26Z" fill="#A6C964" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>' +
    `<ellipse cx="${shadow[0]}" cy="${shadow[1]}" rx="${shadow[2]}" ry="${shadow[3]}" fill="#2B211C" opacity="0.14"></ellipse>`;
}
export function sprite(body, shadow) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -122 140 190" width="280" height="380">${tile(shadow)}<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}
/** Small pennant flag on a pole at (u, v) from z0 up h. */
export function flag(u, v, z0, h, col = GOLD[1], dir = 1) {
  const [x, y] = iso(u, v, z0);
  const t = y - h;
  return ln(`M${x} ${y}L${x} ${r(t)}`, INK, 2.6) + ln(`M${x} ${y}L${x} ${r(t)}`, '#8E6539', 1.2) +
    p(`M${x} ${r(t + 0.5)}L${r(x + 9 * dir)} ${r(t + 2.5)}L${r(x + 6 * dir)} ${r(t + 4.5)}L${r(x + 9 * dir)} ${r(t + 7)}L${x} ${r(t + 7)}Z`, col, 1.1) +
    `<circle cx="${x}" cy="${r(t)}" r="1.4" fill="${GOLD[1]}" stroke-width="0.9"/>`;
}
/** Grass tufts at ground points. */
export function tufts(pts, col = '#5E8C3A') {
  let d = '';
  for (const [u, v, z = 0, s = 1] of pts) {
    const [x, y] = iso(u, v, z);
    d += `M${r(x - 2.5 * s)} ${y}l${r(1 * s)} ${r(-3.5 * s)}l${r(1 * s)} ${r(2.5 * s)}l${r(1 * s)} ${r(-4 * s)}l${r(1 * s)} ${r(4 * s)}l${r(1 * s)} ${r(-3 * s)}l${r(0.5 * s)} ${r(3.5 * s)}`;
  }
  return ln(d, col, 1.1);
}
/** Smoke puffs rising from a point. */
export function smoke(x, y, s = 1) {
  const c = (cx, cy, rr) => `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rr)}" fill="#F1E1C2" stroke-width="1.1" opacity="0.92"/>`;
  return c(x, y - 3 * s, 2.6 * s) + c(x + 3 * s, y - 9 * s, 3.4 * s) + c(x + 1 * s, y - 16 * s, 4 * s);
}
/** Flame (teardrop) at screen x, y (base), height h. */
export function flame(x, y, h = 8) {
  const w = h * 0.45;
  return p(`M${r(x)} ${r(y - h)}Q${r(x + w * 1.3)} ${r(y - h * 0.4)} ${r(x + w * 0.8)} ${r(y)}L${r(x - w * 0.8)} ${r(y)}Q${r(x - w * 1.3)} ${r(y - h * 0.4)} ${r(x)} ${r(y - h)}Z`, '#EE8443', 1.1) +
    p(`M${r(x)} ${r(y - h * 0.55)}Q${r(x + w * 0.6)} ${r(y - h * 0.2)} ${r(x + w * 0.35)} ${r(y)}L${r(x - w * 0.35)} ${r(y)}Q${r(x - w * 0.6)} ${r(y - h * 0.2)} ${r(x)} ${r(y - h * 0.55)}Z`, '#FFDC7A', 0, ' stroke="none"');
}
/** Four-point sparkle. */
export function glint(x, y, s = 3, col = '#FFE08F') {
  const i = s * 0.28;
  return p(`M${r(x)} ${r(y - s)}L${r(x + i)} ${r(y - i)}L${r(x + s)} ${r(y)}L${r(x + i)} ${r(y + i)}L${r(x)} ${r(y + s)}L${r(x - i)} ${r(y + i)}L${r(x - s)} ${r(y)}L${r(x - i)} ${r(y - i)}Z`, col, 0.9);
}
/** Brazier on a short iron stand at (u, v). */
export function brazier(u, v, z0 = 0) {
  const [x, y] = iso(u, v, z0);
  return ln(`M${r(x - 2.5)} ${y}L${r(x)} ${r(y - 6)}L${r(x + 2.5)} ${y}`, INK, 1.4) +
    p(`M${r(x - 4)} ${r(y - 8)}L${r(x + 4)} ${r(y - 8)}L${r(x + 2.5)} ${r(y - 5)}L${r(x - 2.5)} ${r(y - 5)}Z`, IRON[2], 1.1) +
    flame(x, y - 7.6, 7);
}
/** Wheel standing in the plane v = const (rim seen from the front-left), centre (u, v, z), radius rad. */
export function wheelU(u, v, z, rad, c = WOOD, spokes = 4, hub = IRON[1], rim = null) {
  const ring = (rr) => {
    let d = '';
    for (let i = 0; i <= 20; i++) { const t = (i / 20) * Math.PI * 2; d += (i ? 'L' : 'M') + pt(u + Math.cos(t) * rr, v, z + Math.sin(t) * rr); }
    return d + 'Z';
  };
  let sp = '';
  for (let i = 0; i < spokes; i++) { const t = (i / spokes) * Math.PI; sp += `M${pt(u + Math.cos(t) * rad * 0.8, v, z + Math.sin(t) * rad * 0.8)}L${pt(u - Math.cos(t) * rad * 0.8, v, z - Math.sin(t) * rad * 0.8)}`; }
  const [x, y] = iso(u, v, z);
  return p(ring(rad), rim || c[2], 1.3) + p(ring(rad * 0.78), c[1], 1) + ln(sp, INK, 2.2) + ln(sp, c[0], 0.9) +
    `<circle cx="${x}" cy="${y}" r="${f(rad * 0.22)}" fill="${hub}" stroke-width="1"/>`;
}
/** Wheel standing in the plane u = const (seen from the front-right). */
export function wheelV(u, v, z, rad, c = WOOD, spokes = 4, hub = IRON[1]) {
  const ring = (rr) => {
    let d = '';
    for (let i = 0; i <= 20; i++) { const t = (i / 20) * Math.PI * 2; d += (i ? 'L' : 'M') + pt(u, v + Math.cos(t) * rr, z + Math.sin(t) * rr); }
    return d + 'Z';
  };
  let sp = '';
  for (let i = 0; i < spokes; i++) { const t = (i / spokes) * Math.PI; sp += `M${pt(u, v + Math.cos(t) * rad * 0.8, z + Math.sin(t) * rad * 0.8)}L${pt(u, v - Math.cos(t) * rad * 0.8, z - Math.sin(t) * rad * 0.8)}`; }
  const [x, y] = iso(u, v, z);
  return p(ring(rad), c[2], 1.3) + p(ring(rad * 0.78), c[1], 1) + ln(sp, INK, 2.2) + ln(sp, c[0], 0.9) +
    `<circle cx="${x}" cy="${y}" r="${f(rad * 0.22)}" fill="${hub}" stroke-width="1"/>`;
}
/** Sawhorse along u at (u, v): beam at z h, splayed legs. */
export function sawhorse(u, v, len = 10, h = 5, c = WOOD) {
  const l = len / 2;
  let s = '';
  for (const du of [-l + 1, l - 1]) s += rod([u + du, v - 2.2, 0], [u + du, v, h], 1.1, c[2], 1.3) + rod([u + du, v + 2.2, 0], [u + du, v, h], 1.1, c[1], 1.3);
  return s + box(u - l, u + l, v - 0.9, v + 0.9, h, h + 1.6, c, 1.2);
}
/** Stack of boards along u. */
export function boards(u0, u1, v0, v1, n = 3, c = WOOD) {
  let s = '';
  for (let i = 0; i < n; i++) s += box(u0 + (i % 2) * 0.8, u1 + (i % 2) * 0.8, v0, v1, i * 1.6, i * 1.6 + 1.6, c, 1.1);
  return s;
}
/** Plain earth yard patch. */
export const yard = (u0, u1, v0, v1, col = '#C8A064') => p(poly([[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]]), col, 1.2);
