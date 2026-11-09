// Headless Chrome CDP screenshots of the lobby homepage (vite dev + faked /lobby/api).
// usage: node home-shot.mjs <outDir>   (needs vite dev on 127.0.0.1:5199:  cd apps/web && npx vite --host 127.0.0.1 --port 5199 --strictPort)
// Signed out at 360x640, 390x844, 1280x720, 1440x900 (out-<w>x<h>.png); signed in (account with 2 badges; worlds: 1 played,
// 2 new, 1 full, 1 finished) at 360x640, 390x844, 1280x720, 1440x900 (in-<w>x<h>.png); the chieftain overlay after
// "Play free" at 360x640 and 1280x720 (chieftain-<w>x<h>.png); the Hall of Fame dialog (hall-1440x900.png).
// Prints, per shot, the page scroller's (.home) scrollHeight vs clientHeight.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node home-shot.mjs <outDir>'); process.exit(1); }
const PROFILE = '/private/tmp/claude-501/home-shot/chrome-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9342;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function waitFor(expr, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(250); }
  throw new Error('timeout waiting for ' + expr);
}
const now = Date.now();
const DAY = 86400000;
const PUBLIC_WORLDS = { worlds: [
  { id: 'w4', name: 'Hollow Marsh', status: 'open', path: '/w/w4/', openedAt: now - 3 * DAY },
  { id: 'w5', name: 'Cinder Vale', status: 'open', path: '/w/w5/', openedAt: now - 9 * DAY },
  { id: 'w6', name: 'Ashfall', status: 'full', path: '/w/w6/', openedAt: now - 20 * DAY },
] };
const ACCOUNT = { id: 1, username: 'Rowan_the_Red', chieftain: 'old-orm', staffRole: null, badges: [
  { worldId: 'w1', worldName: 'First Light', badge: 'champion', place: null, endedAt: now - 40 * DAY },
  { worldId: 'w2', worldName: 'Second Spark', badge: 'top10', place: 4, endedAt: now - 20 * DAY },
] };
const LOBBY_WORLDS = { worlds: [
  { id: 'w4', name: 'Hollow Marsh', status: 'open', path: '/w/w4/', lastPlayedAt: now - 2 * DAY },
  { id: 'w5', name: 'Cinder Vale', status: 'open', path: '/w/w5/', lastPlayedAt: null },
  { id: 'w7', name: 'Emberfall', status: 'open', path: '/w/w7/', lastPlayedAt: null },
  { id: 'w6', name: 'Ashfall', status: 'full', path: '/w/w6/', lastPlayedAt: null },
  { id: 'w1', name: 'First Light', status: 'finished', path: '/w/w1/', lastPlayedAt: now - 50 * DAY },
] };
const HALL = { worlds: [
  { worldId: 'w1', worldName: 'First Light', endedAt: now - 40 * DAY, kind: 'domination', winner: { tag: 'EMB', name: 'The Embers' },
    topPlayers: [{ rank: 1, name: 'Rowan_the_Red', tribeTag: 'EMB', points: 12840 }, { rank: 2, name: 'Mags', tribeTag: null, points: 9120 }, { rank: 3, name: 'Tinker', tribeTag: 'EMB', points: 7005 }] },
] };
let signedIn = false;
const json = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5199/lobby/api/*' }] });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url; let body = { error: 'not_found' }; let status = 404;
    if (u.includes('/auth/me')) { body = { account: signedIn ? ACCOUNT : null }; status = 200; }
    else if (u.includes('/worlds/public')) { body = PUBLIC_WORLDS; status = 200; }
    else if (u.includes('/hall-of-fame')) { body = HALL; status = 200; }
    else if (u.includes('/worlds')) { body = LOBBY_WORLDS; status = 200; }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) }).catch(() => {});
  });
  const SIZES = [[360, 640, true], [390, 844, true], [1280, 720, false], [1440, 900, false]];
  async function open(w, h, mob) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mob ? 2 : 1, mobile: mob });
    await send('Page.navigate', { url: 'http://127.0.0.1:5199/lobby/' });
    await waitFor(`document.querySelector('.home-village-art[data-ready="true"]') || !document.querySelector('.home-hero') || getComputedStyle(document.querySelector('.home-hero')).display === 'none'`);
    await sleep(900); // fade-in
  }
  async function shot(name, w, h) {
    const m = await evalJs(`(() => { const e = document.querySelector('.home') || document.documentElement; const d = document.documentElement; const hero = document.querySelector('.home-hero'); const r = hero ? hero.getBoundingClientRect() : { width: 0, height: 0 }; const card = document.querySelector('.home-welcome'); const inner = card ? [card, ...card.querySelectorAll('*')].some((x) => { const c = getComputedStyle(x); return /(auto|scroll)/.test(c.overflowY) && x.scrollHeight > x.clientHeight + 1; }) : false; return { sh: e.scrollHeight, ch: e.clientHeight, psh: d.scrollHeight, pch: d.clientHeight, sw: d.scrollWidth, cw: d.clientWidth, hero: Math.round(r.width) + 'x' + Math.round(r.height), inner }; })()`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}-${w}x${h}.png`), Buffer.from(r.data, 'base64'));
    console.log(`${name} ${w}x${h}`, `.home ${m.sh}/${m.ch}`, `page ${m.psh}/${m.pch}`, m.psh <= m.pch ? 'NO-PAGE-SCROLL' : `PAGE-SCROLLS(+${m.psh - m.pch})`, `village=${m.hero}`, m.sw <= m.cw ? '' : 'H-SCROLL', m.inner ? 'INNER-SCROLLBAR' : '');
  }
  for (const [w, h, mob] of [[360, 640, true], [390, 844, true], [1440, 900, false]]) {
    signedIn = false;
    await open(w, h, mob);
    await waitFor(`document.querySelector('.home-world')`);
    await shot('out', w, h);
  }
  for (const [w, h, mob] of [[360, 640, true], [1440, 900, false]]) {
    signedIn = false;
    await open(w, h, mob);
    await evalJs(`document.querySelector('.home-play').click()`);
    await waitFor(`document.querySelector('input[name=username]')`);
    await sleep(500);
    await shot('auth', w, h);
  }
  for (const [w, h, mob] of SIZES) {
    signedIn = true;
    await open(w, h, mob);
    await waitFor(`document.querySelector('.home-welcome .home-world')`);
    await shot('in', w, h);
  }
  // Hall of Fame dialog, signed in, desktop.
  signedIn = true;
  await open(1440, 900, false);
  await waitFor(`document.querySelector('.home-hall')`);
  await evalJs(`document.querySelector('.home-hall').click()`);
  await waitFor(`document.querySelector('.hof-dialog .hof-card')`);
  await sleep(300);
  await shot('hall', 1440, 900);
} catch (e) { console.error(e); } finally { chrome.kill(); }
