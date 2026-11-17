// A still picture of the village scene for the small picture in the left column (building pages, Army). Drawing the live scene costs
// ~250 ms of SVG work every time it mounts; this turns it into an image once (off-screen, while idle) so later visits just paint a bitmap.
//
// An SVG that is loaded as an <img> is a sealed document: it cannot load a blob: URL, and a <use> can only see defs inside the same
// document (Safari paints nothing for either: the owner saw a plain green box, 2026-11-17). So the picture is built in two steps:
//  1. the still back layer (landscape + ground, already one decoded <image> in the scene) is drawn onto the canvas as a bitmap;
//  2. the live layers are put in one self-contained SVG (the shared defs they point at copied in, the scene's own CSS rules inlined
//     with their custom properties resolved), rasterised, and drawn over it.
// `snapshotProblems` refuses a source that would paint empty, so a broken picture is never shown or kept.

import { FIRE_BOX } from '../../art/scenery.tsx';

export type MiniShot = { url: string };

let cssCache: string | null = null;

function sceneCss(from: Element): string {
  if (cssCache !== null) return cssCache;
  const cs = getComputedStyle(from);
  const out: string[] = [];
  const fix = (text: string) => text.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback?: string) => cs.getPropertyValue(name).trim() || fallback || 'inherit');
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && /\.vv-|\.tl-|\.ls-/.test(rule.selectorText) && !/\.fv-|\.frame/.test(rule.selectorText)) out.push(fix(rule.cssText));
    }
  }
  cssCache = out.join('\n');
  return cssCache;
}

/**
 * What would make an SVG used as an image paint empty or half empty: a `blob:` reference (sealed documents cannot load them) or a
 * `<use>` whose target id is not in the same source. Returns one line per problem; empty when the source is fine.
 */
export function snapshotProblems(xml: string): string[] {
  const problems: string[] = [];
  if (/blob:/i.test(xml)) problems.push('contains a blob: reference');
  const ids = new Set(Array.from(xml.matchAll(/\sid="([^"]+)"/g), (m) => m[1]!));
  const missing = new Set<string>();
  for (const m of xml.matchAll(/<use\b[^>]*?\s(?:xlink:)?href="#([^"]+)"/g)) if (!ids.has(m[1]!)) missing.add(m[1]!);
  for (const id of missing) problems.push(`<use> target #${id} is missing`);
  return problems;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

/** Width of the picture in pixels: sharp at twice the size the small picture is shown at. */
const SHOT_WIDTH = 640;

/**
 * Turn the live scene (`.vv-view` element) into a bitmap of its whole picture box (SCENE_FIT_BOX). It reads no layout, so it works while
 * the scene is hidden; the small picture shows it centred and cropped to fit (`object-fit: cover`, same as the scene's own stage).
 * Null when it cannot be done.
 */
export async function snapshotScene(view: Element): Promise<MiniShot | null> {
  try {
    // The scene is stacked layers: still back layer (one <image>, or the drawn landscape while that is not ready), then the live layer.
    const layers = Array.from(view.querySelectorAll('svg.vv-svg')) as SVGSVGElement[];
    const back = layers.find((l) => l.classList.contains('vv-svg-back')) ?? null;
    const live = layers.filter((l) => l !== back);
    const ref = live[0] ?? back;
    if (!ref) return null;
    const vb = ref.viewBox.baseVal;
    if (!vb.width || !vb.height) return null;
    const { x, y, width: vw, height: vh } = vb;
    const outW = SHOT_WIDTH;
    const outH = Math.round((SHOT_WIDTH * vh) / vw);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#9cc46a';
    g.fillRect(0, 0, outW, outH);
    const px = outW / vw; // canvas pixels per scene unit

    // Step 1: the still back layer, as the bitmap it already is.
    const pic = back?.querySelector('image') ?? null;
    if (pic) {
      const href = pic.getAttribute('href') ?? '';
      const img = await loadImage(href);
      const ix = Number(pic.getAttribute('x'));
      const iy = Number(pic.getAttribute('y'));
      const iw = Number(pic.getAttribute('width'));
      const ih = Number(pic.getAttribute('height'));
      g.drawImage(img, (ix - x) * px, (iy - y) * px, iw * px, ih * px);
    }

    // Step 2: everything else in one self-contained SVG.
    const clone = document.createElementNS(SVG_NS, 'svg');
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', `${x} ${y} ${vw} ${vh}`);
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
    clone.setAttribute('preserveAspectRatio', 'none');
    clone.setAttribute('style', 'overflow:hidden');
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = `*{animation:none!important;transition:none!important}\n${sceneCss(ref)}`;
    clone.appendChild(style);
    const defs = view.ownerDocument.querySelector('svg.vv-defs defs');
    if (defs) clone.appendChild(defs.cloneNode(true));
    if (back && !pic) for (const child of Array.from(back.childNodes)) clone.appendChild(child.cloneNode(true));
    for (const layer of live) for (const child of Array.from(layer.childNodes)) clone.appendChild(child.cloneNode(true));
    // The campfire's still parts (own small SVGs in a box over the scene; flames and smoke only move, so they are left out).
    for (const fire of Array.from(view.querySelectorAll('.vv-fire-box > svg:not(.vv-flame):not(.vv-fire-puff)'))) {
      const f = fire.cloneNode(true) as SVGSVGElement;
      f.removeAttribute('class');
      f.removeAttribute('style');
      f.setAttribute('x', String(FIRE_BOX.x));
      f.setAttribute('y', String(FIRE_BOX.y));
      f.setAttribute('width', String(FIRE_BOX.w));
      f.setAttribute('height', String(FIRE_BOX.h));
      clone.appendChild(f);
    }
    const xml = new XMLSerializer().serializeToString(clone);
    const problems = snapshotProblems(xml);
    if (problems.length) {
      console.warn('mini snapshot would paint empty:', problems.join('; '));
      return null;
    }
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    try {
      g.drawImage(await loadImage(url), 0, 0, outW, outH);
    } finally {
      URL.revokeObjectURL(url);
    }
    // An SVG picture is replayed on every paint (as slow as the live scene): keep a bitmap of it instead. A data: URL, so it can also
    // be kept across reloads (miniShots.ts).
    const jpg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!jpg) return null;
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(jpg);
    });
    return { url: data };
  } catch (e) {
    console.warn('mini snapshot failed', e);
    return null;
  }
}
