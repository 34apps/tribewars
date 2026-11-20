// usage: node shot.mjs <label BEFORE|AFTER> <htmlDir> <port> <mode: l10|mid> <phone|desktop> <outfile>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const [LABEL, DIR, PORTSTR, MODE, DEV, OUTFILE] = process.argv.slice(2);
const PHONE = DEV === 'phone';
const CDP = 9600 + Math.floor(Math.random() * 300);
const PROFILE = `/private/tmp/claude-501/drillyard-shot-profile-${CDP}`;
rmSync(PROFILE, { recursive: true, force: true });
const server = spawn('python3', ['-m', 'http.server', PORTSTR, '--bind', '127.0.0.1', '-d', DIR], { stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let seq = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const page = list.find((t) => t.type === 'page'); if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; } } catch {}
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
async function evalJs(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; }
async function waitFor(expr, ms = 40000) { const end = Date.now() + ms; while (Date.now() < end) { if (await evalJs(`!!(${expr})`).catch(() => false)) return; await sleep(300); } throw new Error('timeout ' + expr); }
const [W, H] = PHONE ? [360, 800] : [1440, 900];
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: PHONE, screenWidth: W, screenHeight: H });
  if (PHONE) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORTSTR}/index.html?demo` });
  await waitFor(`window.clanfirePreview`, 90000); await sleep(3000);
  await waitFor(`document.querySelector('nav, .shell, header, [aria-label^="Drillyard"]')`, 60000); await sleep(2000);
  const pid = await evalJs(`fetch('/api/state').then(r => r.json()).then(s => s.player.id)`);
  const mode = MODE;
  await evalJs(`window.clanfirePreview.run((ctx) => { const rec = ctx.store.villagesOfPlayer(${pid})[0]; const s = rec.state;
    s.resources = { wood: 80000, food: 80000, iron: 80000, gold: 4000 };
    if (${JSON.stringify(mode)} === 'l10') {
      s.buildings.drillyard = 10;
      s.researched = ['pikeman','guard','hearthwarden','raider','outrider','knight','pathfinder','logram','firecart','chieftain'];
      s.ranks = { logram: { breach: 3 }, firecart: { breach: 5 }, hearthwarden: { bulwark: 2 }, guard: { bulwark: 3 }, knight: { might: 2, bulwark: 1 }, pikeman: { bulwark: 5 }, raider: { might: 1 } };
    } else {
      s.buildings.drillyard = 5;
      s.researched = ['pikeman','guard','raider','pathfinder'];
      s.ranks = { pikeman: { bulwark: 2 }, raider: { might: 1 } };
    }
    ctx.store.saveVillage(rec.id, s, rec.points); return 1; })`);
  await sleep(1500);
  await evalJs(`location.hash = 'village'`); await waitFor(`document.querySelector('[aria-label^="Drillyard"]')`, 30000); await sleep(1500);
  await evalJs(`(() => { const b = document.querySelector('[aria-label^="Drillyard"]'); if (b) b.click(); })()`);
  await sleep(3000);
  const metrics = await evalJs(`JSON.stringify({ doc: document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight, win: innerWidth + 'x' + innerHeight })`);
  console.log(MODE, DEV, metrics);
  if (PHONE) {
    await evalJs(`(() => { const els = [...document.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 4 && /Drillyard/.test(e.textContent); }); const el = els[els.length - 1]; if (!el) return 'no scroller'; const t = [...el.querySelectorAll('*')].find((x) => x.children.length === 0 && /Training Points/.test(x.textContent)); if (t) t.scrollIntoView({ block: 'start' }); el.scrollTop += ${Number(process.env.SCROLL || 0)}; return 1; })()`);
    await sleep(800);
  }
  if (process.env.CLICK_RESET) {
    // Open the confirm: tap the first Reset icon button (Pikeman, rank 5 -> +10 points back)
    console.log(await evalJs(`(() => { const b = document.querySelector('.drill-reset'); if (!b) return 'no reset button'; const r = b.getBoundingClientRect(); b.click(); return b.getAttribute('aria-label') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); })()`));
    await sleep(800);
    console.log(await evalJs(`(document.querySelector('[role="dialog"], [role="alertdialog"], dialog') || {}).innerText || 'no dialog'`));
  }
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUTFILE, Buffer.from(r.data, 'base64'));
  console.log('saved', OUTFILE);
} catch (e) { console.error(e); } finally { chrome.kill(); server.kill(); }
