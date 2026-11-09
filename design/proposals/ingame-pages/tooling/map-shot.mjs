// Desktop Map page screenshots (1440: nothing selected, abandoned village with a raid filled, other player's village, own village, a site, map key open, a full-army worst case; 360 phone unchanged) on the demo seed.
// usage: node map-shot.mjs <outDir>   (needs the preview at PREVIEW_URL, default http://localhost:5174/?demo)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-map';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9493;
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
    if (m.method === 'Page.frameNavigated') console.log('NAV', m.params.frame.url);
    if (m.method === 'Runtime.consoleAPICalled' && ['error'].includes(m.params.type)) console.log('CONSOLE', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
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
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; return ${JSON.stringify(tag)} + ' page ' + de.scrollWidth + 'x' + de.scrollHeight + ' vs ' + innerWidth + 'x' + innerHeight; })()`).then(console.log);
// Panel checks: nothing taller than the panel (it never scrolls), no element sticking out of it, no inner scrollers, text >= 13 px, controls >= 36 px.
const check = (tag) => evalJs(`(() => {
  const p = document.querySelector('.wm-panel'); if (!p) return ${JSON.stringify(tag)} + ': no panel';
  const pr = p.getBoundingClientRect(); const out = [];
  for (const e of p.querySelectorAll('*')) {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(e);
    if (e.closest('details:not([open]) > :not(summary)')) continue;
    if (e.closest('.wm-send-top .help-pop p')) continue;
    if (r.bottom > pr.bottom + 0.5 || r.right > pr.right + 0.5) out.push('OUT ' + e.className + ':' + (e.textContent || '').slice(0, 14));
    if (['auto','scroll'].includes(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) out.push('SCROLL ' + e.className);
    const direct = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (direct && parseFloat(cs.fontSize) < 12.9) out.push('SMALL ' + cs.fontSize + ' ' + e.className + ':' + e.textContent.slice(0, 12));
    if (/^(BUTTON|INPUT|SELECT|SUMMARY)$/.test(e.tagName) && r.height < 35.5 && !e.matches('.wm-uhave, .wm-link, .wm-tag, .wm-morale summary')) out.push('TOUCH ' + Math.round(r.height) + ' ' + e.className + ':' + (e.textContent || e.getAttribute('aria-label') || '').slice(0, 12));
  }
  const used = Math.round(Math.max(...[...p.children].map((c) => c.getBoundingClientRect().bottom)) - pr.top);
  return ${JSON.stringify(tag)} + ': panel ' + Math.round(pr.height) + ' used ' + used + ' scrollH ' + p.scrollHeight + (p.classList.contains('is-tight') ? ' TIGHT' : '') + ' | ' + (out.slice(0, 10).join(' | ') || 'clean');
})()`).then(console.log);
const goTo = async (x, y) => {
  await evalJs(`document.querySelector('.wm-panel .wm-close')?.click()`); await sleep(200);
  await evalJs(`document.querySelector('[aria-label="Go to coordinates"]').click()`); await sleep(200);
  await evalJs(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; for (const [id, v] of [['go-x', ${x}], ['go-y', ${y}]]) { const i = document.getElementById(id); set.call(i, String(v)); i.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('.wm-go-pop button[type=submit]').click(); })()`);
  await sleep(1800);
};
const fill = (id, v) => evalJs(`(() => { const i = document.getElementById('send-' + ${JSON.stringify(id)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(String(v))}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  // A realistic army at home (the demo account starts with none): eight kinds, like the mock-up.
  const setTroops = (n) => evalJs(`(async () => { const ctx = window.clanfirePreview.ctx; const st = await (await fetch('/api/state')).json(); const myV = ctx.store.villagesOfPlayer(st.player.id)[0]; const troops = { ...myV.state.troops }; const mine = ${JSON.stringify(n)}; for (const k of Object.keys(troops)) troops[k] = typeof mine === 'number' ? mine : (mine[k] ?? 0); ctx.store.saveVillage(myV.id, { ...myV.state, troops }, myV.points); return Object.keys(troops).join(','); })()`);
  console.log('units', await setTroops({ pikeman: 40, guard: 25, raider: 12, outrider: 8, knight: 6, pathfinder: 3, chieftain: 2, logram: 1 }));
  await sleep(11000);
  // Find real targets through the public API of the in-page server.
  const targets = await evalJs(`(async () => {
    const st = await (await fetch('/api/state')).json();
    const me = st.villages[0]; const out = { own: { x: me.x, y: me.y } };
    const m = await (await fetch('/api/map?x=' + (me.x - 30) + '&y=' + (me.y - 30) + '&w=60&h=60')).json();
    const list = m.villages || [];
    const dist = (v) => Math.hypot(v.x - me.x, v.y - me.y);
    const pick = (f) => list.filter(f).sort((a, b) => dist(a) - dist(b))[0];
    const ab = pick((v) => v.kind === 'abandoned'); const pl = pick((v) => v.kind === 'player');
    if (ab) out.abandoned = { x: ab.x, y: ab.y }; if (pl) out.player = { x: pl.x, y: pl.y, name: pl.name };
    const s = await (await fetch('/api/sites')).json();
    const site = (s.sites || []).find((q) => q.kind !== 'lookout' && q.kind !== 'waymark') || (s.sites || [])[0];
    if (site) out.site = { x: site.x, y: site.y, kind: site.kind };
    const lk = (s.sites || []).find((q) => q.kind === 'lookout'); if (lk) out.lookout = { x: lk.x, y: lk.y };
    out.kinds = [...new Set(list.map((v) => v.kind))];
    return out;
  })()`);
  console.log('targets', JSON.stringify(targets));
  await evalJs(`location.hash = 'map'`); await sleep(2500);
  await waitFor(`document.querySelector('.wm-canvas')`, 20000); await sleep(3000);
  await metrics('map none'); await shot('map-1440.png');
  if (targets.abandoned) {
    await goTo(targets.abandoned.x, targets.abandoned.y);
    await fill('raider', 8); await fill('outrider', 8); await sleep(500);
    await metrics('abandoned'); await check('abandoned'); await shot('map-abandoned-1440.png');
  }
  if (targets.player) {
    await goTo(targets.player.x, targets.player.y); await sleep(500);
    await metrics('player'); await check('player'); await shot('map-player-1440.png');
    console.log('testmode', await evalJs(`(() => { const d = document.querySelector('.wm-test'); if (!d) return false; d.open = true; return true; })()`)); await sleep(400); await shot('map-testmode-1440.png');
  }
  await goTo(targets.own.x, targets.own.y); await sleep(500);
  await metrics('own'); await check('own'); await shot('map-own-1440.png');
  if (targets.site) {
    await goTo(targets.site.x, targets.site.y); await sleep(500);
    await metrics('site ' + targets.site.kind); await check('site'); await shot('map-site-1440.png');
    // The site's second mission (support) and the troop fill, to see the tallest state.
    await evalJs(`[...document.querySelectorAll('.wm-panel .segment')].find((b) => /support/i.test(b.textContent))?.click()`); await sleep(300);
    await fill('pikeman', 5); await sleep(300); await check('site support');
  }
  // Worst case: every unit type at home, abandoned village.
  if (targets.abandoned) {
    await setTroops(5);
    await sleep(11000); await goTo(targets.abandoned.x, targets.abandoned.y); await fill('pikeman', 3); await sleep(400);
    await metrics('all troops'); await check('all troops'); await shot('map-alltroops-1440.png');
  }
  // Key open.
  await evalJs(`document.querySelector('.wm-panel .wm-close')?.click()`); await sleep(300);
  await evalJs(`document.querySelector('[aria-label="Map key"]').click()`); await sleep(500);
  console.log('key', await evalJs(`(() => { const b = document.querySelector('.wm-legend-body'); const c = document.querySelector('.wm-legend-card').getBoundingClientRect(); const st = document.querySelector('.wm-stage').getBoundingClientRect(); return 'scrollH ' + b.scrollHeight + ' clientH ' + b.clientHeight + ' card top ' + Math.round(c.top - st.top); })()`));
  await metrics('key'); await shot('map-key-1440.png');
  await size(360, 780, true); await sleep(3000);
  console.log('layout', await evalJs(`document.documentElement.className`));
  await evalJs(`location.hash = 'map'`); await sleep(3000);
  await metrics('360 map'); await shot('map-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
