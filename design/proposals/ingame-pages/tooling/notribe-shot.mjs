// No-tribe Tribe page, Ranks Domination tab and the phone pages (360) on the demo seed (the demo account has no tribe).
// usage: node notribe-shot.mjs <outDir>   (needs the preview at PREVIEW_URL, default http://localhost:5174/?demo)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-notribe';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9493;
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
    if (m.method === 'Page.frameNavigated') console.log('NAV', m.params.frame.url);
    if (m.method === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(m.params.exceptionDetails).slice(0, 500));
    if (m.method === 'Runtime.consoleAPICalled' && ['error'].includes(m.params.type)) console.log('CONSOLE', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
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


const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(2500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; return ${JSON.stringify(tag)} + ' page ' + de.scrollWidth + 'x' + de.scrollHeight + ' vs ' + innerWidth + 'x' + innerHeight; })()`).then(console.log);
// Fit checks: nothing wider/taller than its panel, text >= 13 px, controls >= 36 px.
const checks = (root) => evalJs(`(() => {
  const out = []; const r = document.querySelector(${JSON.stringify(root)}); if (!r) return 'no root';
  for (const e of r.querySelectorAll('*')) {
    const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
    if (!b.width || !b.height || cs.visibility === 'hidden') continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(cs.fontSize) < 12.99) out.push('small ' + e.tagName + '.' + e.className + ' ' + cs.fontSize + ' ' + e.textContent.trim().slice(0, 24));
    if ((e.tagName === 'BUTTON' || e.tagName === 'INPUT') && b.height < 35.5 && !e.closest('.visually-hidden')) out.push('short ' + e.tagName + '.' + e.className + ' ' + Math.round(b.height) + ' ' + e.textContent.trim().slice(0, 20));
    const p = e.closest('.fv-pn');
    if (p && e !== p) { const q = p.getBoundingClientRect(); if (b.right > q.right + 1 || b.bottom > q.bottom + 1) out.push('overflow ' + e.tagName + '.' + e.className + ' ' + e.textContent.trim().slice(0, 24)); }
  }
  const f = document.querySelector('.frame'); const de = document.documentElement;
  out.push('page ' + de.scrollHeight + ' vs ' + innerHeight + ', frame ' + Math.round(f.getBoundingClientRect().height));
  return out.join('\\n');
})()`).then((s) => console.log('CHECKS ' + root + '\n' + s));
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(`(async () => {
    const ctx = window.clanfirePreview.ctx;
    const st = await (await fetch('/api/state')).json();
    const me = ctx.store.getPlayer(st.player.id);
    const t = Date.now(); const D = 86400000;
    const my = ctx.store.villagesOfPlayer(me.id)[0];
    ctx.store.saveVillage(my.id, { ...my.state, buildings: { ...my.state.buildings, hall: ${process.env.HALL || 5} } }, 80);
    const mine = ctx.store.tribes.membership(me.id);
    if (mine) return 'already in a tribe';
    if (!ctx.store.getPlayerByLowerName('seed-founder-0')) {
      const names = ['Cinder Band', 'Greywater Oath', 'Marsh Lords', 'Hollow Watch', 'Raven Hollow', 'Salt Wardens', 'Oakridge Kin', 'Thornfield', 'Red Heron', 'Stonebrook', 'Dawn Riders', 'Pale Moon'];
      const tags = ['CND', 'GWO', 'MRL', 'HLW', 'RVN', 'SLT', 'OAK', 'THF', 'RHR', 'STB', 'DWN', 'PLM'];
      const kinds = ['application', 'application', 'open', 'application', 'open', 'invite', 'open', 'application', 'open', 'invite', 'application', 'open'];
      const donor = ctx.store.villagesOfPlayer(me.id)[0];
      const mk = (nm, pts, x, y) => { const id = ctx.store.insertPlayer(nm, 'bot', t - 20 * D, 0, 'corwen'); ctx.store.insertVillage(id, nm + ' village', x, y, pts, donor.state); return id; };
      const tids = [];
      for (let i = 0; i < names.length; i++) {
        let x = my.x + 8 + (i % 6) * 3, y = my.y + 8 + Math.floor(i / 6) * 3; while (ctx.store.villageExistsAt(x, y)) x++;
        const id = mk('seed-founder-' + i, 9000 - i * 600, x, y);
        ctx.tribes.found(ctx.store.getPlayer(id), { name: names[i], tag: tags[i], description: '', recruitment: kinds[i] }, t - 15 * D);
        tids.push(ctx.store.tribes.membership(id).tribeId);
        for (let k = 0; k < (i * 5) % 29; k++) { let xx = my.x - 30 - k, yy = my.y + 20 + i; while (ctx.store.villageExistsAt(xx, yy)) yy++; const jid = mk('seed-m-' + i + '-' + k, 800, xx, yy); try { ctx.tribes.join(ctx.store.getPlayer(jid), tids[i], t - 10 * D); } catch (e) {} }
      }
      try { ctx.tribes.invite(ctx.store.getPlayer(ctx.store.getPlayerByLowerName('seed-founder-0').id), me.username, t); } catch (e) { console.log('inv', e.message); }
      try { ctx.tribes.invite(ctx.store.getPlayer(ctx.store.getPlayerByLowerName('seed-founder-4').id), me.username, t); } catch (e) { console.log('inv', e.message); }
      try { ctx.tribes.apply(me, tids[3], 'Hello, I would like to join your watch.', t - D); } catch (e) { console.log('apply', e.message); }
    }
    const list = (await (await fetch('/api/tribes')).json()).tribes;
    return 'tribes ' + list.length;
  })()`));
  await sleep(12000); await tab('tribe'); await waitFor(`document.querySelector('.frn-t')`, 30000); await sleep(1500);
  await metrics('notribe'); await checks('.frn'); await shot('notribe-1440.png');
  console.log('rows', await evalJs(`document.querySelectorAll('.frn-t tbody tr').length`));
  // Found form: fill it in (the button wakes up when name and tag are valid).
  await evalJs(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const [n, g] = document.querySelectorAll('.frn-f input'); set.call(n, 'Iron Wolves'); n.dispatchEvent(new Event('input', { bubbles: true })); set.call(g, 'IRW'); g.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500); await shot('notribe-found-1440.png');
  console.log('found button disabled:', await evalJs(`document.querySelector('.frn-found').disabled`));
  // Search + paging.
  await evalJs(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const i = document.querySelector('.frn-srch input'); set.call(i, 'zzzz'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300); console.log('search none:', await evalJs(`document.querySelector('.frn-msg')?.textContent`));
  await evalJs(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const i = document.querySelector('.frn-srch input'); set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  console.log('foot:', await evalJs(`document.querySelector('.frn-foot').textContent`));
  await evalJs(`document.querySelector('.frn-foot [aria-label="More tribes"]')?.click()`); await sleep(400);
  console.log('foot p2:', await evalJs(`document.querySelector('.frn-foot').textContent`));
  // Ranks: Domination tab via the Tribe tile's Details.
  await evalJs(`document.querySelector('.frn-dom .fv-lk').click()`); await sleep(2500);
  await waitFor(`document.querySelector('.frk-road')`, 15000); await sleep(800);
  await metrics('ranks domination'); await checks('.frk'); await shot('ranks-domination-1440.png');
  // Details button on the Players tab opens the tab too.
  await evalJs(`[...document.querySelectorAll('.frk-sub')][0].click()`); await sleep(800);
  await evalJs(`[...document.querySelectorAll('.frk-dom .fv-btn, .frk-side .fv-btn')].find((b) => b.textContent.trim() === 'Details').click()`); await sleep(800);
  console.log('details opens tab:', await evalJs(`!!document.querySelector('.frk-road')`));
  await size(360, 780, true); await sleep(3000);
  await evalJs(`location.hash = 'tribe'`); await sleep(3000);
  await metrics('360 tribe'); await shot('tribe-360.png');
  await evalJs(`location.hash = 'ranks'`); await sleep(3000);
  await metrics('360 ranks'); await shot('ranks-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
