// Builds board-1440-village.png, board-1440-notif.png, board-360.png (Now + A/B/C side by side) with headless Chrome.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = join(here, '..');
const SCALE = 2;
const LAB = {
  Now: 'Now', A: 'A · Tidy bar', B: 'B · Game HUD', C: 'C · Side rail + Now panel',
};
const LINE = {
  village: { Now: 'Four attack warnings, icon-only tabs, village squeezed by panels', A: 'Same layout: labels on every tab, one attack pill, no strips', B: 'Art edge to edge, floating pills, bottom dock, one attack card', C: 'Left rail and a Now column: attack, building, steps, alerts' },
  notif: { Now: '21 red rows with Show buttons, art dimmed', A: 'Right drawer, art stays bright, On the way / Earlier one-line rows', B: 'Floating sheet over bright art, same one-line rows', C: 'Alerts open inside the Now column, no popup' },
  p: { Now: 'Four warnings, tiny tabs, two big cards on the art', A: 'One-row strip, one attack line, 5 tabs', B: 'Full-bleed art, floating chips and dock', C: 'Top bar, resources, swipe Now cards, 5 tabs' },
};
const CSS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;600;700&display=swap"><style>
body{margin:0;background:#e9dcc0;font-family:Rubik,sans-serif;color:#2b211c;padding:30px 40px 40px;width:max-content}
h1{font:400 32px 'Bagel Fat One';margin:0 0 4px}.sub{font-size:16px;color:#5d4838;margin-bottom:22px}
.lab{font:400 24px 'Bagel Fat One';background:#f2b33d;border:3px solid #2b211c;border-radius:14px;padding:6px 14px 8px;box-shadow:0 4px 0 #2b211c;display:inline-block}.lab.now{background:#fffaf0}
.line{font-size:15px;line-height:1.3;color:#3e3028;margin:10px 0 12px;font-weight:600}
.fr{border:2px solid #2b211c;line-height:0;background:#fff;box-shadow:0 5px 0 rgba(43,33,28,.35)}.fr img{display:block}
.g2{display:grid;grid-template-columns:640px 640px;gap:34px 44px}
.g4{display:grid;grid-template-columns:90px repeat(4,300px);gap:0 30px;align-items:start}.rl{font:400 22px 'Bagel Fat One';writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;align-self:center;justify-self:center}
.ph{border:3px solid #2b211c;border-radius:30px;overflow:hidden;box-shadow:0 6px 0 #2b211c;line-height:0;width:300px}.ph img{width:300px;display:block}
</style>`;
const cell = (k, key, src) => `<div><div class="lab ${k === 'Now' ? 'now' : ''}">${LAB[k]}</div><div class="line">${LINE[key][k]}</div><div class="fr"><img src="${src}" width="640"></div></div>`;
const pcol = (k, src) => `<div class="ph"><img src="${src}"></div>`;
const boards = [];
for (const key of ['village', 'notif']) boards.push([`board-1440-${key}`, `<h1>In-game ${key === 'village' ? 'village screen' : 'alerts open'}: desktop 1440 x 900</h1><div class="sub">Now vs three options. Same data in every picture.</div><div class="g2">${['Now', 'A', 'B', 'C'].map((k) => cell(k, key, k === 'Now' ? `../now/${key === 'village' ? 'village' : 'notif'}-1440.png` : `../${k.toLowerCase()}-${key}-1440.png`)).join('')}</div>`]);
const heads = ['Now', 'A', 'B', 'C'].map((k) => `<div><div class="lab ${k === 'Now' ? 'now' : ''}">${LAB[k]}</div><div class="line" style="min-height:40px">${LINE.p[k]}</div></div>`).join('');
const rowOf = (name, key) => `<div class="rl">${name}</div>` + ['Now', 'A', 'B', 'C'].map((k) => pcol(k, k === 'Now' ? `../now/${key}-360.png` : `../${k.toLowerCase()}-${key}-360.png`)).join('');
boards.push(['board-360', `<h1>In-game screens on a phone: 360 x 780</h1><div class="sub">Top row: village. Bottom row: alerts open. Now vs three options.</div><div class="g4"><div></div>${heads}${rowOf('Village', 'village')}<div style="grid-column:1/-1;height:34px"></div>${rowOf('Alerts open', 'notif')}</div>`]);
const PROFILE = '/private/tmp/claude-501/ingame-clarity-board'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9373;
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
  for (const [name, body] of boards) {
    const f = join(ROOT, 'mockups', `${name}.html`); writeFileSync(f, `<!doctype html><meta charset="utf-8">${CSS}${body}`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: SCALE, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(f).href });
    await sleep(500); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode()))'); await sleep(600);
    const m = await ev('({w: document.body.scrollWidth, h: document.body.scrollHeight})');
    await send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: SCALE, mobile: false });
    await sleep(300);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ROOT, `${name}.png`), Buffer.from(r.data, 'base64'));
    console.log(name, m.w, m.h);
  }
} finally { chrome.kill(); }
