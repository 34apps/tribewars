// Headless Chrome screenshots of mockups/[abc]-*-{1440,360}.html -> ../<name>.png (1440x900 @1x, 360x780 @2x). Optional arg: name filter.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const MOCK = join(here, '..', 'mockups'); const OUT = join(here, '..');
const PROFILE = '/private/tmp/claude-501/page-tabs-shot'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9382;
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
  const f = process.argv[2] || '';
  const names = readdirSync(MOCK).filter((x) => /^[abc]-(reports|army)-(1440|360)\.html$/.test(x) && x.includes(f)).map((x) => x.replace('.html', ''));
  for (const n of names) {
    const d = n.endsWith('1440'); const [w, h] = d ? [1440, 900] : [360, 780];
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d ? 1 : 2, mobile: !d });
    await send('Page.navigate', { url: pathToFileURL(join(MOCK, n + '.html')).href });
    await sleep(500); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode()))'); await sleep(700);
    const m = await ev(`({sw: document.documentElement.scrollWidth, fonts: [...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family).join(','), over: [...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>${w}+1||r.left<-1)&&!e.closest('.art')&&e.tagName!=='path'&&!e.closest('svg')}).slice(0,4).map(e=>e.className)})`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${n}.png`), Buffer.from(r.data, 'base64'));
    console.log(n, m.sw > w ? 'H-SCROLL' : '', m.fonts, JSON.stringify(m.over));
  }
} finally { chrome.kill(); }
