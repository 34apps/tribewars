// Headless Chrome CDP screenshots of the Tribe projects screens in the single-file preview.
// usage: node shot.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2]; const THEME_DIR = new URL('.', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/app-colours-shot';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9347;
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
  Object.keys(rec.state.buildings).forEach((k, i) => { b[k] = lv[i % lv.length]; });
  const t = {}; Object.keys(rec.state.troops).forEach((k, i) => { t[k] = [40, 25, 12, 8, 6, 3, 2, 1][i % 8]; });
  const s2 = { ...rec.state, buildings: b, troops: t, resources: { wood: 4200, food: 3100, iron: 1800, gold: 650 } };
  ctx.store.saveVillage(rec.id, s2, 80);
  // a few movements so Army / Reports have rows
  const others = [];
  for (let id = 1; id < 3000 && others.length < 4; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id) others.push(v); }
  const units = {}; for (const k of Object.keys(t)) units[k] = 0; units[Object.keys(t)[0]] = 8;
  if (others[0]) ctx.store.insertMovement({ kind: 'attack', originVillageId: others[0].id, targetVillageId: rec.id, units, loot: null, departAt: now - 600000, arriveAt: now + 2 * 3600000 });
  if (others[1]) ctx.store.insertMovement({ kind: 'support', originVillageId: rec.id, targetVillageId: others[1].id, units, loot: null, departAt: now - 600000, arriveAt: now + 3 * 3600000 });
  return { me: me.username, others: others.length };
})()`;


const INV = `(() => { const lum=(c)=>{const m=c.match(/[\\d.]+/g).map(Number); if(m.length>3&&m[3]<0.3) return null; const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);};
 const out={}; for(const el of document.querySelectorAll('body *')){ if(el.closest('svg')) continue; const cs=getComputedStyle(el); const L=lum(cs.backgroundColor); if(L!==null&&L<0.12){ const k=el.tagName.toLowerCase()+'.'+[...el.classList].join('.'); out[k]=(out[k]||0)+1; } } return out; })()`;


const AUDIT = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { if (['CANVAS','IMG','VIDEO'].includes(e.tagName)) return null; const bi = getComputedStyle(e).backgroundImage; if (bi && bi !== 'none' && !bi.includes('repeating-linear') && !bi.includes('linear-gradient(180deg, rgb(227')) return null; const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const out = {};
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg')) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const bg = bgOf(el); if (!bg) continue; const fg = parse(cs.color);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6 && +cs.fontWeight >= 700);
    if (ratio < (big ? 3 : 4.5)) { const k = el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' [' + cs.color + ' on rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')] ' + ratio.toFixed(1) + ' "' + el.textContent.trim().slice(0, 24) + '"'; out[k] = 1; }
  }
  return Object.keys(out).slice(0, 40);
})()`;

const VARIANTS = (process.argv[3] || 'now,a,b,c').split(',');
async function apply(v) {
  const css = v === 'now' ? '' : readFileSync(join(THEME_DIR, `theme-${v}.css`), 'utf8');
  await evalJs(`(() => {
    let s = document.getElementById('theme-css'); if (!s) { s = document.createElement('style'); s.id = 'theme-css'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)}; return true; })()`);
}
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(1800); };
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  await tab('army'); await tab('village'); await sleep(4000);
  for (const v of VARIANTS) {
    await size(1440, 900, false); await tab('village'); await apply(v); await sleep(600);
    if (process.env.INV) console.log('INV village', JSON.stringify(await evalJs(INV)));
    if (process.env.AUDIT) console.log('AUDIT village1440', v, JSON.stringify(await evalJs(AUDIT), null, 1)); await shot(`village-1440-${v}.png`);
    await tab('army'); await size(1440, 1250, false); await sleep(700); if (process.env.INV) console.log('INV army', JSON.stringify(await evalJs(INV))); if (process.env.AUDIT) console.log('AUDIT army1440', v, JSON.stringify(await evalJs(AUDIT), null, 1)); await shot(`army-1440-${v}.png`);
    await size(1440, 900, false);
    await tab('reports'); await sleep(600); if (process.env.INV) console.log('INV reports', JSON.stringify(await evalJs(INV))); await shot(`reports-1440-${v}.png`);
    await tab('village');
    await size(360, 780, true); await sleep(800); await apply(v); await sleep(600);
    if (process.env.AUDIT) console.log('AUDIT village360', v, JSON.stringify(await evalJs(AUDIT), null, 1)); await shot(`village-360-${v}.png`);
    for (const t of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: 180, y: 478, button: 'left', clickCount: 1 });
    await sleep(1200); await evalJs('document.activeElement && document.activeElement.blur()');
    if (process.env.AUDIT) console.log('AUDIT sheet360', v, JSON.stringify(await evalJs(AUDIT), null, 1));
    await shot(`sheet-360-${v}.png`);
  }
  if (process.env.TABS) {
    for (const v of VARIANTS) { await apply(v); for (const [w, h, mob] of [[1440, 1400, false], [360, 900, true]]) { await size(w, h, mob); for (const t of ['map', 'reports', 'mail', 'tribe', 'ranks']) { await tab(t); console.log('TAB', v, w, t, JSON.stringify(await evalJs(AUDIT))); await shot(`tab-${t}-${w}-${v}.png`); } } }
  }
} catch (e) { console.error(e); } finally { chrome.kill(); }
