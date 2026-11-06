// Renders the real village scene (SceneArt from apps/web) to static HTML pages for headless-Chrome screenshots.
// Usage (from the repo root): node design/proposals/village-layout/render.mjs <out-prefix> [looks...]
// Writes <out-prefix>-look<N>.html for each look (default 2 and 4): every building and the wall at that look.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const require = createRequire(root + 'package.json');
const { createServer } = await import(require.resolve('vite'));
const server = await createServer({
  root, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
});
// Sprites are fetched by URL in the app; serve them from disk here.
globalThis.fetch = async (url) => {
  const p = String(url).split('?')[0];
  const text = readFileSync(root + p.replace(/^\//, ''), 'utf8');
  return { ok: true, status: 200, text: async () => text };
};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const eng = await server.ssrLoadModule('@clanfire/engine');
const b = await server.ssrLoadModule('/src/art/buildings.ts');
const vs = await server.ssrLoadModule('/src/views/village/VillageScene.tsx');
const [, , prefix = 'out', ...lk] = process.argv;
const looks = lk.length ? lk.map(Number) : [2, 4];
const ids = eng.BUILDING_IDS;
// Preload every sprite.
for (const id of ids) for (const s of [0, 1, 2, 3, 4]) await b.loadSprite(b.spriteUrl(id, s));
await b.loadSprite(b.SCAFFOLD_URL);
const lvl = (id, look) => {
  const [a, c] = b.STAGE_TOPS[id];
  const max = eng.BUILDINGS[id].maxLevel;
  return look === 1 ? 1 : look === 2 ? a + 1 : look === 3 ? c + 1 : max;
};
for (const look of looks) {
  const arts = Object.fromEntries(ids.map((id) => [id, { stage: look, queued: false, locked: false }]));
  const vb = b.SCENE_VIEWBOX;
  const svg = renderToStaticMarkup(
    React.createElement(vs.SceneArt, { arts, vb, tier: 3, wide: true, landscape: 'tiles', selected: process.env.SEL ?? null, hearthOut: false, onBox: () => {}, onPick: () => {} }),
  );
  const labels = ids
    .filter((id) => id !== 'wall')
    .map((id) => {
      const a = b.labelAnchor(id, look);
      const l = ((a.x - vb.x) / vb.w) * 100, t = ((a.y - vb.y) / vb.h) * 100;
      return `<span class="lb" style="left:${l}%;top:${t}%">${eng.BUILDINGS[id].name}<i>${lvl(id, look)}</i></span>`;
    })
    .join('');
  const css = `html,body{margin:0;background:#3A5E27;font:700 11px Rubik,system-ui,sans-serif}
  .board{position:relative;width:1370px;height:900px;overflow:hidden;background:#3A5E27}
  .stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1350px,${(880 * vb.w) / vb.h}px);aspect-ratio:${vb.w / vb.h}}
  .stage svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  .lb{position:absolute;transform:translate(-50%,-100%);background:#FFF4DC;border:2px solid #2B211C;border-radius:10px;padding:1px 6px;white-space:nowrap;display:flex;gap:4px;align-items:center;color:#2B211C}
  .lb i{font-style:normal;background:#F2B33D;border:1.5px solid #2B211C;border-radius:9px;padding:0 4px}
  .tag{position:absolute;left:16px;top:12px;background:#2B211C;color:#FFE08F;font-size:22px;padding:6px 14px;border-radius:10px}`;
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../../apps/web/src/views/village/village.css"><style>${css}</style><div class="board"><div class="stage">${svg}<div>${labels}</div></div><div class="tag">${prefix.split('/').pop()} · look ${look}</div></div>`;
  writeFileSync(`${prefix}-look${look}.html`, html);
  console.log('wrote', `${prefix}-look${look}.html`);
}
await server.close();
