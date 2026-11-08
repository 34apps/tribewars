// Times the signed-out homepage's village on a throttled connection, and takes final + mid-load screenshots.
// usage: node home-load.mjs <distDir> <label> <outDir|-> ; serves <distDir> with `vite preview` on a free port (faked /lobby/api).
//   distDir = apps/web/dist (or any earlier production build). Prints ms from navigation start until the village is visible.
// Throttle: 10 Mbps / 40 ms for the timing runs; 1 Mbps for the mid-load screenshot (so the loader frame can be caught).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [DIST, LABEL = 'run', OUT = '-'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const WEB = resolve(new URL('../../../../apps/web', import.meta.url).pathname);
const vp = await freePort(); const cp = await freePort();
const vite = spawn(join(WEB, '../../node_modules/.bin/vite'), ['preview', '--outDir', resolve(DIST), '--host', '127.0.0.1', '--port', String(vp), '--strictPort'], { cwd: WEB, stdio: 'ignore' });
const profile = join(tmpdir(), `clanfire-home-load-${process.pid}`);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${cp}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws; let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(method + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
const now = Date.now();
const WORLDS = { worlds: [{ id: 'w4', name: 'Hollow Marsh', status: 'open', path: '/w/w4/', openedAt: now }, { id: 'w5', name: 'Cinder Vale', status: 'open', path: '/w/w5/', openedAt: now }, { id: 'w6', name: 'Ashfall', status: 'full', path: '/w/w6/', openedAt: now }] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
async function setup() {
  for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${cp}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Fetch.requestPaused') { const u = m.params.request.url; const body = u.includes('/auth/me') ? { account: null } : u.includes('/worlds/public') ? WORLDS : { error: 'nf' };
      send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: b64(body) }).catch(() => {}); } });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: `*://127.0.0.1:${vp}/lobby/api/*` }] });
}
const VISIBLE = `!!(document.querySelector('.home-village-art[data-ready="true"]') || document.querySelector('.home-village-stage[data-ready="true"]'))`;
async function run(w, h, mob, mbps, shot) {
  await send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (mbps * 1e6) / 8 });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mob ? 2 : 1, mobile: mob });
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  const t0 = Date.now(); await send('Page.navigate', { url: `http://127.0.0.1:${vp}/lobby/` });
  let mid = false; let t = null;
  while (Date.now() - t0 < 60000) {
    if (shot && !mid && (await evalJs(`!!document.querySelector('.home-village-art[data-ready="false"] .home-village-loader') && !!document.querySelector('.home-world')`).catch(() => false))) {
      await sleep(150); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `home-loading-${w}x${h}.png`), Buffer.from(r.data, 'base64')); mid = true; }
    if (await evalJs(VISIBLE).catch(() => false)) { t = Date.now() - t0; break; }
    await sleep(25);
  }
  if (shot) { await sleep(900); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `home-${w}x${h}.png`), Buffer.from(r.data, 'base64')); }
  return { t, mid };
}
try {
  await setup(); if (OUT !== '-') mkdirSync(OUT, { recursive: true });
  const times = [];
  for (let i = 0; i < 3; i++) times.push((await run(1440, 900, false, 10, false)).t);
  console.log(`${LABEL}: 1440x900 @10Mbps/40ms village visible after ms:`, times.join(', '));
  const tm = [];
  for (let i = 0; i < 3; i++) tm.push((await run(360, 640, true, 10, false)).t);
  console.log(`${LABEL}: 360x640 @10Mbps/40ms village visible after ms:`, tm.join(', '));
  if (OUT !== '-') {
    const a = await run(1440, 900, false, 1, true); const b = await run(360, 640, true, 1, true);
    console.log(`${LABEL}: screenshots written (mid-load caught: desktop=${a.mid} phone=${b.mid})`);
  }
} catch (e) { console.error(e); } finally { chrome.kill(); vite.kill(); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} process.exit(0); }
