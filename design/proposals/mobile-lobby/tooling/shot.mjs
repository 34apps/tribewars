// Headless Chrome (CDP) screenshots of mockups/*.html at 390 wide, deviceScaleFactor 2 -> shots/<name>.png (full page height, min 844).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const MOCK = join(here, '..', 'mockups'); const OUT = join(here, '..');
const PROFILE = '/private/tmp/claude-501/mobile-lobby-chrome'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9347;
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const names = readdirSync(MOCK).filter((f) => /^[abc]-.*\.html$/.test(f)).map((f) => f.replace('.html', ''));
  for (const n of names) {
    await send('Page.navigate', { url: pathToFileURL(join(MOCK, n + '.html')).href });
    await sleep(400);
    await ev('document.fonts.ready.then(()=>true)'); await sleep(900);
    const m = await ev('({h: Math.max(844, document.documentElement.scrollHeight), fonts: [...document.fonts].filter(f=>f.status==="loaded").length, sw: document.documentElement.scrollWidth})');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: m.h, deviceScaleFactor: 2, mobile: true });
    await sleep(200);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    writeFileSync(join(OUT, `${n}.png`), Buffer.from(r.data, 'base64'));
    console.log(n, m.h, 'fonts', m.fonts, m.sw > 390 ? 'H-SCROLL' : '');
  }
} finally { chrome.kill(); }
