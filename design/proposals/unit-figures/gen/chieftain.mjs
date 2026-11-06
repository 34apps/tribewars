import { P, INK, sh, ell, cap, rr, line, fill, star, base, shadow, g, svg, iconSvg, person, MOUTH, reset, f } from './lib.mjs';

const U = 'chieftain';
const LABEL = 'Chieftain';

// Fur-trimmed leather cap with a gold band and a little ember badge (a leader, not a king: no crown points).
const hat = () =>
  sh('M70 54C68 33 84 21 100 21C116 21 132 33 130 54Z', P.wood, 3) +
  line('M84 26Q80 38 82 50M100 22V50M116 26Q120 38 118 50', '#714B29', 1.8, ' opacity="0.5"') +
  sh(rr(62, 46, 76, 14, 7), P.sun, 2) +
  `<circle cx="100" cy="21" r="4.5" fill="#F2B33D" stroke="${INK}" stroke-width="2.2"></circle>` +
  fill('M112 40C116 45 119 48 118 53C117 57 114 58 112 58C110 58 107 57 106 53C105 48 109 46 112 40Z', '#EE8443', 2) +
  fill('M112 47C114 50 115 52 114.6 54C114 56 113 56.5 112 56.5C111 56.5 110 56 109.4 54C109 52 110.5 50 112 47Z', '#FFDC7A') +
  `<ellipse cx="80" cy="31" rx="6" ry="3.4" transform="rotate(-35 80 31)" fill="#FFFFFF" opacity="0.6"></ellipse>`;

// Beard and moustache over the lower face; `mouth` sits between them.
const beard = (mouth) =>
  sh('M67 77C67 101 83 120 104 120C125 120 137 101 135 75C129 88 122 92 113 90C105 89 99 92 92 92C80 92 71 86 67 77Z', P.hair, 2) +
  mouth +
  sh('M97 92C99 84 107 83 110.5 88C113 83 122 83 125 90C121 95 114 94 110.5 92C107 95 100 96 97 92Z', P.hair, 1.5, 2.2);
const M_CALM = fill('M103 100Q111 106 119 99Q112 102 103 100Z', '#5A2230', 2);
const M_OPEN = fill('M100 96Q110 98 121 95Q120 112 110 112Q101 112 100 96Z', '#5A2230', 2.4) + fill('M103 97.4L118 96.5L117 100L104 100.6Z', '#FFF8E8') + fill('M104 110Q110 104 116 110Z', '#E0707A');
const M_WAVY = `<ellipse cx="111" cy="104" rx="4.4" ry="5.2" fill="#5A2230" stroke="${INK}" stroke-width="2.2"/>`;

const collar = () =>
  sh('M63 107C64 97 80 98 100 104C120 98 136 97 137 107C138 117 120 120 100 118C80 120 62 117 63 107Z', P.bone, 2) +
  line('M72 104Q74 110 72 114M86 106Q88 112 86 117M114 106Q112 112 114 117M128 104Q126 110 128 114', '#C6AF88', 1.8) +
  `<circle cx="100" cy="115" r="5.4" fill="#F2B33D" stroke="${INK}" stroke-width="2.2"></circle>`;

const tunicLines = `<path d="M100 104V180" fill="none" stroke="#F2B33D" stroke-width="7"></path><path d="M96.5 104V180M103.5 104V180" fill="none" stroke="${INK}" stroke-width="1.8"></path><path d="M60 172Q100 178 140 172" fill="none" stroke="#1A646B" stroke-width="2" opacity="0.6"></path>`;

const cloakIdle = () => sh('M70 100C54 130 48 168 43 197Q70 207 100 205Q130 207 156 196C150 166 144 130 130 100Z', P.terra, 3);
const cloakMarch = () => sh('M72 100C52 118 30 146 10 170Q22 182 36 180Q42 194 60 192Q76 202 96 198L128 104Z', P.terra, 3);

// The ember torch: wooden staff, little iron fire cup, flame. (x1,y1) bottom, (x2,y2) top; tilt leans the flame.
function torch(x1, y1, x2, y2, tilt = 0, lit = true) {
  let s = sh(cap(x1, y1, x2, y2, 4.2, 4), P.wood, 1.5, 2.4);
  const fl =
    sh('M0 -42C6 -30 18 -22 16 -11C15 -3 8 1 0 1C-8 1 -15 -3 -16 -11C-17 -20 -10 -24 -8 -33C-5 -28 -3 -26 0 -42Z', P.flame, 2) +
    fill('M0 -26C3 -19 9 -15 8 -9C7 -4 4 -2 0 -2C-4 -2 -7 -4 -8 -9C-8 -14 -3 -18 0 -26Z', '#FFDC7A') +
    fill('M0 -14C1.6 -11 4 -9 3.6 -6C3.2 -3.6 1.6 -3 0 -3C-1.6 -3 -3.2 -3.6 -3.6 -6C-3.8 -8.6 -1.6 -10 0 -14Z', '#FFF8E8');
  const ang = (Math.atan2(x2 - x1, y1 - y2) * 180) / Math.PI;
  let top = (lit ? g(`rotate(${f(tilt - ang)})`, fl) : '') +
    sh('M-15 -2H15L9 13Q0 17 -9 13Z', P.iron, 1.5, 2.4) +
    `<path d="M-15 -2H15" fill="none" stroke="#F2B33D" stroke-width="2.2"></path>`;
  s += g(`translate(${f(x2)} ${f(y2)}) rotate(${f(ang)})`, top);
  s += g(`translate(${f(x1 + (x2 - x1) * 0.78)} ${f(y1 + (y2 - y1) * 0.78)}) rotate(${f(ang)})`, sh(rr(-5.5, -3, 11, 6, 2.5), P.sun, 1, 2));
  return s;
}

const figure = (o) =>
  person({ tunic: P.teal, legs: P.wood, boots: P.boot, bodyExtra: tunicLines, overBody: collar, hat, face: 'calm', mouth: '', ...o });

const BASE = () => base(P.bone, false, '#F2B33D');
const out = {};

// idle: standing, torch upright in the right hand, left fist on the hip
reset(`${U}0`);
out.idle = svg(`${LABEL}, on guard`,
  shadow() + BASE() +
  figure({
    under: () => cloakIdle() + torch(146, 216, 152, 46),
    backArm: [78, 112, 60, 146],
    frontArm: [122, 112, 147, 140],
    afterFace: () => beard(M_CALM),
  }) + star(174, 22, 5, '#FFDC7A'));

// march: leaning forward, cloak flying back, torch carried forward
reset(`${U}1`);
out.march = svg(`${LABEL}, marching`,
  shadow() + BASE() +
  g('translate(6 0) rotate(8 100 212)',
    figure({
      under: () => cloakMarch() + torch(134, 178, 162, 24, -22),
      legL: 20, legR: -22,
      backArm: [78, 112, 56, 140],
      frontArm: [122, 112, 150, 98],
      face: 'effort',
      afterFace: () => beard(M_CALM),
    })) +
  line('M-8 150H14M-16 166H8M-2 182H18', INK, 2.6, ' opacity="0.45"'));

// victory: hop with the torch held high
reset(`${U}2`);
out.victory = svg(`${LABEL}, cheering a victory`,
  shadow(48, 9, 104, 226, 0.22) +
  line('M70.3 235L64.4 241M100 237L100 244M129.7 235L135.6 241', INK, 2.6, ' opacity="0.55"') +
  g('translate(0 -16)', BASE() +
    figure({
      under: () => cloakIdle() + torch(137, 150, 143, -12),
      backArm: [77, 110, 60, 66],
      frontArm: [123, 110, 140, 62],
      face: 'happy',
      afterFace: () => beard(M_OPEN),
      headT: 'translate(-2 -2) rotate(-4 100 70)',
    })) +
  star(32, 120, 8) + star(186, 120, 6, '#2F9AA0') + star(170, 160, 5) + star(100, -40, 5, '#FFDC7A'));

// defeated: knocked flat, cap off, the torch on the ground with its ember gone out (a curl of smoke)
reset(`${U}3`);
const smoke = (x, y) =>
  `<g opacity="0.85">${line(`M${x + 10} ${y + 22}C${x - 6} ${y + 10} ${x + 14} ${y - 4} ${x} ${y - 18}`, '#E0DCD3', 3.4)}<circle cx="${x}" cy="${y}" r="8" fill="#F1E1C2" stroke="${INK}" stroke-width="2.2"/><circle cx="${x + 8}" cy="${y - 12}" r="10" fill="#F1E1C2" stroke="${INK}" stroke-width="2.2"/><circle cx="${x + 1}" cy="${y - 27}" r="7.5" fill="#F1E1C2" stroke="${INK}" stroke-width="2.2"/></g>`;
out.defeated = svg(`${LABEL}, knocked over`,
  shadow(128, 12, 104, 222, 0.22) +
  g('translate(80 -44) rotate(-84 100 214)', BASE() +
    figure({
      under: cloakIdle,
      hat: null,
      backArm: [78, 112, 56, 142],
      frontArm: [122, 112, 150, 124],
      face: 'dizzy',
      afterFace: () => beard(M_WAVY),
    })) +
  g('translate(128 146) rotate(104 100 45)', hat()) +
  torch(150, 233, -22, 222, 0, false) +
  smoke(-40, 196) +
  `<circle cx="-50" cy="228" r="4.6" fill="#EE8443" stroke="${INK}" stroke-width="2"></circle>` +
  line('M6.8 104.9Q36.8 88.9 66.8 104.9', INK, 2, ' stroke-dasharray="3 5" opacity="0.6"') +
  star(6.8, 104.9, 7) + star(38.8, 92.9, 6, '#2F9AA0') + star(66.8, 104.9, 7));

// icon: head and shoulders in a bone ring with a gold rim, the ember torch beside
reset(`${U}i`);
{
  const c = 'chieftaini_clip';
  out.icon = iconSvg(LABEL,
    `<circle cx="24" cy="27.5" r="19" fill="#C6AF88" stroke="${INK}" stroke-width="2.6"></circle><circle cx="24" cy="26" r="19" fill="#FFF8E8" stroke="${INK}" stroke-width="2.6"></circle><circle cx="24" cy="26" r="15.6" fill="none" stroke="#F2B33D" stroke-width="2"></circle>` +
    `<defs><clipPath id="${c}"><path d="M6.3 26A17.7 17.7 0 1 0 41.7 26A17.7 17.7 0 1 0 6.3 26Z"></path></clipPath></defs><g clip-path="url(#${c})">` +
    sh('M3 50C2 42 8 38 14 37C20 36 28 36 34 37C40 38 46 42 45 50Z', P.terra, 1.6) +
    sh('M10 48C8 42 12 38 24 37C36 38 40 42 38 48Z', P.teal, 1.6) +
    `<path d="M24 37V48" stroke="#F2B33D" stroke-width="3"></path>` +
    `</g>` +
    sh('M10.5 38C11 34 18 35 24 37C30 35 37 34 37.5 38C38 42 31 43 24 42C17 43 10 42 10.5 38Z', P.bone, 1.2, 2.2) +
    sh(cap(41, 44, 41.6, 12, 1.8), P.wood, 1, 2) +
    g('translate(41.6 12)', sh('M0 -11C2 -7 6 -5 5.4 -1.6C5 1 2.6 2 0 2C-2.6 2 -5 1 -5.4 -1.6C-5.8 -4.6 -2.4 -6 0 -11Z', P.flame, 1, 2) + fill('M0 -5C1.2 -3 2.4 -2 2 -0.4C1.6 0.8 0.8 1 0 1C-0.8 1 -1.6 0.8 -2 -0.4C-2.2 -1.8 -1 -3 0 -5Z', '#FFDC7A') + sh('M-6 1H6L3.6 6Q0 7.6 -3.6 6Z', P.iron, 0.8, 2)) +
    sh('M13 28A10.5 10 0 1 0 34 28A10.5 10 0 1 0 13 28Z', P.skin, 1.6) +
    `<ellipse cx="20.6" cy="28.4" rx="1.8" ry="2.3" fill="${INK}"></ellipse><ellipse cx="27.4" cy="28.4" rx="1.8" ry="2.3" fill="${INK}"></ellipse>` +
    sh('M13 30C13 37 18 42 24.6 42C31 42 35 37 34.4 29.6C32.4 33 30 34 27.4 33.4C25.4 33 23.6 34 21.6 34C17.6 34 15 32.6 13 30Z', P.hair, 1, 2) +
    sh('M20.4 34.6C21 32 24 31.8 25 33.4C26 31.8 29 32 29.6 34.4C28.4 35.8 26.4 35.6 25 34.8C23.8 35.8 21.6 36 20.4 34.6Z', P.hair, 0.8, 1.6) +
    sh('M14.6 22C14 13 19 8.6 24 8.6C29 8.6 34 13 33.4 22Z', P.wood, 1.6) +
    sh(rr(11.6, 19.6, 24.8, 6, 3), P.sun, 1, 2.2) +
    fill('M28 15.6C29.4 17.4 30.4 18.6 30 20.2C29.6 21.6 28.8 22 28 22C27.2 22 26.4 21.6 26 20.2C25.6 18.6 26.6 17.4 28 15.6Z', '#EE8443', 1.6) +
    `<circle cx="24" cy="8.8" r="2" fill="#F2B33D" stroke="${INK}" stroke-width="1.6"></circle>`);
}

export default out;
