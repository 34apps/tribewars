// A still picture of the village scene for the small picture in the left column (building pages, Army). Drawing the live scene costs
// ~250 ms of SVG work every time it mounts; this turns it into an image once (off-screen, while idle) so later visits just paint a bitmap.
// Sprite markup is self-contained; the scene's own CSS rules are copied in with their custom properties resolved.

export type MiniShot = { url: string };

function sceneCss(from: Element): string {
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
  return out.join('\n');
}

/** Turn the live scene (`.vv-view` element) into a bitmap that shows exactly what is visible inside `box`. Null when it cannot be done. */
export async function snapshotScene(box: Element, view: Element): Promise<MiniShot | null> {
  try {
    const svg = view.querySelector('svg.vv-svg') as SVGSVGElement | null;
    if (!svg) return null;
    const B = box.getBoundingClientRect();
    const S = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (!B.width || !S.width || !vb.width) return null;
    // Visible part of the scene in its own units (the landscape paints outside the viewBox, so this can reach past it).
    const k = vb.width / S.width;
    const x = vb.x + (B.left - S.left) * k;
    const y = vb.y + (B.top - S.top) * k;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute('class');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${x} ${y} ${B.width * k} ${B.height * k}`);
    clone.setAttribute('width', String(B.width));
    clone.setAttribute('height', String(B.height));
    clone.setAttribute('preserveAspectRatio', 'none');
    clone.setAttribute('style', 'overflow:hidden');
    const css = `*{animation:none!important;transition:none!important}\n${sceneCss(svg)}`;
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    // An SVG picture is replayed on every paint (as slow as the live scene): keep a bitmap of it instead.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(B.width * dpr);
    canvas.height = Math.round(B.height * dpr);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return png ? { url: URL.createObjectURL(png) } : null;
  } catch (e) {
    console.warn('mini snapshot failed', e);
    return null;
  }
}
