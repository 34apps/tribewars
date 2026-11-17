// Turns a React SVG tree into a self-contained SVG string, so a layer that never animates (the village landscape and ground)
// can be shown as one <img> instead of thousands of live DOM nodes (see SceneBackdrop in views/village/VillageScene.tsx).

import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/**
 * Renders `svg` (a root <svg> element that carries its own <defs>, so every <use> target is inside it) into a detached
 * container and returns it as an XML string. Call it from a timer or event, never during render or an effect (flushSync).
 */
export function renderStaticSvg(svg: ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(svg));
    const el = host.firstElementChild;
    if (!el) throw new Error('renderStaticSvg: nothing rendered');
    return new XMLSerializer().serializeToString(el);
  } finally {
    root.unmount();
  }
}
