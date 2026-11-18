// Screenshots of the reworked Drillyard page: a COPY of the owner's world (never the original) is loaded into the headless preview's IndexedDB,
// then the village is given a Wrightyard 4 and both siege units. usage: node shot.mjs <outDir> <world-copy.sqlite> <token-file> [phone]  (the copy needs a session row for a 43-char token)
// needs: npm run build:preview:local and `vite preview --outDir dist-local --port 5217` (apps/preview). Headless only, no visible window.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const DB = readFileSync(process.argv[3]).toString('base64');
const TOKEN = readFileSync(process.argv[4], 'utf8').trim();
const PROFILE = '/private/tmp/claude-501/drillyard-ranks-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PHONE = process.argv[5] === 'phone';
const PORT = PHONE ? 9524 : 9523;
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
const size = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: PHONE, screenWidth: w, screenHeight: h }); if (PHONE) await send('Emulation.setTouchEmulationEnabled', { enabled: true }); };
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64')); console.log('saved', name); }
async function waitFor(expr, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(300); } throw new Error('timeout ' + expr); }
const URL_ = 'http://localhost:5223/';
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable'); await (PHONE ? size(360, 800) : size(1440, 900));
  await send('Page.navigate', { url: URL_ }); await sleep(2500);
  await evalJs(`(async () => { const b = Uint8Array.from(atob(${JSON.stringify(DB)}), (c) => c.charCodeAt(0));
    await new Promise((res, rej) => { const rq = indexedDB.open('clanfire-preview', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('kv'); rq.onsuccess = () => { const tx = rq.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ db: b, token: ${JSON.stringify(TOKEN)} }, 'save-v1'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); }); return 1; })()`);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000); await sleep(3000);
  console.log('who', await evalJs(`fetch('/api/state').then(r => r.json()).then(s => s.player.username)`));
  await evalJs(`window.clanfirePreview.run((ctx) => { const rec = ctx.store.villagesOfPlayer(11)[0]; const s = rec.state; s.resources = { wood: 80000, food: 80000, iron: 80000, gold: 4000 }; ctx.store.saveVillage(rec.id, s, rec.points); return 1; })`); await sleep(1500);
  const openDrillyard = async () => {
    await evalJs(`location.hash = 'village'`); await waitFor(`document.querySelector('[aria-label^="Drillyard"]')`, 30000); await sleep(1500);
    await evalJs(`(() => { const b = document.querySelector('[aria-label^="Drillyard"]'); if (b) b.click(); })()`);
    await sleep(2500);
  };
  // buy ranks the real way: click the Buy button of the row (unit name + track tag)
  const buy = (unit, track, times) => evalJs(`(async () => { let n = 0; for (let i = 0; i < ${times}; i++) { const rows = [...document.querySelectorAll('button')].filter((b) => /^Buy rank/.test(b.textContent.trim())); const btn = rows.find((b) => { let e = b; for (let k = 0; k < 6 && e; k++) { e = e.parentElement; if (e && e.textContent.includes(${JSON.stringify(unit)}) && e.textContent.includes(${JSON.stringify(track)}) && e.textContent.length < 400) return true; } return false; }); if (!btn || btn.disabled) break; btn.click(); n++; await new Promise((r) => setTimeout(r, 700)); } return n; })()`);
  const metrics = async (tag) => console.log(tag, await evalJs(`JSON.stringify({ doc: document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight, win: innerWidth + 'x' + innerHeight, buttons: document.querySelectorAll('button').length })`));
  await openDrillyard();
  console.log('bought', await buy('Log Ram', 'Breach', 3), await buy('Firecart', 'Breach', 1), await buy('Hearthwarden', 'Defence', 2), await buy('Shieldbearer', 'Defence', 3), await buy('Ember Guard', 'Attack', 2), await buy('Ember Guard', 'Defence', 1));
  await sleep(6500);
  if (!PHONE) {
    await metrics('1440 ranks'); await shot('drillyard-ranks-1440x900.png');
    await evalJs(`(() => { const b = [...document.querySelectorAll('button, [role=tab]')].find(e => /^Research/.test((e.textContent || '').trim())); if (b) b.click(); })()`);
    await sleep(1200); await metrics('1440 research'); await shot('drillyard-research-1440x900.png');
  } else {
    await metrics('360 sheet');
    const scrollSheet = (sel, y) => evalJs(`(() => { const els = [...document.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 4 && /Drillyard/.test(e.textContent); }); const el = els[els.length - 1]; if (!el) return 'no scroller'; ${sel ? `const t = [...el.querySelectorAll('*')].find((x) => x.children.length === 0 && /Training Points/.test(x.textContent)); if (t) t.scrollIntoView({ block: 'start' });` : `el.scrollTop = ${y};`} return el.scrollTop + '/' + el.scrollHeight; })()`);
    await shot('drillyard-360-1-top.png');
    console.log(await scrollSheet(true, 0)); await sleep(600); await shot('drillyard-ranks-360.png');
    console.log(await scrollSheet(false, 700)); await sleep(600); await shot('drillyard-ranks-360-b.png');
    console.log(await scrollSheet(false, 99999)); await sleep(600); await shot('drillyard-ranks-360-c.png');
  }
} catch (e) { console.error(e); try { console.error('BODY', String(await evalJs('document.body.innerText')).slice(0, 800), 'HAS', await evalJs('typeof window.clanfirePreview')); } catch {} } finally { chrome.kill(); }
