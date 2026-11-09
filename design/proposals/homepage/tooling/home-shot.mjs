// Headless Chrome CDP screenshots of the lobby (vite dev + faked /lobby/api).
// usage: node home-shot.mjs <outDir>   (needs vite dev on 127.0.0.1:5199:  cd apps/web && npx vite --host 127.0.0.1 --port 5199 --strictPort)
// Fake data = the mobile-lobby mockups: account with 2 badges; worlds: 2 played (1 running, 1 finished), 9 open, 2 full and
// 3 finished that were never played; the public list has the same open and full worlds.
// Shots (out/<name>-<w>x<h>.png): phone 360x640 and 390x844: home, signin, signup, worlds, allworlds (worlds and allworlds
// also as <name>-full-<w>x<h>.png, the whole page); desktop 1440x900: home, worlds, allworlds; 1280x720: worlds; plus the account menu (menu-390x844.png) and the
// Hall of Fame dialog (hall-1440x900.png). Prints, per shot, whether the page scrolls (page scrollHeight vs clientHeight).
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
const OPEN = [['Emberfall', 1], ['Thornwick', 2], ['Cinder Vale', 5], ['Mistral Reach', 6], ['Ravenmoor', 8], ['Saltmarsh', 11], ['Duskhollow', 13], ['Greywater', 16], ['Stonebrook', 19]];
const FULL = [['Ashfall', 25], ['Brackenmoor', 31]];
const DONE = [['Old Cairn', 90], ['Frostgate', 120], ['Last Ember', 150]];
const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, '-');
const mk = (n, status, days, played) => ({ id: slug(n), name: n, status, path: `/w/${slug(n)}/`, openedAt: now - days * DAY, lastPlayedAt: played === null ? null : now - played * DAY });
const LOBBY_WORLDS = { worlds: [
  mk('Hollow Marsh', 'open', 30, 2),
  mk('First Light', 'finished', 80, 40),
  ...OPEN.map(([n, d]) => mk(n, 'open', d, null)),
  ...FULL.map(([n, d]) => mk(n, 'full', d, null)),
  ...DONE.map(([n, d]) => mk(n, 'finished', d, null)),
] };
const PUBLIC_WORLDS = { worlds: [...OPEN.map(([n, d]) => ({ id: slug(n), name: n, status: 'open', path: `/w/${slug(n)}/`, openedAt: now - d * DAY })), ...FULL.map(([n, d]) => ({ id: slug(n), name: n, status: 'full', path: `/w/${slug(n)}/`, openedAt: now - d * DAY }))] };
const ACCOUNT = { id: 1, username: 'Rowan_the_Red', chieftain: 'old-orm', staffRole: null, badges: [
  { worldId: 'w1', worldName: 'First Light', badge: 'champion', place: null, endedAt: now - 40 * DAY },
  { worldId: 'w2', worldName: 'Second Spark', badge: 'top10', place: 4, endedAt: now - 20 * DAY },
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
  /** Open a lobby address fresh (hash routes: /lobby/#signin ...) and wait until the screen is drawn. */
  async function open(w, h, mob, hash, ready) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mob ? 2 : 1, mobile: mob });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: 'http://127.0.0.1:5199/lobby/' + hash });
    await waitFor(ready);
    await waitFor(`!document.querySelector('.home-village-art') || document.querySelector('.home-village-art[data-ready="true"]')`);
    await sleep(900); // fade-in
  }
  async function shot(name, w, h, mob, full = false) {
    const m = await evalJs(`(() => { const d = document.documentElement; const inner = [...document.querySelectorAll('body *')].some((x) => { const c = getComputedStyle(x); return /(auto|scroll)/.test(c.overflowY) && x.clientHeight > 0 && x.scrollHeight > x.clientHeight + 1 && x !== d && x !== document.body; }); return { psh: d.scrollHeight, pch: d.clientHeight, sw: d.scrollWidth, cw: d.clientWidth, inner, hash: location.hash }; })()`);
    // Full page: capture beyond the viewport (the layout keeps the real window height, so media queries do not change).
    const r = full && m.psh > h
      ? await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: m.psh, scale: 1 } })
      : await send('Page.captureScreenshot', { format: 'png' });
    const file = `${name}${full ? '-full' : ''}-${w}x${h}.png`;
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
    console.log(file.padEnd(28), `page ${m.psh}/${m.pch}`, m.psh <= m.pch ? 'NO-PAGE-SCROLL' : `PAGE-SCROLLS(+${m.psh - m.pch})`, m.sw <= m.cw ? '' : 'H-SCROLL', m.inner ? 'INNER-SCROLLBOX' : '', m.hash);
  }
  const READY = {
    home: `document.querySelector('.lp-foot, .home-world')`,
    form: `document.querySelector('input[name=username]')`,
    worlds: `document.querySelector('.lp-sheet-in .wrow, .home-welcome .home-world')`,
    all: `document.querySelector('.aw-list .wrow')`,
  };
  for (const [w, h] of [[360, 640], [390, 844]]) {
    signedIn = false;
    await open(w, h, true, '', READY.home); await shot('home', w, h, true);
    await open(w, h, true, '#signin', READY.form); await shot('signin', w, h, true);
    await open(w, h, true, '#signup', READY.form); await shot('signup', w, h, true);
    signedIn = true;
    await open(w, h, true, '', READY.worlds); await shot('worlds', w, h, true); await shot('worlds', w, h, true, true);
    if (w === 390) { await evalJs(`document.querySelector('.lp-avatar').click()`); await waitFor(`document.querySelector('.lp-menu')`); await sleep(200); await shot('menu', w, h, true); }
    await open(w, h, true, '#worlds', READY.all); await shot('allworlds', w, h, true); await shot('allworlds', w, h, true, true);
  }
  signedIn = false;
  await open(1440, 900, false, '', READY.home); await shot('home', 1440, 900, false);
  signedIn = true;
  await open(1440, 900, false, '', READY.worlds); await shot('worlds', 1440, 900, false);
  await open(1440, 900, false, '#worlds', READY.all); await shot('allworlds', 1440, 900, false);
  await open(1280, 720, false, '', READY.worlds); await shot('worlds', 1280, 720, false);
  // Hall of Fame dialog, signed in, desktop.
  await open(1440, 900, false, '', READY.worlds);
  await evalJs(`document.querySelector('.home-hall').click()`);
  await waitFor(`document.querySelector('.hof-dialog .hof-card')`);
  await sleep(300);
  await shot('hall', 1440, 900, false);
} catch (e) { console.error(e); } finally { chrome.kill(); }
