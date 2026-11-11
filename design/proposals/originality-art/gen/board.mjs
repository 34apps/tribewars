// Builds ../compare.html (old vs new at game size) and, when resvg is available, ../compare.png and ../village-mock.png.
// Rendering is windowless (resvg, no browser): RESVG=<path to @resvg/resvg-js> node board.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { iso } from './blib.mjs';
import { stake, gate, banner } from './palisade.mjs';

const HERE = new URL('../', import.meta.url).pathname;
const OLD = new URL('../../../../apps/web/src/art/', import.meta.url).pathname;
const oldB = (f) => `${OLD}buildings/${f}.svg`, oldU = (f) => `${OLD}units/${f}.svg`, oldI = (f) => `${OLD}units/icon/${f}.svg`;
const newF = (f) => `${HERE}${f}.svg`, newI = (f) => `${HERE}icon/${f}.svg`;
const rel = (p) => p.replace(HERE, '').replace(OLD, '../../../apps/web/src/art/');

const BUILDINGS = [
  ['Longhouse', 'new: population room', 'farm', 'Farm (it held population)', 'longhouse'],
  ['Wrightyard', 'new: builds siege', 'barracks', 'Barracks (siege trained there)', 'wrightyard'],
  ['Root Cellar', 'replaces Hidden Vault', 'hidden-vault', 'Hidden Vault', 'root-cellar'],
  ['Gold Sluice', 'replaces Gold Mine', 'gold-mine', 'Gold Mine', 'gold-sluice'],
  ['Palisade', 'replaces Wall (panel piece)', 'wall', 'Wall', 'palisade'],
  ['Elk Pens', 'replaces Stables', 'stables', 'Stables', 'elk-pens'],
];
const UNITS = [
  ['Elk Rider', 'replaces Outrider', 'outrider', 'elk-rider'],
  ['Ember Guard', 'replaces Knight (now on foot)', 'knight', 'ember-guard'],
  ['Firecart', 'replaces Log Ram + Boulder Sling', 'logram', 'firecart', 'boulder'],
];
const POSES = ['idle', 'march', 'victory', 'defeated'];

// ---------- one SVG board, used for both the HTML page and the PNG ----------
const BW = 180, BH = 244; // building sprite at about village size on a desktop (140 x 190 units x 1.29)
const UW = 132, UH = 127; // unit figure at about army-card size
const LBL = 190, GAP = 8, PAD = 24;
const INK = '#2B211C';
const esc = (s) => s.replace(/&/g, '&amp;');
let y = PAD, body = '';
const W = PAD * 2 + LBL + 8 * (BW + GAP) + 24;
const T = (x, yy, s, size, fill = '#FFF8E8', weight = 700, anchor = 'start') =>
  `<text x="${x}" y="${yy}" font-family="Rubik, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
const img = (x, yy, w, h, href) => `<image x="${x}" y="${yy}" width="${w}" height="${h}" href="${href}" preserveAspectRatio="xMidYMid meet"/>`;

body += T(W / 2, y + 30, 'Clanfire originality pass: old art vs new art', 32, INK, 800, 'middle');
y += 46;
body += T(W / 2, y + 14, 'Buildings shown stage 1 to 4 at about village size; units idle / march / victory / defeated + round icon.', 15, INK, 400, 'middle');
y += 34;
const colX0 = PAD + LBL;
const half = 4 * (BW + GAP);
body += `<rect x="${colX0}" y="${y}" width="${half - GAP}" height="30" rx="10" fill="#7C756B"/>` + T(colX0 + half / 2, y + 21, 'OLD (in the game today)', 16, '#FFF8E8', 700, 'middle');
body += `<rect x="${colX0 + half + 24}" y="${y}" width="${half - GAP}" height="30" rx="10" fill="#F2B33D"/>` + T(colX0 + half + 24 + half / 2, y + 21, 'NEW (proposal)', 16, INK, 700, 'middle');
y += 40;
for (const [name, note, oldFile, oldNote, nf] of BUILDINGS) {
  body += `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${BH + 16}" rx="16" fill="${INK}"/>`;
  body += T(PAD + 14, y + 36, name, 24, '#F2B33D', 800) + T(PAD + 14, y + 60, note, 13, '#F1E1C2', 400) + T(PAD + 14, y + 80, `old: ${oldNote}`, 13, '#B3ACA0', 400);
  for (let s = 1; s <= 4; s++) {
    const x = colX0 + (s - 1) * (BW + GAP);
    body += `<rect x="${x}" y="${y + 8}" width="${BW}" height="${BH}" rx="10" fill="#3E3028"/>` + img(x, y + 8, BW, BH, oldB(`${oldFile}-${s}`)) + T(x + 8, y + 26, `${s}`, 13, '#B3ACA0');
    const x2 = colX0 + half + 24 + (s - 1) * (BW + GAP);
    body += `<rect x="${x2}" y="${y + 8}" width="${BW}" height="${BH}" rx="10" fill="#4A3A2E"/>` + img(x2, y + 8, BW, BH, newF(`${nf}-${s}`)) + T(x2 + 8, y + 26, `${s}`, 13, '#F2B33D');
  }
  y += BH + 16 + 12;
}
y += 10;
for (const [name, note, oldU1, nu, oldU2] of UNITS) {
  const h = UH + 16 + (oldU2 ? 0 : 0);
  body += `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${h}" rx="16" fill="${INK}"/>`;
  body += T(PAD + 14, y + 36, name, 24, '#F2B33D', 800) + T(PAD + 14, y + 60, note, 13, '#F1E1C2', 400);
  const uw = (half - GAP) / 5;
  POSES.forEach((pz, i) => {
    body += img(colX0 + i * uw, y + 8, uw, UH, oldU(`${oldU1}-${pz}`));
    body += img(colX0 + half + 24 + i * uw, y + 8, uw, UH, newF(`${nu}-${pz}`));
  });
  if (oldU2) {
    body += img(colX0 + 4 * uw + 4, y + 18, uw / 2 - 6, uw / 2 - 6, oldI(oldU1)) + img(colX0 + 4 * uw + uw / 2, y + 18, uw / 2 - 6, uw / 2 - 6, oldI(oldU2));
  } else body += img(colX0 + 4 * uw + 16, y + 20, uw - 32, uw - 32, oldI(oldU1));
  body += img(colX0 + half + 24 + 4 * uw + 16, y + 20, uw - 32, uw - 32, newI(nu));
  y += h + 12;
}
y += PAD - 12;
const boardSvg = (hrefMap) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><rect width="${W}" height="${y}" fill="#B98A56"/>${hrefMap(body)}</svg>`;

// ---------- village scene mock: new buildings (stage 3) placed in a ring of Palisade ----------
const TILE_RE = /^\s*(?:<path\b[^>]*\bfill=["']#(?:5E8C3A|3A5E27|A6C964)["'][^>]*>(?:\s*<\/path>)?\s*){3}/i;
let pfx = 0;
function inline(file, u, v, k = 1) {
  const text = readFileSync(file, 'utf8');
  const p = `s${pfx++}_`;
  let inner = /<svg\b[^>]*>([\s\S]*)<\/svg>/i.exec(text)[1].replace(TILE_RE, '');
  inner = inner.replace(/ id="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/href="#([^"]+)"/g, `href="#${p}$1"`);
  const [x, y0] = iso(u, v, 0);
  // sprite (0, 26) is the tile centre
  return `<g transform="translate(${x} ${y0 - 26 * k}) scale(${k})">${inner}</g>`;
}
function scene() {
  const R = 118, Z = 0;
  const S = 3; // palisade look
  let s = '';
  const P = (pts) => 'M' + pts.map(([u, v, z = 0]) => iso(u, v, z).join(' ')).join('L') + 'Z';
  const E = R + 10;
  s += `<path d="${P([[-E, E, 0], [E, E, 0], [E, E, -10], [-E, E, -10]])}" fill="#5E8C3A" stroke="${INK}" stroke-width="1.8"/>`;
  s += `<path d="${P([[E, E, 0], [E, -E, 0], [E, -E, -10], [E, E, -10]])}" fill="#3A5E27" stroke="${INK}" stroke-width="1.8"/>`;
  s += `<path d="${P([[-E, -E], [E, -E], [E, E], [-E, E]])}" fill="#A6C964" stroke="${INK}" stroke-width="1.8"/>`;
  // paths: gate on the front-left wall (v = +R) to the square
  s += `<path d="${P([[-9, 0], [9, 0], [9, E], [-9, E]])}" fill="#D9B77A" stroke="${INK}" stroke-width="1.2"/>`;
  s += `<path d="${P([[-26, -26], [26, -26], [26, 26], [-26, 26]])}" fill="#E3DED3" stroke="${INK}" stroke-width="1.2"/>`;
  s += `<path d="${P([[0, -9], [E - 18, -9], [E - 18, 9], [0, 9]])}" fill="#D9B77A" stroke="${INK}" stroke-width="1.2" opacity="0.9"/>`;
  const items = [];
  const H = 15 + S, step = 4.2;
  for (let t = -R; t <= R; t += step) {
    items.push([-R + t - 0.01, `<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${stake(-R, t, 0, H, S)}</g>`]);
    items.push([t - R - 0.01, `<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${stake(t, -R, 0, H, S)}</g>`]);
    items.push([R + t + 0.5, `<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${stake(R, t, 0, H, S)}</g>`]);
    if (Math.abs(t) > 9) items.push([t + R + 0.5, `<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${stake(t, R, 0, H, S)}</g>`]);
  }
  items.push([R, `<g stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${gate(-6, 6, S, R)}</g>`]);
  const place = [
    ['wrightyard-3', -72, -72, HERE], ['elk-pens-3', 0, -72, HERE], ['gold-sluice-3', 72, -72, HERE],
    ['root-cellar-3', -72, 0, HERE], ['town-hall-3', 0, 0, OLD + 'buildings/'], ['longhouse-3', 72, 0, HERE],
    ['farm-3', -72, 72, OLD + 'buildings/'], ['palisade-3', 50, 64, null], ['barracks-3', 72, 72, OLD + 'buildings/'],
  ];
  for (const [f, u, v, dir] of place) if (dir) items.push([u + v, inline(`${dir}${f}.svg`, u, v, 1)]);
  items.sort((a, b) => a[0] - b[0]);
  s += items.map((i) => i[1]).join('');
  const [lx, ly] = iso(-R, R, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1680" height="1170" viewBox="-280 -170 560 390"><rect x="-280" y="-170" width="560" height="390" fill="#B98A56"/>` +
    `<text x="0" y="-148" font-family="Rubik, Helvetica, Arial, sans-serif" font-size="15" font-weight="800" fill="${INK}" text-anchor="middle">Village mock: new art at stage 3 inside a Palisade ring</text>` +
    `<text x="0" y="-133" font-family="Rubik, Helvetica, Arial, sans-serif" font-size="8.5" fill="${INK}" text-anchor="middle">New: Wrightyard (top), Root Cellar (upper left), Elk Pens (upper right), Gold Sluice (right), Longhouse (lower right), Palisade ring and gate. Old for scale: Town Hall, Farm, Barracks.</text>` +
    `${s}</svg>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Originality art: old vs new</title>
<style>body{margin:0;background:#B98A56}img{display:block;max-width:100%;height:auto;margin:0 auto}</style></head>
<body>
${boardSvg((b) => b.replace(/href="([^"]+)"/g, (m, p) => `href="${rel(p)}"`))}
<div style="height:24px"></div>
${scene()}
</body></html>
`;
writeFileSync(`${HERE}compare.html`, html);
console.log('wrote compare.html');

const RESVG = process.env.RESVG;
if (RESVG) {
  const { Resvg } = createRequire(import.meta.url)(RESVG);
  const render = (svg, out) => writeFileSync(`${HERE}${out}`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng());
  render(boardSvg((b) => b), 'compare.png');
  render(scene(), 'village-mock.png');
  console.log('wrote compare.png, village-mock.png');
} else console.log('set RESVG=<path to @resvg/resvg-js> to also render the PNGs');
