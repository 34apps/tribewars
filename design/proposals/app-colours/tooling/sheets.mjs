// node sheets.mjs : builds the 4 comparison sheets (HTML -> PNG via headless Chrome CDP) from ../raw/*.png
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
const D = new URL('..', import.meta.url).pathname;
const COLS = [
  ['now', 'Now', 'Dark brown top bar and panels on a brown table.'],
  ['a', 'A · Parchment', 'Warm paper page, cream panels, honey top bar.'],
  ['b', 'B · Meadow & sky', 'Pale sky page, white panels, moss-green top bar.'],
  ['c', 'C · Sunny wood', 'Light honey wood page, cream panels, teal top bar.'],
];
const css = `body{margin:0;background:#2b211c;font-family:'Rubik',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#fff8e8}
.sheet{padding:36px 40px 40px}.h{margin:0 0 6px;font-size:30px;letter-spacing:.2px}.sub{margin:0 0 26px;font-size:18px;color:#d8c9a8}
.grid{display:grid;gap:28px}.col h2{margin:0;font-size:38px;font-weight:800;line-height:1.1}.col p{margin:4px 0 14px;font-size:20px;color:#e8d9bc;min-height:50px}
.col img{display:block;width:100%;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.45)}.row2{margin-top:30px}.cap{margin:26px 0 8px;font-size:20px;color:#d8c9a8}
.ph{display:flex;gap:14px;justify-content:center}.ph img{width:calc(50% - 7px)}.ph1 img{width:55%}`;
const img = (f) => `<img src="file://${D}raw/${f}">`;
function page(title, sub, cols, body, w) { return `<!doctype html><meta charset=utf-8><style>${css}</style><div class=sheet style="width:${w - 80}px"><div class=h>${title}</div><div class=sub>${sub}</div>${body}</div>`; }
const two = (shotFn, w) => `<div class=grid style="grid-template-columns:1fr 1fr">${COLS.map(([k, t, l]) => `<div class=col><h2>${t}</h2><p>${l}</p>${img(shotFn(k))}</div>`).join('')}</div>`;
const four = (shotFn) => `<div class=grid style="grid-template-columns:repeat(4,1fr)">${COLS.map(([k, t, l]) => `<div class=col><h2>${t}</h2><p>${l}</p>${shotFn(k)}</div>`).join('')}</div>`;
const SHEETS = {
  '1-homepage-1440.png': [2400, page('Homepage (signed out, 1440 wide)', 'Same page, four colour looks. The village picture is not changed.', 0, two((k) => `home-1440-${k}.png`), 2400)],
  '2-village-1440.png': [2400, page('Village screen in the game (1440 wide)', 'Top bar, buttons, side panels and the page behind. The village picture is not changed.', 0, two((k) => `village-1440-${k}.png`), 2400)],
  '3-army-1440.png': [2400, page('Army screen in the game (1440 wide)', 'The busiest screen: lists, movements, forms and buttons.', 0, two((k) => `army-1440-${k}.png`), 2400)],
  '4-phone-360.png': [2400, page('Phone (360 wide)', 'Top row: homepage and the village screen. Bottom row: the village screen with a building opened.', 0,
    four((k) => `<div class="ph">${img(`home-360-${k}.png`)}${img(`village-360-${k}.png`)}</div><div class="ph ph1" style="margin-top:20px">${img(`sheet-360-${k}.png`)}</div>`), 2400)],
};
const PROFILE = '/private/tmp/claude-501/app-colours-sheets/profile'; rmSync(PROFILE, { recursive: true, force: true });
mkdirSync('/private/tmp/claude-501/app-colours-sheets', { recursive: true });
const PORT = 9351;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--allow-file-access-from-files', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
try {
  await send('Page.enable'); await send('Runtime.enable');
  for (const [name, [w, html]] of Object.entries(SHEETS)) {
    const f = `/private/tmp/claude-501/app-colours-sheets/${name}.html`; writeFileSync(f, html);
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + f }); await sleep(1500);
    const h = (await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.value;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(600);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(D + name, Buffer.from(r.data, 'base64')); console.log('saved', name, w, h);
  }
} finally { chrome.kill(); }
