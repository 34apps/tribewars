// Headless Chrome CDP screenshots of the Tribe projects screens in the single-file preview.
// usage: node shot.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/-Users-admin-Projects-tribewars/d574ac8d-eea1-44a6-b7d9-198d45c0229a/scratchpad/shots';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = 9339;
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

const SEED = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const j = async (m, u, b) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(u + ' ' + r.status + ' ' + t); return t ? JSON.parse(t) : null; };
  const st = await j('GET', '/api/state');
  const me = st.player; const myV = st.villages[0];
  const now = Date.now();
  ctx.store.run('UPDATE players SET created_at = ? WHERE id = ?', now - 10 * 86400000, me.id);
  { const rec = ctx.store.villagesOfPlayer(me.id)[0]; const s2 = { ...rec.state, buildings: { ...rec.state.buildings, hall: 5, market: Math.max(rec.state.buildings.market || 0, 3) } }; ctx.store.saveVillage(rec.id, s2, 50); }
  await j('POST', '/api/tribes', { name: 'Ember Foxes', tag: 'EMF', recruitment: 'open' });
  const tribeId = ctx.store.tribes.membership(me.id).tribeId;
  // other players' villages (computer players) for ledger names, a tribe-mate and an incoming attack
  const others = []; let mate = null;
  for (let id = 1; id < 3000; id++) { const v = ctx.store.getVillage(id); if (!v || !v.ownerId || v.ownerId === me.id) continue; if (others.length < 6) others.push(v); if (!mate && others.length >= 5) mate = v; if (others.length >= 6 && mate) break; }
  if (mate) ctx.store.tribes.run('DELETE FROM tribe_members WHERE player_id = ?', mate.ownerId);
  if (mate) ctx.store.tribes.insertMember(mate.ownerId, tribeId, 'member', now - 5 * 86400000);
  await j('POST', '/api/tribe/projects/store-village', { villageId: (mate || myV).id });
  const P = ctx.store.projects;
  P.setResources(tribeId, { wood: 182400, food: 151900, iron: 96300, gold: 41250 });
  P.setLevel(tribeId, 'roads', 1);
  P.setLevel(tribeId, 'watchtower', 2);
  P.insertRun({ tribeId, project: 'wards', level: 1, startedAt: now - 3 * 3600000, endsAt: now + 5 * 3600000 + 42 * 60000, cost: { wood: 75000, food: 75000, iron: 75000, gold: 75000 } });
  const giver = (i) => (i === 0 && mate) ? mate : others[i % others.length];
  const gifts = [[me.id, me.username, 9000, 6000, 4000, 2500, 0.4], [giver(0).ownerId, giver(0).ownerName, 12000, 12000, 8000, 3000, 1.5], [giver(1).ownerId, giver(1).ownerName, 5000, 8000, 2000, 1000, 3], [me.id, me.username, 4000, 4000, 4000, 1000, 20], [giver(2).ownerId, giver(2).ownerName, 20000, 15000, 10000, 5000, 30]];
  for (const [pid, name, a, b, c, d, h] of gifts) P.insertLedger(tribeId, pid, name, { wood: a, food: b, iron: c, gold: d }, now - h * 3600000);
  // an incoming attack on my village (Watchtower level 2 shows its rough size and slowest unit)
  const units = {}; for (const k of Object.keys(ctx.store.villagesOfPlayer(me.id)[0].state.troops)) units[k] = 0;
  units.raider = 420; units.logram = 12;
  ctx.store.insertMovement({ kind: 'attack', originVillageId: others[3].id, targetVillageId: myV.id, units, loot: null, departAt: now - 600000, arriveAt: now + 2 * 3600000 + 13 * 60000 });
  return { me: me.username, mate: mate && mate.name, tribeId, others: others.length };
})()`;

try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  const url = `file://${ROOT}/apps/preview/dist/index.html?demo`;
  await send('Page.navigate', { url });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 40000);
  await sleep(2500);
  console.log('seed', JSON.stringify(await evalJs(SEED)));
  await sleep(1500);
  // Projects page, desktop
  await evalJs(`window.location.hash = 'tribe'`); await sleep(1500);
  console.log('tab', await clickText('[role=tab]', 'Projects')); await sleep(2000);
  await evalJs('window.scrollTo(0,0)');
  await shot('projects-1440.png', true);
  // Alerts page
  for (const t of ['Alerts', 'Warnings', 'Incoming']) { if (await clickText('[role=tab]', t)) { console.log('alerts tab', t); break; } }
  await sleep(2000); await evalJs('window.scrollTo(0,0)');
  await shot('alerts-1440.png', false);
  // Send to store (opens the map with the send form)
  await clickText('[role=tab]', 'Projects'); await sleep(1500);
  console.log('send', await clickText('button', 'Send resources')); await sleep(3000);
  await evalJs('window.scrollTo(0,0)');
  await shot('send-1440.png', false);
  // Phone
  await size(360, 780, true);
  await evalJs(`window.location.hash = 'tribe'`); await sleep(1500);
  await clickText('[role=tab]', 'Projects'); await sleep(2000);
  await evalJs('window.scrollTo(0,0)');
  await shot('projects-360.png', true);
  console.log('send360', await clickText('button', 'Send resources')); await sleep(3000);
  await shot('send-360.png', false);
  // inner scrollbars check at desktop
  await size(1440, 900, false);
  await evalJs(`window.location.hash = 'tribe'`); await sleep(1200); await clickText('[role=tab]', 'Projects'); await sleep(1500);
  console.log('inner-scroll', JSON.stringify(await evalJs(`[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2 && e !== document.scrollingElement; }).map(e => e.className || e.tagName).slice(0, 10)`)));
  console.log('hscroll360', await (async () => { await size(360, 780, true); await sleep(800); return evalJs('document.documentElement.scrollWidth'); })());
} catch (e) {
  console.error(e);
} finally {
  chrome.kill();
}
