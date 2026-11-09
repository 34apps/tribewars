// Battle simulator and unit info card screenshots (1440 + phone) on the demo seed.
// usage: node sim-shot.mjs [outDir]   (needs the preview dev server on :5174, `npm run dev:preview`, or PREVIEW_URL). Prints fit metrics per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-sim';
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



const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(k === 'Enter' ? { text: '\r' } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(400); };

const SEED = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = st.player;
  const rec = ctx.store.villagesOfPlayer(me.id)[0];
  const now = Date.now();
  const mk = (unit, count, done, per, startAt) => ({ unit, count, done, perUnitMs: per, startAt });
  const t = { pikeman: 40, guard: 25, raider: 72, outrider: 12, knight: 6, pathfinder: 3, chieftain: 2, logram: 4, boulder: 0 };
  const away = { pikeman: 8, guard: 10, raider: 4, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 };
  const b = { ...rec.state.buildings, hall: 10, barracks: 8, stables: 3, drillyard: 5, bannerhall: 2, storehouse: 12, wall: 3 };
  const tq = { ...rec.state.trainQueues, barracks: [mk('raider', 5, 1, 194000, now - 300000), mk('pikeman', 20, 0, 175000, now + 700000)], stables: [mk('knight', 2, 0, 600000, now - 100000)] };
  const ranks = { raider: { might: 2, bulwark: 0, keen: 0 } };
  ctx.store.saveVillage(rec.id, { ...rec.state, buildings: b, troops: t, away, trainQueues: tq, ranks, lastUpdate: now, resources: { wood: 48200, food: 31400, iron: 22800, gold: 15650 } }, 80);
  return 'ok';
})()`;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const metrics = (tag, root = '.fsm') => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } const small = []; const root = document.querySelector(${JSON.stringify(root)}); if (root) for (const e of root.querySelectorAll('*')) { if (!e.childNodes.length) continue; const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 13) small.push((e.className||e.tagName)+':'+fs); } const f = document.querySelector('.frame'); return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, frame: f && Math.round(f.getBoundingClientRect().height), inner, small: small.slice(0, 8) }); })()`).then((r) => console.log(tag, r));
const overflow = (root, within) => evalJs(`(() => { const out=[]; const R = document.querySelector(${JSON.stringify(root)}); if (!R) return 'no root'; for (const e of R.querySelectorAll('*')) { const p = e.closest(${JSON.stringify(within)}); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && a.height>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | ') || 'clean'; })()`).then((r) => console.log('overflow', r));
const setInput = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const mouse = async (x, y, type = 'mouseMoved') => { await send('Input.dispatchMouseEvent', { type, x, y, button: 'none' }); };
const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
const goTo = async (x, y) => {
  await evalJs(`document.querySelector('.wm-panel .wm-close')?.click()`); await sleep(200);
  await evalJs(`document.querySelector('[aria-label="Go to coordinates"]').click()`); await sleep(200);
  await evalJs(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; for (const [id, v] of [['go-x', ${x}], ['go-y', ${y}]]) { const i = document.getElementById(id); set.call(i, String(v)); i.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('.wm-go-pop button[type=submit]').click(); })()`);
  await sleep(1800);
};
const only = process.argv[3] || 'all';
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(SEED));
  await sleep(12000);
  await evalJs(`location.hash = 'simulator'`);
  await waitFor(`document.querySelector('.fsm')`, 30000);
  await waitFor(`/72 at home/.test(document.body.innerText)`, 40000).catch(() => console.log('WARN seeded numbers not shown'));
  await sleep(800);
  // Army: raiders, outriders, knights, rams; ranks on. Defender: scouted-like (pikemen, guards, support pikemen), Wall 6.
  for (const [u, n] of [['raider', 60], ['outrider', 12], ['knight', 6], ['logram', 4]]) await setInput(`[aria-label="${{ raider: 'Raider', outrider: 'Outrider', knight: 'Knight', logram: 'Log Ram' }[u]} in your army"]`, n);
  await setInput('[aria-label="Pikeman in the village"]', 48); await setInput('[aria-label="Shieldbearer in the village"]', 30); await setInput('[aria-label="Pikeman support"]', 15);
  await setInput('[aria-label="Wall level"]', 6);
  await evalJs(`document.querySelector('.fsm-sw input')?.click()`);
  await sleep(600);
  await metrics('1440 sim'); await overflow('.fsm', '.fv-pn');
  await shot('sim-1440.png');
  // slider moved to -5 %
  await setInput('#fsm-luck', -5); await sleep(500);
  console.log('luck', await evalJs(`document.querySelector('.fsm-lv').textContent + ' | ' + document.querySelector('.fsm-vt').textContent`));
  await shot('sim-luck-1440.png');
  await setInput('#fsm-luck', -10); await sleep(300);
  console.log('luck -10', await evalJs(`document.querySelector('.fsm-vt').textContent`));
  await setInput('#fsm-luck', -5); await sleep(300);
  // all nine kinds on both sides: the densest result table still fits
  for (const [n, v] of [['Pikeman', 5], ['Shieldbearer', 5], ['Pathfinder', 1], ['Chieftain', 1], ['Boulder Sling', 1]]) await setInput(`[aria-label="${n} in your army"]`, v);
  for (const n of ['Raider', 'Outrider', 'Knight', 'Pathfinder', 'Chieftain', 'Log Ram']) { await setInput(`[aria-label="${n} in the village"]`, 3); await setInput(`[aria-label="${n} support"]`, 2); }
  await sleep(500); await metrics('1440 sim dense'); await overflow('.fsm', '.fv-pn'); await shot('sim-dense-1440.png');
  for (const n of ['Pikeman', 'Shieldbearer', 'Pathfinder', 'Chieftain', 'Boulder Sling']) await setInput(`[aria-label="${n} in your army"]`, 0);
  for (const n of ['Raider', 'Outrider', 'Knight', 'Pathfinder', 'Chieftain', 'Log Ram']) { await setInput(`[aria-label="${n} in the village"]`, 0); await setInput(`[aria-label="${n} support"]`, 0); }
  await sleep(300);
  // small hover card on a unit name (left column), then the big card by click
  const c = await center('.fsm-rows:not(.is-def) li:nth-child(3) .fsm-nm');
  console.log('hover at', JSON.stringify(c));
  await mouse(c[0] - 40, c[1] - 120); await mouse(c[0], c[1]); await sleep(900);
  console.log('tip', await evalJs(`!!document.querySelector('.uc-tip')`));
  await shot('unitcard-hover-1440.png');
  await metrics('hover', '.uc-tip');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', clickCount: 1 });
  await sleep(900);
  console.log('big', await evalJs(`!!document.querySelector('dialog.uc-big[open]')`));
  await shot('unitcard-big-1440.png');
  // flip with the arrow key, Esc closes
  await key('ArrowRight', 'ArrowRight', 39); console.log('flipped to', await evalJs(`document.querySelector('#unit-info-title')?.textContent`));
  await key('Escape', 'Escape', 27); await sleep(300);
  console.log('closed', await evalJs(`!document.querySelector('dialog.uc-big[open]')`));
  // keyboard: Tab to a name, focus shows the small card, Enter opens the big one
  await evalJs(`document.querySelector('.fsm-rows:not(.is-def) li:nth-child(1) .fsm-ul')?.focus()`);
  await key('Tab', 'Tab', 9); await sleep(600);
  console.log('focus tip', await evalJs(`!!document.querySelector('.uc-tip') + ' on ' + document.activeElement?.textContent`));
  await key('Enter', 'Enter', 13); await sleep(500); console.log('enter opens big', await evalJs(`!!document.querySelector('dialog.uc-big[open]')`)); await key('Escape', 'Escape', 27); await sleep(300);
  await evalJs(`document.querySelector('.fsm-rows:not(.is-def) li:nth-child(1) .fsm-ul')?.focus()`); await key('Tab', 'Tab', 9); await sleep(600); await key('Escape', 'Escape', 27); console.log('esc hides tip', await evalJs(`!document.querySelector('.uc-tip')`));
  // Army page: the at-home figure hover, the send form name
  await evalJs(`location.hash = 'army'`); await waitFor(`document.querySelector('.fa-mu')`, 20000); await sleep(1500);
  const a = await center('.fa-mus li:nth-child(3) .fa-mu, .fa-mus li:nth-child(3) button');
  await mouse(a[0] - 30, a[1] - 80); await mouse(a[0], a[1]); await sleep(900); console.log('army tip', await evalJs(`!!document.querySelector('.uc-tip')`));
  await shot('unitcard-army-1440.png');
  await mouse(5, 5); await sleep(500);
  // Barracks building page
  await evalJs(`location.hash = 'village/b/barracks'`); await waitFor(`document.querySelector('.fv-unitname')`, 20000); await sleep(1500);
  const bb = await center('.fv-wrs li:nth-child(3) .fv-unitname');
  await mouse(bb[0] - 30, bb[1] - 60); await mouse(bb[0], bb[1]); await sleep(900); console.log('barracks tip', await evalJs(`!!document.querySelector('.uc-tip')`));
  await shot('unitcard-barracks-1440.png'); await mouse(5, 5); await sleep(400);
  // Map place panel send form
  await evalJs(`location.hash = 'map'`); await waitFor(`document.querySelector('.wm-canvas')`, 20000); await sleep(3000);
  const tgt = await evalJs(`(async () => { const st = await (await fetch('/api/state')).json(); const me = st.villages[0]; const m = await (await fetch('/api/map?x=' + (me.x - 30) + '&y=' + (me.y - 30) + '&w=60&h=60')).json(); const v = (m.villages || []).filter((q) => q.kind === 'abandoned').sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]; return v ? { x: v.x, y: v.y } : null; })()`);
  console.log('map target', JSON.stringify(tgt));
  if (tgt) {
    await goTo(tgt.x, tgt.y); await sleep(800);
    const p = await center('.wm-ucard:nth-child(3) .wm-ubtn');
    console.log('map unit btn', JSON.stringify(p));
    if (p) { await mouse(p[0] + 30, p[1] - 40); await mouse(p[0], p[1]); await sleep(900); console.log('map tip', await evalJs(`!!document.querySelector('.uc-tip')`)); await shot('unitcard-map-1440.png'); await mouse(5, 5); }
  }
  // Reports troop tables are seeded elsewhere; check the label exists when a report is open
  // phone, unchanged
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(1500);
  await evalJs(`location.hash = 'simulator'`); await sleep(3000);
  await setInput('#sim-a-raider', 20).catch(() => {}); await sleep(500);
  await metrics('360 sim', '.sim-page'); await shot('sim-360.png');
  await evalJs(`document.querySelector('.sim-unit button, .sim-unit-name')?.click()`);
} catch (e) { console.error(e); } finally { chrome.kill(); }
