// Mounted Pathfinder, Hearthwarden and Ember Guard (owner 2026-11-20: every rider trains at the Stables).
// Same toy library and elk drawing as the Elk Rider (design/proposals/originality-art/gen/elk-rider.mjs), parameterised.
// node build.mjs [pathfinder|hearthwarden|ember-guard ...]  ->  apps/web/src/art/units/<unit>-<pose>.svg and icon/<unit>.svg
import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, shadow, svg, iconSvg, reset, person, MOUTH, setK } from '../../unit-figures/gen/lib.mjs';
import { dust, jumpMarks, dizzy, puff } from '../../unit-figures/gen/siege.mjs';

const IRONDK = ['#8F8A82', '#3B3632', '#665F57']; // blackened iron
const EMBER = P.flame;

/** Round toy base like lib.base() with a free width. */
let BN = 0, BP = 'mb';
function baseW(pal, rx, ring) {
  const ry = 15, x0 = 100 - rx, x1 = 100 + rx;
  const d = `M${x0} 210L${x0} 220A${rx} ${ry} 0 0 0 ${x1} 220L${x1} 210A${rx} ${ry} 0 0 1 ${x0} 210Z`;
  const c = `${BP}${BN++}`;
  const [l, k, m] = pal;
  return `<defs><clipPath id="${c}"><path d="${d}"/></clipPath></defs><g clip-path="url(#${c})"><path d="${d}" fill="${k}"/><rect x="${x0 - 1}" y="195" width="${f(rx * 0.95)}" height="42" fill="${m}"/></g><path d="${d}" fill="none" stroke="${INK}" stroke-width="2.6"/><ellipse cx="100" cy="210" rx="${rx}" ry="${ry}" fill="${l}" stroke="${INK}" stroke-width="2.6"/><ellipse cx="${f(100 - rx * 0.12)}" cy="${f(210 - ry * 0.12)}" rx="${f(rx * 0.72)}" ry="${f(ry * 0.6)}" fill="none" stroke="${ring || m}" stroke-width="${ring ? 2.6 : 2}"/>`;
}

/** A flame tongue rising from (x, y), h tall. */
function tongue(x, y, h) {
  const w = h * 0.42;
  return fill(`M${f(x)} ${f(y - h)}Q${f(x + w * 1.4)} ${f(y - h * 0.35)} ${f(x + w)} ${f(y)}L${f(x - w)} ${f(y)}Q${f(x - w * 1.4)} ${f(y - h * 0.4)} ${f(x)} ${f(y - h)}Z`, '#EE8443', 2.2) +
    fill(`M${f(x)} ${f(y - h * 0.55)}Q${f(x + w * 0.7)} ${f(y - h * 0.2)} ${f(x + w * 0.45)} ${f(y)}L${f(x - w * 0.45)} ${f(y)}Q${f(x - w * 0.7)} ${f(y - h * 0.2)} ${f(x)} ${f(y - h * 0.55)}Z`, '#FFDC7A');
}

/**
 * The toy mount, facing right, hooves on y 212. E = palette, o.legs = [farBack, farFront, nearBack, nearFront] swing,
 * o.cloth = saddle cloth palette (o.long = long caparison), o.pony = no antlers (ears, mane, tail), o.armor = iron barding.
 */
function mount(E, o = {}) {
  const [fb, ff, nb, nf] = o.legs || [0, 0, 0, 0];
  const lr = o.pony ? 0.8 : 1;
  const leg = (x, y, L, a, pal, rad) => {
    const t = (a * Math.PI) / 180, fx = x - Math.sin(t) * L, fy = y + Math.cos(t) * L;
    return sh(cap(x, y, fx, fy, rad * lr, rad * lr * 0.8), pal, 2, 2.6) + sh(rr(fx - 7 * lr, fy - 2, 14 * lr, 8, 3), P.boot, 1, 2.4);
  };
  let s = '';
  s += leg(62, 150, 54, fb, E.neck, 8) + leg(134, 150, 54, ff, E.neck, 7.5);
  if (o.pony) {
    const w = o.tailSwing || 0;
    s += sh(`M48 122C30 ${112 + w} 12 ${120 + w} 8 ${150 + w}C18 ${142 + w} 30 ${146 + w} 38 ${140 + w}C32 ${134 + w} 40 ${132 + w} 48 134Z`, E.mane, 2, 2.4);
  } else s += sh('M46 124Q36 120 34 130Q38 136 46 134Z', E.neck, 1.5);
  s += sh('M44 140C42 120 56 110 74 110L118 108C130 96 150 94 160 106C170 118 168 150 158 164C150 174 122 174 100 174L70 174C52 174 45 160 44 140Z', E.body, 3, 2.6,
    `<ellipse cx="50" cy="140" rx="16" ry="30" fill="${E.rump}"/><path d="M128 102C146 96 164 106 166 130L150 128Z" fill="${E.neck[2]}" opacity="0.45"/>`);
  if (o.cloth) {
    const d = o.long ? 'M80 108L130 106L138 150L132 192Q106 200 80 192L74 150Z' : 'M84 108L128 106L132 146Q108 152 84 148Z';
    s += sh(d, o.cloth, 2, 2.4, `<path d="M${o.long ? 76 : 84} ${o.long ? 184 : 141}Q106 ${o.long ? 192 : 146} ${o.long ? 134 : 132} ${o.long ? 182 : 139}" fill="none" stroke="#F2B33D" stroke-width="4"/>`);
  }
  s += leg(74, 154, 52, nb, E.leg, 8.5) + leg(146, 154, 52, nf, E.leg, 8);
  if (o.armor) {
    // iron plates over the shoulder and chest, rivets in gold
    s += sh('M138 112C150 100 166 108 168 134C160 150 148 156 138 150Z', IRONDK, 2, 2.4) +
      line('M142 122Q154 118 162 126M142 136Q154 132 164 140', '#F2B33D', 2.6);
  }
  let h = sh('M138 116C144 98 156 84 170 78L186 92C178 104 172 122 162 142Z', E.neck, 2.4);
  if (o.armor) h += sh('M142 114C148 100 158 88 168 82L180 94C174 104 168 120 160 136Z', IRONDK, 1.5, 2.2) + line('M150 106L166 120M156 94L172 106', '#F2B33D', 2.4);
  if (o.pony) h += sh('M168 72C158 74 148 84 142 98C138 106 136 114 136 122L147 116L143 110L152 106L150 98L158 94L158 86L166 84Z', E.mane, 1.5, 2.2);
  else h += sh('M182 70C192 60 204 54 218 52L213 59L226 59L215 67L223 72C208 76 196 76 186 76Z', E.ant, 2, 2.4);
  h += sh('M166 74C172 64 188 64 196 72L218 96C224 104 218 113 209 111L196 109C186 105 176 96 168 88Z', E.body, 3);
  if (o.armor) h += sh('M170 73C176 66 188 66 195 73L217 96L205 101C192 96 178 88 171 80Z', IRONDK, 1.5, 2.2) + line('M178 74L208 98', '#F2B33D', 2.6) +
    fill('M176 60L172 74L182 70Z', EMBER, 2) ;
  h += sh(ell(212, 104, 7, 6), E.neck, 1.5, 2.2);
  h += sh('M180 102Q186 122 177 128Q170 116 173 100Z', E.neck, 1.5, 2.2);
  h += o.pony
    ? sh('M170 74L164 48L184 68Z', E.body, 1.5, 2.2) + sh('M164 76L152 54L172 68Z', E.neck, 1.5, 2.2)
    : sh('M168 74L152 62L171 66Z', E.body, 1.5, 2.2);
  h += o.eye === 'dizzy'
    ? line('M181 79L189 87M189 79L181 87', INK, 2.6)
    : `<ellipse cx="185" cy="83" rx="3.6" ry="4.2" fill="${INK}"/><circle cx="184" cy="81.5" r="1.3" fill="#FFF8E8"/>`;
  if (o.mouth) h += line('M200 109Q205 114 211 112', INK, 2.4);
  if (!o.pony) h += sh('M176 70C160 66 150 54 146 36L155 41L155 28L163 39L167 24L173 39L181 29L181 46C185 56 183 64 179 72Z', E.ant, 2.4, 2.4);
  s += o.head ? g(o.head, h) : h;
  return s;
}

// ---------- gear ----------
const spyglass = (hx, hy, a, back = 36, front = 64) => {
  const r = (a * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
  const x1 = hx - dx * back, y1 = hy - dy * back, x2 = hx + dx * front, y2 = hy + dy * front;
  return sh(cap(x1, y1, x2, y2, 7, 9), P.sun, 1.5, 2.4) +
    sh(cap(x2 - dx * 6, y2 - dy * 6, x2 + dx * 8, y2 + dy * 8, 10, 10), P.teal, 1.5, 2.4) +
    fill(`M${f(x1 + dx * 14 - dy * 8)} ${f(y1 + dy * 14 + dx * 8)}L${f(x1 + dx * 14 + dy * 8)} ${f(y1 + dy * 14 - dx * 8)}`, 'none', 0, ' stroke="#B07720" stroke-width="3"');
};
function shield(cx, cy, k = 1, lit = true) {
  return g(`translate(${f(cx)} ${f(cy)}) scale(${k})`, sh(ell(0, 0, 33, 37), IRONDK, 3, 2.8) + `<ellipse cx="0" cy="0" rx="29" ry="33" fill="none" stroke="#F2B33D" stroke-width="3"/>` +
    sh(ell(0, 0, 18, 21), lit ? EMBER : ['#9C9588', '#3B3632', '#665F57'], 2, 2.4) +
    (lit ? `<ellipse cx="-2" cy="-3" rx="9" ry="11" fill="#FFDC7A" opacity="0.9"/>` + tongue(-3, 4, 22) + tongue(7, 6, 15) : '') +
    [[0, -30], [0, 30], [-25, 0], [25, 0]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="#F2B33D" stroke="${INK}" stroke-width="1.6"/>`).join(''));
}
/** Ember lantern hanging from a hook: (x, y) is the hook top. */
function lantern(x, y, lit = true) {
  return line(`M${f(x)} ${f(y)}V${f(y + 12)}`, INK, 2.6) +
    sh(`M${f(x - 12)} ${f(y + 14)}L${f(x + 12)} ${f(y + 14)}L${f(x + 9)} ${f(y + 22)}L${f(x - 9)} ${f(y + 22)}Z`, P.sun, 1.5, 2.4) +
    sh(rr(x - 11, y + 22, 22, 30, 5), lit ? EMBER : ['#9C9588', '#3B3632', '#665F57'], 2, 2.4) +
    (lit ? `<ellipse cx="${f(x - 1)}" cy="${f(y + 38)}" rx="5.5" ry="9" fill="#FFDC7A"/>` : '') +
    line(`M${f(x - 4)} ${f(y + 22)}V${f(y + 52)}M${f(x + 4)} ${f(y + 22)}V${f(y + 52)}`, INK, 1.8) +
    sh(`M${f(x - 12)} ${f(y + 52)}L${f(x + 12)} ${f(y + 52)}L${f(x + 8)} ${f(y + 60)}L${f(x - 8)} ${f(y + 60)}Z`, P.sun, 1.5, 2.4);
}
const lanternStaff = (bx, by, top = 120, lit = true) =>
  sh(cap(bx, by + 56, bx + 3, by - top, 3.6), P.wood, 1.5, 2.4) + line(`M${f(bx + 3)} ${f(by - top)}Q${f(bx + 20)} ${f(by - top - 14)} ${f(bx + 22)} ${f(by - top + 4)}`, INK, 3) +
  g(`translate(${f(bx + 22)} ${f(by - top + 4)}) scale(1.3) translate(${f(-bx - 22)} ${f(-(by - top + 4))})`, lantern(bx + 22, by - top + 4, lit));
/** Brazier on top of a pole: the Ember Guard's ember. (x, y) = pole top. */
function brazier(x, y, lit = true) {
  return sh(`M${f(x - 20)} ${f(y - 8)}L${f(x + 20)} ${f(y - 8)}L${f(x + 14)} ${f(y + 12)}Q${f(x)} ${f(y + 18)} ${f(x - 14)} ${f(y + 12)}Z`, IRONDK, 2, 2.6) +
    line(`M${f(x - 20)} ${f(y - 4)}H${f(x + 20)}`, '#F2B33D', 3) +
    (lit ? sh(ell(x, y - 10, 15, 6), EMBER, 1.5, 2.2) + tongue(x - 8, y - 8, 28) + tongue(x + 7, y - 7, 34) + tongue(x, y - 9, 22) : sh(ell(x, y - 10, 15, 6), ['#9C9588', '#3B3632', '#665F57'], 1.5, 2.2));
}
const emberPole = (x1, y1, x2, y2, lit = true) =>
  sh(cap(x1, y1, x2, y2, 4.2), P.wood, 1.5, 2.4) + brazier(x2, y2, lit);

// ---------- riders' hats and clothing ----------
const hood = () =>
  sh('M56 62C52 80 56 100 66 112L76 96C66 88 62 74 64 62Z', P.moss, 2, 2.4) +
  sh('M60 72C56 36 78 18 102 18C126 18 144 36 140 66C138 58 130 50 120 46Q100 40 80 48C70 54 64 62 60 72Z', P.moss, 3) +
  sh('M116 28C128 8 150 6 160 12C150 14 142 22 130 36Z', P.terra, 1.5, 2.2);
const wardenCap = () =>
  sh('M66 60C64 34 80 20 100 20C120 20 136 34 134 60L130 52Q100 42 70 52Z', P.iron, 3) +
  sh(rr(62, 50, 76, 10, 5), P.sun, 2, 2.4) +
  sh('M98 20C100 4 122 -2 136 10C126 10 118 18 112 24Z', P.plum, 2, 2.4) +
  `<circle cx="100" cy="23" r="4.6" fill="#F2B33D" stroke="${INK}" stroke-width="2.4"/>`;
const helm = () =>
  sh('M88 22C110 6 140 20 150 44L138 46C130 32 114 26 100 30Z', EMBER, 2, 2.4) +
  sh('M62 66C60 36 78 20 100 20C122 20 140 36 138 66L134 66L128 50Q100 42 72 50L66 66Z', P.iron, 3) +
  sh(rr(60, 52, 80, 10, 5), P.sun, 2, 2.4) +
  sh('M62 60L72 60L74 92Q68 94 64 88Z', P.iron, 2, 2.4) + sh('M138 60L128 60L126 92Q132 94 136 88Z', P.iron, 2, 2.4) +
  `<circle cx="100" cy="24" r="5" fill="#F2B33D" stroke="${INK}" stroke-width="2.4"/>`;
const plates = () =>
  sh('M58 102C66 92 86 94 92 104L90 120Q74 124 60 120Z', P.iron, 2, 2.4) +
  sh('M142 102C134 92 114 94 108 104L110 120Q126 124 140 120Z', P.iron, 2, 2.4) +
  line('M70 128Q100 138 130 128', '#F2B33D', 3.4) + line('M100 108V146', '#665F57', 2, ' opacity="0.6"');
const wardenPlates = () =>
  sh('M62 104C70 96 88 98 94 106L92 120Q76 124 64 120Z', P.iron, 2, 2.4) +
  sh('M138 104C130 96 112 98 106 106L108 120Q124 124 136 120Z', P.iron, 2, 2.4);
const cloak = () => sh('M72 100C44 104 22 128 12 170C30 164 48 168 62 178L72 150Z', P.moss, 3) + line('M60 112Q36 128 26 156', '#3A5E27', 2, ' opacity="0.7"');
const flameCloak = () => sh('M72 100C46 106 26 130 18 176C38 170 54 174 66 182L72 150Z', P.terra, 3);

/** The mounted figure. u: unit config (see below). */
function build(u) {
  const RS = u.RS || 0.6;
  const RL = (hx, hy, x, y) => [f((x - (hx - 100 * RS)) / RS), f((y - (hy - 166 * RS)) / RS)].map(Number);
  void RL;
  const rider = (hx, hy, o, extraT = '', k0 = 1) => {
    setK(RS * k0);
    const s = g(`translate(${f(hx - 100 * RS)} ${f(hy - 166 * RS)}) scale(${RS})${extraT ? ' ' + extraT : ''}`,
      person({ ...u.rider, legL: -48, legR: -38, face: 'calm', ...o }));
    setK(k0);
    return s;
  };
  const E = u.pal;
  const out = {};
  const baseT = () => baseW(u.basePal, u.baseRx, u.baseRing);
  const wrap = (inner) => g(`translate(100 212) scale(${u.sc}) translate(-100 -212)`, inner);
  /** Rider-local hand positions for each pose, as in the Elk Rider. */
  const arms = {
    idle: { back: [76, 112, 60, 150], front: [124, 112, 150, 128] },
    march: { back: [78, 112, 60, 146], front: [124, 114, 152, 150] },
    victory: { back: [76, 110, 60, 68], front: [124, 110, 140, 62] },
  };
  const make = (pose, mopts, rpos, rextra, ropts) => {
    const a = arms[pose];
    const o = { backArm: a.back, frontArm: a.front, under: u.under?.(pose, a.back, a.front), held: u.held?.(pose, a.front), ...ropts };
    return mount(E, { cloth: u.cloth, long: u.long, pony: u.pony, armor: u.armor, tailSwing: 0, ...mopts }) + rider(rpos[0], rpos[1], o, rextra);
  };

  reset(`${u.id}0`); BN = 0; BP = `${u.id}b0`;
  out.idle = svg(`${u.label}, on guard`, shadow(u.baseRx + 4, 17) + baseT() + wrap(make('idle', {}, [100, 116])));

  reset(`${u.id}1`); BN = 0; BP = `${u.id}b1`;
  out.march = svg(`${u.label}, marching`, shadow(u.baseRx + 4, 17) + baseT() + wrap(g('translate(0 -6)',
    make('march', { legs: [-26, 30, 24, -34], head: 'rotate(8 150 120)', tailSwing: -8 }, [104, 114], 'rotate(10 100 166)', { face: 'effort', mouth: MOUTH.grit }) )) +
    dust(34, 204, 1) + dust(70, 210, 0.7) + line('M-40 120H-14M-52 140H-24M-40 160H-16', INK, 2.6, ' opacity="0.45"'));

  reset(`${u.id}2`); BN = 0; BP = `${u.id}b2`;
  out.victory = svg(`${u.label}, cheering a victory`, jumpMarks() + g('translate(100 212) scale(' + u.sc + ') translate(-100 -212)', g('rotate(-14 66 208)',
    make('victory', { legs: [4, -40, 0, -56], mouth: true, head: 'rotate(-6 150 120)', tailSwing: 10 }, [96, 110], '', { face: 'happy', mouth: MOUTH.open }))) +
    star(-30, 60, 8) + star(230, 30, 6, '#2F9AA0') + star(210, 140, 7) + star(-10, 150, 5));

  reset(`${u.id}3`); BN = 0; BP = `${u.id}b3`;
  {
    const body = mount(E, { cloth: u.cloth, long: u.long, pony: u.pony, armor: u.armor, legs: [-78, 76, -84, 82], eye: 'dizzy', head: 'rotate(24 150 120)' });
    setK(RS);
    const fallen = g(`translate(132 216) rotate(84) scale(${RS}) translate(-100 -212)`,
      person({ ...u.rider, legL: -48, legR: -38, face: 'dizzy', mouth: MOUTH.wavy, backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124] }));
    setK(1);
    out.defeated = svg(`${u.label}, knocked down`, shadow(u.baseRx + 8, 13, 112, 224, 0.22) + baseT() +
      wrap(g('translate(-14 40)', body) + u.lying()) + wrap(fallen) + dizzy(236, 156) + puff(200, 150, 5));
  }

  reset(`${u.id}i`);
  {
    const k = u.icon.s, kk = k * u.sc * 1.9;
    const [cx0, cy0] = u.icon.c, tx = f(24 - (100 + (cx0 - 100) * u.sc) * k), ty = f(26 - (212 + (cy0 - 212) * u.sc) * k);
    setK(kk);
    const inner = g(`translate(100 212) scale(${u.sc}) translate(-100 -212)`, mount(E, { cloth: u.cloth, long: u.long, pony: u.pony, armor: u.armor }) +
      rider(100, 116, { backArm: arms.idle.back, frontArm: arms.idle.front, under: u.under?.('idle', arms.idle.back, arms.idle.front), held: u.held?.('idle', arms.idle.front) }, '', kk));
    const c = `${u.id}i_clip`;
    out.icon = iconSvg(u.label,
      `<circle cx="24" cy="27.5" r="19" fill="${u.icon.rim}" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="${u.icon.bg}" stroke="${INK}" stroke-width="2.6"/>` +
      `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
      `<path d="M2 44H46V50H2Z" fill="${u.icon.ground}" stroke="${INK}" stroke-width="2"/>` +
      g(`translate(${tx} ${ty}) scale(${k})`, inner) + `</g>`);
    setK(1);
  }
  return out;
}

// ---------- the three units ----------
const UNITS = {
  pathfinder: {
    id: 'pat', label: 'Pathfinder', sc: 0.8, RS: 0.6, baseRx: 70, basePal: P.wood, baseRing: undefined,
    pal: { body: ['#F6E2B0', '#8A6A3A', '#D8B672'], neck: ['#D8B672', '#6B4E26', '#B8924F'], leg: ['#B8924F', '#4E3818', '#8E6C34'], mane: P.hair, ant: P.bone, rump: '#FFF4D6' },
    cloth: P.terra, pony: true,
    rider: { tunic: P.wood, sleeve: P.wood, legs: P.hair, boots: P.boot, hat: hood, bodyExtra: '' },
    under: () => cloak,
    held: (pose, h) => () => spyglass(h[2], h[3], pose === 'march' ? -14 : pose === 'victory' ? -70 : -38),
    lying: () => sh(cap(-10, 214, 52, 206, 7, 9), P.sun, 1.5, 2.4) + sh(cap(48, 207, 62, 205, 10, 10), P.teal, 1.5, 2.4),
    icon: { s: 0.28, c: [146, 80], bg: '#E4B67C', rim: '#714B29', ground: '#B07D46' },
  },
  hearthwarden: {
    id: 'hrw', label: 'Hearthwarden', sc: 0.94, RS: 0.6, baseRx: 84, basePal: P.teal, baseRing: undefined,
    pal: { body: ['#E3D9CB', '#5A4C42', '#B3A592'], neck: ['#B3A592', '#3A302A', '#8A7B6B'], leg: ['#9C8E7E', '#3A302A', '#74675A'], mane: P.hair, ant: P.bone, rump: '#F6EEE0' },
    cloth: P.plum, long: true,
    rider: { tunic: P.terra, sleeve: P.iron, legs: P.plum, boots: P.boot, hat: wardenCap, overBody: wardenPlates, bodyExtra: '' },
    under: (pose, b) => () => flameCloak() + lanternStaff(b[2] - 6, b[3], pose === 'victory' ? 110 : 128),
    held: (pose, h) => () => shield(h[2] + 12, h[3] - 4, 0.95),
    lying: () => lantern(-20, 168, false) + g('rotate(-20 190 190)', shield(196, 192, 0.8, false)),
    icon: { s: 0.19, c: [146, 78], bg: '#7AD3CD', rim: '#1A646B', ground: '#2F9AA0' },
  },
  'ember-guard': {
    id: 'emg', label: 'Ember Guard', sc: 1.06, RS: 0.66, baseRx: 90, basePal: P.sun, baseRing: '#C4623A',
    pal: { body: ['#8E766A', '#2A1D18', '#58443B'], neck: ['#58443B', '#1E1410', '#3A2A23'], leg: ['#58443B', '#1E1410', '#3A2A23'], mane: P.hair, ant: IRONDK, rump: '#B8A596' },
    cloth: P.terra, long: true, armor: true,
    rider: { tunic: P.iron, sleeve: IRONDK, legs: IRONDK, boots: P.boot, hat: helm, overBody: plates, bodyExtra: '<path d="M56 160H144V182H56Z" fill="#7A3B5E"/>', mouth: MOUTH.grit },
    under: (pose) => pose === 'idle' ? () => '' : () => '',
    held: (pose, h) => () => pose === 'march' ? emberPole(h[2] - 24, h[3] + 64, h[2] + 60, h[3] - 92) : emberPole(h[2] - 6, h[3] + 96, h[2] + 4, h[3] - (pose === 'victory' ? 84 : 124)),
    lying: () => emberPole(-30, 218, 50, 204, false),
    icon: { s: 0.185, c: [140, 62], bg: '#FFDC7A', rim: '#B07720', ground: '#C4623A' },
  },
};
export default function (name) { return build(UNITS[name]); }
export const NAMES = Object.keys(UNITS);
void star;
