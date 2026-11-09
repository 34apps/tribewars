// Tribe page screenshots (1440 Overview, Members, a growing sub-tab, phone unchanged) on the demo seed with a tribe of 18.
// usage: node tribe-shot.mjs <outDir>   (needs the preview at PREVIEW_URL, default http://localhost:5174/?demo)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-tribe';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9491;
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

const SEED_TRIBE = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = ctx.store.getPlayer(st.player.id);
  const t = Date.now(); const H = 3600000; const D = 24 * H;
  const named = (n) => ctx.store.getPlayerByLowerName(n.toLowerCase());
  const myV = ctx.store.villagesOfPlayer(me.id)[0];
  const donor = ctx.store.villagesOfPlayer(named('Brannoch').id)[0];
  ctx.store.saveVillage(myV.id, { ...myV.state, buildings: { ...myV.state.buildings, hall: 5 } }, 80);
  ctx.tribes.found(me, { name: 'Embers of the Fold', tag: 'EMB', description: 'We hold the fold between the river and the hills. Help each other first, and answer in chat when someone is attacked.\\n\\nNew members: read the first forum thread, then send a short hello in chat. We raid together on weekends and keep two Pikemen at home for every Raider we send out.\\n\\nWatchtower first, Roads second. Ask an officer before you start a project.', recruitment: 'open' }, t - 12 * D);
  const tid = ctx.store.tribes.membership(me.id).tribeId;
  const extras = [['Maerwen','corwen',6840,3,'online'],['Corwin','hild',5920,3,2],['Saffi','saffi',5410,4,'online'],['Barley','wren',4980,6,5],['Hild','hild',3760,9,24],['Orrin','corwen',3240,12,'online'],['Wren','wren',2890,14,3],['Khorza','old-orm',2410,20,48],['Pell','maelis',1120,2,6],['Lysa','ysra',980,5,30],['Dunmar','brannoc',860,7,9],['Edda','saffi',720,8,70]];
  const real = [['Ysolde_K',4100,10,4],['Ironhart',2100,11,7],['Odalys',1600,13,26],['Sable',1300,15,40],['Grimwald',1500,16,12]];
  const rows = [];
  let n = 0;
  for (const [name, ch, pts, days, seen] of extras) {
    const id = ctx.store.insertPlayer(name, 'bot', t - days * D, 0, ch);
    let x = myV.x - 6 + (n % 5) * 3, y = myV.y + 5 + Math.floor(n / 5) * 3; while (ctx.store.villageExistsAt(x, y)) { x += 1; }
    ctx.store.insertVillage(id, name + "'s village", x, y, pts, donor.state);
    rows.push([id, days, seen]); n++;
  }
  for (const [name, pts, days, seen] of real) { const p = named(name); try { ctx.tribes.leave(p, t); } catch (e) {} const v = ctx.store.villagesOfPlayer(p.id)[0]; ctx.store.run('UPDATE villages SET points = ? WHERE id = ?', pts, v.id); rows.push([p.id, days, seen]); }
  for (const [id, days, seen] of rows) {
    const p = ctx.store.getPlayer(id); ctx.tribes.join(p, tid, t - days * D);
    const ago = seen === 'online' ? 60000 : seen * H;
    ctx.store.run('UPDATE players SET last_active = ? WHERE id = ?', t - ago, id);
  }
  for (const nm of ['Maerwen', 'Saffi', 'Ysolde_K']) ctx.tribes.setRole(me, named(nm).id, 'officer', t);
  ctx.tribes.updateSettings(me, { recruitment: 'application' }, t);
  const chat = [['Saffi', 'Tolvek is out again, 2 attacks on the way.', 40], ['Maerwen', 'Sending 15 Pikemen to Emberfold now.', 38], ['Corwin', 'His second one hits me. Anyone near Ashby?', 35], ['Barley', 'I can send 10 Guards, give me a minute.', 33], ['Maerwen', 'Thanks all. Wall is 9, holding.', 30]];
  for (const [who, text, mins] of chat) ctx.tribes.chatPost(named(who), text, t - mins * 60000);
  const boards = ctx.forum.boards(me, t).boards; const b0 = (boards.find((b) => b.postRule === 'members') ?? boards[1]).id;
  const threads = [['Tolvek keeps hitting us: plan', 'Saffi', 'We need a plan for his weekend raids. Who can hold what?', 27, 0.25], ['Rules of EMB: read first', 'Maerwen', 'Be kind. Help in chat. Ask before you start a project.', 12, 72], ['Store: who sends what this week', 'Corwin', 'List what you send to the Tribe Store here.', 9, 5], ['Wards first or Roads 2?', 'Orrin', 'Which project next?', 15, 24], ['Welcome, new members', 'Maerwen', 'Say hello and tell us your timezone.', 31, 144]];
  threads.sort((x, y) => y[4] - x[4]);
  for (const [title, who, body, posts, agoH] of threads) {
    const a = named(who); const t0 = t - agoH * H - 3 * H; const th = ctx.forum.createThread(a, b0, title, body, t0);
    const tidn = th.thread.id;
    const authors = ['Saffi', 'Corwin', 'Orrin', 'Barley'];
    for (let i = 1; i < 4; i++) { try { ctx.forum.reply(named(authors[i % 4]), tidn, 'Agreed, count me in.', t0 + i * 20 * 60000 + agoH * 0); } catch (e) { console.log('reply', e.message); } }
  }
  ctx.tribes.diplomacy(me, 'ASH', 'enemy', t);
  for (const [tag, kind, leader] of [['MIST', 'ally', 'Mira_of_Vale'], ['EMBR', 'nap', 'Brannoch']]) { const r = ctx.tribes.diplomacy(me, tag, kind, t); const pr = r.proposals.find((p) => p.other.tag === tag); if (pr) ctx.tribes.acceptProposal(named(leader), pr.id, t); }
  ctx.store.projects.ensure(tid); ctx.store.projects.setLevel(tid, 'roads', 1); ctx.store.projects.setLevel(tid, 'watchtower', 2);
  ctx.store.projects.insertRun({ tribeId: tid, project: 'watchtower', level: 3, startedAt: t - 20 * H, endsAt: t + 31.2 * H, cost: { wood: 0, food: 0, iron: 0, gold: 0 } });
  const tolvek = ctx.store.villagesOfPlayer(named('Tolvek').id)[0];
  const corwinV = ctx.store.villagesOfPlayer(named('Corwin').id)[0];
  const units = {}; for (const k of Object.keys(myV.state.troops)) units[k] = 0; units.raider = 40; units.logram = 6;
  const u2 = { ...units, logram: 0, raider: 12 };
  ctx.store.insertMovement({ kind: 'attack', originVillageId: tolvek.id, targetVillageId: myV.id, units, loot: null, departAt: t - 40 * 60000, arriveAt: t + (18 * 60 + 42) * 1000 });
  ctx.store.insertMovement({ kind: 'attack', originVillageId: tolvek.id, targetVillageId: corwinV.id, units: u2, loot: null, departAt: t - 30 * 60000, arriveAt: t + (41 * 60 + 10) * 1000 });
  return 'ok';
})()`;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(2500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; return ${JSON.stringify(tag)} + ' page ' + de.scrollWidth + 'x' + de.scrollHeight + ' vs ' + innerWidth + 'x' + innerHeight; })()`).then(console.log);
const overflow = () => evalJs(`(() => { const out = []; for (const e of document.querySelectorAll('.frt *')) { const p = e.closest('.fv-pn'); if (!p || e === p) continue; const a = e.getBoundingClientRect(), b = p.getBoundingClientRect(); if (a.width && (a.right > b.right + 1 || a.bottom > b.bottom + 1)) out.push(e.className + ':' + e.textContent.slice(0, 20)); } return out.slice(0, 8).join(' | ') || 'no overflow'; })()`).then((r) => console.log('overflow:', r));
const clickSub = (label) => evalJs(`(() => { const b = [...document.querySelectorAll('.frt-sub')].find(e => e.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(SEED_TRIBE));
  await sleep(1500);
  await tab('tribe'); await waitFor(`document.querySelector('.frt-head')`, 30000); await sleep(4000);
  await metrics('tribe overview'); console.log(await evalJs(`['.frame','.fr-sheet','.frt','.frt-ovtop','.frt-alerts','.frt-about','.frt-forum','.frt-chat','.frt-sum'].map(q => q + ' ' + Math.round(document.querySelector(q)?.getBoundingClientRect().height ?? -1)).join(', ')`)); await overflow(); await shot('tribe-1440.png');
  await clickSub('Members'); await sleep(1200);
  await metrics('tribe members'); await overflow(); await shot('tribe-members-1440.png');
  await evalJs(`[...document.querySelectorAll('.frt-pgr .fv-pg')][1].click()`); await sleep(500); await metrics('members page 2'); await shot('tribe-members-page2-1440.png');
  await clickSub('Overview'); await sleep(800);
  await evalJs(`[...document.querySelectorAll('.frt-about .fv-lk')][0].click()`); await sleep(800); await shot('tribe-about-1440.png');
  await evalJs(`document.querySelector('dialog[open] .fv-btn')?.click()`); await sleep(400);
  await clickSub('Diplomacy'); await sleep(1500); await metrics('tribe diplomacy'); await shot('tribe-diplomacy-1440.png', true);
  await clickSub('Chat'); await sleep(1500); await metrics('tribe chat'); await shot('tribe-chat-1440.png', true);
  await size(360, 780, true); await sleep(3000);
  console.log('layout', await evalJs(`document.documentElement.className`));
  await evalJs(`location.hash = 'tribe'`); await sleep(3000);
  await metrics('360 tribe'); await shot('tribe-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
