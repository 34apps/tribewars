import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, base, shadow, svg, iconSvg, reset, person, MOUTH, setK } from '../../unit-figures/gen/lib.mjs';
import { dust, jumpMarks, dizzy } from '../../unit-figures/gen/siege.mjs';

const LABEL = 'Elk Rider';
const E = {
  body: ['#C08A58', '#4A2C18', '#8B5835'],
  neck: ['#8A5A36', '#2E1F18', '#5B371F'],
  leg: ['#8C6248', '#2E1F18', '#6B4A36'],
  hoof: P.boot,
  ant: P.bone,
};
const RUMP = '#E9D3A8';

/** Leg from hip (x, y) of length L, rotated a degrees (positive swings the foot back), radius rr. */
function leg(x, y, L, a, pal, rad, hoofT = '') {
  const t = (a * Math.PI) / 180, fx = x - Math.sin(t) * L, fy = y + Math.cos(t) * L;
  return sh(cap(x, y, fx, fy, rad, rad * 0.8), pal, 2, 2.6) + sh(rr(fx - 7, fy - 2, 14, 8, 3), E.hoof, 1, 2.4);
}
/**
 * The big toy elk, facing right, hooves on y 212. o.legs = [farBack, farFront, nearBack, nearFront] swing angles,
 * o.cloth = saddle-cloth palette, o.mouth adds an open mouth, o.head = transform of the head + antlers.
 */
function elk(o = {}) {
  const [fb, ff, nb, nf] = o.legs || [0, 0, 0, 0];
  let s = '';
  s += leg(62, 150, 54, fb, E.neck, 8) + leg(134, 150, 54, ff, E.neck, 7.5);
  s += sh('M46 124Q36 120 34 130Q38 136 46 134Z', E.neck, 1.5);
  s += sh('M44 140C42 120 56 110 74 110L118 108C130 96 150 94 160 106C170 118 168 150 158 164C150 174 122 174 100 174L70 174C52 174 45 160 44 140Z', E.body, 3, 2.6,
    `<ellipse cx="50" cy="140" rx="16" ry="30" fill="${RUMP}"/><path d="M128 102C146 96 164 106 166 130L150 128Z" fill="#5B371F" opacity="0.45"/>`);
  if (o.cloth) s += sh('M84 108L128 106L132 146Q108 152 84 148Z', o.cloth, 2, 2.4, `<path d="M84 141Q108 146 132 139" fill="none" stroke="#F2B33D" stroke-width="4"/>`);
  s += leg(74, 154, 52, nb, E.leg, 8.5) + leg(146, 154, 52, nf, E.leg, 8);
  let h = sh('M138 116C144 98 156 84 170 78L186 92C178 104 172 122 162 142Z', E.neck, 2.4);
  h += sh('M182 70C192 60 204 54 218 52L213 59L226 59L215 67L223 72C208 76 196 76 186 76Z', E.ant, 2, 2.4);
  h += sh('M166 74C172 64 188 64 196 72L218 96C224 104 218 113 209 111L196 109C186 105 176 96 168 88Z', E.body, 3);
  h += sh(ell(212, 104, 7, 6), E.neck, 1.5, 2.2);
  h += sh('M180 102Q186 122 177 128Q170 116 173 100Z', E.neck, 1.5, 2.2);
  h += sh('M168 74L152 62L171 66Z', E.body, 1.5, 2.2);
  h += o.eye === 'dizzy'
    ? line('M181 79L189 87M189 79L181 87', INK, 2.6)
    : `<ellipse cx="185" cy="83" rx="3.6" ry="4.2" fill="${INK}"/><circle cx="184" cy="81.5" r="1.3" fill="#FFF8E8"/>`;
  if (o.mouth) h += line('M200 109Q205 114 211 112', INK, 2.4);
  h += sh('M176 70C160 66 150 54 146 36L155 41L155 28L163 39L167 24L173 39L181 29L181 46C185 56 183 64 179 72Z', o.goldAnt ? P.sun : E.ant, 2.4, 2.4);
  s += o.head ? g(o.head, h) : h;
  return s;
}
const fur = () =>
  sh('M64 58C62 32 80 18 100 18C120 18 138 32 136 58Z', P.terra, 3) +
  sh(rr(58, 46, 84, 16, 8), P.bone, 2) + line('M74 52h4M90 54h4M108 54h4M124 52h4', '#C6AF88', 2);
const spear = (x1, y1, x2, y2) => {
  const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  const tx = x2 + ux * 22, ty = y2 + uy * 22, nx = -uy, ny = ux;
  return sh(cap(x1, y1, x2, y2, 3.6), P.wood, 1.5, 2.4) +
    sh(`M${f(x2 + nx * 6)} ${f(y2 + ny * 6)}L${f(tx)} ${f(ty)}L${f(x2 - nx * 6)} ${f(y2 - ny * 6)}Z`, P.iron, 1.5, 2.4) +
    fill(`M${f(x2 - ux * 4 + nx * 5)} ${f(y2 - uy * 4 + ny * 5)}L${f(x2 - ux * 4 - nx * 5)} ${f(y2 - uy * 4 - ny * 5)}`, 'none', 0, ` stroke="#2F9AA0" stroke-width="5"`);
};
const RS = 0.6;
/** The rider, seated: person() scaled, hips at world (hx, hy). o: person options. */
function rider(hx, hy, o, extraT = '') {
  setK(RS);
  const s = g(`translate(${f(hx - 100 * RS)} ${f(hy - 166 * RS)}) scale(${RS})${extraT ? ' ' + extraT : ''}`,
    person({ tunic: P.moss, sleeve: P.moss, legs: P.hair, boots: P.boot, hat: fur, face: 'calm', legL: -48, legR: -38,
      bodyExtra: `<path d="M64 120L136 150" fill="none" stroke="#2F9AA0" stroke-width="10"/>`, ...o }));
  setK(1);
  return s;
}
/** World -> rider-local point. */
const RL = (hx, hy, x, y) => [f((x - (hx - 100 * RS)) / RS), f((y - (hy - 166 * RS)) / RS)].map(Number);

const out = {};
const BASE = () => base(P.moss, true);
/** Spear in rider-local units, through the front hand (hx, hy), from t0 behind to t1 ahead along direction a (deg). */
const held = (hx, hy, a, t0, t1) => () => {
  const r = (a * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
  return spear(hx - dx * t0, hy - dy * t0, hx + dx * t1, hy + dy * t1);
};

reset('elk0');
out.idle = svg(`${LABEL}, on guard`, shadow(88, 17) + BASE() + elk({ cloth: P.teal }) +
  rider(100, 116, { backArm: [76, 112, 60, 150], frontArm: [124, 112, 150, 128], held: held(150, 128, -84, 120, 170) }));

reset('elk1');
out.march = svg(`${LABEL}, marching`, shadow(88, 17) + BASE() + g('translate(0 -6)',
  elk({ cloth: P.teal, legs: [-26, 30, 24, -34], head: 'rotate(8 150 120)' }) +
  rider(104, 114, { backArm: [78, 112, 60, 146], frontArm: [124, 112, 152, 126], face: 'effort', mouth: MOUTH.grit, held: held(152, 126, -12, 110, 120) }, 'rotate(10 100 166)')) +
  dust(34, 204, 1) + dust(70, 210, 0.7) + line('M-40 120H-14M-52 140H-24M-40 160H-16', INK, 2.6, ' opacity="0.45"'));

reset('elk2');
out.victory = svg(`${LABEL}, cheering a victory`, jumpMarks() +
  g('rotate(-14 66 208)', elk({ cloth: P.teal, legs: [4, -40, 0, -56], mouth: true, head: 'rotate(-6 150 120)' }) +
    rider(96, 110, { backArm: [76, 110, 60, 68], frontArm: [124, 110, 140, 62], face: 'happy', mouth: MOUTH.open, held: held(140, 62, -80, 90, 150) })) +
  star(-30, 60, 8) + star(230, 30, 6, '#2F9AA0') + star(210, 140, 7) + star(-10, 150, 5));

reset('elk3');
{
  // the elk slumped down with its legs tucked, the rider thrown off in front, the spear snapped
  const body = elk({ cloth: P.teal, legs: [-78, 76, -84, 82], eye: 'dizzy', head: 'rotate(24 150 120)' });
  setK(0.6);
  const fallen = g('translate(132 216) rotate(84) scale(0.6) translate(-100 -212)', person({ tunic: P.moss, sleeve: P.moss, legs: P.hair, boots: P.boot, hat: fur, face: 'dizzy', mouth: MOUTH.wavy,
    backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124] }));
  setK(1);
  out.defeated = svg(`${LABEL}, knocked down`, shadow(110, 13, 112, 224, 0.22) + BASE() +
    g('translate(-14 40)', body) + spear(-34, 214, 40, 196) + sh(cap(170, 220, 236, 204, 3.6), P.wood, 1.5, 2.4) + fallen +
    dizzy(236, 156));
}
reset('elki');
{
  const c = 'elki_clip';
  setK(0.26);
  const head = g('translate(-23.3 5.4) scale(0.26)', (() => {
    let h = sh('M182 70C192 60 204 54 218 52L213 59L226 59L215 67L223 72C208 76 196 76 186 76Z', E.ant, 2, 2.4);
    h += sh('M138 116C144 98 156 84 170 78L186 92C178 104 172 122 162 142Z', E.neck, 2.4);
    h += sh('M166 74C172 64 188 64 196 72L218 96C224 104 218 113 209 111L196 109C186 105 176 96 168 88Z', E.body, 3);
    h += sh(ell(212, 104, 7, 6), E.neck, 1.5, 2.2) + sh('M168 74L152 62L171 66Z', E.body, 1.5, 2.2);
    h += `<ellipse cx="185" cy="83" rx="3.6" ry="4.2" fill="${INK}"/><circle cx="184" cy="81.5" r="1.3" fill="#FFF8E8"/>`;
    h += sh('M176 70C160 66 150 54 146 36L155 41L155 28L163 39L167 24L173 39L181 29L181 46C185 56 183 64 179 72Z', E.ant, 2.4, 2.4);
    return h;
  })());
  setK(1);
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#3A5E27" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#A6C964" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
    `<path d="M2 44H46V50H2Z" fill="#5E8C3A" stroke="${INK}" stroke-width="2"/>` + head + `</g>`);
}
export default out;
