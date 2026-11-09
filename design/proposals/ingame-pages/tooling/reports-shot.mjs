// Army page screenshots (1440 + phone) plus the Drillyard and Village pages, on the demo seed with extra movements and support.
// usage: node after-shot.mjs <outDir>   (needs apps/preview/dist/index.html: npm run build:preview). Prints a contrast audit per screen.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-reports';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9486;
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

const U = (o) => ({ pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0, ...o });
// Seed: a rich village, ~30 reports (battles of both sides, a big siege battle with support, scouting, shipments, support turned back).
const SEED_REPORTS = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = st.player; const now = Date.now();
  const rec = ctx.store.villagesOfPlayer(me.id)[0];
  const b = { ...rec.state.buildings, hall: 10, barracks: 8, stables: 3, drillyard: 5, bannerhall: 2, storehouse: 12, wall: 7 };
  ctx.store.saveVillage(rec.id, { ...rec.state, buildings: b, lastUpdate: now, resources: { wood: 48200, food: 31400, iron: 22800, gold: 15650 } }, 80);
  const others = [];
  for (let id = 1; id < 3000 && others.length < 4; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id) others.push(v); }
  const ab = []; for (let id = 1; id < 3000 && ab.length < 1; id++) { const v = ctx.store.getVillage(id); if (v && !v.ownerId) ab.push(v); }
  const ref = (v) => ({ villageId: v.id, name: v.name, x: v.x, y: v.y, ownerName: v.ownerName });
  const mine = ref(rec); const [t, i, y, br] = others.map(ref); const aband = ref(ab[0]);
  const U = (o) => ({ pikeman: 0, guard: 0, raider: 0, outrider: 0, knight: 0, pathfinder: 0, chieftain: 0, logram: 0, boulder: 0, ...o });
  const R0 = { wood: 0, food: 0, iron: 0, gold: 0 };
  const H = 3600000; let n = 0;
  const at = (hoursAgo) => now - Math.round(hoursAgo * H) - (n++) * 1000;
  const battle = (side, won, title, o) => ctx.store.insertReport({ playerId: me.id, side, won, title, createdAt: o.at, type: 'battle', battle: { type: 'battle', outcome: 'battle', attacker: o.att, defender: o.def, attackerWon: o.aw, luck: o.luck ?? 0.03, attackPower: o.ap ?? 1200, defensePower: o.dp ?? 800, attackerUnits: o.au ?? U({ raider: 20 }), attackerLosses: o.al ?? U({ raider: 3 }), defenderUnits: o.du === undefined ? U({ pikeman: 10 }) : o.du, defenderLosses: o.dl === undefined ? U({ pikeman: 10 }) : o.dl, supportUnits: o.su ?? null, supportLosses: o.sl ?? null, wallLevel: o.wall ?? 3, loot: o.loot ?? R0, ...(o.siege ? { siege: o.siege } : {}), ...(o.renown ? { renownGained: o.renown } : {}), ...(o.morale ? { morale: o.morale } : {}) } });
  // oldest first so ids ascend with time
  for (let k = 0; k < 8; k++) ctx.store.insertReport({ playerId: me.id, side: 'shipment', won: true, title: 'Shipment received from ' + i.name + ' (' + i.x + '|' + i.y + ')', createdAt: at(120 + k * 9), type: 'shipment', shipment: { type: 'shipment', role: 'received', from: i, to: mine, resources: { wood: 2000, food: 0, iron: 0, gold: 0 }, stored: { wood: 2000, food: 0, iron: 0, gold: 0 }, lost: R0 } });
  for (let k = 0; k < 6; k++) battle('defense', k % 3 !== 0, 'Attack from ' + br.name + ' (' + br.x + '|' + br.y + ')', { at: at(60 + k * 5), att: br, def: mine, aw: k % 3 === 0, au: U({ raider: 15 }), al: U({ raider: k % 3 === 0 ? 2 : 15 }), du: U({ pikeman: 20 }), dl: U({ pikeman: k % 3 === 0 ? 8 : 1 }) });
  for (let k = 0; k < 5; k++) ctx.store.insertReport({ playerId: me.id, side: 'attack', won: true, title: 'Scouting ' + t.name + ' (' + t.x + '|' + t.y + ')', createdAt: at(30 + k * 3), type: 'scout', scout: { type: 'scout', scout: mine, target: t, success: k !== 2, scoutsSent: 5, scoutsLost: k === 2 ? 5 : 0, defenderScouts: k === 2 ? null : 12, defenderScoutsLost: 0, intel: k === 2 ? null : { keen: 5, resources: { wood: 12480, food: 9310, iron: 7905, gold: 2140 }, troops: U({ pikeman: 64, guard: 48, raider: 140, outrider: 36, knight: 10, pathfinder: 12, chieftain: 1, logram: 6, boulder: 3 }), wallLevel: 7, drillyardLevel: 5, buildings: { hall: 11, lumber: 13, farm: 12, mine: 12, goldmine: 6, market: 4, storehouse: 10, barracks: 9, stables: 5, drillyard: 5, bannerhall: 1, wall: 7, vault: 5 } } } });
  for (let k = 0; k < 4; k++) battle('attack', true, 'Raid on Abandoned village (' + aband.x + '|' + aband.y + ')', { at: at(26 + k * 2), att: mine, def: aband, aw: true, du: U(), dl: U(), au: U({ raider: 12 }), al: U({ raider: 1 }), loot: { wood: 150, food: 100, iron: 100, gold: 100 }, renown: 3 });
  // yesterday: the big support battle (Wall 8 -> 6 by 48 Log Rams, a market knocked down by 40 slings)
  battle('support', false, 'Your troops at ' + t.name + ' (' + t.x + '|' + t.y + ') were attacked', { at: now - 20 * H, att: i, def: t, aw: true, au: U({ pikeman: 60, guard: 40, raider: 300, outrider: 90, knight: 24, pathfinder: 15, logram: 48, boulder: 40 }), al: U({ pikeman: 14, guard: 9, raider: 71, outrider: 21, knight: 6, logram: 16, boulder: 10 }), du: U({ pikeman: 120, guard: 90, raider: 30, outrider: 20, knight: 8, pathfinder: 10, chieftain: 1, logram: 2, boulder: 4 }), dl: U({ pikeman: 120, guard: 90, raider: 30, outrider: 20, knight: 8, pathfinder: 10, chieftain: 1, logram: 2, boulder: 4 }), su: U({ guard: 12, knight: 2 }), sl: U({ guard: 12, knight: 2 }), ap: 19860, dp: 11420, luck: -0.03, wall: 7, loot: { wood: 3940, food: 3210, iron: 2860, gold: 720 }, renown: 12, siege: [{ unit: 'logram', building: 'wall', from: 8, to: 6 }, { unit: 'boulder', building: 'market', from: 2, to: 0 }] });
  // today: big battle of mine with morale, siege on one building and loot
  battle('attack', true, 'Raid on ' + y.name + ' (' + y.x + '|' + y.y + ')', { at: now - 5 * H, att: mine, def: y, aw: true, au: U({ pikeman: 30, guard: 20, raider: 120, outrider: 40, knight: 12, pathfinder: 5, chieftain: 1, logram: 4 }), al: U({ pikeman: 4, guard: 3, raider: 18, outrider: 6, knight: 1, logram: 1 }), du: U({ pikeman: 50, guard: 40, raider: 15, outrider: 10, knight: 4, pathfinder: 6, chieftain: 1, logram: 2 }), dl: U({ pikeman: 50, guard: 40, raider: 15, outrider: 10, knight: 4, pathfinder: 6, chieftain: 1, logram: 2 }), su: U({ pikeman: 20, guard: 15, knight: 3 }), sl: U({ pikeman: 20, guard: 15, knight: 3 }), ap: 7940, dp: 5210, luck: 0.04, wall: 6, morale: 0.75, loot: { wood: 1820, food: 1640, iron: 1510, gold: 410 }, renown: 41, siege: [{ unit: 'logram', building: 'wall', from: 6, to: 4 }] });
  ctx.store.insertReport({ playerId: me.id, side: 'attack', won: true, title: 'Scouting ' + t.name + ' (' + t.x + '|' + t.y + ')', createdAt: now - 3 * H, type: 'scout', scout: { type: 'scout', scout: mine, target: t, success: true, scoutsSent: 5, scoutsLost: 0, defenderScouts: 12, defenderScoutsLost: 0, intel: { keen: 5, resources: { wood: 12480, food: 9310, iron: 7905, gold: 2140 }, troops: U({ pikeman: 64, guard: 48, raider: 140, outrider: 36, knight: 10, pathfinder: 12, chieftain: 1, logram: 6, boulder: 3 }), wallLevel: 7, drillyardLevel: 5, buildings: { hall: 11, lumber: 13, farm: 12, mine: 12, goldmine: 6, market: 4, storehouse: 10, barracks: 9, stables: 5, drillyard: 5, bannerhall: 1, wall: 7, vault: 5 } } } });
  ctx.store.insertReport({ playerId: me.id, side: 'shipment', won: true, title: 'Shipment delivered to ' + i.name + ' (' + i.x + '|' + i.y + ')', createdAt: now - 2 * H, type: 'shipment', shipment: { type: 'shipment', role: 'sent', from: mine, to: i, resources: { wood: 3000, food: 1000, iron: 0, gold: 0 }, stored: { wood: 2500, food: 1000, iron: 0, gold: 0 }, lost: { wood: 500, food: 0, iron: 0, gold: 0 } } });
  battle('defense', true, 'Attack from ' + br.name + ' (' + br.x + '|' + br.y + ')', { at: now - 1 * H, att: br, def: mine, aw: false, au: U({ raider: 10 }), al: U({ raider: 10 }), du: U({ pikeman: 20 }), dl: U({ pikeman: 2 }), ap: 520, dp: 1900 });
  ctx.store.insertReport({ playerId: me.id, side: 'support', won: false, title: 'Support for ' + i.name + ' (' + i.x + '|' + i.y + ') turned back', createdAt: now - 0.5 * H, type: 'support', support: { type: 'support', reason: 'relation_changed', home: mine, host: i, units: U({ pikeman: 10, guard: 6 }) } });
  return ctx.store.all ? 'ok' : 'ok';
})()`;

const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await waitFor(`document.querySelector('.fr-tab-${name.split('/')[0]}')`, 20000).catch(() => console.log('NAV FAIL', name)); await sleep(1500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; const inner = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && !/vsw-pop|who-menu/.test(e.className)) inner.push((e.className||e.tagName)+':'+e.scrollHeight+'/'+e.clientHeight); } const f = document.querySelector('.frame'); return JSON.stringify({ docW: de.scrollWidth, docH: de.scrollHeight, frame: f && Math.round(f.getBoundingClientRect().height), viewH: innerHeight, inner, layout: de.className }); })()`).then((r) => console.log(tag, r));
const overflow = (root) => evalJs(`(() => { const out=[]; for (const e of document.querySelectorAll(${JSON.stringify(root + ' *')})) { const p = e.closest('.fv-pn'); if (!p || e===p) continue; const a=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if (a.width>0 && a.height>0 && (a.bottom>b.bottom+1||a.right>b.right+1)) out.push((typeof e.className==='string'?e.className:e.tagName)+' '+Math.round(a.bottom-b.bottom)+','+Math.round(a.right-b.right)); } return out.slice(0,12).join(' | '); })()`).then((r) => console.log('overflow', r));
const pick = async (re) => { const ok = await evalJs(`(() => { const el = [...document.querySelectorAll('.frp-rr')].find(e => ${re}.test(e.textContent)); if (!el) return false; el.click(); return true; })()`); await sleep(1200); return ok; };
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(SEED_REPORTS));
  await sleep(12000);
  await tab('reports'); await waitFor(`document.querySelector('.frp-rr')`, 30000); await sleep(1500);
  console.log('auto-open selected row:', await evalJs(`document.querySelector('.frp-rr.sel')?.innerText.replace(/\\n/g,' | ')`), 'is first:', await evalJs(`document.querySelector('.frp-rr')?.classList.contains('sel')`));
  await metrics('1440 reports (auto-open newest)'); await overflow('.frp');
  await pick('/Tolvek attacked/'); await shot('reports-1440.png'); await overflow('.frp');
  console.log('rows', await evalJs(`document.querySelectorAll('.frp-rr').length`), await evalJs(`document.querySelector('.frp-pgr').innerText`));
  console.log('big support', await pick('/your troops|Support at|attacked/i && /Support at/')); await metrics('1440 big'); await overflow('.frp'); await shot('reports-big-1440.png');
  console.log('page 2', await evalJs(`(() => { document.querySelector('.fv-pg[aria-label="Older reports"]').click(); return document.querySelector('.frp-pgr').innerText; })()`)); await sleep(600); await shot('reports-page2-1440.png');
  await evalJs(`(() => { document.querySelectorAll('.frp-chip')[2].click(); })()`); await sleep(1000);
  console.log('scout chip rows', await evalJs(`document.querySelectorAll('.frp-rr').length`)); await metrics('1440 scout'); await overflow('.frp'); await shot('reports-scout-1440.png');
  await evalJs(`(() => { document.querySelectorAll('.frp-chip')[4].click(); })()`); await sleep(1000); await shot('reports-ship-1440.png'); await overflow('.frp');
  await evalJs(`(() => { document.querySelectorAll('.frp-chip')[3].click(); })()`); await sleep(1000); await shot('reports-support-1440.png'); await overflow('.frp');
  await evalJs(`(() => { document.querySelectorAll('.frp-chip')[1].click(); })()`); await sleep(1000);
  console.log('mine big', await pick('/You raided Hardhaven|You raided/i')); await sleep(300);
  // the list's first few battle rows, pick the newest "You raided" with siege (second battle raid)
  await shot('reports-battles-1440.png'); await overflow('.frp');
  // army page: Boulder Sling picker
  await evalJs(`(async () => { const ctx = window.clanfirePreview.ctx; const st = await (await fetch('/api/state')).json(); const rec = ctx.store.villagesOfPlayer(st.player.id)[0]; ctx.store.saveVillage(rec.id, { ...rec.state, troops: { ...rec.state.troops, pikeman: 40, raider: 12, boulder: 6 }, lastUpdate: Date.now() }, 80); })()`); await sleep(12000);
  await tab('army'); await sleep(1500);
  const tgt = await evalJs(`(async () => { const ctx = window.clanfirePreview.ctx; const st = await (await fetch('/api/state')).json(); for (let id = 1; id < 3000; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== st.player.id) return v.x + '|' + v.y; } return null; })()`);
  const setInput = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setInput('#fa-target', tgt); await sleep(1500);
  await setInput('#fa-n-pikeman', '8'); await setInput('#fa-n-boulder', '2'); await sleep(1500);
  await shot('army-boulder-1440.png'); await metrics('1440 army boulder'); await overflow('.fa-send');
  console.log('picker', await evalJs(`(() => { const s = document.querySelector('.fa-siege .wm-select'); const r = s.getBoundingClientRect(); return JSON.stringify({ h: r.height, w: r.width, label: document.querySelector('.fa-siege label').getBoundingClientRect().top < r.bottom, opts: s.options.length }); })()`));
  // pick Market, then send for real
  await evalJs(`(() => { const s = document.querySelector('.fa-siege .wm-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'market'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500);
  console.log('click attack', await clickText('.fa-go .fa-red', 'Attack')); await sleep(3000);
  console.log('after send', await evalJs(`JSON.stringify({ moves: document.querySelectorAll('.fa-moves .fa-mv').length, why: document.querySelector('.fa-why')?.textContent, text: [...document.querySelectorAll('.fa-moves .fa-mv')].map(e => e.innerText.replace(/\\n/g,' ')).slice(0,4) })`));
  // phone, unchanged
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(1500);
  await evalJs(`location.hash = 'reports'`); await sleep(3000);
  await metrics('360 reports'); await shot('reports-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
