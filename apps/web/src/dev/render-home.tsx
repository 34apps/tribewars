// DEV ONLY render page for scripts/render-home-village.mjs (served by the vite dev server at /render-home.html, not part
// of the production build). Draws the live village scene at 1:1 scene units inside a frame of ?w x ?h CSS px, centred,
// with the same green backdrop and clipping as the homepage's hero frame, and flags body[data-art-ready] once every
// sprite has loaded and painted.

import { createRoot } from 'react-dom/client';
import '../styles.css';
import '../components/home.css';
import { SCENE_VIEWBOX } from '../art/buildings.ts';
import HomeVillageLive from './HomeVillageLive.tsx';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 1236);
const H = Number(q.get('h') ?? 1266);

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; overflow: hidden; background: #8fb85a; }
  .render-frame { width: ${W}px; height: ${H}px; display: grid; place-items: center; overflow: hidden; background: #8fb85a; }
  .home-village-stage { position: relative; aspect-ratio: var(--vb-ratio); }
  .home-village-stage .vv-svg { pointer-events: none; }
  .render-frame .home-village-stage { width: ${SCENE_VIEWBOX.w}px !important; opacity: 1 !important; transition: none !important; }
`;
document.head.append(style);

createRoot(document.getElementById('root')!).render(
  <div className="render-frame">
    <HomeVillageLive />
  </div>,
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle() {
  while (!document.querySelector('.home-village-stage[data-ready="true"]')) await sleep(100);
  // Every <image> inside the scene (landscape tiles, sprites) must be fetched and decoded.
  let lastCount = -1;
  for (let i = 0; i < 100; i++) {
    const urls = [...new Set([...document.querySelectorAll('svg image')].map((n) => n.getAttribute('href') ?? n.getAttribute('xlink:href')).filter((u): u is string => !!u))];
    await Promise.all(
      urls.map(
        (u) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = img.onerror = () => res();
            img.src = u;
          }),
      ),
    );
    if (urls.length === lastCount) break; // no new images appeared since the last pass
    lastCount = urls.length;
    await sleep(300);
  }
  await sleep(500);
  document.body.dataset.artReady = '1';
}
void settle();
