// The game as ONE FIXED-SIZE FRAME (owner, 2026-11-09): the 1440x900 page never shrinks or rearranges with the window.
//   wide-a-1920.png   frame centred at the top of a 1920x1080 window, our toy landscape (terrain sprites) washed out around it
//   wide-b-1920.png   same, plain Parchment paper around it; the top bar's band runs edge to edge
//   narrow-1180.png   a 1180x760 window: the frame keeps its size, scrollbars appear (drawn, headless Chrome hides real ones)
//   board-frame.png   the three together (@2x)
// The frame is the real Mix village page (../mix-village-1440.png from tooling/shot.mjs). Run: node tooling/frame.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = join(here, '..'); const MOCK = join(ROOT, 'mockups');
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700&display=swap">';
const PAGE = '#f6ecd6', LINES = 'repeating-linear-gradient(180deg,transparent 0 94px,rgba(174,126,74,.09) 94px 96px)';
const FR = { x: 240, w: 1440, h: 900 }; // frame in the 1920 window

/* ---------- A · toy landscape from the game's own terrain tiles (iso grid, tile 89.2 x 44.6) ---------- */
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const HX = 44.6, HY = 22.3, OX = 960, OY = -900;
const pos = (c, r) => [OX + (c - r) * HX, OY + (c + r) * HY];
// River: a vertical meander down the right side (steps alternate SE and SW: pieces sw-nw / ne-se).
const river = new Map();
{
  let best = null; // start tile near x 1812, y -60
  for (let c = -60; c < 80; c++) for (let r = -60; r < 80; r++) { const [x, y] = pos(c, r); const d = Math.abs(x - 1812) + Math.abs(y + 60); if (!best || d < best[0]) best = [d, c, r]; }
  let [, c, r] = best;
  for (let i = 0; i < 60; i++) { river.set(`${c},${r}`, i % 2 ? 'river-ne-se' : 'river-sw-nw'); if (i % 2) c += 1; else r += 1; }
}
const tileFor = (x, y, c, r) => {
  const k = river.get(`${c},${r}`); if (k) return k;
  if (x < FR.x + 40 || (y > FR.h - 20 && x < 760)) { // forest and hills side
    if (y < 260 && x < 170) return pick(['mountain-1', 'mountain-2', 'hills-1', 'forest-dense-1']);
    if (x < 150) return pick(['forest-dense-1', 'forest-dense-2', 'forest-dense-1', 'forest-light-1', 'hills-1']);
    return pick(['forest-light-1', 'forest-light-2', 'hills-1', 'hills-2', 'grass-2', 'forest-dense-2', 'bush', 'rocks']);
  }
  if (x > FR.x + FR.w - 40 || (y > FR.h - 20 && x > 1180)) { // fields and river side
    const nearRiver = [...river.keys()].some((kk) => { const [rc, rr] = kk.split(',').map(Number); return Math.abs(rc - c) + Math.abs(rr - r) === 1; });
    if (nearRiver) return pick(['meadow', 'grass-1', 'clover', 'grass-3']);
    return pick(['meadow', 'grass-1', 'wheat-1', 'grass-2', 'wheat-2', 'meadow', 'sheep-grazing', 'grass-3', 'haystack', 'flowers']);
  }
  return pick(['grass-1', 'grass-2', 'grass-3', 'meadow', 'flowers', 'daisies', 'tufts', 'clover', 'stump']); // the open ground below
};
const tiles = [];
for (let c = -60; c < 80; c++) for (let r = -60; r < 80; r++) {
  const [x, y] = pos(c, r); const L = x - 64, T = y - 116;
  if (L > 1920 || L + 128 < 0 || T > 1080 || T + 156 < 0) continue;
  if (L >= FR.x && L + 128 <= FR.x + FR.w && T + 156 <= FR.h) continue; // fully behind the frame
  tiles.push([c + r, c, `<img src="terrain/${tileFor(x, y, c, r)}.svg" style="left:${L.toFixed(1)}px;top:${T.toFixed(1)}px" alt="">`]);
}
tiles.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const land = `<div class="land">${tiles.map((t) => t[2]).join('')}</div>`;

const frameImg = `<img class="frame" src="../mix-village-1440.png" alt="">`;
const BASE = `html,body{margin:0}body{position:relative;overflow:hidden;background-color:${PAGE};background-image:${LINES};font-family:Rubik,sans-serif}`;
const pageA = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}body{width:1920px;height:1080px}
.land{position:absolute;inset:0;opacity:.6;filter:saturate(.72) brightness(1.04)}.land img{position:absolute;width:128px;height:156px}
.halo{position:absolute;left:${FR.x}px;top:0;width:${FR.w}px;height:${FR.h}px;box-shadow:0 0 110px 70px rgba(246,236,214,.93)}
.frame{position:absolute;left:${FR.x}px;top:0;width:${FR.w}px;height:${FR.h}px;outline:3px solid #2b211c;box-shadow:0 14px 44px rgba(43,33,28,.32),0 5px 0 rgba(43,33,28,.55)}
</style></head><body>${land}<div class="halo"></div>${frameImg}</body></html>`;

const pageB = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}body{width:1920px;height:1080px}
.shadow{position:absolute;left:${FR.x}px;top:0;width:${FR.w}px;height:${FR.h}px;box-shadow:0 0 0 1.5px #cdb98e,0 10px 34px rgba(43,33,28,.16);z-index:1}
.band{position:absolute;left:0;right:0;top:0;height:68px;box-sizing:border-box;background:#fffaf0;border-bottom:2.5px solid #2b211c;z-index:2}
.frame{position:absolute;left:${FR.x}px;top:0;width:${FR.w}px;height:${FR.h}px;z-index:3}
</style></head><body><div class="shadow"></div><div class="band"></div>${frameImg}</body></html>`;

// Narrow window: viewport 1180x760 incl. 15 px scrollbars -> 1165x745 of the frame visible, left-aligned, nothing shrinks.
const VW = 1180, VH = 760, SB = 15, CW = VW - SB, CH = VH - SB;
const vThumb = Math.round((CH - 4) * (CH / FR.h)), hThumb = Math.round((CW - 4) * (CW / FR.w));
const pageN = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}body{width:${VW}px;height:${VH}px}
.view{position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;overflow:hidden}.view img{display:block;width:${FR.w}px;height:${FR.h}px}
.sbv{position:absolute;right:0;top:0;width:${SB}px;height:${CH}px;background:#f3f3f3;border-left:1px solid #dadada;box-sizing:border-box}
.sbh{position:absolute;left:0;bottom:0;width:${CW}px;height:${SB}px;background:#f3f3f3;border-top:1px solid #dadada;box-sizing:border-box}
.corner{position:absolute;right:0;bottom:0;width:${SB}px;height:${SB}px;background:#f3f3f3}
.tv{position:absolute;left:3px;top:2px;width:8px;height:${vThumb}px;border-radius:5px;background:#a3a3a3}
.th{position:absolute;top:3px;left:2px;height:8px;width:${hThumb}px;border-radius:5px;background:#a3a3a3}
</style></head><body><div class="view"><img src="../mix-village-1440.png" alt=""></div><div class="sbv"><span class="tv"></span></div><div class="sbh"><span class="th"></span></div><div class="corner"></div></body></html>`;

/* ---------- board ---------- */
const LAB = { a: 'A · Toy landscape around the game', b: 'B · Plain paper around the game', n: 'Smaller window: scrollbars, nothing shrinks' };
const LINE = {
  a: 'A 1920 × 1080 window. The 1440 × 900 game sits at the top in the middle; our own toy landscape, washed out, fills both sides and the space below.',
  b: "The same window with calm paper and faint board lines; the top bar's band runs edge to edge, its contents stay inside the game.",
  n: 'A 1180 × 760 window. The game keeps its size: scrollbars appear and the right side and the bottom are cut off.',
};
const board = `<!doctype html><meta charset="utf-8"><base href="../">${FONTS}<style>
body{margin:0;background:#eadcbc;font-family:Rubik,sans-serif;color:#2b211c;padding:34px 40px 44px;width:max-content}
h1{font:400 38px/1.3 'Bagel Fat One';margin:0}.sub{font:500 18px/1.4 Rubik;color:#4a3a2f;margin:2px 0 26px}
.lab{display:inline-block;font:400 28px/1.3 'Bagel Fat One';background:#f2b33d;border:3px solid #2b211c;border-radius:16px;padding:4px 16px 6px;box-shadow:0 4px 0 #2b211c}.lab.n{background:#fffaf0}
.line{font:600 17px/1.35 Rubik;color:#3e3028;margin:12px 0 14px;min-height:46px;max-width:960px}
.fr{border:3px solid #2b211c;border-radius:6px;overflow:hidden;line-height:0;background:#fff;box-shadow:0 6px 0 rgba(43,33,28,.35);width:max-content}.fr img{display:block}
.g{display:grid;grid-template-columns:repeat(2,966px);gap:34px 44px}
</style><h1>One fixed-size game frame · wide and narrow windows</h1><div class="sub">The game is always 1440 × 900. Wider windows get a calm backdrop around it; smaller windows get scrollbars. Shown at the same scale.</div>
<div class="g"><div><span class="lab">${LAB.a}</span><div class="line">${LINE.a}</div><div class="fr"><img src="wide-a-1920.png" style="width:960px"></div></div>
<div><span class="lab">${LAB.b}</span><div class="line">${LINE.b}</div><div class="fr"><img src="wide-b-1920.png" style="width:960px"></div></div>
<div><span class="lab n">${LAB.n}</span><div class="line">${LINE.n}</div><div class="fr"><img src="narrow-1180.png" style="width:${VW / 2}px"></div></div></div>`;

const shots = [['wide-a-1920', pageA, 1920, 1080, 1], ['wide-b-1920', pageB, 1920, 1080, 1], ['narrow-1180', pageN, VW, VH, 1], ['board-frame', board, 0, 0, 2]];
const PROFILE = '/private/tmp/claude-501/ingame-pages-frame'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9494;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (const [name, html, w, h, scale] of shots) {
    const f = join(MOCK, `${name}.html`); writeFileSync(f, html);
    await send('Emulation.setDeviceMetricsOverride', { width: w || 2100, height: h || 1000, deviceScaleFactor: scale, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(f).href });
    await sleep(800); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))'); await sleep(600);
    let [W, H] = [w, h];
    if (!w) { const m = await ev('({w: document.body.scrollWidth, h: document.body.scrollHeight})'); [W, H] = [m.w, m.h]; await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false }); await sleep(400); }
    const bad = await ev('[...document.images].filter(i=>!i.naturalWidth).length');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ROOT, `${name}.png`), Buffer.from(r.data, 'base64'));
    console.log(name, W * scale, 'x', H * scale, bad ? `${bad} IMG FAILED` : '');
  }
  console.log('tiles', tiles.length);
} finally { chrome.kill(); }
