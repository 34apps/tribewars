// Ranks page screenshots (1440 + phone) on the demo seed.
// usage: node ranks-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-ranks';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9487;
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

const SEED = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = ctx.store.getPlayer(st.player.id);
  try { ctx.tribes.found(me, { name: 'Embers of the Fold', tag: 'EMB', description: 'We hold the fold.' }, Date.now()); } catch (e) { return 'tribe: ' + e.message; }
  return 'ok';
})()`;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.fr-tab-${name}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } const f = document.querySelector('.frame'); return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, frame: f && Math.round(f.getBoundingClientRect().height), viewH: innerHeight, inner, layout: de.className }); })()`).then((r) => console.log(tag, r));
const overflow = () => evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll('.frk *')) { const p = e.closest('.fv-pn'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && a.height>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } const tw = document.querySelector('.frk-tw'); const t = document.querySelector('.frk-t'); const sd = document.querySelector('.frk-side'); return 'panel-overflow: ' + (out.slice(0,12).join(' | ') || 'none') + ' | table ' + (t ? t.getBoundingClientRect().height + '/' + tw.getBoundingClientRect().height : '-') + ' | side ' + (sd ? sd.scrollHeight + '/' + sd.clientHeight : '-') + ' | rows ' + document.querySelectorAll('.frk-t tbody tr').length; })()`).then((r) => console.log(r));
const setInput = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const sub = async (label) => { await clickText('.frk-sub', label); await sleep(1500); };
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(SEED));
  await sleep(4000);
  await tab('ranks'); await waitFor(`document.querySelector('.frk-t tbody tr')`, 30000); await sleep(2500);
  await metrics('1440 players'); await overflow(); await shot('ranks-1440.png');
  console.log('you card', await evalJs(`document.querySelector('.frk-you-b').innerText.replace(/\\n/g,' | ')`));
  await sub('Tribes'); await metrics('1440 tribes'); await overflow(); await shot('ranks-tribes-1440.png');
  await sub('Renown'); await waitFor(`document.querySelector('.frk-t tbody tr')`, 20000); await metrics('1440 renown'); await overflow(); await shot('ranks-renown-1440.png');
  await sub('Players');
  console.log('jump', await clickText('.frk-yact .fv-btn', 'Jump to me')); await sleep(800);
  console.log('page', await evalJs(`document.querySelector('.frk-pgr').innerText.replace(/\\n/g,' ')`), 'me row', await evalJs(`!!document.querySelector('.frk-t tr.me')`));
  await metrics('1440 jump'); await overflow(); await shot('ranks-jump-1440.png');
  await setInput('.frk-srch input', 'EMB'); await sleep(1000);
  await metrics('1440 search'); await overflow(); await shot('ranks-search-1440.png');
  await setInput('.frk-srch input', 'zzzz'); await sleep(600); await overflow();
  await setInput('.frk-srch input', ''); await sleep(500);
  console.log('open popup', await evalJs(`(() => { document.querySelector('.frk-who').click(); return true; })()`)); await sleep(2000);
  await shot('ranks-popup-1440.png'); await evalJs(`document.querySelector('dialog[open] .fv-btn').click()`); await sleep(500);
  await evalJs(`(() => { [...document.querySelectorAll('.frk-dom .fv-btn')][0].click(); })()`); await sleep(800); await shot('ranks-domination-1440.png');
  await evalJs(`document.querySelector('dialog[open] .fv-btn').click()`); await sleep(500);
  // phone, unchanged
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(1500);
  await evalJs(`location.hash = 'ranks'`); await sleep(3000);
  await metrics('360 ranks'); await shot('ranks-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
