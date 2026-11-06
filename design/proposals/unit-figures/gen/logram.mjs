import { base, shadow, svg, iconSvg, reset, MOUTH, setK } from './lib.mjs';
import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, wheel, dust, crew, toCrew, jumpMarks, dizzy, crewHatOnly } from './siege.mjs';

const U = 'logram';
const LABEL = 'Log Ram';

function scallops(y0, y1, step) {
  let d = '';
  for (let y = y0; y <= y1; y += step) {
    d += `M30 ${y}`;
    for (let x = 30; x < 214; x += 14) d += `q7 6 14 0`;
  }
  return `<path d="${d}" fill="none" stroke="#843A23" stroke-width="2" opacity="0.7"/>`;
}

const roof = () =>
  sh(cap(73, 168, 75, 122, 5), P.wood, 1.5, 2.4) + sh(cap(173, 168, 171, 122, 5), P.wood, 1.5, 2.4) +
  sh('M44 121L80 87H164L202 121Q123 129 44 121Z', P.terra, 3, 2.6, scallops(96, 116, 10)) +
  sh(rr(76, 79, 92, 10, 5), P.wood, 1.5, 2.4) +
  sh(cap(44, 122, 202, 122, 4.6), P.wood, 1.5, 2.4);

const ropes = () => {
  const d = 'M104 125V137M150 125V137';
  return line(d, INK, 5) + line(d, '#E4B67C', 2);
};

const log = () =>
  sh(cap(62, 146, 192, 146, 10.5), P.wood, 2, 2.6,
    `<path d="M76 141H120M90 151H160M134 141H178" fill="none" stroke="#714B29" stroke-width="1.8" opacity="0.6"/>`) +
  sh(rr(100, 134, 8, 24, 2), P.iron, 1, 2.2) + sh(rr(146, 134, 8, 24, 2), P.iron, 1, 2.2) +
  `<ellipse cx="62" cy="146" rx="5.4" ry="10.5" fill="#E4B67C" stroke="${INK}" stroke-width="2.4"/><ellipse cx="62" cy="146" rx="2" ry="4.6" fill="none" stroke="#B07D46" stroke-width="1.6"/>` +
  sh('M188 130Q212 129 221 146Q212 163 188 162Z', P.iron, 2, 2.6) +
  `<circle cx="197" cy="137" r="2.2" fill="#665F57"/><circle cx="197" cy="155" r="2.2" fill="#665F57"/><circle cx="209" cy="146" r="2.2" fill="#665F57"/>`;

const chassis = () => sh(rr(56, 163, 134, 13, 5), P.wood, 2, 2.6);

/** The machine; rot spins the wheels; front=false leaves the front wheel off. */
const ram = (rot = 0, front = true) =>
  roof() + ropes() + log() + chassis() + wheel(84, 190, 18, rot) + (front ? wheel(162, 190, 18, rot) : '');

// The machine is drawn 15% up from its sketch coordinates (strokes kept at the house weight).
const MS = 1.15;
const M = (fn, extraT = '') => {
  setK(MS);
  const s = g(`translate(-4.6 -31.2) scale(${MS})${extraT}`, fn());
  setK(1);
  return s;
};
/** sketch -> world */
const W = (x, y) => [x * MS - 4.6, y * MS - 31.2];

const out = {};
const BASE = () => base(P.iron, true);

// idle: the crewman stands at the back with a hand on the post
reset(`${U}0`);
{
  const cx = 26;
  out.idle = svg(`${LABEL}, standing ready`,
    shadow(88, 17, 112) + BASE() + M(() => ram()) +
    crew(cx, { backArm: [78, 112, 60, 146], frontArm: [122, 112, ...toCrew(cx, ...W(68, 150))] }));
}

// march: rolling forward, the crewman leaning in and pushing
reset(`${U}1`);
{
  const cx = 18;
  out.march = svg(`${LABEL}, marching`,
    shadow(88, 17, 112) + BASE() + M(() => ram(22)) +
    dust(...W(62, 205), 1) + dust(...W(140, 205), 0.8) +
    crew(cx, { backArm: [80, 112, 150, 132], frontArm: [122, 114, 156, 118], legL: 22, legR: -16, face: 'effort', mouth: MOUTH.grit }, 'rotate(16 100 212)') +
    line('M-40 150H-18M-50 168H-26M-38 186H-16', INK, 2.6, ' opacity="0.45"'));
}

// victory: a hop, the crewman cheering, bits of wall flying off the ram's head
reset(`${U}2`);
{
  const cx = 26;
  const brick = (x, y, a) => g(`rotate(${a} ${x} ${y})`, sh(rr(x - 9, y - 6, 18, 12, 3), P.stone, 1, 2.4));
  out.victory = svg(`${LABEL}, cheering a victory`,
    jumpMarks() +
    g('translate(0 -16)', BASE() + M(() => ram()) +
      crew(cx, { backArm: [77, 110, 60, 66], frontArm: [123, 110, 140, 62], face: 'happy', mouth: MOUTH.open })) +
    brick(252, 84, 20) + brick(226, 50, -16) + brick(258, 118, 40) +
    line('M240 100Q250 92 252 80M214 70Q218 60 224 52', INK, 2, ' opacity="0.45"') +
    star(-36, 90, 8) + star(186, 12, 6, '#2F9AA0') + star(140, 30, 5));
}

// defeated: a wheel off, nose in the dirt, roof knocked askew, the crewman flat on his back
reset(`${U}3`);
{
  const body = () => g('rotate(9 84 208)',
    g('rotate(-8 123 104) translate(-6 -2)', roof()) + ropes() + log() + chassis() + wheel(84, 190, 18));
  out.defeated = svg(`${LABEL}, broken down`,
    shadow(128, 12, 104, 222, 0.22) + BASE() + M(body) +
    g('rotate(-14 236 212)', wheel(236, 191, 20, 10)) +
    g('translate(10 6) rotate(-84 100 212)', crew(100, { backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124], face: 'dizzy', mouth: MOUTH.wavy })) +
    dizzy(-14, 132));
}

// icon: the ram's iron head and roof seen from the front-left, in an iron ring
reset(`${U}i`);
{
  const c = 'logrami_clip';
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#665F57" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#E0DCD3" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
    sh('M2 45H46V50H2Z', P.wood, 1, 2.2) +
    `</g>` + ICON());
}
function ICON() {
  setK(0.8);
  const s = g('translate(4.8 5.4) scale(0.8)',
    sh(cap(12, 36, 12, 20, 2), P.wood, 0.8, 2) + sh(cap(36, 36, 36, 20, 2), P.wood, 0.8, 2) +
    sh('M3 22L13 9H35L45 22Q24 25 3 22Z', P.terra, 1.4, 2.4, `<path d="M0 15q3.5 3 7 0q3.5 3 7 0q3.5 3 7 0q3.5 3 7 0q3.5 3 7 0q3.5 3 7 0q3.5 3 7 0" fill="none" stroke="#843A23" stroke-width="1.4" opacity="0.7"/>`) +
    sh(cap(4, 29, 34, 29, 5.6), P.wood, 1, 2.2) +
    sh(rr(15, 23, 4, 12, 1), P.iron, 0.6, 1.8) +
    sh('M32 22Q43 22 46 29Q43 36 32 36Z', P.iron, 1, 2.4) +
    `<circle cx="37" cy="26" r="1.2" fill="#665F57"/><circle cx="37" cy="32" r="1.2" fill="#665F57"/>` +
    sh(ell(14, 39, 6.6), P.iron, 0.8, 2.2) + sh(ell(14, 39, 3.4), P.wood, 0.6, 1.8) +
    sh(ell(33, 39, 6.6), P.iron, 0.8, 2.2) + sh(ell(33, 39, 3.4), P.wood, 0.6, 1.8));
  setK(1);
  return s;
}

export default out;
