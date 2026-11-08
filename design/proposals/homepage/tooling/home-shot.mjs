// Headless Chrome CDP screenshots of the signed-out lobby homepage (vite dev + faked /lobby/api), at four sizes.
// usage: node home-shot.mjs <outDir>   (needs vite dev on 127.0.0.1:5199:  cd apps/web && npx vite --host 127.0.0.1 --port 5199 --strictPort)
// Saves home-1440x900.png, home-1280x720.png, home-360x640.png, home-360x780.png and prints scrollHeight vs innerHeight per size.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node home-shot.mjs <outDir>'); process.exit(1); }
const PROFILE = '/private/tmp/claude-501/home-shot/chrome-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9342;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws; let seq = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
}
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
}
async function waitFor(expr, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(250); }
  throw new Error('timeout waiting for ' + expr);
}
const now = Date.now();
const WORLDS = { worlds: [
  { id: 'w4', name: 'Hollow Marsh', status: 'open', path: '/w/w4/', openedAt: now - 3 * 86400000 },
  { id: 'w5', name: 'Cinder Vale', status: 'open', path: '/w/w5/', openedAt: now - 9 * 86400000 },
  { id: 'w6', name: 'Ashfall', status: 'full', path: '/w/w6/', openedAt: now - 20 * 86400000 },
] };
const json = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5199/lobby/api/*' }] });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url; let body = { error: 'not_found' }; let status = 404;
    if (u.includes('/auth/me')) { body = { account: null }; status = 200; }
    else if (u.includes('/worlds/public')) { body = WORLDS; status = 200; }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) }).catch(() => {});
  });
  for (const [w, h, mob] of [[1440, 900, false], [1280, 720, false], [360, 640, true], [360, 780, true]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mob ? 2 : 1, mobile: mob });
    await send('Page.navigate', { url: 'http://127.0.0.1:5199/lobby/' });
    await waitFor(`document.querySelector('.home-village-stage[data-ready="true"]')`);
    await waitFor(`document.querySelector('.home-world')`);
    await sleep(900); // fade-in
    const m = await evalJs(`({ sh: document.documentElement.scrollHeight, bsh: document.body.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth })`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `home-${w}x${h}.png`), Buffer.from(r.data, 'base64'));
    console.log(`${w}x${h}`, `scrollHeight=${m.sh} body=${m.bsh} innerHeight=${m.ih}`, m.sh <= m.ih ? 'NO-SCROLL' : 'SCROLLS', `scrollWidth=${m.sw} innerWidth=${m.iw}`, m.sw <= m.iw ? '' : 'H-SCROLL');
  }
} catch (e) { console.error(e); } finally { chrome.kill(); }
