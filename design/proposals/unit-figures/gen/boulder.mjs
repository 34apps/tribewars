import { base, shadow, svg, iconSvg, reset, MOUTH, setK } from './lib.mjs';
import { P, INK, sh, ell, cap, rr, line, fill, star, g, f, wheel, dust, crew, toCrew, jumpMarks, dizzy, crewHatOnly } from './siege.mjs';

const U = 'boulder';
const LABEL = 'Boulder Sling';

const MS = 1.15;
const M = (fn) => {
  setK(MS);
  const s = g(`translate(-4.6 -31.2) scale(${MS})`, fn());
  setK(1);
  return s;
};
const W = (x, y) => [x * MS - 4.6, y * MS - 31.2];

const PIV = [152, 160];
const CUP = 'M-20 -6Q-19 11 0 11Q19 11 20 -6Q0 1 -20 -6Z';

// A round boulder with a couple of cracks.
const rock = (x, y, r = 15) =>
  sh(`M${x - r} ${y + 2}C${x - r} ${y - r * 0.7} ${x - r * 0.5} ${y - r} ${x + 1} ${y - r}C${x + r * 0.7} ${y - r} ${x + r} ${y - r * 0.5} ${x + r} ${y + 1}C${x + r} ${y + r * 0.8} ${x + r * 0.5} ${y + r} ${x} ${y + r}C${x - r * 0.6} ${y + r} ${x - r} ${y + r * 0.6} ${x - r} ${y + 2}Z`, P.stone, 2, 2.6,
    `<path d="M${x - 4} ${y - r + 3}l3 6l-3 4M${x + 5} ${y + 3}l5 3" fill="none" stroke="#5F584F" stroke-width="1.8"/>`);

// The throwing arm from the pivot to its tip, with the sling cup at the end (opening away from the arm, on its "up" side).
function arm(tip, load) {
  const dx = tip[0] - PIV[0], dy = tip[1] - PIV[1];
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  const cup = g(`translate(${f(tip[0])} ${f(tip[1])}) rotate(${f(a + 160)})`,
    (load ? rock(0, -18, 19) : '') + sh(CUP, P.wood, 1.5, 2.4));
  return sh(cap(PIV[0], PIV[1], tip[0], tip[1], 6.6, 5), P.wood, 1.5, 2.6) + cup;
}

const frameBack = () => sh(cap(144, 168, 168, 102, 6.2), P.wood, 1.5, 2.6);
const frameFront = () =>
  sh(cap(192, 168, 168, 102, 6.2), P.wood, 1.5, 2.6) +
  sh(rr(146, 92, 44, 15, 7.5), P.bone, 1.5, 2.6) +
  line('M157 94V105M168 94V105M179 94V105', '#C6AF88', 1.8);
const pivot = () =>
  sh(ell(PIV[0], PIV[1], 11, 10), P.terra, 1.5, 2.4) + line(`M${PIV[0] - 5} ${PIV[1] - 7}V${PIV[1] + 7}M${PIV[0] + 1} ${PIV[1] - 8.6}V${PIV[1] + 8.6}M${PIV[0] + 6} ${PIV[1] - 6.6}V${PIV[1] + 6.6}`, '#843A23', 1.8);
const chassis = () => sh(rr(60, 162, 140, 16, 6), P.wood, 2, 2.6);

/** tip: where the arm ends; load: boulder in the cup; rot: wheel spin. */
const sling = (tip, load = true, rot = 0) =>
  frameBack() + arm(tip, load) + pivot() + chassis() + frameFront() + wheel(88, 190, 17, rot) + wheel(170, 190, 17, rot);

const COCKED = [84, 134];
const out = {};
const BASE = () => base(P.iron, true);

// idle: arm cocked with a boulder in the cup; the slinger points at the target
reset(`${U}0`);
{
  const cx = 24;
  out.idle = svg(`${LABEL}, standing ready`,
    shadow(88, 17, 112) + BASE() + M(() => sling(COCKED)) +
    crew(cx, { backArm: [78, 112, 60, 146], frontArm: [122, 110, 156, 84] }));
}

// march: rolling, the slinger pushing from behind
reset(`${U}1`);
{
  const cx = 16;
  out.march = svg(`${LABEL}, marching`,
    shadow(88, 17, 112) + BASE() + M(() => sling(COCKED, true, 22)) +
    dust(...W(66, 205), 1) + dust(...W(148, 205), 0.8) +
    crew(cx, { backArm: [80, 112, 150, 134], frontArm: [122, 114, 156, 120], legL: 22, legR: -16, face: 'effort', mouth: MOUTH.grit }, 'rotate(16 100 212)') +
    line('M-40 150H-18M-50 168H-26M-38 186H-16', INK, 2.6, ' opacity="0.45"'));
}

// victory: the arm has swung up against the bumper and the boulder sails off
reset(`${U}2`);
{
  const cx = 24;
  out.victory = svg(`${LABEL}, cheering a victory`,
    jumpMarks() +
    g('translate(0 -16)', BASE() + M(() => sling([166, 100], false)) +
      crew(cx, { backArm: [77, 110, 60, 66], frontArm: [123, 110, 140, 62], face: 'happy', mouth: MOUTH.open })) +
    line('M186 40Q200 14 218 -2', INK, 2.4, ' stroke-dasharray="3 6" opacity="0.6"') +
    rock(240, -16, 20) + line('M216 -34L204 -42M214 -14L200 -16', INK, 2.4, ' opacity="0.5"') +
    star(-36, 90, 8) + star(130, 10, 6, '#2F9AA0') + star(258, 30, 5));
}

// defeated: arm snapped, the boulder rolled off, the slinger knocked flat
reset(`${U}3`);
{
  const body = () =>
    frameBack() + sh(cap(PIV[0], PIV[1], 124, 150, 6.6, 6.2), P.wood, 1.5, 2.6) +
    fill('M126 143L115 145L121 150L113 155L126 157Z', '#E4B67C', 2.2) +
    pivot() + chassis() + frameFront() + wheel(88, 190, 17) + wheel(170, 190, 17);
  out.defeated = svg(`${LABEL}, broken down`,
    shadow(128, 12, 104, 222, 0.22) + BASE() + g('rotate(-5 196 208)', M(body)) +
    g('translate(196 226) rotate(-6)', sh(cap(0, 0, 40, 0, 5, 6.2), P.wood, 1.5, 2.6) + fill('M40 -7L51 -3L45 0L52 5L40 7Z', '#E4B67C', 2.2) + g('rotate(172)', sh(CUP, P.wood, 1.5, 2.4))) +
    rock(236, 194, 19) +
    g('translate(10 6) rotate(-84 100 212)', crew(100, { backArm: [78, 112, 56, 142], frontArm: [122, 112, 150, 124], face: 'dizzy', mouth: MOUTH.wavy })) +
    dizzy(-14, 132));
}

// icon: the boulder in the sling cup on its arm, the frame behind, in an iron ring
reset(`${U}i`);
{
  const c = 'boulderi_clip';
  setK(1);
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#665F57" stroke="${INK}" stroke-width="2.6"/><circle cx="24" cy="26" r="19" fill="#E0DCD3" stroke="${INK}" stroke-width="2.6"/>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"/></clipPath></defs><g clip-path="url(#${c})">` +
    sh('M2 40H46V50H2Z', P.wood, 1.2, 2.4) + `</g>` + ICON());
}
function ICON() {
  setK(0.86);
  const s = g('translate(4.4 4.6) scale(0.86)',
    sh(cap(28, 40, 34, 16, 2.2), P.wood, 0.8, 2.2) + sh(cap(42, 40, 34, 16, 2.2), P.wood, 0.8, 2.2) +
    sh(rr(28.5, 12.5, 12, 5.4, 2.7), P.bone, 0.8, 2) +
    sh(cap(31, 36, 13, 22, 2.6, 2.2), P.wood, 1, 2.4) +
    `<circle cx="31" cy="36" r="4" fill="#C4623A" stroke="${INK}" stroke-width="2.2"/>` +
    g('translate(13 22) rotate(-2)', sh('M-8 -2Q-7.6 5 0 5Q7.6 5 8 -2Q0 1 -8 -2Z', P.wood, 0.8, 2.2)) +
    sh('M3.6 15C3.6 8 7 4.6 12 4.6C17.6 4.6 21 8 21 14C21 19.6 17 22.4 12.4 22.4C7.4 22.4 3.6 20 3.6 15Z', P.stone, 1.2, 2.4,
      `<path d="M10 6l1.6 3.4l-1.6 2.4M15 14l3 1.6" fill="none" stroke="#5F584F" stroke-width="1.4"/>`));
  setK(1);
  return s;
}

export default out;
