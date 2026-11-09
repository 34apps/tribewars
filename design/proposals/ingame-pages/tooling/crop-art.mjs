// Writes tightly cropped copies of the building and unit-figure art (viewBox = drawing's bounding box + a small margin),
// so thumbnails fill their box: mockups/buildings/*.svg -> mockups/crop/b-<name>.svg, mockups/units/*-idle.svg -> mockups/crop/u-<id>.svg.
// Uses headless Chrome getBBox(). Run once after copying art: node tooling/crop-art.mjs
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const MOCK = join(here, '..', 'mockups'); const CROP = join(MOCK, 'crop');
mkdirSync(CROP, { recursive: true });
const files = [
  ...readdirSync(join(MOCK, 'buildings')).filter((f) => f.endsWith('.svg')).map((f) => ['buildings/' + f, 'b-' + f]),
  ...readdirSync(join(MOCK, 'units')).filter((f) => f.endsWith('-idle.svg')).map((f) => ['units/' + f, 'u-' + f.replace('-idle', '')]),
];
const PROFILE = '/private/tmp/claude-501/ingame-pages-crop'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9493;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
try {
  await send('Runtime.enable');
  for (const [src, out] of files) {
    const svg = readFileSync(join(MOCK, src), 'utf8');
    const expr = `(() => { document.body.innerHTML = ${JSON.stringify(svg)}; const s = document.querySelector('svg'); const b = s.getBBox(); return [b.x, b.y, b.width, b.height]; })()`;
    const [x, y, w, h] = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
    const m = Math.max(w, h) * 0.03; const vb = [x - m, y - m, w + 2 * m, h + 2 * m].map((v) => +v.toFixed(2));
    const fixed = svg.replace(/viewBox="[^"]*"/, `viewBox="${vb.join(' ')}"`).replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${Math.round(vb[2] * 2)}" height="${Math.round(vb[3] * 2)}"`);
    writeFileSync(join(CROP, out), fixed);
    console.log(out, vb.join(' '));
  }
} finally { chrome.kill(); }
