// Headless Chrome CDP screenshots of Morale: map send form, Command post send form, battle report, simulator.
// usage: node morale-shot.mjs <outDir>   (needs apps/preview/dist/index.html; no server). Fakes via a wrapped window.fetch:
//  - /api/map and /api/search/villages get one extra small player village "Mouse Hollow" next to the demo home (ownerPoints 12)
//  - /api/reports(/id) get one fake battle report with morale 0.75
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const ROOT = '/Users/admin/Projects/tribewars';
const PROFILE = '/private/tmp/claude-501/-Users-admin-Projects-tribewars/bc5d3889-5461-4156-a71b-ac51493d5481/scratchpad/morale-chrome-profile';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9352;
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
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
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
async function size(w, h, mobile) { cur = { w, h, mobile }; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }); }
async function shot(name, full) {
  if (full) {
    const h = await evalJs(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`);
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
const hscroll = () => evalJs('({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
const INNER = `[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e !== document.scrollingElement && e.tagName !== 'HTML' && e.tagName !== 'BODY'; }).map(e => (e.className && e.className.baseVal === undefined ? e.className : e.tagName)).slice(0, 10)`;
// Is the (first) button with this text fully inside the viewport?
const btnVisible = (text) => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent); if (!b) return 'no button'; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inView: r.top >= 0 && r.bottom <= innerHeight }; })()`);
const setInput = (sel, val) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(String(val))}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const clickText = (sel, text) => evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)}) && e.offsetParent); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`);

const FAKE_NAME = 'Mouse Hollow';
const BATTLE = { outcome: 'battle', attacker: { villageId: 1, name: 'Home', ownerName: 'demo', x: 0, y: 0 }, defender: { villageId: 900, name: FAKE_NAME, ownerName: 'tiny_tim', x: 2, y: 1 },
  attackerWon: true, luck: 0.043, attackPower: 412, defensePower: 138,
  attackerUnits: { pikeman: 0, guard: 0, raider: 60, outrider: 20, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 },
  attackerLosses: { pikeman: 0, guard: 0, raider: 9, outrider: 3, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 },
  defenderUnits: { pikeman: 25, guard: 10, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 },
  defenderLosses: { pikeman: 25, guard: 10, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0 },
  supportUnits: null, supportLosses: null, wallLevel: 2, morale: 0.75, loot: { wood: 320, food: 210, iron: 90, gold: 40 }, renownGained: 3 };
const now = Date.now();
const SUMMARY = { id: 9001, createdAt: now - 600000, title: `Raid on ${FAKE_NAME} (2|1)`, side: 'attack', type: 'battle', won: true, read: false, outcome: 'battle' };
const REPORT = { ...SUMMARY, battle: BATTLE, scout: null, support: null, shipment: null, village: null };

try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let inner = window.fetch; const NAME = ${JSON.stringify(FAKE_NAME)}; const SUM = ${JSON.stringify(SUMMARY)}; const REP = ${JSON.stringify(REPORT)};
    const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    const fakeVillage = (own) => ({ id: 900, name: NAME, kind: 'player', ownerName: 'tiny_tim', points: 20, protected: false, tribeTag: null, tribeId: null, ownerChieftain: null, relation: 'neutral', ownerPoints: 12, x: own.x + 2, y: own.y + 1 });
    const wrap = (u, o) => {
      const s = String(u && u.url || u);
      if (/\\/api\\/map\\?/.test(s)) return inner(u, o).then(async (r) => { try { const j = await r.clone().json(); const own = j.villages.find((v) => v.kind === 'own'); if (own) { window.__own = own; if (!j.villages.some((v) => v.id === 900) && s.includes('w=')) { const fv = fakeVillage(own); const m = /x=(-?\\d+)&y=(-?\\d+)&w=(\\d+)&h=(\\d+)/.exec(s); if (!m || (fv.x >= +m[1] && fv.x < +m[1] + +m[3] && fv.y >= +m[2] && fv.y < +m[2] + +m[4])) j.villages.push(fv); } } return J(j); } catch { return r; } });
      if (/\\/api\\/search\\/villages/.test(s)) return inner(u, o).then(async (r) => { try { const j = await r.clone().json(); const own = window.__own; if (own && decodeURIComponent(s).toLowerCase().includes('mouse')) j.villages = [fakeVillage(own)]; return J(j); } catch { return r; } });
      if (/\\/api\\/reports$/.test(s)) return Promise.resolve(J({ reports: [SUM] }));
      if (/\\/api\\/reports\\/9001$/.test(s)) return Promise.resolve(J(REP));
      return inner(u, o);
    };
    Object.defineProperty(window, 'fetch', { configurable: true, get() { return wrap; }, set(f) { inner = f; } });
  })()` });

  for (const [w, h, mob] of [[360, 800, true], [1440, 900, false]]) {
    const tag = `${w}`;
    await size(w, h, mob);
    await send('Page.navigate', { url: `file://${ROOT}/apps/preview/dist/index.html?demo` });
    await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
    await sleep(2500);

    // Give the demo home an army and some building levels (points), through the in-page server's store.
    await evalJs(`window.location.hash = 'map'`); await sleep(2500);
    const own = await evalJs(`window.__own || null`);
    console.log('own village', JSON.stringify(own && { x: own.x, y: own.y }));
    console.log('seeded', JSON.stringify(await evalJs(`(() => { const st = clanfirePreview.ctx.store; const rec = st.getVillageAt(window.__own.x, window.__own.y); const s = JSON.parse(JSON.stringify(rec.state));
      for (const b of Object.keys(s.buildings)) if (s.buildings[b] > 0) s.buildings[b] = Math.min(10, s.buildings[b] + 6);
      s.troops = { ...s.troops, raider: 80, outrider: 25, pikeman: 40, guard: 20 };
      st.saveVillage(rec.id, s, rec.points); return { id: rec.id, points: rec.points, keys: Object.keys(s.troops) }; })()`)));
    await evalJs(`window.location.hash = 'village'`); await sleep(500);
    await evalJs(`document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))`); await sleep(6000);
    await evalJs(`window.location.hash = 'map'`); await sleep(2500);
    await evalJs(`fetch('/api/map?x=-40&y=-40&w=61&h=61')`);
    const own2 = await evalJs(`window.__own || null`);

    // ---- 1. map: type the fake village's coordinates into Go (x|y), press Go, tile panel opens; pick troops ----
    await setInput('#go-x', own2.x + 2); await setInput('#go-y', own2.y + 1);
    await evalJs(`document.querySelector('.wm-goto button[type=submit]').click()`); await sleep(2500);
    const pick = async (q) => { await setInput('#send-raider', 30); await setInput('#send-outrider', 10); await sleep(600); };
    await pick();
    const mtext = await evalJs(`document.body.innerText.match(/Morale[^\\n]*/g)`);
    console.log(`[${tag}] map morale text`, JSON.stringify(mtext));
    // scroll the send form into view so the Morale line + Send attack button are both visible when they fit
    await evalJs(`(() => { const m = [...document.querySelectorAll('.wm-morale')][0]; if (m) m.scrollIntoView({ block: 'center' }); })()`); await sleep(500);
    await shot(`map-send-${tag}.png`, false);
    console.log(`[${tag}] map: hscroll`, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'Send attack btn', JSON.stringify(await btnVisible('Send attack')));
    // open the morale "?" help
    await evalJs(`(() => { const d = document.querySelector('.wm-morale details'); if (d) d.open = true; })()`); await sleep(300);
    await shot(`map-send-help-${tag}.png`, false);
    // ---- 4. simulator opened from the map's Simulate link (morale pre-ticked) ----
    console.log(`[${tag}] simulate click`, await clickText('button.wm-link', 'Simulate')); await sleep(2000);
    console.log(`[${tag}] hash`, await evalJs(`location.hash`));
    await shot(`simulator-${tag}.png`, true);
    console.log(`[${tag}] simulator: hscroll`, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'switch', await evalJs(`(() => { const i = [...document.querySelectorAll('.sim-morale input')][0]; return i ? i.checked : null; })()`));
    await evalJs(`(() => { const d = document.querySelector('.sim-morale details'); if (d) d.open = true; })()`); await sleep(300);
    await shot(`simulator-help-${tag}.png`, true);

    // ---- 2. Command post (Army tab): coordinates mode ----
    await evalJs(`window.location.hash = 'army'`); await sleep(2000);
    await setInput('.cp-target input', `${own2.x + 2}|${own2.y + 1}`); await sleep(2500);
    await setInput('#send-raider', 30); await setInput('#send-outrider', 10); await sleep(600);
    await evalJs(`(() => { const m = document.querySelector('.command-post .wm-morale, .cp-sheet .wm-morale'); if (m) m.scrollIntoView({ block: 'center' }); })()`); await sleep(500);
    console.log(`[${tag}] cp morale text`, JSON.stringify(await evalJs(`document.body.innerText.match(/Morale[^\\n]*/g)`)));
    await shot(`command-post-${tag}.png`, false);
    await shot(`command-post-full-${tag}.png`, true);
    console.log(`[${tag}] cp: hscroll`, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)), 'Send attack btn', JSON.stringify(await btnVisible('Send attack')));

    // ---- 3. battle report (fake) ----
    await evalJs(`window.location.hash = 'reports'`); await sleep(2000);
    console.log(`[${tag}] report row`, await clickText('li button, .report-row, [class*=report] button, tr', FAKE_NAME)); await sleep(1500);
    console.log(`[${tag}] report morale text`, JSON.stringify(await evalJs(`document.body.innerText.match(/Morale[^\\n]*/g)`)));
    await evalJs(`(() => { const d = [...document.querySelectorAll('dt')].find(e => e.textContent.trim() === 'Morale'); if (d) d.scrollIntoView({ block: 'center' }); })()`); await sleep(500);
    await shot(`report-${tag}.png`, false);
    await shot(`report-full-${tag}.png`, true);
    console.log(`[${tag}] report: hscroll`, JSON.stringify(await hscroll()), 'inner', JSON.stringify(await evalJs(INNER)));
  }
} catch (e) { console.error(e); } finally { chrome.kill(); }
