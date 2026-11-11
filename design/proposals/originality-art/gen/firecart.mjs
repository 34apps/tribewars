import { base, shadow, svg, iconSvg, reset, MOUTH, setK } from '../../unit-figures/gen/lib.mjs';
import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, wheel, dust, crew, toCrew, jumpMarks, dizzy, puff } from '../../unit-figures/gen/siege.mjs';

const LABEL = 'Firecart';

function tongue(x, y, h, w = h * 0.42) {
  return fill(`M${f(x)} ${f(y - h)}Q${f(x + w * 1.4)} ${f(y - h * 0.35)} ${f(x + w)} ${f(y)}L${f(x - w)} ${f(y)}Q${f(x - w * 1.4)} ${f(y - h * 0.4)} ${f(x)} ${f(y - h)}Z`, '#EE8443', 2.4) +
    fill(`M${f(x)} ${f(y - h * 0.55)}Q${f(x + w * 0.7)} ${f(y - h * 0.2)} ${f(x + w * 0.45)} ${f(y)}L${f(x - w * 0.45)} ${f(y)}Q${f(x - w * 0.7)} ${f(y - h * 0.2)} ${f(x)} ${f(y - h * 0.55)}Z`, '#FFDC7A');
}
const fire = (k = 1) => tongue(134, 108, 34 * k) + tongue(166, 108, 28 * k) + tongue(150, 106, 48 * k, 16 * k);
const smoke = () => puff(120, 40, 7) + puff(108, 22, 9) + puff(122, 4, 6);

/** The cart: bed, side boards with iron bands, the iron fire pot, a burning log poking forward, push shafts. */
function cart(o = {}) {
  const rot = o.rot || 0;
  let s = '';
  s += sh(cap(92, 168, 30, 142, 4.2), P.wood, 1.5, 2.4); // push shaft
  s += sh(rr(82, 160, 124, 14, 5), P.wood, 2, 2.6);
  s += sh(rr(86, 130, 116, 32, 4), P.wood, 2, 2.6, `<path d="M86 146H202" fill="none" stroke="#714B29" stroke-width="2" opacity="0.6"/>`);
  s += sh(rr(100, 128, 9, 36, 2), P.iron, 1, 2.2) + sh(rr(178, 128, 9, 36, 2), P.iron, 1, 2.2);
  // fire pot
  if (o.lit !== false) s += fire(o.big || 1);
  s += sh('M116 108Q116 140 150 140Q184 140 184 108Z', P.iron, 2.6, 2.6) + sh(rr(110, 100, 80, 12, 6), P.iron, 1.5, 2.4);
  s += `<ellipse cx="150" cy="104" rx="32" ry="3.4" fill="${o.lit === false ? '#3B3632' : '#B5462A'}"/>`;
  s += sh(cap(176, 104, 230, 82, 7), P.wood, 1.5, 2.4) + `<ellipse cx="230" cy="82" rx="5" ry="7" fill="#EE8443" stroke="${INK}" stroke-width="2.4" transform="rotate(-22 230 82)"/>`;
  if (o.lit !== false) s += tongue(236, 78, 18);
  s += wheel(112, 190, 19, rot) + (o.front === false ? '' : wheel(178, 190, 19, rot));
  return s;
}
const MS = 1.12;
/** The cart drawn 12% up (strokes kept at house weight). */
const M = (o) => { setK(MS); const s = g(`translate(-8 -25) scale(${MS})`, cart(o)); setK(1); return s; };
const out = {};
const BASE = () => base(P.terra, true);
const look = { tunic: P.terra, bodyExtra: `<path d="M64 128Q100 136 136 128" fill="none" stroke="#843A23" stroke-width="2.4" opacity="0.6"/>` };

reset('fic0');
out.idle = svg(`${LABEL}, standing ready`, shadow(88, 17, 112) + BASE() + smoke() + M() +
  g('translate(18 -4)', crew(36, { ...look, backArm: [78, 112, 60, 146], frontArm: [122, 112, ...toCrew(36, 26, 136)] })) +
  crew(10, { backArm: [78, 112, 60, 146], frontArm: [122, 112, ...toCrew(10, 34, 138)] }));

reset('fic1');
out.march = svg(`${LABEL}, marching`, shadow(88, 17, 112) + BASE() + g('translate(-6 0)', smoke() + M({ rot: 22 })) + dust(100, 206, 1) + dust(176, 208, 0.8) +
  g('translate(18 -4)', crew(30, { ...look, backArm: [80, 112, 150, 132], frontArm: [122, 114, 156, 118], legL: 22, legR: -16, face: 'effort', mouth: MOUTH.grit }, 'rotate(16 100 212)')) +
  crew(4, { backArm: [80, 112, 150, 132], frontArm: [122, 114, 156, 118], legL: -16, legR: 22, face: 'effort', mouth: MOUTH.grit }, 'rotate(16 100 212)') +
  line('M-46 150H-24M-56 168H-32M-44 186H-22', INK, 2.6, ' opacity="0.45"'));

reset('fic2');
out.victory = svg(`${LABEL}, cheering a victory`, jumpMarks() +
  g('translate(0 -16)', BASE() + smoke() + M({ big: 1.25 }) +
    g('translate(18 -4)', crew(36, { ...look, backArm: [77, 110, 60, 66], frontArm: [123, 110, 140, 62], face: 'happy', mouth: MOUTH.open })) +
    crew(8, { backArm: [77, 110, 60, 66], frontArm: [123, 110, 140, 62], face: 'happy', mouth: MOUTH.open })) +
  star(-36, 90, 8) + star(220, 20, 6, '#2F9AA0') + star(250, 120, 6) +
  `<circle cx="196" cy="40" r="3" fill="#FFDC7A" stroke="${INK}" stroke-width="1.8"/><circle cx="176" cy="20" r="2.2" fill="#FFDC7A" stroke="${INK}" stroke-width="1.6"/>`);

reset('fic3');
{
  setK(1);
  const body = g('rotate(10 112 208)', M({ lit: false }));
  // the second crewman sits dazed in front of the cart, legs out
  const sitter = g('translate(0 34)', crew(206, { ...look, legL: -84, legR: -74, backArm: [78, 112, 64, 150], frontArm: [122, 112, 140, 150], face: 'dizzy', mouth: MOUTH.wavy }));
  out.defeated = svg(`${LABEL}, broken down`, shadow(128, 12, 104, 222, 0.22) + BASE() + body +
    puff(160, 70, 8) + puff(176, 52, 6) + puff(150, 52, 5) + sitter + dizzy(206, 66) +
    g('translate(10 6) rotate(-84 100 212)', crew(100, { ...look, backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124], face: 'dizzy', mouth: MOUTH.wavy })) +
    dizzy(-14, 132));
}

reset('fici');
{
  const c = 'fici_clip';
  const t = (x, y, h, w = h * 0.42) => `<path d="M${f(x)} ${f(y - h)}Q${f(x + w * 1.4)} ${f(y - h * 0.35)} ${f(x + w)} ${f(y)}L${f(x - w)} ${f(y)}Q${f(x - w * 1.4)} ${f(y - h * 0.4)} ${f(x)} ${f(y - h)}Z" fill="#EE8443" stroke="${INK}" stroke-width="2"/>` +
    `<path d="M${f(x)} ${f(y - h * 0.55)}Q${f(x + w * 0.7)} ${f(y - h * 0.2)} ${f(x + w * 0.45)} ${f(y)}L${f(x - w * 0.45)} ${f(y)}Z" fill="#FFDC7A"/>`;
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#843A23" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#EF9C6E" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})"><path d="M2 44H46V50H2Z" fill="#B07D46" stroke="${INK}" stroke-width="2"/></g>` +
    t(18, 24, 11) + t(30, 24, 9) + t(24, 23, 15, 5.5) +
    `<path d="M11 24Q11 35 24 35Q37 35 37 24Z" fill="#A39E94" stroke="${INK}" stroke-width="2.4"/><path d="M14 27Q16 32 22 33" fill="none" stroke="#E0DCD3" stroke-width="1.8"/>` +
    `<rect x="9" y="21" width="30" height="5" rx="2.5" fill="#A39E94" stroke="${INK}" stroke-width="2.2"/>` +
    `<circle cx="16" cy="39" r="5" fill="#A39E94" stroke="${INK}" stroke-width="2.2"/><circle cx="16" cy="39" r="1.8" fill="#F2B33D" stroke="${INK}" stroke-width="1.2"/>` +
    `<circle cx="32" cy="39" r="5" fill="#A39E94" stroke="${INK}" stroke-width="2.2"/><circle cx="32" cy="39" r="1.8" fill="#F2B33D" stroke="${INK}" stroke-width="1.2"/>`);
}
export default out;
