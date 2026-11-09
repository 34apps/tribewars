// Headless Chrome CDP screenshots of every main screen in the single-file preview (Parchment is the default now).
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9484;
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

// Second seed: levels and queues chosen so every state of the building control shows (Up, can't afford, upgrading, Max, Locked).
const SEED2 = (jobs, train) => `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const rec = ctx.store.villagesOfPlayer(st.player.id)[0];
  const now = Date.now();
  const ids = Object.keys(rec.state.buildings);
  const lv = { hall: 10, lumber: 20, farm: 5, mine: 2, goldmine: 3, market: ${jobs} > 1 ? 4 : 1, storehouse: 12, barracks: 8, stables: 3, drillyard: 5, bannerhall: ${jobs} > 1 ? 2 : 0, wall: 1, vault: 2 };
  const b = {}; for (const k of ids) b[k] = lv[k] ?? 1;
  const queue = [{ building: 'barracks', targetLevel: 9, startAt: now - 3600000, finishAt: now + 2530000 }];
  if (${jobs} > 1) queue.push({ building: 'storehouse', targetLevel: 13, startAt: now + 2530000, finishAt: now + 2530000 + 4893000 });
  const mk = (unit, count, done, per, startAt) => ({ unit, count, done, perUnitMs: per, startAt });
  const tq = ${train} ? { ...rec.state.trainQueues, barracks: [mk('raider', 5, 1, 194000, now - 300000), mk('pikeman', 20, 0, 175000, now + 700000), mk('pathfinder', 2, 0, 117000, now + 4200000)] } : { ...rec.state.trainQueues, barracks: [] };
  const t = { ...rec.state.troops }; for (const k of Object.keys(t)) t[k] = 0; Object.assign(t, { pikeman: 40, guard: 25, raider: 12, pathfinder: 3, logram: 1 });
  const s2 = { ...rec.state, buildings: b, buildQueue: queue, trainQueues: tq, troops: t, lastUpdate: now, resources: { wood: 9800, food: 8200, iron: 500, gold: 120 } };
  ctx.store.saveVillage(rec.id, s2, 80);
  return Object.keys(s2).join(',');
})()`;

const click = async (x, y) => { for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(900); };
const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await sleep(400); };

const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.fr-tab-${name.split('/')[0]}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, viewW: innerWidth, viewH: innerHeight, inner, layout: de.className }); })()`).then((r) => console.log(tag, r));
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  console.log('seed2', await evalJs(SEED2(1, true)));
  await tab('army'); await tab('village'); await sleep(2500);
  await waitFor(`/48\\.2k/.test(document.body.innerText)`, 40000).catch(() => console.log('WARN seeded numbers not shown'));
  await sleep(1500); await metrics('1440 village'); await shot('village-1440.png');
  console.log('overflow', await evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll('.fv *')) { const p = e.closest('.fv-pn, .fv-pic'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((e.className&&e.className.baseVal===undefined?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | '); })()`));
  // bell sheet and account menu
  await evalJs(`document.querySelector('.frame .bell').click()`); await sleep(900); await shot('bell-1440.png');
  await evalJs(`document.querySelector('.frame .bell').click()`); await sleep(300);
  await evalJs(`document.querySelector('.frame .hud-avatar').click()`); await sleep(900); await shot('account-1440.png');
  await evalJs(`document.querySelector('.frame .hud-avatar').click()`); await sleep(300);
  // building pages (queue full: two build jobs)
  console.log('seed3', await evalJs(SEED2(2, true))); await sleep(12000);
  const openB = async (name, file) => {
    await evalJs(`(() => { const b = [...document.querySelectorAll('.fv-bpick')].find(e => e.getAttribute('aria-label').startsWith(${JSON.stringify(name + ', level')})); if (b) b.click(); })()`);
    await sleep(2000); console.log('hash', await evalJs('location.hash'));
    console.log('doc', await evalJs(`(() => { const d = document.documentElement; return d.scrollWidth + 'x' + d.scrollHeight + ' frame ' + JSON.stringify(document.querySelector('.frame').getBoundingClientRect().toJSON()); })()`));
    await metrics('1440 ' + file); await shot(file);
    console.log('overflow', await evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll('.fv *')) { const p = e.closest('.fv-pn'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | '); })()`));
    await evalJs(`location.hash = 'village'`); await sleep(900);
  };
  await openB('Barracks', 'building-1440.png');
  await openB('Stables', 'building-stables-1440.png');
  await openB('Town Hall', 'building-townhall-1440.png');
  await openB('Farm', 'building-farm-1440.png');
  await openB('Drillyard', 'building-drillyard-1440.png');
  await openB('Banner Hall', 'building-bannerhall-1440.png');
  await evalJs(`location.hash = 'village/b/barracks'`); await sleep(1500);
  await key('Escape', 'Escape', 27); console.log('hash after esc', await evalJs('location.hash'));
  for (const t of ['army', 'reports', 'map']) {
    await tab(t); await sleep(1500); await metrics('1440 ' + t); await shot(`${t}-1440.png`);
  }
  await tab('village');
  // other window sizes: the frame never changes size
  await size(1920, 1080, false); await sleep(1200); await metrics('1920'); await shot('village-1920.png');
  await size(1180, 760, false); await sleep(1200); await metrics('1180'); await shot('village-1180.png');
  // done variant: hide First steps (the Standing card replaces it)
  await size(1440, 900, false); await sleep(800);
  await evalJs(`fetch('/api/first-steps/hidden', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hidden: true }) }).then(r => r.status)`);
  await tab('army'); await tab('village'); await sleep(3000); await metrics('1440 done'); await shot('village-done-1440.png');
  // phone, unchanged
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(2500);
  await metrics('360 village'); await shot('village-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
