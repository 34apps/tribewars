import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, base, shadow, svg, iconSvg, reset, person, MOUTH, setK } from '../../unit-figures/gen/lib.mjs';
import { jumpMarks, dizzy, puff } from '../../unit-figures/gen/siege.mjs';

const LABEL = 'Ember Guard';
const DARK = ['#8F8A82', '#3B3632', '#665F57']; // blackened iron
const EMBER = P.flame;

/** Great helm with an open face, cheek guards, a gold rim and an ember-red crest. */
const helm = () =>
  sh('M88 22C110 6 140 20 150 44L138 46C130 32 114 26 100 30Z', EMBER, 2, 2.4) +
  sh('M62 66C60 36 78 20 100 20C122 20 140 36 138 66L134 66L128 50Q100 42 72 50L66 66Z', P.iron, 3) +
  sh(rr(60, 52, 80, 10, 5), P.sun, 2, 2.4) +
  sh('M62 60L72 60L74 92Q68 94 64 88Z', P.iron, 2, 2.4) + sh('M138 60L128 60L126 92Q132 94 136 88Z', P.iron, 2, 2.4) +
  `<circle cx="100" cy="24" r="5" fill="#F2B33D" stroke="${INK}" stroke-width="2.4"/>`;
/** Plates over the shoulders and a gold-trimmed breastplate (drawn over the body). */
const plates = () =>
  sh('M58 102C66 92 86 94 92 104L90 120Q74 124 60 120Z', P.iron, 2, 2.4) +
  sh('M142 102C134 92 114 94 108 104L110 120Q126 124 140 120Z', P.iron, 2, 2.4) +
  line('M70 128Q100 138 130 128', '#F2B33D', 3.4) + line('M100 108V146', '#665F57', 2, ' opacity="0.6"');
/** The ember brazier-shield: a round iron shield with a glowing grate in the middle. cx, cy in person units. */
function shield(cx, cy, lit = true) {
  let s = sh(ell(cx, cy, 30, 34), DARK, 3, 2.8) + `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="26" ry="30" fill="none" stroke="#F2B33D" stroke-width="3"/>`;
  s += sh(ell(cx, cy, 14, 16), lit ? EMBER : ['#9C9588', '#3B3632', '#665F57'], 2, 2.4);
  if (lit) s += `<ellipse cx="${f(cx - 2)}" cy="${f(cy - 3)}" rx="7" ry="8" fill="#FFDC7A" opacity="0.9"/>`;
  s += line(`M${f(cx - 14)} ${f(cy)}H${f(cx + 14)}M${f(cx)} ${f(cy - 16)}V${f(cy + 16)}M${f(cx - 10)} ${f(cy - 11)}L${f(cx + 10)} ${f(cy + 11)}M${f(cx + 10)} ${f(cy - 11)}L${f(cx - 10)} ${f(cy + 11)}`, INK, 2.4);
  if (lit) s += tongue(cx - 5, cy - 8, 20) + tongue(cx + 6, cy - 6, 15);
  for (const [dx, dy] of [[0, -27], [0, 27], [-22, 0], [22, 0]]) s += `<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="2.6" fill="#F2B33D" stroke="${INK}" stroke-width="1.6"/>`;
  return s;
}
/** A flame tongue rising from (x, y), h tall. */
function tongue(x, y, h) {
  const w = h * 0.42;
  return fill(`M${f(x)} ${f(y - h)}Q${f(x + w * 1.4)} ${f(y - h * 0.35)} ${f(x + w)} ${f(y)}L${f(x - w)} ${f(y)}Q${f(x - w * 1.4)} ${f(y - h * 0.4)} ${f(x)} ${f(y - h)}Z`, '#EE8443', 2.2) +
    fill(`M${f(x)} ${f(y - h * 0.55)}Q${f(x + w * 0.7)} ${f(y - h * 0.2)} ${f(x + w * 0.45)} ${f(y)}L${f(x - w * 0.45)} ${f(y)}Q${f(x - w * 0.7)} ${f(y - h * 0.2)} ${f(x)} ${f(y - h * 0.55)}Z`, '#FFDC7A');
}
/** Glaive from (x1,y1) to the blade at (x2,y2) with an ember-hot edge. */
function glaive(x1, y1, x2, y2, lit = true) {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
  const tx = x2 + ux * 52, ty = y2 + uy * 52;
  const blade = `M${f(x2 - nx * 6)} ${f(y2 - ny * 6)}Q${f(x2 + ux * 24 + nx * 22)} ${f(y2 + uy * 24 + ny * 22)} ${f(tx)} ${f(ty)}Q${f(x2 + ux * 18 - nx * 4)} ${f(y2 + uy * 18 - ny * 4)} ${f(x2 - nx * 6)} ${f(y2 - ny * 6)}Z`;
  let s = sh(cap(x1, y1, x2, y2, 4), P.wood, 1.5, 2.4) + sh(blade, lit ? EMBER : P.iron, 2, 2.6);
  s += sh(rr(x2 - 7, y2 - 4, 14, 8, 3), P.sun, 1, 2.2).replace(/^/, '');
  return s;
}
const sparks = (pts) => pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFDC7A" stroke="${INK}" stroke-width="1.6"/>`).join('');
const look = (o) => ({ tunic: P.iron, sleeve: DARK, legs: DARK, boots: P.boot, hat: helm, overBody: plates,
  bodyExtra: `<path d="M56 160H144V182H56Z" fill="#7A3B5E"/>`, face: 'calm', mouth: MOUTH.grit, ...o });

const out = {};
const BASE = () => base(P.sun, false, '#C4623A');

reset('emb0');
out.idle = svg(`${LABEL}, on guard`, shadow() + BASE() +
  person(look({ backArm: [70, 112, 50, 150], frontArm: [130, 114, 150, 142],
    under: () => glaive(48, 214, 40, 30), held: () => shield(150, 142) })) +
  sparks([[36, -4, 2.4], [48, -14, 1.8]]));

reset('emb1');
out.march = svg(`${LABEL}, marching`, shadow() + BASE() +
  g('rotate(6 100 212)', person(look({ backArm: [72, 112, 56, 140], frontArm: [130, 114, 156, 136], legL: 22, legR: -20, face: 'effort',
    under: () => glaive(20, 190, 150, 40), held: () => shield(156, 136) }))) +
  line('M-40 120H-16M-50 140H-26M-40 160H-18', INK, 2.6, ' opacity="0.45"') + sparks([[200, 24, 2.4], [214, 36, 1.8]]));

reset('emb2');
out.victory = svg(`${LABEL}, cheering a victory`, jumpMarks(60) +
  g('translate(0 -14)', BASE() + person(look({ backArm: [72, 110, 54, 64], frontArm: [130, 112, 158, 120], face: 'happy', mouth: MOUTH.open,
    under: () => glaive(70, 150, 40, -20), held: () => shield(158, 120) }))) +
  sparks([[20, -40, 3], [60, -60, 2.4], [6, -10, 2]]) + star(-30, 80, 8) + star(220, 40, 6, '#2F9AA0') + star(200, 170, 6));

reset('emb3');
{
  const fallen = g('translate(10 8) rotate(-84 100 212)', person(look({ backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124], face: 'dizzy', mouth: MOUTH.wavy })));
  out.defeated = svg(`${LABEL}, knocked down`, shadow(110, 12, 104, 222, 0.22) + BASE() +
    glaive(120, 222, 250, 196, false) + fallen + g('rotate(-20 190 190)', shield(196, 186, false)) +
    puff(196, 150, 6) + puff(206, 136, 5) + dizzy(-20, 120));
}

reset('embi');
{
  const c = 'embi_clip';
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#B07720" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#FFDC7A" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
    `<path d="M2 44H46V50H2Z" fill="#C4623A" stroke="${INK}" stroke-width="2"/></g>` +
    `<ellipse cx="24" cy="29" rx="13" ry="14" fill="#665F57" stroke="${INK}" stroke-width="2.6"/><path d="M13.5 24A12 12 0 0 1 27 16" fill="none" stroke="#8F8A82" stroke-width="2.4"/>` +
    `<ellipse cx="24" cy="29" rx="10.4" ry="11.4" fill="none" stroke="#F2B33D" stroke-width="1.8"/>` +
    `<ellipse cx="24" cy="29" rx="6" ry="6.6" fill="#EE8443" stroke="${INK}" stroke-width="2"/><ellipse cx="23" cy="28" rx="3" ry="3.4" fill="#FFDC7A"/>` +
    `<path d="M18 29H30M24 22.4V35.6M19.8 24.5L28.2 33.5M28.2 24.5L19.8 33.5" fill="none" stroke="${INK}" stroke-width="1.5"/>` +
    `<path d="M22 21Q17 15 21 7Q23 12 26 11Q25 16 28 18Q27 21 22 21Z" fill="#EE8443" stroke="${INK}" stroke-width="2"/><path d="M23 20Q21 16 23 13Q24.5 16 26 17Q25 20 23 20Z" fill="#FFDC7A"/>` +
    [[24, 15.6], [24, 42.4], [13.6, 29], [34.4, 29]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#F2B33D" stroke="${INK}" stroke-width="1"/>`).join(''));
}
export default out;
