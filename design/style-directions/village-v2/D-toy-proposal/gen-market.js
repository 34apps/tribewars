// Toy Diorama market sprites (3 stages) in the shared sprite frame: viewBox -70 -122 140 190, ground tile centred (0, 26).
const fs = require('fs');
const INK = '#2B211C';
const f = (n) => Math.round(n * 10) / 10;
const P = (x, y, z = 0) => [f(x - y), f(26 + (x + y) / 2 - z)];
const d = (pts) => 'M' + pts.map((p) => P(...p).join(' ')).join('L') + 'Z';
const TILE =
  '<path d="M-59.8 26L0 55.9L0 62.9L-59.8 33Z" fill="#5E8C3A" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>' +
  '<path d="M59.8 26L0 55.9L0 62.9L59.8 33Z" fill="#3A5E27" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>' +
  '<path d="M0 -3.9L59.8 26L0 55.9L-59.8 26Z" fill="#A6C964" stroke="#2B211C" stroke-width="1.8" stroke-linejoin="round"></path>';
const C = {
  wood: ['#E4B67C', '#B07D46', '#714B29'],
  bone: ['#FFF6E2', '#F1E1C2', '#C9B48F'],
  roof: ['#EF9C6E', '#C4623A', '#843A23'],
  stone: ['#E3DED3', '#B3ACA0', '#7C756B'],
  sun: ['#FFD77A', '#F2B33D', '#C98E1F'],
  teal: ['#7CC9C9', '#2F9AA0', '#1F6E73'],
  plum: ['#B0668F', '#7A3B5E', '#52253E'],
  moss: ['#A6C964', '#5E8C3A', '#3A5E27'],
};
let out = [];
const path = (dd, fill, sw = 1.6) => out.push(`<path d="${dd}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`);
/** Box x0..x1, y0..y1, z0..z1: left (+y) face, right (+x) face, top. */
function box(x0, x1, y0, y1, z0, z1, c, sw = 1.6) {
  path(d([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]), c[1], sw);
  path(d([[x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [x1, y1, z1]]), c[2], sw);
  path(d([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]), c[0], sw);
}
function shadow(x0, x1, y0, y1) {
  out.push(`<path d="${d([[x0, y0, 0], [x1 + 4, y0 - 1, 0], [x1 + 6, y1 + 2, 0], [x0 + 2, y1 + 3, 0]])}" fill="${INK}" opacity="0.16"/>`);
}
/** Market stall: four posts, counter with goods, striped awning sloping to the front-left (+y). */
function stall(cx, cy, w, dpt, h, stripe, goods) {
  const x0 = cx - w, x1 = cx + w, y0 = cy - dpt, y1 = cy + dpt;
  shadow(x0, x1, y0, y1);
  // back posts
  box(x0, x0 + 1.4, y0, y0 + 1.4, 0, h + 3, C.wood, 1.2);
  box(x1 - 1.4, x1, y0, y0 + 1.4, 0, h + 3, C.wood, 1.2);
  // counter
  box(x0 + 1, x1 - 1, y0 + 2, y1 - 1, 0, 6, C.wood);
  // goods on the counter: little round heaps / crates
  goods.forEach(([gx, col], i) => {
    const [px, py] = P(cx + gx, cy, 6);
    out.push(`<ellipse cx="${f(px)}" cy="${f(py - 1.4)}" rx="3.2" ry="2.2" fill="${C[col][1]}" stroke="${INK}" stroke-width="1.1"/>`);
    out.push(`<ellipse cx="${f(px - 1)}" cy="${f(py - 2.2)}" rx="1.2" ry="0.7" fill="${C[col][0]}"/>`);
  });
  // front posts
  box(x0, x0 + 1.4, y1 - 1.4, y1, 0, h, C.wood, 1.2);
  box(x1 - 1.4, x1, y1 - 1.4, y1, 0, h, C.wood, 1.2);
  // awning: from back top (h+3) to front (h-1) overhanging; stripes along x
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = x0 - 1 + ((x1 - x0 + 2) * i) / n, b = x0 - 1 + ((x1 - x0 + 2) * (i + 1)) / n;
    const fill = i % 2 ? C.bone[1] : C[stripe][1];
    path(d([[a, y0 - 1, h + 3], [b, y0 - 1, h + 3], [b, y1 + 3, h - 1], [a, y1 + 3, h - 1]]), fill, 1.2);
  }
  // scalloped front valance
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([x0 - 1 + ((x1 - x0 + 2) * i) / n, y1 + 3, h - 1]);
  let vd = `M${P(...pts[0]).join(' ')}`;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = P(...pts[i]);
    const [bx, by] = P(...pts[i + 1]);
    vd += `Q${f((ax + bx) / 2)} ${f((ay + by) / 2 + 4)} ${bx} ${by}`;
  }
  out.push(`<path d="${vd}Z" fill="${C[stripe][2]}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`);
  path(d([[x0 - 1, y0 - 1, h + 3], [x1 + 1, y0 - 1, h + 3], [x1 + 1, y1 + 3, h - 1], [x0 - 1, y1 + 3, h - 1]]), 'none', 1.6);
}
function crate(x, y, s = 3.2) { box(x - s, x + s, y - s, y + s, 0, s * 2, C.wood, 1.3); out.push(`<path d="M${P(x - s, y + s, 0).join(' ')}L${P(x + s, y + s, s * 2).join(' ')}" stroke="${INK}" stroke-width="0.9"/>`); }
function barrel(x, y) {
  const [px, py] = P(x, y, 0);
  out.push(`<path d="M${f(px - 3.4)} ${f(py)}V${f(py - 7)}A3.4 1.7 0 0 1 ${f(px + 3.4)} ${f(py - 7)}V${f(py)}A3.4 1.7 0 0 1 ${f(px - 3.4)} ${f(py)}Z" fill="${C.wood[1]}" stroke="${INK}" stroke-width="1.3"/>`);
  out.push(`<ellipse cx="${f(px)}" cy="${f(py - 7)}" rx="3.4" ry="1.7" fill="${C.wood[0]}" stroke="${INK}" stroke-width="1.3"/>`);
  out.push(`<path d="M${f(px - 3.4)} ${f(py - 3.5)}A3.4 1.7 0 0 0 ${f(px + 3.4)} ${f(py - 3.5)}" fill="none" stroke="${C.wood[2]}" stroke-width="1"/>`);
}
function cart(x, y) {
  shadow(x - 7, x + 7, y - 4, y + 4);
  box(x - 7, x + 7, y - 4, y + 4, 3, 7, C.wood);
  box(x - 6, x + 6, y - 3, y + 3, 7, 9, C.sun, 1.2);
  const [wx, wy] = P(x - 2, y + 4.5, 2.5);
  out.push(`<circle cx="${wx}" cy="${wy}" r="3.2" fill="${C.wood[2]}" stroke="${INK}" stroke-width="1.3"/><circle cx="${wx}" cy="${wy}" r="0.9" fill="${C.wood[0]}"/>`);
  const [hx, hy] = P(x + 10, y + 1, 4);
  const [h2x, h2y] = P(x + 7, y + 2, 5);
  out.push(`<path d="M${h2x} ${h2y}L${hx} ${hy}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/><path d="M${h2x} ${h2y}L${hx} ${hy}" stroke="${C.wood[1]}" stroke-width="1" stroke-linecap="round"/>`);
}
function flag(x, y, z, h) {
  const [px, py] = P(x, y, z);
  out.push(`<path d="M${px} ${py}V${f(py - h)}" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`);
  out.push(`<path d="M${f(px + 0.6)} ${f(py - h)}h12l-3 3.5l3 3.5h-12z" fill="${C.sun[1]}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`);
}
/** Gabled hall along x with a terracotta roof. */
function hall(x0, x1, y0, y1, h, rise) {
  shadow(x0, x1, y0, y1);
  box(x0, x1, y0, y1, 0, h, C.bone);
  const ym = (y0 + y1) / 2;
  // gable end (+x face) triangle
  path(d([[x1, y1, h], [x1, y0, h], [x1, ym, h + rise]]), C.bone[2]);
  // roof planes: front (+y) slope lit, back hidden; ridge along x
  path(d([[x0 - 1.5, y1 + 2, h - 1], [x1 + 1.5, y1 + 2, h - 1], [x1 + 1.5, ym, h + rise], [x0 - 1.5, ym, h + rise]]), C.roof[1], 1.8);
  path(d([[x1 + 1.5, ym, h + rise], [x1 + 1.5, y1 + 2, h - 1], [x1 + 1.5, y1 + 2, h - 2.6], [x1 + 1.5, ym, h + rise - 1.6]]), C.roof[2], 1.2);
  out.push(`<path d="M${P(x0, ym - 0.2, h + rise - 1).join(' ')}L${P(x0 + (x1 - x0) * 0.4, ym + 4, h + rise - 5).join(' ')}" stroke="${C.roof[0]}" stroke-width="1.6" stroke-linecap="round"/>`);
  // door and windows on the front face
  const door = d([[x0 + (x1 - x0) * 0.42, y1, 0], [x0 + (x1 - x0) * 0.58, y1, 0], [x0 + (x1 - x0) * 0.58, y1, h * 0.62], [x0 + (x1 - x0) * 0.42, y1, h * 0.62]]);
  path(door, C.wood[2], 1.3);
  for (const t of [0.18, 0.78]) path(d([[x0 + (x1 - x0) * t, y1, h * 0.45], [x0 + (x1 - x0) * (t + 0.1), y1, h * 0.45], [x0 + (x1 - x0) * (t + 0.1), y1, h * 0.75], [x0 + (x1 - x0) * t, y1, h * 0.75]]), C.sun[1], 1.1);
}
function pad(kind) {
  const r = 25;
  if (kind === 'dirt') out.push(`<path d="${d([[-r, -r, 0], [r, -r, 0], [r, r, 0], [-r, r, 0]])}" fill="#D9B98A" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
  else {
    out.push(`<path d="${d([[-r, -r, 0], [r, -r, 0], [r, r, 0], [-r, r, 0]])}" fill="#CFC6B2" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
    out.push(`<path d="${d([[-r + 4, -r + 4, 0], [r - 4, -r + 4, 0], [r - 4, r - 4, 0], [-r + 4, r - 4, 0]])}" fill="#E3DED3" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`);
  }
}
const stages = {
  1: () => { pad('dirt'); stall(-2, -6, 10, 6, 15, 'roof', [[-5, 'sun'], [1, 'moss'], [6, 'roof']]); crate(12, 12); barrel(-14, 14); crate(6, 16, 2.6); },
  2: () => { pad('dirt'); stall(-12, -10, 9, 6, 15, 'teal', [[-4, 'sun'], [3, 'moss']]); stall(10, 4, 9, 6, 15, 'roof', [[-4, 'plum'], [3, 'sun']]); cart(-8, 14); barrel(16, -14); crate(18, 18, 2.8); },
  3: () => { pad('stone'); hall(-18, 10, -20, -4, 17, 12); flag(4, -12, 29, 14); stall(14, 4, 8, 5.5, 14, 'teal', [[-3, 'sun'], [3, 'moss']]); stall(-14, 12, 8, 5.5, 14, 'roof', [[-3, 'plum'], [3, 'sun']]); cart(10, 18); barrel(19, -12); crate(-20, 22, 2.6); },
};
for (const k of [1, 2, 3]) {
  out = [];
  stages[k]();
  fs.writeFileSync(`art/buildings/market-${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -122 140 190" width="280" height="380">${TILE}<ellipse cx="6" cy="30" rx="54.6" ry="27.3" fill="#2B211C" opacity="0.14"></ellipse>${out.join('')}</svg>`);
}
