// Shared bits for the two siege machines: wheels, dust, the small crew figure.
import { P, INK, sh, ell, cap, rr, line, fill, star, g, person, MOUTH, setK, f } from './lib.mjs';

export function wheel(cx, cy, r, rot = 0) {
  let sp = '';
  for (let a = 0; a < 180; a += 45) {
    const t = ((a + rot) * Math.PI) / 180, dx = Math.cos(t) * (r - 5), dy = Math.sin(t) * (r - 5);
    sp += `M${f(cx - dx)} ${f(cy - dy)}L${f(cx + dx)} ${f(cy + dy)}`;
  }
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="#A39E94" stroke="${INK}" stroke-width="2.6"/><path d="M${f(cx - r + 2.4)} ${f(cy)}A${f(r - 2.4)} ${f(r - 2.4)} 0 0 1 ${f(cx)} ${f(cy - r + 2.4)}" fill="none" stroke="#E0DCD3" stroke-width="2.4"/>` + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 4.6)}" fill="#B07D46" stroke="${INK}" stroke-width="2.2"/>` +
    line(sp, INK, 5.4) + line(sp, '#B07D46', 2.4) +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="4.6" fill="#F2B33D" stroke="${INK}" stroke-width="2.2"/>`;
}

const puff = (x, y, r) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#F1E1C2" stroke="${INK}" stroke-width="2.2"/>`;
export const dust = (x, y, s = 1) =>
  `<g opacity="0.9">${puff(x - 11 * s, y + 2, 5 * s)}${puff(x + 3 * s, y - 9 * s, 4.5 * s)}${puff(x, y, 7 * s)}<path d="M${f(x - 4 * s)} ${f(y - 3 * s)}a${f(3 * s)} ${f(3 * s)} 0 0 1 ${f(4 * s)} -${f(2 * s)}" fill="none" stroke="#FFF8E8" stroke-width="2"/></g>`;
export { puff };

// Crew hat: a knitted teal cap with a rolled bone brim and a bobble.
const crewHat = () =>
  sh('M69 58C66 34 82 22 100 22C118 22 134 34 131 58Z', P.teal, 3) +
  line('M84 28Q80 42 82 54M100 23V54M116 28Q120 42 118 54', '#1A646B', 2, ' opacity="0.55"') +
  sh(rr(63, 48, 74, 14, 7), P.bone, 2) +
  `<circle cx="100" cy="19" r="7" fill="#F1E1C2" stroke="${INK}" stroke-width="2.4"/>`;

export const SC = 0.82;
/** The small crew figure with feet at world (cx, 210). Arms etc. in the standard person coordinates. */
export function crew(cx, o, t = '') {
  setK(SC);
  const s = g(`translate(${f(cx - 100 * SC)} ${f(212 - 212 * SC)}) scale(${SC})${t ? ' ' + t : ''}`,
    person({ small: true, tunic: P.sun, legs: P.wood, boots: P.boot, hat: crewHat, face: 'calm', mouth: MOUTH.smile,
      bodyExtra: `<path d="M64 128Q100 136 136 128" fill="none" stroke="#B07720" stroke-width="2.4" opacity="0.6"/>`, ...o }));
  setK(1);
  return s;
}
/** World point -> crew-local point, for placing hands on the machine. */
export const toCrew = (cx, x, y) => [f((x - (cx - 100 * SC)) / SC), f((y - (212 - 212 * SC)) / SC)].map(Number);
export const crewHatOnly = crewHat;

export const jumpMarks = (rx = 78) =>
  `<ellipse cx="104" cy="226" rx="${rx}" ry="9" fill="${INK}" opacity="0.22"/>` +
  line('M40 235L34 241M100 237L100 244M160 235L166 241', INK, 2.6, ' opacity="0.55"');

export const dizzy = (x, y) =>
  line(`M${x - 30} ${y + 12}Q${x} ${y - 4} ${x + 30} ${y + 12}`, INK, 2, ' stroke-dasharray="3 5" opacity="0.6"') +
  star(x - 30, y + 12, 7) + star(x, y, 6, '#2F9AA0') + star(x + 30, y + 12, 7);

export { P, INK, sh, ell, cap, rr, line, fill, star, g, f };
