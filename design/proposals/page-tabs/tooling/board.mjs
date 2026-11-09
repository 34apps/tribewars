// Builds board-1440.png and board-360.png (rows Reports + Army, columns Now + A/B/C) with headless Chrome.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = join(here, '..');
const SCALE = 2;
const LAB = { Now: 'Now', A: 'A · Panel over the village', B: 'B · Clean list', C: 'C · Game tiles' };
const LINE = {
  reports: { Now: 'Spreadsheet look: wordy two-line rows, tiny art, empty detail box', A: 'Village art stays behind one big cream sheet; one-line rows, list plus detail', B: 'Plain page, one card, 56 px one-line rows with dividers; list and detail', C: 'Chunky tiles: big Won / Lost / Loot block, name, time; 4 per row' },
  army: { Now: 'Number table full of zeros (this shot is the seeding glitch: real data is 40 / 25 / 12 ...)', A: 'Same sheet: moves and training on top, one line per unit with a big count', B: 'One row per unit with portrait and big count; movements and training as rows', C: 'Incoming attack first as a strip, then big unit tiles with away and training badges' },
  pr: { Now: 'Wordy rows, fixed header and cards', A: 'Cream sheet over the art, segmented tabs, one-line rows', B: 'One card, 56 px rows, small-caps day headers', C: 'Two tiles per row, outcome block on top' },
  pa: { Now: 'Zero-filled table', A: 'Moves, training, then one line per unit', B: 'Movement rows, then unit rows with portraits', C: 'Swipe strip of movements, then unit tiles' },
};
const CSS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;600;700&display=swap"><style>
body{margin:0;background:#e9dcc0;font-family:Rubik,sans-serif;color:#2b211c;padding:30px 40px 40px;width:max-content}
h1{font:400 32px 'Bagel Fat One';margin:0 0 4px}.sub{font-size:16px;color:#5d4838;margin-bottom:22px}
.lab{font:400 24px 'Bagel Fat One';background:#f2b33d;border:3px solid #2b211c;border-radius:14px;padding:6px 14px 8px;box-shadow:0 4px 0 #2b211c;display:inline-block}.lab.now{background:#fffaf0}
.lab.s{font-size:19px;padding:4px 11px 6px;border-radius:12px}
.line{font-size:14px;line-height:1.3;color:#3e3028;margin:10px 0 12px;font-weight:600}
.fr{border:2px solid #2b211c;line-height:0;background:#fff;box-shadow:0 5px 0 rgba(43,33,28,.35)}.fr img{display:block;width:560px}
.g4{display:grid;grid-template-columns:70px repeat(4,560px);gap:0 30px;align-items:start}
.p4{display:grid;grid-template-columns:60px repeat(4,280px);gap:0 26px;align-items:start}
.rl{font:400 26px 'Bagel Fat One';writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;align-self:center;justify-self:center}
.ph{border:3px solid #2b211c;border-radius:30px;overflow:hidden;box-shadow:0 6px 0 #2b211c;line-height:0;width:280px}.ph img{width:280px;display:block}
.gap{grid-column:1/-1;height:36px}
</style>`;
const K = ['Now', 'A', 'B', 'C'];
const src = (k, page, w) => (k === 'Now' ? `../now/${page}-${w}.png` : `../${k.toLowerCase()}-${page}-${w}.png`).replace('../', '');
const boards = [];
const rowD = (name, page) => `<div class="rl">${name}</div>` + K.map((k) => `<div><div class="lab ${k === 'Now' ? 'now' : ''}">${LAB[k]}</div><div class="line" style="min-height:38px">${LINE[page][k]}</div><div class="fr"><img src="${src(k, page, 1440)}"></div></div>`).join('');
boards.push(['board-1440', `<h1>Page tabs: Reports and Army, desktop 1440 x 900</h1><div class="sub">Now vs three options. Same data in every picture. Header and dock unchanged.</div><div class="g4">${rowD('Reports', 'reports')}<div class="gap"></div>${rowD('Army', 'army')}</div>`]);
const heads = K.map((k) => `<div><div class="lab s ${k === 'Now' ? 'now' : ''}">${LAB[k]}</div></div>`).join('');
const rowP = (name, page, key) => `<div class="rl">${name}</div>` + K.map((k) => `<div><div class="line" style="min-height:52px;font-size:13px">${LINE[key][k]}</div><div class="ph"><img src="${src(k, page, 360)}"></div></div>`).join('');
boards.push(['board-360', `<h1>Page tabs on a phone: 360 x 780</h1><div class="sub">Top row: Reports. Bottom row: Army. Now vs three options.</div><div class="p4"><div></div>${heads}${rowP('Reports', 'reports', 'pr')}<div class="gap"></div><div></div>${heads}${rowP('Army', 'army', 'pa')}</div>`]);
const PROFILE = '/private/tmp/claude-501/page-tabs-board'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9383;
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
    const f = join(ROOT, 'mockups', `${name}.html`); writeFileSync(f, `<!doctype html><meta charset="utf-8"><base href="../">${CSS}${body}`);
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
