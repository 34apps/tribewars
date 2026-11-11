// Renders ../longhouse-wrightyard-v2.png: the new Longhouse and Wrightyard stages next to Town Hall and Barracks for
// scale. Windowless (resvg, no browser): RESVG=<path to @resvg/resvg-js> node board-v2.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const HERE = new URL('../', import.meta.url).pathname;
const OLD = new URL('../../../../apps/web/src/art/buildings/', import.meta.url).pathname;
const ROWS = [
  ['Longhouse', 'NEW', `${HERE}longhouse`],
  ['Town Hall', 'in game, for scale', `${OLD}town-hall`],
  ['Wrightyard', 'NEW', `${HERE}wrightyard`],
  ['Barracks', 'in game, for scale', `${OLD}barracks`],
];
const CW = 180, CH = 244, LBL = 170, G = 8, P = 20, INK = '#2B211C';
const W = P * 2 + LBL + 4 * (CW + G), H = 70 + ROWS.length * (CH + 16 + G) + P;
const T = (x, y, s, size, fill, w = 700, a = 'start') => `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}">${s}</text>`;
let b = `<rect width="${W}" height="${H}" fill="#B98A56"/>` + T(W / 2, 40, 'Longhouse and Wrightyard v2, stage 1 to 4 (about village size)', 24, INK, 800, 'middle');
ROWS.forEach(([name, note, stem], r) => {
  const y = 60 + r * (CH + 16 + G), isNew = note === 'NEW';
  b += `<rect x="${P}" y="${y}" width="${W - 2 * P}" height="${CH + 16}" rx="16" fill="${INK}"/>`;
  b += T(P + 14, y + 36, name, 22, isNew ? '#F2B33D' : '#E3DED3', 800) + T(P + 14, y + 58, note, 13, isNew ? '#F1E1C2' : '#B3ACA0', isNew ? 700 : 400);
  for (let s = 1; s <= 4; s++) {
    const x = P + LBL + (s - 1) * (CW + G);
    b += `<rect x="${x}" y="${y + 8}" width="${CW}" height="${CH}" rx="10" fill="${isNew ? '#4A3A2E' : '#3E3028'}"/>` +
      `<image x="${x}" y="${y + 8}" width="${CW}" height="${CH}" href="${stem}-${s}.svg" preserveAspectRatio="xMidYMid meet"/>` + T(x + 8, y + 26, `${s}`, 13, isNew ? '#F2B33D' : '#B3ACA0');
  }
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${b}</svg>`;
const { Resvg } = createRequire(import.meta.url)(process.env.RESVG);
writeFileSync(`${HERE}longhouse-wrightyard-v2.png`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng());
console.log('wrote longhouse-wrightyard-v2.png', W, H);
