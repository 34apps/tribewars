// Headless Chrome CDP screenshots of every main screen in the single-file preview (Parchment is the default now).
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../now/', import.meta.url).pathname; const THEME_DIR = new URL('.', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-clarity-now';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9361;
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
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(1800); };
const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await sleep(400); };
const audit = (tag) => evalJs(`(() => {
  const de = document.documentElement; const out = { hscroll: de.scrollWidth > de.clientWidth + 1 };
  const chips = [...document.querySelectorAll('.hud-res .hres')].map((e) => Math.round(e.getBoundingClientRect().top));
  out.chipTop = chips.length ? Math.min(...chips) : null;
  const sheet = document.querySelector('.hud-sheet'); if (sheet) { const cs = getComputedStyle(sheet); out.sheetOverflowY = cs.overflowY; out.sheetScrolls = sheet.scrollHeight > sheet.clientHeight + 1; out.sheetBottom = Math.round(sheet.getBoundingClientRect().bottom + scrollY); }
  out.pageScroll = de.scrollHeight - de.clientHeight;
  return JSON.stringify(out); })()`).then((r) => console.log(tag, r));
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  await sleep(1500); console.log('stock', await evalJs(`[...document.querySelectorAll('.hres')].map(e=>e.textContent).join(' | ')`));
  await tab('army'); await tab('village');
  await waitFor(`document.querySelector('.bell .badge')`, 90000).catch(() => console.log('bell badge never appeared'));
  await sleep(2000);
  const pickBuilding = () => evalJs(`(() => { const h = document.querySelector('.vv-hit'); if (!h) return 'nohit'; h.dispatchEvent(new MouseEvent('click', { bubbles: true })); h.click(); return 'ok'; })()`);
  for (const [tag, w, h, mob] of [['1440', 1440, 900, false], ['360', 360, 780, true]]) {
    await size(w, h, mob); await sleep(1000);
    await tab('village'); await sleep(1200);
    await audit(tag + ' village');
    await shot(`village-${tag}.png`);
    await evalJs(`document.querySelector('.bell').click()`); await sleep(1000);
    await audit(tag + ' notif');
    await shot(`notif-${tag}.png`);
    await key('Escape', 'Escape', 27);
    console.log(tag, 'sheet after esc', await evalJs(`!!document.querySelector('.notif-sheet')`));
    if (!mob) {
      console.log('pick', await pickBuilding()); await sleep(1200);
      await audit('1440 panel'); await shot('village-panel-1440.png');
      await key('Escape', 'Escape', 27);
      await tab('army'); await shot('army-1440.png');
      await tab('map'); await sleep(1500); await shot('map-1440.png');
    } else {
      console.log('pick', await pickBuilding()); await sleep(1200);
      await audit('360 panel'); await shot('village-panel-360.png');
      await key('Escape', 'Escape', 27);
      await tab('army'); await audit('360 army'); await shot('army-360.png');
      await tab('map'); await sleep(1500); await audit('360 map'); await shot('map-360.png');
      await tab('reports'); await shot('reports-360.png');
      await evalJs(`document.querySelector('.dbtn-more').click()`); await sleep(900);
      await audit('360 more'); await shot('more-360.png');
      await key('Escape', 'Escape', 27);
      await tab('village');
      await evalJs(`document.querySelector('.vv-stepschip')?.click()`); await sleep(900); await shot('steps-360.png');
    }
    await tab('village');
  }
  // desktop extras: account menu
  await size(1440, 900, false); await sleep(800); await tab('village');
  await evalJs(`document.querySelector('.hud-avatar').click()`); await sleep(700); await audit('1440 account'); await shot('account-1440.png');
  await key('Escape', 'Escape', 27);
  // narrow desktop
  await size(1024, 768, false); await sleep(800); await tab('village'); await audit('1024 village'); await shot('village-1024.png');
  await evalJs(`document.querySelector('.bell').click()`); await sleep(900); await audit('1024 notif'); await shot('notif-1024.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
