// Army page screenshots (1440 + phone) plus the Drillyard and Village pages, on the demo seed with extra movements and support.
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-army';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9485;
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


// Army seed: troops (some training), my own movements (an outgoing support that can still be cancelled, a raid coming home, an attack) and support troops.
const SEED_ARMY = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = st.player;
  const rec = ctx.store.villagesOfPlayer(me.id)[0];
  const now = Date.now();
  const others = [];
  for (let id = 1; id < 3000 && others.length < 4; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id) others.push(v); }
  const mk = (unit, count, done, per, startAt) => ({ unit, count, done, perUnitMs: per, startAt });
  const t = { pikeman: 40, guard: 25, raider: 12, outrider: 8, knight: 6, pathfinder: 3, chieftain: 2, logram: 1, boulder: 0 };
  const away = { pikeman: 8, guard: 10, raider: 4, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 };
  const b = { ...rec.state.buildings, hall: 10, barracks: 8, stables: 3, drillyard: 5, bannerhall: 2, storehouse: 12 };
  const tq = { ...rec.state.trainQueues, barracks: [mk('raider', 5, 1, 194000, now - 300000), mk('pikeman', 20, 0, 175000, now + 700000)], stables: [mk('knight', 2, 0, 600000, now - 100000)] };
  const q = [{ building: 'barracks', targetLevel: 9, startAt: now - 3600000, finishAt: now + 2530000 }, { building: 'storehouse', targetLevel: 13, startAt: now + 2530000, finishAt: now + 2530000 + 4893000 }];
  ctx.store.saveVillage(rec.id, { ...rec.state, buildings: b, troops: t, away, trainQueues: tq, buildQueue: q, lastUpdate: now, resources: { wood: 48200, food: 31400, iron: 22800, gold: 15650 } }, 80);
  const u = (o) => ({ pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0, ...o });
  ctx.store.run('DELETE FROM movements WHERE target_village_id = ? OR origin_village_id = ?', rec.id, rec.id);
  // incoming attack, outgoing support (fresh: cancellable), returning raid with loot, another outgoing attack
  ctx.store.insertMovement({ kind: 'attack', originVillageId: others[0].id, targetVillageId: rec.id, units: u({ pikeman: 5 }), loot: null, departAt: now - 600000, arriveAt: now + 18 * 60000 + 42000 });
  ctx.store.insertMovement({ kind: 'support', originVillageId: rec.id, targetVillageId: others[1].id, units: u({ guard: 10 }), loot: null, departAt: now - 40000, arriveAt: now + 31 * 60000 });
  ctx.store.insertMovement({ kind: 'return', originVillageId: others[2].id, targetVillageId: rec.id, units: u({ raider: 4 }), loot: { wood: 150, food: 100, iron: 100, gold: 100 }, departAt: now - 900000, arriveAt: now + 12 * 60000 + 30000 });
  ctx.store.insertMovement({ kind: 'attack', originVillageId: rec.id, targetVillageId: others[3].id, units: u({ pikeman: 8 }), loot: null, departAt: now - 1200000, arriveAt: now + 3 * 3600000 });
  // support: 15 pikemen of another player here, mine abroad
  ctx.store.addStationed(others[1].ownerId, others[1].id, rec.id, u({ pikeman: 15 }), now - 86400000);
  ctx.store.addStationed(me.id, rec.id, others[2].id, u({ pikeman: 8 }), now - 7200000);
  return others.map((o) => o.name).join(',');
})()`;

const SEED_MORE = (n) => `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const rec = ctx.store.villagesOfPlayer(st.player.id)[0];
  const now = Date.now();
  const others = [];
  for (let id = 1; id < 3000 && others.length < 4; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== st.player.id) others.push(v); }
  const u = (o) => ({ pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0, ...o });
  for (let i = 0; i < ${n}; i++) ctx.store.insertMovement({ kind: 'attack', originVillageId: rec.id, targetVillageId: others[i % 4].id, units: u({ pikeman: 1 }), loot: null, departAt: now - 60000, arriveAt: now + (4 + i) * 3600000 });
  ctx.store.addStationed(others[3].ownerId, others[3].id, rec.id, u({ guard: 3 }), now - 3600000);
  ctx.store.addStationed(st.player.id, rec.id, others[3].id, u({ raider: 2 }), now - 3600000);
  return 'ok';
})()`;

const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.fr-tab-${name.split('/')[0]}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } const f = document.querySelector('.frame'); return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, frame: f && Math.round(f.getBoundingClientRect().height), viewH: innerHeight, inner, layout: de.className }); })()`).then((r) => console.log(tag, r));
const overflow = (root) => evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll(${JSON.stringify(root + ' *')})) { const p = e.closest('.fv-pn'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && a.height>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | '); })()`).then((r) => console.log('overflow', r));
const SEL = process.argv[3] || 'all';
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  console.log('seed2', await evalJs(SEED2(2, true)));
  console.log('seed army', await evalJs(SEED_ARMY));
  await sleep(12000);
  await tab('army'); await waitFor(`/48\\.2k/.test(document.body.innerText)`, 40000).catch(() => console.log('WARN seeded numbers not shown'));
  await sleep(1500);
  // fill the send form: target an abandoned village near home, 8 pikemen and 8 raiders
  const tgt = await evalJs(`(async () => { const ctx = window.clanfirePreview.ctx; const st = await (await fetch('/api/state')).json(); const me = ctx.store.villagesOfPlayer(st.player.id)[0]; for (let id = 1; id < 3000; id++) { const v = ctx.store.getVillage(id); if (v && !v.ownerId) return v.x + '|' + v.y; } return null; })()`);
  console.log('target', tgt);
  const setInput = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  if (tgt) { await setInput('#fa-target', tgt); await sleep(1500); }
  await setInput('#fa-n-pikeman', '8'); await setInput('#fa-n-raider', '8'); await sleep(900);
  await metrics('1440 army'); await overflow('.fa');
  console.log('doc', await evalJs(`document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight`));
  await shot('army-1440.png');
  // a real send: Attack with the filled form, then the recent-target chip appears
  console.log('click attack', await clickText('.fa-go .fa-red', 'Attack')); await sleep(2500);
  console.log('after send', await evalJs(`JSON.stringify({ chips: [...document.querySelectorAll('.fa-rc')].map(e => e.textContent), moves: document.querySelectorAll('.fa-moves .fa-mv').length, why: document.querySelector('.fa-why')?.textContent, toasts: [...document.querySelectorAll('[role=status],[role=alert]')].map(e => e.textContent).slice(0,3) })`));
  await shot('army-sent-1440.png');
  // more movements than fit: "+N more" and its dialog
  console.log('more', await evalJs(SEED_MORE(4))); await sleep(12000);
  await metrics('1440 army more'); await overflow('.fa'); await shot('army-more-1440.png');
  await clickText('.fa-moves .fv-lk', 'more'); await sleep(800); await shot('army-more-dialog-1440.png');
  await key('Escape', 'Escape', 27); await sleep(400);
  // Drillyard and Village
  await tab('village');
  await sleep(1500);
  await shot('village-1440.png');
  await overflow('.fv');
  await evalJs(`(() => { const b = [...document.querySelectorAll('.fv-bpick')].find(e => e.getAttribute('aria-label').startsWith('Drillyard, level')); if (b) b.click(); })()`);
  await sleep(2000); await metrics('1440 drillyard'); await overflow('.fv'); await shot('building-drillyard-1440.png');
  // phone, unchanged
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(1500);
  await evalJs(`location.hash = 'army'`); await sleep(3000);
  await metrics('360 army'); await shot('army-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
