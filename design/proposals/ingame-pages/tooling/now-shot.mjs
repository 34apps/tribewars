// Headless Chrome CDP screenshots of every main screen in the single-file preview (Parchment is the default now).
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../now/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-now';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9483;
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
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
}
async function shot(name, full) {
  if (full) {
    const h = await evalJs(`(() => { const m = document.querySelector('main'); return Math.max(document.documentElement.scrollHeight, m ? m.getBoundingClientRect().top + m.scrollHeight + 40 : 0); })()`);
    await send('Emulation.setDeviceMetricsOverride', { width: cur.w, height: Math.min(Math.ceil(h), 5000), deviceScaleFactor: cur.mobile ? 2 : 1, mobile: cur.mobile });
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
  const j = async (m, u, b) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(u + ' ' + r.status + ' ' + t); return t ? JSON.parse(t) : null; };
  const st = await j('GET', '/api/state');
  const me = st.player;
  const now = Date.now();
  ctx.store.run('UPDATE players SET created_at = ? WHERE id = ?', now - 10 * 86400000, me.id);
  const rec = ctx.store.villagesOfPlayer(me.id)[0];
  const b = {}; const lv = [4,3,5,2,3,4,3,2,1,3,2,1,2,1,1,2,1,1,1];
  Object.keys(rec.state.buildings).forEach((k, i) => { b[k] = lv[i % lv.length]; }); b.storehouse = 24;
  const t = {}; Object.keys(rec.state.troops).forEach((k, i) => { t[k] = [40, 25, 12, 8, 6, 3, 2, 1][i % 8]; });
  const s2 = { ...rec.state, buildings: b, troops: t, resources: { wood: 48200, food: 31400, iron: 22800, gold: 15650 } };
  ctx.store.saveVillage(rec.id, s2, 80);
  const others = [];
  for (let id = 1; id < 3000 && others.length < 4; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id) others.push(v); }
  const units = {}; for (const k of Object.keys(t)) units[k] = 0; units[Object.keys(t)[0]] = 8;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const arrive = now - Math.round((N - i) * 4.2 * 3600000 / 1) + 600000; // spread over ~last day
    ctx.store.insertMovement({ kind: 'attack', originVillageId: others[i % others.length].id, targetVillageId: rec.id, units, loot: null, departAt: arrive - 3600000, arriveAt: arrive });
  }
  ctx.store.insertMovement({ kind: 'attack', originVillageId: others[0].id, targetVillageId: rec.id, units, loot: null, departAt: now - 600000, arriveAt: now + 180000 });
  return { me: me.username, others: others.length };
})()`;


const click = async (x, y) => { for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(900); };
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.app.app-${name}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await sleep(400); };
const audit = (tag) => evalJs(`(() => {
  const de = document.documentElement; const out = { hscroll: de.scrollWidth > de.clientWidth + 1 };
  const chips = [...document.querySelectorAll('.hud-res .hres')].map((e) => Math.round(e.getBoundingClientRect().top));
  out.chipTop = chips.length ? Math.min(...chips) : null;
  const sheet = document.querySelector('.hud-sheet'); if (sheet) { const cs = getComputedStyle(sheet); out.sheetOverflowY = cs.overflowY; out.sheetScrolls = sheet.scrollHeight > sheet.clientHeight + 1; out.sheetBottom = Math.round(sheet.getBoundingClientRect().bottom + scrollY); }
  out.pageScroll = de.scrollHeight - de.clientHeight;
  return JSON.stringify(out); })()`).then((r) => console.log(tag, r));

const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
// Real data on screen: resources far above the raw 1,907 seed and a non-zero troop count somewhere in state.
const DATA_OK = `(async () => { const s = await fetch('/api/state').then(r => r.json()); const v = s.villages ? s.villages[0] : s.village; const r = v && v.state ? v.state.resources : (v && v.resources); return !!r && r.wood > 20000; })()`;
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } return JSON.stringify({ docH: de.scrollHeight, viewH: innerHeight, inner }); })()`).then((r) => console.log(tag, r));
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  await tab('army'); await tab('village'); await sleep(2000);
  for (const [tag, w, h, mob] of [['1440', 1440, 900, false], ['360', 360, 780, true]]) {
    await size(w, h, mob); await sleep(1000);
    if (mob) { await send('Page.reload'); await sleep(3000); await waitFor(`document.querySelector('.vv-hit')`, 60000); await sleep(2500); }
    await tab('village'); await sleep(1500);
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => /^\s*Close\s*$/.test(e.textContent)); if (b) b.click(); })()`);
    await waitFor(`/[1-9][0-9],?[0-9]{3}/.test(document.body.innerText)`, 30000).catch(() => console.log('WARN no big resource number'));
    console.log(tag, 'text', (await evalJs(`document.body.innerText.slice(0,200).replace(/\\n/g,' | ')`)));
    if (mob) { await evalJs(`window.dispatchEvent(new Event('resize'))`); await sleep(1500); }
    console.log(tag, 'vv', await evalJs(`JSON.stringify(['.vv-view','.vv-stage','.vv-board','.vv-phone'].map(q => { const e = document.querySelector(q); if (!e) return q+':none'; const b = e.getBoundingClientRect(); return q+':'+Math.round(b.top)+','+Math.round(b.height); }))`));
    await metrics(tag + ' village'); await shot(`village-${tag}.png`); if (!mob) await shot(`village-${tag}-full.png`, true);
    // building
    const bn = await evalJs(`(() => { const b = [...document.querySelectorAll('.vv-hit')].find(e => /^Barracks, level [1-9]/.test(e.getAttribute('aria-label'))) ; if (!b) return 'NONE'; b.click(); return b.getAttribute('aria-label'); })()`);
    console.log(tag, 'building', bn); await sleep(1500);
    await metrics(tag + ' building'); await shot(`building-${tag}.png`); if (!mob) await shot(`building-${tag}-full.png`, true);
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => /^\s*Close\s*$/.test(e.textContent)); if (b) b.click(); })()`);
    for (const t of ['army', 'reports']) {
      await tab(t); await sleep(1200);
      console.log(tag, t, 'text', await evalJs(`document.body.innerText.slice(0,300).replace(/\\n/g,' | ')`));
      await metrics(tag + ' ' + t); await shot(`${t}-${tag}.png`); if (!mob) await shot(`${t}-${tag}-full.png`, true);
    }
  }
} catch (e) { console.error(e); } finally { chrome.kill(); }
