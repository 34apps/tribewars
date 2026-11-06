// Toy Diorama SVG helpers, matching design/sprites/units/* (3-tone block shading lit from the top left, warm ink outline).
export const INK = '#2B211C';
export const P = {
  wood: ['#E4B67C', '#714B29', '#B07D46'],
  sun: ['#FFDC7A', '#B07720', '#F2B33D'],
  iron: ['#E0DCD3', '#665F57', '#A39E94'],
  skin: ['#FFE0C4', '#C98A62', '#F3BE95'],
  skin2: ['#E6B188', '#8C5634', '#C4885C'],
  moss: ['#A6C964', '#3A5E27', '#5E8C3A'],
  terra: ['#EF9C6E', '#843A23', '#C4623A'],
  plum: ['#B86C92', '#4A213C', '#7A3B5E'],
  teal: ['#7AD3CD', '#1A646B', '#2F9AA0'],
  boot: ['#6B4A36', '#2E1F18', '#4A3226'],
  bone: ['#FFF8E8', '#C6AF88', '#F1E1C2'],
  hair: ['#8B5835', '#2E1F18', '#5B371F'],
  flame: ['#FFDC7A', '#B5462A', '#EE8443'],
  stone: ['#D9D2C4', '#5F584F', '#9C9588'],
};
const r1 = (n) => Math.round(n * 10) / 10;
export const f = (n) => String(r1(n));

let PFX = 'x';
let N = 0;
/** Scale factor of the current sub-figure: strokes and shading offsets are divided by it so they match the full-size art. */
export let K = 1;
export function setK(k) { K = k; }
export function reset(prefix) { PFX = prefix; N = 0; K = 1; }
export const id = () => `${PFX}${(N++).toString(36)}`;

/**
 * One shaded toy shape. size: 3 = big (body/head), 2 = medium, 1.5 = small, 1 = tiny.
 * extra: markup clipped inside the shape (stripes, belts).
 */
export function sh(d, pal, size = 2, w = 2.6, extra = '') {
  const [l, k, m] = pal;
  if (size <= 1 && !extra) return `<path d="${d}" fill="${m}" stroke="${INK}" stroke-width="${r1(w / K)}"/>`;
  const s = r1(size / K);
  const mx = r1((-1.6 * size) / K), my = r1((-2 * size) / K);
  const a = id(), b = id(), c = id();
  const sw = r1(w / K);
  return `<defs><path id="${a}" d="${d}"/><clipPath id="${b}"><use href="#${a}"/></clipPath><clipPath id="${c}"><use href="#${a}" x="${s}" y="${s}"/></clipPath></defs><g clip-path="url(#${b})"><use href="#${a}" fill="${l}"/><use href="#${a}" fill="${k}" x="${s}" y="${s}"/><g clip-path="url(#${c})"><use href="#${a}" fill="${m}" x="${mx}" y="${my}"/></g>${extra}</g><use href="#${a}" fill="none" stroke="${INK}" stroke-width="${sw}"/>`;
}

export const ell = (cx, cy, rx, ry = rx) =>
  `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;

/** Limb / pole from (x1,y1) to (x2,y2) with round ends of radius r1 and r2. */
export function cap(x1, y1, x2, y2, ra, rb = ra) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  return `M${f(x1 + nx * ra)} ${f(y1 + ny * ra)}L${f(x2 + nx * rb)} ${f(y2 + ny * rb)}A${f(rb)} ${f(rb)} 0 0 0 ${f(x2 - nx * rb)} ${f(y2 - ny * rb)}L${f(x1 - nx * ra)} ${f(y1 - ny * ra)}A${f(ra)} ${f(ra)} 0 0 0 ${f(x1 + nx * ra)} ${f(y1 + ny * ra)}Z`;
}

export const rr = (x, y, w, h, r) =>
  `M${f(x + r)} ${f(y)}L${f(x + w - r)} ${f(y)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}L${f(x + w)} ${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}L${f(x + r)} ${f(y + h)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)}L${f(x)} ${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`;

export const line = (d, col = INK, w = 2.6, extra = '') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${r1(w / K)}"${extra}></path>`;
export const fill = (d, col, w = 0, extra = '') =>
  `<path d="${d}" fill="${col}"${w ? ` stroke="${INK}" stroke-width="${r1(w / K)}"` : ''}${extra}></path>`;

/** Four-point sparkle star. */
export function star(cx, cy, r, col = '#F2B33D') {
  const i = r * 0.26;
  return `<path d="M${f(cx)} ${f(cy - r)}L${f(cx + i)} ${f(cy - i)}L${f(cx + r)} ${f(cy)}L${f(cx + i)} ${f(cy + i)}L${f(cx)} ${f(cy + r)}L${f(cx - i)} ${f(cy + i)}L${f(cx - r)} ${f(cy)}L${f(cx - i)} ${f(cy - i)}Z" fill="${col}" stroke="${INK}" stroke-width="2"></path>`;
}

/** The round toy base (top at cx 100, cy 210). Small = foot units, wide = cavalry / machines. */
export function base(pal, wide, ring) {
  const rx = wide ? 84 : 54, ry = wide ? 15 : 14;
  const x0 = 100 - rx, x1 = 100 + rx;
  const d = `M${x0} 210L${x0} 220A${rx} ${ry} 0 0 0 ${x1} 220L${x1} 210A${rx} ${ry} 0 0 1 ${x0} 210Z`;
  const c = id();
  const [l, k, m] = pal;
  return `<defs><clipPath id="${c}"><path d="${d}"></path></clipPath></defs><g clip-path="url(#${c})"><path d="${d}" fill="${k}"></path><rect x="${x0 - 1}" y="${wide ? 195 : 196}" width="${f(rx * 0.95)}" height="${wide ? 42 : 40}" fill="${m}"></rect></g><path d="${d}" fill="none" stroke="${INK}" stroke-width="2.6"></path><ellipse cx="100" cy="210" rx="${rx}" ry="${ry}" fill="${l}" stroke="${INK}" stroke-width="2.6"></ellipse><ellipse cx="${f(100 - rx * 0.12)}" cy="${f(210 - ry * 0.12)}" rx="${f(rx * 0.72)}" ry="${f(ry * 0.6)}" fill="none" stroke="${ring || m}" stroke-width="${ring ? 2.6 : 2}"></ellipse>`;
}

export const shadow = (rx = 58, ry = 16, cx = 106, cy = 224, op = 0.28) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}" opacity="${op}"></ellipse>`;

export const g = (t, inner) => `<g transform="${t}">${inner}</g>`;

const tidy = (s) => s.replace(/><\/(use|path|ellipse|circle|rect)>/g, '/>');
export function svg(label, body) {
  return tidy(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-72 -80 344 330" width="344" height="330" stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${label}">${body}</svg>`);
}
export function iconSvg(label, body) {
  return tidy(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${label}">${body}</svg>`);
}

// ---------- the standard toy person (feet on y 212, centre x 100, facing right) ----------
const BODY = 'M72 104C82.5 98 117.3 98 128 104C138.7 110 134.2 128.3 136 140C137.8 151.7 145 167.3 139 174C133 180.7 112.8 180 100 180C87.2 180 67.8 180.7 62 174C56.2 167.3 63.3 151.7 65 140C66.7 128.3 61.5 110 72 104Z';
const HEAD = 'M66 70C66 61.3 66.3 49.3 72 44C77.7 38.7 90.7 38 100 38C109.3 38 122.3 38.7 128 44C133.7 49.3 134 61.3 134 70C134 78.7 133.7 90.3 128 96C122.3 101.7 109.3 104 100 104C90.7 104 77.7 101.7 72 96C66.3 90.3 66 78.7 66 70Z';
const BOOT_L = 'M92 200C88.7 198.5 78.2 196.2 74 197C69.8 197.8 67.8 202.5 67 205C66.2 207.5 65.2 210.8 69 212C72.8 213.2 85.8 213 90 212C94.2 211 93.7 208 94 206C94.3 204 95.3 201.5 92 200Z';
const BOOT_R = 'M107 200C110.3 198.5 120.8 196.2 125 197C129.2 197.8 131.2 202.5 132 205C132.8 207.5 133.8 210.8 130 212C126.2 213.2 113.2 213 109 212C104.8 211 105.3 208 105 206C104.7 204 103.7 201.5 107 200Z';
export const HEAD_PATH = HEAD;

function face(kind) {
  let s = '';
  if (kind === 'happy') {
    s += line('M89.5 76.5Q95 69 100.5 76.5M115.5 76.5Q121 69 126.5 76.5', INK, 3.2);
    s += line('M87 62L101 60', INK, 3.4) + line('M115 60L129 62', INK, 3.4);
  } else if (kind === 'dizzy') {
    const sp = (cx, cy) => {
      let p = '';
      for (let t = 0; t <= 4 * Math.PI; t += 0.45) {
        const r = 0.5 + t * 0.4;
        p += `${p ? 'L' : 'M'}${f(cx + Math.cos(t) * r)} ${f(cy + Math.sin(t) * r)}`;
      }
      return line(p, INK, 2.4);
    };
    s += sp(95, 75) + sp(121, 75);
  } else if (kind === 'effort') {
    s += `<ellipse cx="96" cy="77" rx="4.2" ry="4.6" fill="${INK}"></ellipse><ellipse cx="121" cy="77" rx="4.2" ry="4.6" fill="${INK}"></ellipse><circle cx="94.6" cy="78.6" r="1.5" fill="#FFF8E8"></circle><circle cx="119.6" cy="78.6" r="1.5" fill="#FFF8E8"></circle>`;
    s += line('M88 68L102 72', INK, 3.4) + line('M114 72L128 66', INK, 3.4);
  } else {
    s += `<ellipse cx="96" cy="76" rx="4.6" ry="5.8" fill="${INK}"></ellipse><ellipse cx="121" cy="76" rx="4.6" ry="5.8" fill="${INK}"></ellipse><circle cx="94.5" cy="74" r="1.6" fill="#FFF8E8"></circle><circle cx="119.5" cy="74" r="1.6" fill="#FFF8E8"></circle>`;
    s += line('M88 64L102 64', INK, 3.4) + line('M114 63L128 61', INK, 3.4);
  }
  s += `<ellipse cx="86" cy="88" rx="5" ry="3.2" fill="#F09A7E" opacity="0.75"></ellipse><ellipse cx="131" cy="88" rx="5" ry="3.2" fill="#F09A7E" opacity="0.75"></ellipse>`;
  return s;
}
export const MOUTH = {
  smile: line('M104 93Q114 96 123 89', INK, 2.6),
  open: fill('M96 85Q109 87 122 84Q120 100 109 100Q98 100 96 85Z', '#5A2230', 2.4) + fill('M99 86.2L119 85L118 89L100 89.6Z', '#FFF8E8') + fill('M103 98.5Q109 92 115 98.5Z', '#E0707A'),
  wavy: line('M99 92Q103.5 88 108 92Q112.5 96 117 92', INK, 2.6),
  grit: fill('M100 88H122Q123 95 116 96H104Q99 95 100 88Z', '#FFF8E8', 2.4) + line('M107 88.5V95.5M114 88.5V95.5', INK, 1.6),
};

/**
 * o: { tunic, sleeve, legs, boots, skin, backArm:[sx,sy,hx,hy], frontArm:[...], legL:deg, legR:deg, face, mouth,
 *      under() (drawn first: cloak, carried pole), bodyExtra (clipped in body), overBody() (collar), hat(), afterFace(), hands:false }
 */
export function person(o) {
  const skin = o.skin || P.skin;
  let s = o.under ? o.under() : '';
  const leg = (hip, ankle, boot, a) =>
    g(`rotate(${a || 0} ${hip[0]} ${hip[1]})`, sh(cap(hip[0], hip[1], ankle[0], ankle[1], 9), o.legs, 3) + sh(boot, o.boots, 2));
  s += leg([84, 168], [82, 200], BOOT_L, o.legL);
  s += leg([115, 168], [117, 200], BOOT_R, o.legR);
  const arm = (a) => sh(cap(a[0], a[1], a[2], a[3], 8.5, 8), o.sleeve || o.tunic, 3);
  if (o.backArm) s += arm(o.backArm);
  const belt = o.belt === false ? '' : `<rect x="55" y="150" width="90" height="11" fill="#B07D46" stroke="${INK}" stroke-width="2.2"></rect>`;
  s += sh(BODY, o.tunic, 3, 2.6, (o.bodyExtra || '') + belt);
  if (o.belt !== false) s += sh('M95 151Q95 148 98 148L106 148Q109 148 109 151L109 160Q109 163 106 163L98 163Q95 163 95 160Z', P.sun, o.small ? 1 : 1.5, 2.2);
  if (o.overBody) s += o.overBody();
  if (o.frontArm) s += arm(o.frontArm);
  if (o.held) s += o.held();
  const hand = (a) => sh(ell(a[2], a[3], 8.5, 8.1), skin, o.small ? 1 : 2);
  if (o.backArm) s += hand(o.backArm);
  if (o.frontArm) s += hand(o.frontArm);
  let h = sh(HEAD, skin, 3) + face(o.face) + (o.mouth ?? MOUTH.smile);
  if (o.afterFace) h += o.afterFace();
  if (o.hat) h += o.hat();
  s += o.headT ? g(o.headT, h) : h;
  return s;
}
