// REAL end-to-end screenshots: throwaway lobby + world w1 (ended, badges recorded) behind vite on 127.0.0.1:5410. No faked data.
// usage: node e2e-shot.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const ROOT = '/Users/admin/Projects/tribewars';
const PROFILE = '/private/tmp/claude-501/badges-e2e/chrome-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9351;
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

const BASE = 'http://127.0.0.1:5410';
const USER = process.argv[3] || 'ember_fox', PW = 'e2e-Passw0rd-badges';
const hscroll = () => evalJs('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
const INNER = `[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e !== document.scrollingElement && e.tagName !== 'HTML' && e.tagName !== 'BODY'; }).map(e => e.className || e.tagName).slice(0, 10)`;
async function typeInto(sel, text) {
  await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`);
  await send('Input.insertText', { text });
}
const text = () => evalJs('document.body.innerText');
const report = [];
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  for (const [w, h, mob] of [[1440, 900, false], [360, 800, true]]) {
    await size(w, h, mob);
    await send('Network.clearBrowserCookies');
    // ---- lobby: real sign-in through the UI ----
    await send('Page.navigate', { url: BASE + '/lobby/' });
    await waitFor(`document.querySelector('input[name=username]')`);
    await typeInto('input[name=username]', USER); await typeInto('input[name=password]', PW);
    await evalJs(`document.querySelector('form.auth-form button[type=submit]').click()`);
    await waitFor(`document.querySelector('.hof-card')`, 20000);
    await sleep(800);
    await shot(`lobby-${w}.png`, true);
    report.push(['lobby', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'badgeRow', await evalJs(`document.querySelectorAll('.lobby-badges .badge-chip, .lobby-badges li').length`), 'hof', await evalJs(`document.querySelectorAll('.hof-card').length`)]);
    // ---- enter w1: View results (fresh pass -> world stores bdg) ----
    console.log('button', await evalJs(`(() => { const b = [...document.querySelectorAll('.lobby-card button, .lobby-card a')].find(e => /View results|Play|Enter/i.test(e.textContent)); if (!b) return null; const t = b.textContent.trim(); b.click(); return t; })()`));
    await waitFor(`location.pathname.startsWith('/w/w1')`, 20000);
    await waitFor(`document.querySelector('nav, .shell, header')`, 40000);
    await sleep(2500);
    // ---- world end screen ----
    await evalJs(`window.location.hash = 'results'`); await sleep(2000);
    await shot(`worldend-${w}.png`, true);
    report.push(['worldend', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'end-badges', await evalJs(`!!document.getElementById('end-badges-title')`)]);
    // ---- ranks profile sheet of a badge holder ----
    await evalJs(`window.location.hash = 'ranks'`); await sleep(1500);
    await evalJs(`(() => { const c = document.querySelector('input[type=checkbox]'); if (c && c.checked) c.click(); })()`); await sleep(1000);
    console.log('click row', await evalJs(`(() => { const rows = [...document.querySelectorAll('tr.rk-press')]; const r = rows.find(x => /kestrel/.test(x.textContent)) || rows[0]; if (!r) return false; r.scrollIntoView({block:'center'}); r.click(); return r.textContent.slice(0,60); })()`));
    await sleep(2500);
    await shot(`profile-${w}.png`, false);
    report.push(['profile', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'text', await evalJs(`(document.body.innerText.match(/Badges[\\s\\S]{0,200}/)||[''])[0].replace(/\\s+/g,' ')`)]);
    await evalJs(`(() => { const b = document.querySelector('[role=dialog] button[aria-label*=lose], .modal button'); if (b) b.click(); })()`);
    // ---- tribe members list ----
    await evalJs(`window.location.hash = 'tribe'`); await sleep(2000);
    console.log('members tab', await clickText('button, a, [role=tab]', 'Members'));
    await sleep(2000);
    await shot(`tribe-members-${w}.png`, true);
    report.push(['members', w, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'badgeIcons', await evalJs(`document.querySelectorAll('.badge-row, .badge-chip, [class*=member-badge]').length`)]);
  }
} catch (e) { console.error(e); } finally { console.log(report.map((r) => r.join(' ')).join('\n')); chrome.kill(); }
