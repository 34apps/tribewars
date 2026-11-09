// Mail page screenshots (1440 thread, compose, phone unchanged) on the demo seed with back-and-forth mails.
// usage: node mail-shot.mjs <outDir>   (needs the preview at PREVIEW_URL, default http://localhost:5174/?demo)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-after-mail';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9487;
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

const SEED_MAIL = `(async () => {
  const ctx = window.clanfirePreview.ctx;
  const st = await (await fetch('/api/state')).json();
  const me = st.player; const now = Date.now(); const H = 3600000;
  const others = [];
  for (let id = 1; id < 3000 && others.length < 10; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id && !others.some((o) => o.ownerId === v.ownerId)) others.push(v); }
  const m = ctx.store.mail;
  const T = [
    ['Tolvek is coming for you', 'Hi neighbour,\\n\\nMy Pathfinders saw Tolvek leave Cinderhold an hour ago: mostly Raiders and Outriders, and a few Log Rams. They are heading your way.\\n\\nI can send 15 Pikemen to Emberfold right now; they should arrive before he does. Keep your Raiders at home tonight.'],
  ];
  const w = (o, from, subj, body, ago) => m.insert(from === 'me' ? me.id : others[o].ownerId, from === 'me' ? others[o].ownerId : me.id, subj, body, now - Math.round(ago * H));
  w(0, 'them', 'Shipment sent', '2,000 wood is on its way for your Storehouse.', 30);
  w(0, 'me', 'Re: Shipment sent', 'Got it, many thanks. I will pay you back in iron once the mine is up.', 29.5);
  w(0, 'them', 'Ask Corwin', 'Ask Corwin, he trades food for iron, one to one.', 6);
  w(0, 'them', T[0][0], T[0][1], 1);
  w(0, 'me', 'Re: ' + T[0][0], 'Thank you! Please send the 15 Pikemen, they will be welcome.', 0.05);
  const others2 = [[1,'them','They arrived just in time. If you need iron, say so.',3],[2,'them','We keep hitting each other and nobody wins. Truce?',5],[3,'them','Nice wall. It will not stop me forever.',24],[4,'me','Bring them. My Wall is waiting.',48],[5,'them','Send me 500 gold every day and I will leave you alone.',120],[6,'them','Market prices this week: food is cheap, iron is dear.',144],[7,'me','Hello neighbour, shall we keep the peace?',190]];
  for (const [o, f, b, a] of others2) if (others[o]) w(o, f, f === 'me' ? 'Hello' : 'News', b, a);
  return 'ok ' + others.length;
})()`;
const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const tab = async (name) => { await evalJs(`window.location.hash = ${JSON.stringify(name)}`); await sleep(2500); };
const metrics = (tag) => evalJs(`(() => { const de = document.documentElement; return ${JSON.stringify(tag)} + ' page ' + de.scrollWidth + 'x' + de.scrollHeight + ' vs ' + innerWidth + 'x' + innerHeight; })()`).then(console.log);
const overflow = () => evalJs(`(() => { const out = []; for (const e of document.querySelectorAll('.frm *')) { const p = e.closest('.fv-pn'); if (!p || e === p) continue; const a = e.getBoundingClientRect(), b = p.getBoundingClientRect(); if (e.closest('.frm-th')) continue; if (a.width && (a.right > b.right + 1 || a.bottom > b.bottom + 1)) out.push(e.className + ':' + e.textContent.slice(0, 20)); } return out.slice(0, 8).join(' | ') || 'no overflow'; })()`).then((r) => console.log('overflow:', r));
try {
  await connect();
  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000);
  await sleep(2500);
  console.log('seed', await evalJs(SEED_MAIL));
  await sleep(12000);
  await tab('mail'); await waitFor(`document.querySelector('.frm-rr')`, 30000); await sleep(2500);
  console.log('first row', await evalJs(`document.querySelector('.frm-rr')?.innerText.replace(/\\n/g,' | ')`), 'rows', await evalJs(`document.querySelectorAll('.frm-rr').length`), await evalJs(`document.querySelector('.frm-pgr').innerText.replace(/\\n/g,' ')`));
  console.log('thread scrolled to bottom', await evalJs(`(() => { const t = document.querySelector('.frm-th'); return t.scrollHeight - t.scrollTop - t.clientHeight; })()`));
  await metrics('mail 1440'); console.log(await evalJs(`['.fr-page','.frm','.frm-list','.frm-detail','.frm-th','.frm-reply','.frm-rows'].map(q => q + ' ' + Math.round(document.querySelector(q).getBoundingClientRect().height)).join(', ')`)); await overflow(); await shot('mail-1440.png');
  console.log('unread badge in tab', await evalJs(`document.querySelector('.fr-tab-mail')?.innerText.replace(/\\n/g,' ')`));
  await evalJs(`document.querySelectorAll('.frm-rr')[1].click()`); await sleep(1500); await shot('mail-second-1440.png');
  await evalJs(`[...document.querySelectorAll('.frm-sg')][1].click()`); await sleep(500);
  console.log('unread filter rows', await evalJs(`document.querySelectorAll('.frm-rr').length`));
  await evalJs(`[...document.querySelectorAll('.frm-sg')][0].click()`); await sleep(300);
  await evalJs(`[...document.querySelectorAll('.fv-btn')].find(b => /New mail/.test(b.textContent)).click()`); await sleep(800);
  await metrics('mail compose 1440'); await overflow(); await shot('mail-compose-1440.png');
  await size(360, 780, true); await send('Page.reload'); await sleep(3500);
  await waitFor(`document.querySelector('.vv-hit')`, 60000).catch(() => console.log('no vv-hit on phone')); await sleep(1500);
  await evalJs(`location.hash = 'mail'`); await sleep(3000);
  await metrics('360 mail'); await shot('mail-360.png');
} catch (e) { console.error(e); } finally { chrome.kill(); }
