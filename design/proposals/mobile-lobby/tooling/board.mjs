// Builds board-*.png: one HTML page per screen (Now | A | B | C), screenshotted with headless Chrome.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = join(here, '..');
const SCALE = Number(process.argv[2] || 1.5);
const BOARDS = [
  ['home', 'Signed out: homepage', 'out'], ['signin', 'Sign in / Create account', 'auth'],
  ['worlds', 'Signed in: Your worlds (2 played, 9 open, 2 full, 3 finished unplayed)', 'in'], ['allworlds', 'All worlds (14): own page, filter tabs, whole page scrolls', null],
];
const COLS = [['Now', 'Current build'], ['A', 'A · Game launcher'], ['B', 'B · Clean list'], ['C', 'C · World cards']];
const PROFILE = '/private/tmp/claude-501/mobile-lobby-board'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9348;
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
  for (const [key, title, now] of BOARDS) {
    const cols = COLS.filter((c) => c[0] !== 'Now' || now);
    const cells = cols.map(([k, label]) => {
      const src = k === 'Now' ? `now/${now}.png` : `${k.toLowerCase()}-${key}.png`;
      return `<div class="col"><div class="lab ${k === 'Now' ? 'now' : ''}">${label}</div><div class="ph"><img src="../${src}"></div></div>`;
    }).join('');
    const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;600;700&display=swap"><style>
    body{margin:0;background:#e9dcc0;font-family:Rubik,sans-serif;color:#2b211c;padding:28px 36px 36px;width:max-content}
    h1{font:400 30px 'Bagel Fat One';margin:0 0 4px}.sub{font-size:16px;color:#5d4838;margin-bottom:22px}
    .row{display:flex;gap:36px;align-items:flex-start}.col{width:390px}.lab{font:400 22px 'Bagel Fat One';margin-bottom:10px;background:#f2b33d;border:3px solid #2b211c;border-radius:14px;padding:6px 14px 8px;box-shadow:0 4px 0 #2b211c;display:inline-block}.lab.now{background:#fffaf0}
    .ph{border:3px solid #2b211c;border-radius:30px;overflow:hidden;box-shadow:0 6px 0 #2b211c;background:#f6ecd6;width:390px}.ph img{display:block;width:390px;height:auto}
    </style><h1>Mobile lobby: ${title}</h1><div class="sub">Phone, 390 px wide, real Parchment tokens. ${key === 'signin' ? 'Now = 360 x 640 screenshot scaled to fit.' : ''}</div><div class="row">${cells}</div>`;
    const f = join(ROOT, 'mockups', `board-${key}.html`); writeFileSync(f, html);
    await send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 900, deviceScaleFactor: SCALE, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(f).href });
    await sleep(500); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode()))'); await sleep(600);
    const m = await ev('({w: document.body.scrollWidth, h: document.body.scrollHeight})');
    await send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: SCALE, mobile: false });
    await sleep(300);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ROOT, `board-${key}.png`), Buffer.from(r.data, 'base64'));
    console.log(key, m.w, m.h);
  }
} finally { chrome.kill(); }
