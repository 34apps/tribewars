// Headless Chrome CDP screenshots of every main screen in the single-file preview (Parchment is the default now).
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2]; const THEME_DIR = new URL('.', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/first-steps-shot';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
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



const J = (m, u, b) => evalJs(`(async () => { const r = await fetch(${JSON.stringify(u)}, { method: ${JSON.stringify(m)}, headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(b ? JSON.stringify(b) : null)} || undefined }); return r.status + ' ' + (await r.text()).slice(0, 400000); })()`);
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(1500); };
const reload = async () => { await send('Page.reload'); await waitFor(`window.clanfirePreview && document.querySelector('.vv')`, 40000); await sleep(2500); };
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
  await waitFor(`window.clanfirePreview && document.querySelector('.vv')`, 40000);
  await sleep(3000);
  const st = JSON.parse((await J('GET', '/api/state')).replace(/^\d+ /, '') || '{}').firstSteps;
  console.log('fresh', JSON.stringify(st && st.steps.map((s) => s.id + ':' + (s.done ? 1 : 0))));
  for (const [tag, w, h, mob] of [['1440', 1440, 900, false], ['360', 360, 780, true]]) {
    await size(w, h, mob); await sleep(900);
    await shot(`01-fresh-${tag}.png`, !mob);
  }
  // Do a step: queue Lumber Camp to level 2.
  const vid = JSON.parse((await J('GET', '/api/state')).replace(/^\d+ /, '')).villages[0].id;
  console.log('build', await J('POST', `/api/villages/${vid}/build`, { building: 'lumber' }));
  await J('POST', `/api/villages/${vid}/build`, { building: 'farm' });
  await sleep(500);
  for (const [tag, w, h, mob] of [['1440', 1440, 900, false], ['360', 360, 780, true]]) {
    await size(w, h, mob); await sleep(900);
    await evalJs('window.dispatchEvent(new Event("focus"))'); await sleep(1800);
    await shot(`02-claimable-${tag}.png`, !mob);
    if (mob) {
      await evalJs(`document.querySelector('.fs-bar-main').click()`); await sleep(900);
      await shot('03-sheet-360.png');
      console.log('bar/touch', await evalJs(`[...document.querySelectorAll('.fs-bar button, .fs-card button, .fs-card summary')].map(b => b.textContent.trim().slice(0,12) + ':' + Math.round(b.getBoundingClientRect().height)).join(' | ')`));
      await evalJs(`document.querySelector('.vv-sheet-close').click()`); await sleep(400);
    }
    await clickText('button.fs-claim', 'Claim'); await sleep(900);
    await shot(`04-claimed-${tag}.png`, !mob && false);
  }
  // Settings toggle + hide
  await clickText('.fs-hide', 'Hide'); await sleep(600);
  console.log('hidden card present', await evalJs(`!!document.querySelector('.fs-card, .fs-bar')`));
  await evalJs(`document.querySelector('.who-button').click()`); await sleep(500);
  await clickText('.who-menu button', 'Settings'); await sleep(900);
  await shot('05-settings-360.png');
  const ov = await evalJs(`document.documentElement.scrollWidth + ' vs ' + innerWidth`);
  console.log('scrollW', ov);
} catch (e) { console.error(e); } finally { chrome.kill(); }
