// Headless shots of the desktop top bar at several widths (checks bell + avatar sit at the right edge).
// usage: node shot.mjs <outDir>   needs: npm run build:preview, and `npx vite preview --outDir dist --port 5391` in apps/preview. Headless only.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const PROFILE = '/private/tmp/claude-501/topbar-fix-profile'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9531;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let seq = 0; const pending = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value; };
const size = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile, screenWidth: w, screenHeight: h });
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, n), Buffer.from(r.data, 'base64')); console.log('saved', n); };
const URL_ = 'http://localhost:5391/';
try {
  await send('Page.enable'); await send('Runtime.enable'); await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ }); await sleep(4000);
  // sign up a throw-away local test account in the in-browser preview
  await ev(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create account')?.click(); await sleep(500);
    const ins = [...document.querySelectorAll('input')]; set(ins[0], 'topbartest'); set(ins[1], 'topbar-test-pass-1'); if (ins[2]) set(ins[2], 'topbar-test-pass-1'); await sleep(300);
    const sub = [...document.querySelectorAll('button[type=submit], form button')].pop(); sub?.click(); return 1; })()`);
  await sleep(5000);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lead your clan')?.click()`);
  await sleep(6000);
  console.log('page', (await ev(`document.body.innerText`)).slice(0, 300));
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.fr-top, nav')`)); i++) await sleep(500);
  const m = () => ev(`(() => { const q = (s) => document.querySelector(s)?.getBoundingClientRect(); const t = q('.fr-top'), b = q('.fr-top .bell'), a = q('.fr-top .hud-avatar'), f = q('.fr-sheet'); return JSON.stringify({ win: innerWidth, top: t && [t.left, t.right], bell: b && b.right, avatar: a && a.right, sheet: f && f.right, scrollW: document.documentElement.scrollWidth }); })()`);
  for (const [w, h, name] of [[1280, 800], [1440, 900, '1440x900'], [1920, 1080, '1920x1080'], [2560, 1300]]) {
    await size(w, h, false); await sleep(800); console.log(w, await m()); if (name) await shot(`${name}.png`);
  }
  await size(360, 800, true); await send('Page.reload'); await sleep(4000); await shot('360x800.png');
  console.log(360, await ev(`document.documentElement.scrollWidth`));
} finally { ws.close(); chrome.kill(); }
