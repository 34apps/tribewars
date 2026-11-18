// Support rider (working name): the Stables' second rider, a fast defender sent to help allies.
// Same toy kit as originality-art/gen/elk-rider.mjs (elk body copied from there), but heavier and calmer:
// quilted plum barding + iron chest plate on the elk, a mail-shirted rider in a terracotta cloak with a big
// round bone shield (hearth emblem: stone hearth arch with a flame) and a short spear held upright. Teal base.
import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, base, shadow, svg, iconSvg, reset, person, MOUTH, setK, K } from '../../unit-figures/gen/lib.mjs';
import { dust, jumpMarks, dizzy } from '../../unit-figures/gen/siege.mjs';

const LABEL = 'Support Rider';
const E = {
  body: ['#B48662', '#3E2A1C', '#7E5A3E'],
  neck: ['#7A5438', '#22170F', '#55392A'],
  leg: ['#7E5A44', '#22170F', '#5E4232'],
  hoof: P.boot,
  ant: P.bone,
};
const RUMP = '#E9D3A8';

function leg(x, y, L, a, pal, rad) {
  const t = (a * Math.PI) / 180, fx = x - Math.sin(t) * L, fy = y + Math.cos(t) * L;
  return sh(cap(x, y, fx, fy, rad, rad * 0.85), pal, 2, 2.6) + sh(rr(fx - 8, fy - 2, 16, 8, 3), E.hoof, 1, 2.4);
}
/** Elk head (+ antlers, chamfron) in elk coordinates. */
function elkHead(o = {}) {
  let h = sh('M136 118C142 98 154 84 170 78L188 92C180 104 174 122 164 144Z', E.neck, 2.4);
  h += sh('M182 70C192 60 204 54 218 52L213 59L226 59L215 67L223 72C208 76 196 76 186 76Z', E.ant, 2, 2.4);
  h += sh('M166 74C172 64 188 64 196 72L218 96C224 104 218 113 209 111L196 109C186 105 176 96 168 88Z', E.body, 3);
  // iron chamfron along the nose, gold rivets
  h += sh('M188 79L206 92Q209 98 203 101L196 100L186 88Z', P.iron, 1.5, 2.2) +
    `<circle cx="192" cy="86" r="1.8" fill="#F2B33D" stroke="${INK}" stroke-width="${f(1.2 / K)}"/><circle cx="200" cy="94" r="1.8" fill="#F2B33D" stroke="${INK}" stroke-width="${f(1.2 / K)}"/>`;
  h += sh(ell(212, 104, 7, 6), E.neck, 1.5, 2.2);
  h += sh('M180 102Q186 122 177 128Q170 116 173 100Z', E.neck, 1.5, 2.2);
  h += sh('M168 74L152 62L171 66Z', E.body, 1.5, 2.2);
  h += o.eye === 'dizzy'
    ? line('M176 79L184 87M184 79L176 87', INK, 2.6)
    : o.eye === 'happy' ? line('M175 84Q180 78 185 84', INK, 2.6)
      : `<ellipse cx="180" cy="83" rx="3.4" ry="3.8" fill="${INK}"/><circle cx="179" cy="81.6" r="1.2" fill="#FFF8E8"/>` + line('M175 78L185 77', INK, 2);
  if (o.mouth) h += line('M200 109Q205 114 211 112', INK, 2.4);
  h += sh('M176 70C160 66 150 54 146 36L155 41L155 28L163 39L167 24L173 39L181 29L181 46C185 56 183 64 179 72Z', E.ant, 2.4, 2.4);
  return h;
}
/** The heavier elk, facing right, hooves on y 212. o.legs = [farBack, farFront, nearBack, nearFront]. */
function elk(o = {}) {
  const [fb, ff, nb, nf] = o.legs || [0, 0, 0, 0];
  let s = '';
  s += leg(62, 150, 54, fb, E.neck, 9.5) + leg(134, 150, 54, ff, E.neck, 9);
  s += sh('M46 124Q36 120 34 130Q38 136 46 134Z', E.neck, 1.5);
  s += sh('M42 140C40 118 56 106 74 106L118 104C130 92 152 92 162 104C172 118 170 152 160 166C152 176 122 178 100 178L70 178C50 178 43 162 42 140Z', E.body, 3, 2.6,
    `<ellipse cx="48" cy="140" rx="16" ry="30" fill="${RUMP}"/><path d="M128 98C146 92 166 104 168 130L150 128Z" fill="#55392A" opacity="0.45"/>`);
  // quilted barding with a scalloped hem and a gold trim
  s += sh('M70 106L134 102Q146 104 146 116L148 156Q140 166 130 160Q120 170 109 162Q98 170 88 162Q77 168 70 158Z', P.plum, 2.4, 2.4,
    `<path d="M70 150Q86 156 98 152Q110 158 122 152Q136 156 148 148" fill="none" stroke="#F2B33D" stroke-width="4"/>` +
    `<path d="M86 106L94 150M106 104L110 152M126 103L128 150M72 128Q108 122 146 126" fill="none" stroke="#4A213C" stroke-width="2" opacity="0.6"/>`);
  s += leg(74, 156, 52, nb, E.leg, 10) + leg(146, 156, 52, nf, E.leg, 9.5);
  const h = elkHead(o);
  s += o.head ? g(o.head, h) : h;
  // iron chest plate with a gold rim, over the base of the neck
  s += sh('M150 116Q176 124 170 156L158 158Q162 134 146 124Z', P.iron, 1.5, 2.4, `<path d="M151 120Q172 128 167 154" fill="none" stroke="#F2B33D" stroke-width="2.4"/>`);
  return s;
}

/** Round iron cap with a gold band, a bone fur rim and a small teal plume (calm, not a great helm). */
const helm = () =>
  sh('M96 26Q104 8 116 14Q108 20 106 30Z', P.teal, 1.5, 2.4) +
  sh('M64 60C62 34 80 20 100 20C120 20 138 34 136 60Z', P.iron, 3,  2.6, `<path d="M100 22V58" fill="none" stroke="#F2B33D" stroke-width="5"/>`) +
  sh(rr(58, 48, 84, 16, 8), P.bone, 2) + line('M74 54h4M90 56h4M108 56h4M124 54h4', '#C6AF88', 2);
/** Mail-shirt texture + teal sash, clipped in the body. */
const MAIL = `<path d="M60 116Q100 124 140 116M60 130Q100 138 140 130M60 144Q100 152 140 144" fill="none" stroke="#665F57" stroke-width="2" opacity="0.5"/><path d="M64 120L136 150" fill="none" stroke="#2F9AA0" stroke-width="10"/>`;

/** The hearth shield: big round bone shield, gold rim, a stone hearth arch with a flame inside. Person units. */
function shield(cx, cy, r = 40, lit = true) {
  const k = r / 40, X = (x) => f(cx + x * k), Y = (y) => f(cy + y * k), T = (x, y) => `${X(x)} ${Y(y)}`, w = (n) => f(n / K);
  let s = sh(ell(cx, cy, r, r), P.bone, 3, 2.8) +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 5 * k)}" fill="none" stroke="#F2B33D" stroke-width="${w(3.4)}"/>`;
  s += sh(`M${T(-22, 20)}L${T(-22, -2)}C${T(-22, -27)} ${T(22, -27)} ${T(22, -2)}L${T(22, 20)}Z`, P.terra, 2, 2.4);
  s += fill(`M${T(-12, 20)}L${T(-12, 0)}C${T(-12, -14)} ${T(12, -14)} ${T(12, 0)}L${T(12, 20)}Z`, '#4A2C18', 2.2);
  s += line(`M${T(-22, 6)}H${X(-12)}M${T(12, 6)}H${X(22)}M${T(-18, -15)}L${T(-10, -8)}M${T(18, -15)}L${T(10, -8)}M${T(0, -24)}V${Y(-13)}`, '#843A23', 2);
  if (lit) {
    s += fill(`M${T(0, -9)}Q${T(10, 4)} ${T(8, 18)}L${T(-8, 18)}Q${T(-10, 4)} ${T(0, -9)}Z`, '#EE8443', 2) +
      fill(`M${T(0, 3)}Q${T(5, 10)} ${T(3.5, 18)}L${T(-3.5, 18)}Q${T(-5, 10)} ${T(0, 3)}Z`, '#FFDC7A');
  }
  s += sh(`M${T(-27, 17)}H${X(27)}V${Y(25)}H${X(-27)}Z`, P.stone, 1.5, 2.2);
  for (const [dx, dy] of [[0, -33], [-33, 0], [33, 0]]) s += `<circle cx="${X(dx)}" cy="${Y(dy)}" r="${f(2.8 * k)}" fill="#F2B33D" stroke="${INK}" stroke-width="${w(1.6)}"/>`;
  return s;
}
/** The hearth shield drawn straight in icon units (48 box): fewer lines so it reads at 32 px. */
function iconShield(cx, cy, r) {
  const T = (x, y) => `${f(cx + x)} ${f(cy + y)}`;
  return `<ellipse cx="${f(cx)}" cy="${f(cy + 1.2)}" rx="${r}" ry="${r}" fill="#C6AF88" stroke="${INK}" stroke-width="2.6"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="#F1E1C2" stroke="${INK}" stroke-width="2.6"/><path d="M${T(-r + 2.6, -1)}A${r - 2.6} ${r - 2.6} 0 0 1 ${T(1, -r + 2.6)}" fill="none" stroke="#FFF8E8" stroke-width="2.2"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 2.4)}" fill="none" stroke="#F2B33D" stroke-width="1.6"/>` +
    `<path d="M${T(-7.5, 6)}V${f(cy - 0.5)}C${T(-7.5, -9.5)} ${T(7.5, -9.5)} ${T(7.5, -0.5)}V${f(cy + 6)}Z" fill="#C4623A" stroke="${INK}" stroke-width="2"/>` +
    `<path d="M${T(-3.8, 6)}V${f(cy)}C${T(-3.8, -4.6)} ${T(3.8, -4.6)} ${T(3.8, 0)}V${f(cy + 6)}Z" fill="#4A2C18"/>` +
    `<path d="M${T(0, -3.6)}Q${T(4, 1.5)} ${T(3, 6)}H${f(cx - 3)}Q${T(-4, 1.5)} ${T(0, -3.6)}Z" fill="#EE8443" stroke="${INK}" stroke-width="1.4"/><path d="M${T(0, 0.6)}Q${T(1.8, 3.6)} ${T(1.3, 6)}H${f(cx - 1.3)}Q${T(-1.8, 3.6)} ${T(0, 0.6)}Z" fill="#FFDC7A"/>` +
    `<path d="M${T(-9.5, 5.5)}H${f(cx + 9.5)}V${f(cy + 8.6)}H${f(cx - 9.5)}Z" fill="#9C9588" stroke="${INK}" stroke-width="1.6"/>`;
}
/** Short spear from butt (x1,y1) to the socket (x2,y2); broad leaf point beyond it. */
function spear(x1, y1, x2, y2, broken = false) {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
  let s = sh(cap(x1, y1, x2, y2, 4.4), P.wood, 1.5, 2.4);
  if (broken) return s;
  const tx = x2 + ux * 34, ty = y2 + uy * 34, mx = x2 + ux * 12, my = y2 + uy * 12;
  s += sh(`M${f(x2)} ${f(y2)}Q${f(mx + nx * 12)} ${f(my + ny * 12)} ${f(tx)} ${f(ty)}Q${f(mx - nx * 12)} ${f(my - ny * 12)} ${f(x2)} ${f(y2)}Z`, P.iron, 1.5, 2.4);
  s += fill(`M${f(x2 - ux * 2 + nx * 6)} ${f(y2 - uy * 2 + ny * 6)}L${f(x2 - ux * 2 - nx * 6)} ${f(y2 - uy * 2 - ny * 6)}`, 'none', 0, ` stroke="#2F9AA0" stroke-width="6"`);
  return s;
}
const cloakSit = () => sh('M74 100C52 120 36 160 22 196Q40 206 58 198Q74 206 92 194L120 104Z', P.terra, 3,  2.6, `<path d="M30 190Q44 196 56 190" fill="none" stroke="#F2B33D" stroke-width="4"/>`);
const cloakFly = () => sh('M74 100C46 108 18 120 -8 132Q0 146 12 146Q8 160 24 162Q30 176 46 170L118 106Z', P.terra, 3, 2.6);
const clasp = () => `<circle cx="80" cy="108" r="6" fill="#F2B33D" stroke="${INK}" stroke-width="${f(2.4 / K)}"/>`;

const RS = 0.64;
function rider(hx, hy, o, extraT = '') {
  setK(RS);
  const s = g(`translate(${f(hx - 100 * RS)} ${f(hy - 166 * RS)}) scale(${RS})${extraT ? ' ' + extraT : ''}`,
    person({ tunic: P.iron, sleeve: P.iron, legs: P.hair, boots: P.boot, hat: helm, face: 'calm', legL: -48, legR: -38,
      bodyExtra: MAIL, overBody: clasp, ...o }));
  setK(1);
  return s;
}
const BASE = () => base(P.teal, true, '#F2B33D');
const out = {};

reset('spr0');
out.idle = svg(`${LABEL}, on guard`, shadow(88, 17) + BASE() + elk({ head: 'rotate(-3 150 120)' }) +
  rider(100, 112, { backArm: [74, 112, 62, 96], frontArm: [126, 114, 140, 140], mouth: MOUTH.smile,
    under: () => cloakSit() + spear(60, 196, 62, 30), held: () => shield(140, 146, 40) }));

reset('spr1');
out.march = svg(`${LABEL}, riding to help`, shadow(88, 17) + BASE() + g('translate(0 -4)',
  elk({ legs: [-18, 22, 16, -24], head: 'rotate(4 150 120)' }) +
  rider(102, 110, { backArm: [74, 112, 64, 100], frontArm: [126, 114, 144, 136], face: 'calm', mouth: MOUTH.smile,
    under: () => cloakFly() + spear(52, 194, 70, 30), held: () => shield(144, 142, 40) }, 'rotate(4 100 166)')) +
  dust(30, 206, 0.8) + dust(62, 210, 0.55) + line('M-46 110H-18M-56 132H-26M-46 154H-20', INK, 2.6, ' opacity="0.45"'));

reset('spr2');
out.victory = svg(`${LABEL}, cheering a victory`, jumpMarks() +
  g('rotate(-7 66 208)', elk({ legs: [2, -24, 0, -36], mouth: true, eye: 'happy', head: 'rotate(-8 150 120)' }) +
    rider(98, 108, { backArm: [74, 110, 64, 58], frontArm: [126, 112, 146, 128], face: 'happy', mouth: MOUTH.open,
      under: () => cloakSit() + spear(66, 120, 62, -40), held: () => shield(146, 132, 40) })) +
  star(-30, 60, 8) + star(230, 30, 6, '#2F9AA0') + star(214, 150, 7) + star(-14, 150, 5));

reset('spr3');
{
  const body = elk({ legs: [-78, 76, -84, 82], eye: 'dizzy', head: 'rotate(24 150 120)' });
  setK(0.6);
  const fallen = g('translate(128 216) rotate(84) scale(0.6) translate(-100 -212)', person({ tunic: P.iron, sleeve: P.iron, legs: P.hair, boots: P.boot, hat: helm, face: 'dizzy', mouth: MOUTH.wavy,
    bodyExtra: MAIL, under: cloakSit, backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124] }));
  setK(1);
  out.defeated = svg(`${LABEL}, knocked down`, shadow(116, 13, 112, 224, 0.22) + BASE() +
    g('rotate(-16 -36 196)', shield(-36, 194, 27, false)) + g('translate(-14 40)', body) + spear(-6, 228, 56, 214, true) + fallen +
    dizzy(236, 156));
}

reset('spri');
{
  const c = 'spri_clip';
  setK(0.24);
  const head = g('translate(-15 3) scale(0.24)', elkHead());
  const sd = iconShield(17.5, 29.5, 13.6);
  setK(1);
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#1A646B" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#7AD3CD" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
    `<path d="M2 44H46V50H2Z" fill="#2F9AA0" stroke="${INK}" stroke-width="2"/>` + head + `</g>` + sd);
}
export default out;
