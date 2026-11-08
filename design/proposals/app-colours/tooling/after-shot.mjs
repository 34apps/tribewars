// Headless Chrome CDP screenshots of every main screen in the single-file preview (Parchment is the default now).
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
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


const log = [];
const audit = async (name) => { const r = await evalJs(AUDIT); log.push(name + ': ' + (r.length ? '\n  ' + r.join('\n  ') : 'ok')); };
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(1800); };
const click = async (x, y) => { for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(900); };
const snap = async (name, full) => { await audit(name); await shot(name + '.png', full); };
const SIZES = [['1440', 1440, 900, false], ['360', 360, 780, true]];
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  await tab('army'); await tab('village'); await sleep(3000);
  for (const [tag, w, h, mob] of SIZES) {
    await size(w, h, mob); await sleep(800);
    await tab('village'); await sleep(1500); await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => /^\\s*Close\\s*$/.test(e.textContent)); if (b) b.click(); })()`); await sleep(500); await snap(`village-${tag}`);
    // building panel / sheet
    if (mob) await click(180, 478); else await click(720, 430);
    await evalJs('document.activeElement && document.activeElement.blur()');
    await sleep(800); await snap(`village-panel-${tag}`);
    await evalJs(`(() => { const b = document.querySelector('.vv-sheet .vv-close, .vv-sheet button[aria-label*="lose"], [role=dialog] button[aria-label*="lose"]'); if (b) b.click(); })()`); await sleep(500);
    await tab('map'); await sleep(2500); await snap(`map-${tag}`);
    await evalJs(`(() => { const d = document.querySelector('.wm-legend'); if (d) d.open = true; })()`); await sleep(700); await snap(`map-key-${tag}`);
    await evalJs(`(() => { const d = document.querySelector('.wm-legend'); if (d) d.open = false; })()`);
    await click(mob ? 180 : 805, mob ? 330 : 450); await sleep(900); await snap(`map-tile-${tag}`);
    await click(mob ? 120 : 400, mob ? 200 : 300); await sleep(900); await snap(`map-tile-empty-${tag}`);
    for (const t of ['army', 'reports', 'mail', 'ranks']) { await tab(t); await sleep(500); await snap(`${t}-${tag}`, true); }
    await tab('tribe'); await sleep(900); await snap(`tribe-none-${tag}`, true);
    if (tag === '1440') console.log('found tribe', await evalJs(`(async () => { const r = await fetch('/api/tribes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ember Clan', tag: 'EMB', description: 'Raiders of the north.', recruitment: 'open' }) }); return r.status + ' ' + (await r.text()).slice(0, 120); })()`));
    await tab('village'); await tab('tribe'); await sleep(1200);
    const subs = await evalJs(`[...document.querySelectorAll('.subtab')].map(e => e.textContent.trim())`);
    log.push('tribe subtabs: ' + JSON.stringify(subs));
    for (let i = 0; i < subs.length; i++) { await evalJs(`document.querySelectorAll('.subtab')[${i}].click()`); await sleep(900); await snap(`tribe-${i}-${tag}`, true); }
    await tab('simulator'); await sleep(600); await snap(`simulator-${tag}`, true);
    await tab('rules'); await sleep(600); await snap(`rules-${tag}`, true);
    await tab('village'); await sleep(800);
    await evalJs(`document.querySelector('.who-button').click()`); await sleep(500); await snap(`account-menu-${tag}`);
    await clickText('.who-menu button', 'Settings'); await sleep(1200); await snap(`settings-${tag}`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400);
  }
} catch (e) { console.error(e); } finally { console.log(log.join('\n')); chrome.kill(); }
