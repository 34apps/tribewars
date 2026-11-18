// Renders ../support-rider-board.png: the new rider's four poses + icon next to the Elk Rider and Ember Guard sets
// at game size, plus the three icons side by side at 32 px. Windowless (resvg, no browser):
//   RESVG=<path to @resvg/resvg-js> node board.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const HERE = new URL('../', import.meta.url).pathname;
const GAME = new URL('../../../../apps/web/src/art/units/', import.meta.url).pathname;
const ROWS = [
  ['Support rider', 'NEW (name not decided)', HERE, 'support-rider'],
  ['Elk Rider', 'in game: the raider', GAME, 'elk-rider'],
  ['Ember Guard', 'in game: heavy defender', GAME, 'ember-guard'],
];
const POSES = ['idle', 'march', 'victory', 'defeated'];
const u64 = (fp) => `data:image/svg+xml;base64,${readFileSync(fp).toString('base64')}`;
const CW = 172, CH = 165, LBL = 190, G = 8, P = 20, INK = '#2B211C', IC = 72;
const W = P * 2 + LBL + 4 * (CW + G) + IC + 40, ROWH = CH + 16;
const H = 70 + ROWS.length * (ROWH + G) + 150 + P;
const T = (x, y, s, size, fill, w = 700, a = 'start') =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}">${s}</text>`;
let b = `<rect width="${W}" height="${H}" fill="#F6ECD6"/>` + T(W / 2, 40, 'Stables: a second rider, the fast defender (game size)', 24, INK, 800, 'middle');
ROWS.forEach(([name, note, dir, stem], r) => {
  const y = 60 + r * (ROWH + G), isNew = r === 0;
  b += `<rect x="${P}" y="${y}" width="${W - 2 * P}" height="${ROWH}" rx="16" fill="${isNew ? '#FFFAF0' : '#EFE2C6'}" stroke="${isNew ? '#F2B33D' : '#D8C49C'}" stroke-width="2"/>`;
  b += T(P + 16, y + 40, name, 22, INK, 800) + T(P + 16, y + 62, note, 13, '#6B5A4A', isNew ? 700 : 400);
  POSES.forEach((p, c) => {
    const x = P + LBL + c * (CW + G);
    b += `<image x="${x}" y="${y + 8}" width="${CW}" height="${CH}" href="${u64(`${dir}${stem}-${p}.svg`)}"/>` + T(x + CW / 2, y + ROWH - 4, p, 11, '#8A7860', 400, 'middle');
  });
  const ix = P + LBL + 4 * (CW + G) + 10;
  b += `<image x="${ix}" y="${y + (ROWH - IC) / 2}" width="${IC}" height="${IC}" href="${u64(`${dir}icon/${stem}.svg`)}"/>`;
});
const sy = 60 + ROWS.length * (ROWH + G);
b += `<rect x="${P}" y="${sy}" width="${W - 2 * P}" height="140" rx="16" fill="#FFFAF0" stroke="#D8C49C" stroke-width="2"/>`;
b += T(P + 16, sy + 40, 'Icons at 32 px', 22, INK, 800) + T(P + 16, sy + 62, 'as in lists and the send panel', 13, '#6B5A4A', 400);
ROWS.forEach(([name, , dir, stem], i) => {
  const x = P + LBL + 20 + i * 150;
  b += `<image x="${x}" y="${sy + 26}" width="32" height="32" href="${u64(`${dir}icon/${stem}.svg`)}"/>` +
    `<image x="${x + 48}" y="${sy + 34}" width="20" height="20" href="${u64(`${dir}icon/${stem}.svg`)}"/>` + T(x + 16, sy + 84, name, 12, INK, 700, 'middle');
});
// the three side by side, as a row of chips would show them
ROWS.forEach(([, , dir, stem], i) => {
  b += `<image x="${P + LBL + 500 + i * 36}" y="${sy + 26}" width="32" height="32" href="${u64(`${dir}icon/${stem}.svg`)}"/>`;
});
b += T(P + LBL + 500 + 54, sy + 84, 'side by side', 12, '#6B5A4A', 400, 'middle');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${b}</svg>`;
if (!process.env.RESVG) { console.error('set RESVG=<path to @resvg/resvg-js>'); process.exit(1); }
const { Resvg } = createRequire(import.meta.url)(process.env.RESVG);
writeFileSync(`${HERE}support-rider-board.png`, new Resvg(svg, { fitTo: { mode: 'zoom', value: 1.5 }, font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' } }).render().asPng());
console.log('wrote support-rider-board.png', W, H);
