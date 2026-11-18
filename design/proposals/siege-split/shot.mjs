// Screenshots for the Log Ram / Firecart split: a COPY of the owner's world (never the original) is loaded into the headless preview's IndexedDB,
// then the village is given a Wrightyard 4 and both siege units. usage: node shot.mjs <outDir> <world-copy.sqlite> <token-file>
// needs: npm run build:preview:local and `vite preview --outDir dist-local --port 5217` (apps/preview). Headless only, no visible window.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const DB = readFileSync(process.argv[3]).toString('base64');
const TOKEN = readFileSync(process.argv[4], 'utf8').trim();
const PROFILE = '/private/tmp/claude-501/siege-split-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9517;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let seq = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch {}
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; }
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 });
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); console.log('saved', name); }
async function waitFor(expr, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(300); } throw new Error('timeout ' + expr); }
const URL_ = 'http://localhost:5217/';
const SEED = `window.clanfirePreview.run((ctx) => {
  const rec = ctx.store.villagesOfPlayer(11)[0];
  const s = rec.state;
  s.buildings.barracks = Math.max(s.buildings.barracks, 8); s.buildings.drillyard = Math.max(s.buildings.drillyard, 4); s.buildings.wrightyard = 4;
  s.researched = [...new Set([...(s.researched ?? []), 'logram', 'firecart'])];
  s.troops = { ...s.troops, raider: 120, pikeman: 60, logram: 24, firecart: 12 };
  s.resources = { wood: 30000, food: 30000, iron: 30000, gold: 2000 };
  ctx.store.saveVillage(rec.id, s, rec.points);
  return 'ok';
})`;
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable'); await size(1440, 900);
  await send('Page.navigate', { url: URL_ }); await sleep(2500);
  // write the owner's world copy as the browser save, then reload so the preview opens it
  await evalJs(`(async () => { const b = Uint8Array.from(atob(${JSON.stringify(DB)}), (c) => c.charCodeAt(0));
    await new Promise((res, rej) => { const rq = indexedDB.open('clanfire-preview', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv'); rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ db: b, token: ${JSON.stringify(TOKEN)} }, 'save-v1'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); }); return 1; })()`);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000); await sleep(3000);
  console.log('who', await evalJs(`fetch('/api/state').then(r => r.json()).then(s => s.player.username)`));
  console.log('seed', await evalJs(SEED)); await sleep(1500);
  await evalJs(`location.hash = 'village'`); await waitFor(`document.querySelector('.fv-bpick')`, 30000); await sleep(1500);
  await evalJs(`(() => { const b = [...document.querySelectorAll('.fv-bpick')].find(e => e.getAttribute('aria-label').startsWith('Wrightyard, level')); if (b) b.click(); })()`);
  await sleep(2500); await shot('wrightyard-1440.png');
  await evalJs(`location.hash = 'army'`); await sleep(3000);
  const tgt = await evalJs(`window.clanfirePreview.run((ctx) => { for (let id = 1; id < 3000; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId === null) return v.x + '|' + v.y; } return null; })`);
  const setInput = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  console.log('target', tgt);
  if (tgt) { await setInput('#fa-target', tgt); await sleep(1500); }
  console.log(await setInput('#fa-n-raider', '60'), await setInput('#fa-n-logram', '20'), await setInput('#fa-n-firecart', '8')); await sleep(1500);
  console.log('picker', await evalJs(`(document.querySelector('.fa-siege') || {}).innerText`));
  await shot('send-both-1440.png');
  await setInput('#fa-n-firecart', '0'); await sleep(800); await shot('send-logram-only-1440.png');
  console.log('doc', await evalJs(`document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight`));
} catch (e) { console.error(e); } finally { chrome.kill(); }
