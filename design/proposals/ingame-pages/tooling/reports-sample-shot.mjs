// Army page screenshots (1440 + phone) plus the Drillyard and Village pages, on the demo seed with extra movements and support.
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-reports';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9486;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--allow-file-access-from-files',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cur = { w: 1440, h: 900, mobile: false };
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
async function size(w, h, mobile) {
  cur = { w, h, mobile };
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: mobile ? w : 1920, screenHeight: mobile ? h : 1080 });
}
async function shot(name, full) {
  if (full) {
    const h = await evalJs(`(() => { const m = document.querySelector('main'); return Math.max(document.documentElement.scrollHeight, m ? m.getBoundingClientRect().top + m.scrollHeight + 40 : 0); })()`);
    await send('Emulation.setDeviceMetricsOverride', { width: cur.w, height: Math.min(Math.ceil(h), 5000), deviceScaleFactor: cur.mobile ? 2 : 1, mobile: cur.mobile, screenWidth: cur.mobile ? cur.w : 1920, screenHeight: cur.mobile ? cur.h : 1080 });
    await sleep(800);
  }
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'));
  if (full) await size(cur.w, cur.h, cur.mobile);
  console.log('saved', name);
}
async function waitFor(expr, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(250); }
  throw new Error('timeout waiting for ' + expr);
}
const clickText = (sel, text) => evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);

const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.fr-tab-${name.split('/')[0]}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } const f = document.querySelector('.frame'); return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, frame: f && Math.round(f.getBoundingClientRect().height), viewH: innerHeight, inner, layout: de.className }); })()`).then((r) => console.log(tag, r));
const overflow = (root) => evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll(${JSON.stringify(root + ' *')})) { const p = e.closest('.fv-pn'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && a.height>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | '); })()`).then((r) => console.log('overflow', r));
const pick = async (re) => { const ok = await evalJs(`(() => { const el = [...document.querySelectorAll('.frp-rr')].find(e => ${re}.test(e.textContent)); if (!el) return false; el.click(); return true; })()`); await sleep(1200); return ok; };
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('fill', await evalJs(`fetch('/api/sandbox/sample-data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status)`));
  await sleep(3000);
  await tab('reports'); await waitFor(`document.querySelector('.frp-rr')`, 30000); await sleep(1500);
  const rowsOf = () => evalJs(`[...document.querySelectorAll('.frp-rr')].map((e,i)=>i+': '+e.innerText.replace(/\\n/g,' | ')).join('\\n')`);
  const tbl = () => evalJs(`document.querySelector('.frp-forces')?.getBoundingClientRect().height + ' / ' + document.querySelector('.frp-forces table')?.rows.length`);
  const chip = (i) => evalJs(`document.querySelectorAll('.frp-chip')[${i}].click()`).then(() => sleep(900));
  const dump = async (tag) => { console.log(tag, await tbl()); await metrics(tag); await overflow('.frp'); };
  await chip(1);
  console.log(await rowsOf());
  const want = JSON.parse(process.env.ROWS || '{}');
  const open = async (i) => { await evalJs(`document.querySelectorAll('.frp-rr')[${i}].click()`); await sleep(1000); };
  await open(+(want.main ?? 0)); await shot('reports-1440.png'); await dump('main');
  await size(1920, 1080, false); await sleep(800);
  await open(+(want.big ?? 0)); await shot('reports-big-1920.png'); await dump('big1920');
  await size(1440, 900, false); await sleep(800);
  await open(+(want.unknown ?? 0)); await shot('reports-unknown-1440.png'); await dump('unknown');
  await open(+(want.siege ?? 0)); await shot('reports-siege-1440.png'); await dump('siege');
  await chip(2); console.log(await rowsOf()); await open(+(want.scout ?? 0)); await shot('reports-scout-1440.png'); await dump('scout');
} catch (e) { console.error(e); } finally { chrome.kill(); }
