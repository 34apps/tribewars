// Headless Chrome CDP screenshots of badges: lobby (vite dev + faked /lobby/api), profile + world end (preview + faked fetch).
// usage: node badges-shot.mjs <outDir>   (needs vite dev on 127.0.0.1:5199 in apps/web)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/-Users-admin-Projects-tribewars/bc5d3889-5461-4156-a71b-ac51493d5481/scratchpad/badges';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9341;
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
const now = Date.now(); const D = 86400000;
const BADGES = [
  ['w1', 'Ashfall', 'champion', null, 40], ['w3', 'Cinder Vale', 'champion', null, 12], ['w1', 'Ashfall', 'top10', 4, 40], ['w3', 'Cinder Vale', 'top10', 9, 12],
  ['w2', 'Emberreach', 'second_tribe', null, 26], ['w1', 'Ashfall', 'veteran', null, 40], ['w2', 'Emberreach', 'veteran', null, 26], ['w3', 'Cinder Vale', 'veteran', null, 12],
].map(([worldId, worldName, badge, place, ago]) => ({ worldId, worldName, badge, place, endedAt: now - ago * D }));
const ACCOUNT = { id: 7, username: 'ember_fox', chieftain: 'Ember Fox', staffRole: null, badges: BADGES };
const HOF = { worlds: [
  { worldId: 'w3', worldName: 'Cinder Vale', endedAt: now - 12 * D, kind: 'domination', winner: { name: 'Ember Foxes', tag: 'EMF' }, topTribes: [], topPlayers: [{ rank: 1, name: 'Grimwald the Long-Named', points: 48210, tribeTag: 'EMF' }, { rank: 2, name: 'kestrel', points: 44980, tribeTag: 'KSTR' }, { rank: 3, name: 'Nobody', points: 39120, tribeTag: null }] },
  { worldId: 'w2', worldName: 'Emberreach', endedAt: now - 26 * D, kind: 'manual', winner: null, topTribes: [], topPlayers: [{ rank: 1, name: 'raven', points: 31500, tribeTag: 'RAVN' }, { rank: 2, name: 'ember_fox', points: 29770, tribeTag: 'EMF' }, { rank: 3, name: 'Thistle', points: 21040, tribeTag: 'TSL' }] },
] };
const WORLDS = { worlds: [{ id: 'w4', name: 'Hollow Marsh', status: 'open', path: '/w/w4/' }, { id: 'w3', name: 'Cinder Vale', status: 'finished', path: '/w/w3/' }, { id: 'w1', name: 'Ashfall', status: 'finished', path: '/w/w1/' }] };
const json = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

const hscroll = () => evalJs('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
const INNER = `[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e !== document.scrollingElement && e.tagName !== 'HTML' && e.tagName !== 'BODY'; }).map(e => e.className || e.tagName).slice(0, 10)`;
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  // ---- 1. lobby (vite dev, /lobby/api faked through CDP Fetch) ----
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5199/lobby/api/*' }] });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url; let body = { error: 'not_found' }; let status = 404;
    if (u.includes('/auth/me')) { body = { account: ACCOUNT }; status = 200; }
    else if (u.includes('/hall-of-fame')) { body = HOF; status = 200; }
    else if (u.includes('/worlds')) { body = WORLDS; status = 200; }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) }).catch(() => {});
  });
  for (const [w, h, mob] of [[1440, 900, false], [360, 800, true]]) {
    await size(w, h, mob);
    await send('Page.navigate', { url: 'http://127.0.0.1:5199/lobby/' });
    await waitFor(`document.querySelector('.hof-card')`, 30000);
    await sleep(800);
    await shot(`lobby-${w}.png`, true);
    console.log('lobby', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)));
  }
  await send('Fetch.disable');
  // ---- 2. preview: profile sheet + world end ----
  const END = { endedAt: now - 3600000, kind: 'domination', winner: { tribeId: 1, name: 'Ember Foxes', tag: 'EMF' }, reason: 'Ember Foxes held the Fire Shrines for 7 days.',
    finalTribes: [{ rank: 1, tribeId: 1, name: 'Ember Foxes', tag: 'EMF', points: 98210, members: 14, villages: 61 }, { rank: 2, tribeId: 2, name: 'Kestrel Court', tag: 'KSTR', points: 90100, members: 12, villages: 48 }, { rank: 3, tribeId: 3, name: 'Ravens', tag: 'RAVN', points: 70400, members: 9, villages: 40 }],
    finalPlayers: [['Grimwald the Long-Named', 'EMF', 48210, 21], ['kestrel', 'KSTR', 44980, 19], ['ember_fox', 'EMF', 39120, 17], ['raven', 'RAVN', 31500, 14], ['Thistle', 'TSL', 21040, 11], ['Nobody', null, 9800, 4]].map(([name, tribeTag, points, villages], i) => ({ rank: i + 1, playerId: 100 + i, name, points, villages, tribeTag })),
    myBadges: [{ badge: 'champion', place: null }, { badge: 'top10', place: 3 }, { badge: 'veteran', place: null }],
    badgeCounts: { champion: 14, second_tribe: 12, third_tribe: 9, top10: 10, veteran: 55 },
    playerBadges: { 100: [{ badge: 'champion', place: null }, { badge: 'top10', place: 1 }, { badge: 'veteran', place: null }], 101: [{ badge: 'second_tribe', place: null }, { badge: 'top10', place: 2 }], 102: [{ badge: 'champion', place: null }, { badge: 'top10', place: 3 }, { badge: 'veteran', place: null }], 103: [{ badge: 'third_tribe', place: null }, { badge: 'top10', place: 4 }, { badge: 'veteran', place: null }], 104: [{ badge: 'veteran', place: null }] } };
  const PROFBADGES = [{ badge: 'champion', count: 2, bestPlace: null }, { badge: 'second_tribe', count: 1, bestPlace: null }, { badge: 'top10', count: 2, bestPlace: 4 }, { badge: 'veteran', count: 3, bestPlace: null }];
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let inner = window.fetch; const END = ${JSON.stringify(END)}; const PB = ${JSON.stringify(PROFBADGES)};
    const wrap = (u, o) => {
      const s = String(u && u.url || u);
      if (window.__fakeEnd && s.includes('/api/world-end')) return Promise.resolve(new Response(JSON.stringify({ ended: END }), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (/\\/api\\/players\\/\\d+$/.test(s)) return inner(u, o).then(async (r) => { try { const j = await r.clone().json(); j.badges = PB; return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }); } catch { return r; } });
      return inner(u, o);
    };
    Object.defineProperty(window, 'fetch', { configurable: true, get() { return wrap; }, set(f) { inner = f; } });
  })()` });
  for (const [w, h, mob] of [[1440, 900, false], [360, 800, true]]) {
    await size(w, h, mob);
    await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
    await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
    await sleep(2500);
    // profile sheet: Rankings tab, press a player row
    await evalJs(`window.location.hash = 'ranks'`); await sleep(1500);
    await evalJs(`(() => { const c = document.querySelector('input[type=checkbox]'); if (c && c.checked) c.click(); })()`); await sleep(1200);
    console.log('click row', await evalJs(`(() => { const r = document.querySelector('tr.rk-press'); if (!r) return false; r.scrollIntoView({block:'center'}); r.click(); return true; })()`));
    await sleep(2000);
    await shot(`profile-${w}.png`, false);
    console.log('profile', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'badge text', await evalJs(`!!document.body.innerText.match(/Veteran/)`));
  }
  // world end: reload with the fake end enabled from the start
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__fakeEnd = true;' });
  for (const [w, h, mob] of [[1440, 900, false], [360, 800, true]]) {
    await size(w, h, mob);
    await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
    await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
    await sleep(3000);
    await evalJs(`window.location.hash = 'results'`); await sleep(1500);
    await shot(`worldend-${w}.png`, true);
    console.log('worldend', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), await evalJs(`!!document.getElementById('end-badges-title')`));
  }
} catch (e) { console.error(e); } finally { chrome.kill(); }
