// Mail page screenshots (1440 thread, compose, phone unchanged) on the demo seed with back-and-forth mails.
// usage: node mail-flow.mjs   (needs the preview at PREVIEW_URL, default http://localhost:5174/?demo)
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || new URL('../after/', import.meta.url).pathname;
const ROOT = '/Users/admin/Projects/tribewars';
const SCRATCH = '/private/tmp/claude-501/ingame-pages-mail-flow';
const PROFILE = join(SCRATCH, 'chrome-profile');
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(SCRATCH, { recursive: true });
const PORT = 9488;
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


const URL_ = process.env.PREVIEW_URL || 'http://localhost:5174/?demo';
const q = (e) => evalJs(e);
const setVal = (sel, v) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const SEED = `(async () => {
  const ctx = window.clanfirePreview.ctx; const st = await (await fetch('/api/state')).json(); const me = st.player; const now = Date.now();
  const others = [];
  for (let id = 1; id < 3000 && others.length < 3; id++) { const v = ctx.store.getVillage(id); if (v && v.ownerId && v.ownerId !== me.id && !others.some((o) => o.ownerId === v.ownerId)) others.push(v); }
  for (let k = 0; k < 45; k++) ctx.store.mail.insert(k % 2 ? me.id : others[0].ownerId, k % 2 ? others[0].ownerId : me.id, 'Chat', 'letter number ' + k, now - (60 - k) * 3600000);
  ctx.store.mail.insert(others[1].ownerId, me.id, 'Hello', 'only one', now - 1000);
  return JSON.stringify({ a: others[0].ownerName, b: others[1].ownerName, c: others[2].ownerName, aId: others[0].ownerId, meId: me.id });
})()`;
try {
  await connect(); await send('Page.enable'); await send('Runtime.enable'); await size(1440, 900, false);
  await send('Page.navigate', { url: URL_ });
  await waitFor(`window.clanfirePreview && document.querySelector('nav, .shell, header')`, 60000); await sleep(2500);
  const seed = JSON.parse(await q(SEED)); console.log('seed', seed); await sleep(12000);
  await evalJs(`location.hash = 'mail'`); await waitFor(`document.querySelector('.frm-rr')`, 30000); await sleep(2500);
  // open thread A (45 letters)
  console.log('open A', await q(`(() => { const r = [...document.querySelectorAll('.frm-rr')].find(e => e.innerText.includes(${JSON.stringify(seed.a)})); r.click(); return !!r; })()`)); await sleep(1500);
  console.log('letters after open', await q(`document.querySelectorAll('.frm-ltr').length`), 'time sample', await q(`document.querySelector('.frm-lt').innerText`));
  // load older: scroll to top
  const before = await q(`(() => { const t = document.querySelector('.frm-th'); const first = [...t.querySelectorAll('.frm-ltr')][0]; return JSON.stringify({ n: t.querySelectorAll('.frm-ltr').length, top: first.getBoundingClientRect().top - t.getBoundingClientRect().top, txt: first.innerText.slice(0, 40) }); })()`);
  await q(`document.querySelector('.frm-th').scrollTop = 0`); await sleep(1500);
  const after = await q(`(() => { const t = document.querySelector('.frm-th'); const m = [...t.querySelectorAll('.frm-ltr')].find(e => e.innerText.includes(${JSON.stringify(JSON.parse(before).txt.slice(0,10))})); return JSON.stringify({ n: t.querySelectorAll('.frm-ltr').length, scrollTop: t.scrollTop, anchorTop: m ? m.getBoundingClientRect().top - t.getBoundingClientRect().top : null }); })()`);
  console.log('older: before', before, 'after', after);
  // reply
  await q(`document.querySelector('.frm-th').scrollTop = 1e6`); await sleep(300);
  await setVal('.frm-rbox textarea', 'reply from the flow test'); await sleep(200);
  console.log('count before send', await q(`document.querySelector('.frm-count').innerText`));
  await q(`document.querySelector('.frm-reply button[type=submit]').click()`); await sleep(1500);
  console.log('after send: last letter', await q(`[...document.querySelectorAll('.frm-ltr')].pop().innerText.replace(/\\n/g,' | ')`), 'count', await q(`document.querySelector('.frm-count').innerText`), 'textarea', JSON.stringify(await q(`document.querySelector('.frm-rbox textarea').value`)), 'at bottom', await q(`(() => { const t = document.querySelector('.frm-th'); return t.scrollHeight - t.scrollTop - t.clientHeight; })()`));
  console.log('list first row', await q(`document.querySelector('.frm-rr').innerText.replace(/\\n/g,' | ')`));
  await shot('mail-flow-reply-1440.png');
  // compose to computer player C (no conversation yet)
  await q(`[...document.querySelectorAll('.fv-btn')].find(b => /New mail/.test(b.textContent)).click()`); await sleep(500);
  await setVal('.frm-cmp input[list]', seed.c); await setVal('.frm-cmp label:nth-of-type(2) input', 'Greetings'); await setVal('.frm-cmp textarea', 'First letter to a new person');
  await q(`document.querySelector('.frm-cmp button[type=submit]').click()`); await sleep(2500);
  console.log('after compose: header', await q(`document.querySelector('.frm-dt h2')?.innerText`), 'expected', seed.c, 'compose open', await q(`!!document.querySelector('.frm-cmp')`), 'last', await q(`[...document.querySelectorAll('.frm-ltr')].pop()?.innerText.replace(/\\n/g,' | ')`));
  // delete B's conversation
  await q(`[...document.querySelectorAll('.frm-rr')].find(e => e.innerText.includes(${JSON.stringify(seed.b)})).click()`); await sleep(1200);
  await q(`document.querySelector('.frm-del').click()`); await sleep(600); await shot('mail-flow-delete-1440.png');
  await q(`[...document.querySelectorAll('dialog .frm-del')].pop().click()`); await sleep(2500);
  console.log('after delete: rows with B', await q(`[...document.querySelectorAll('.frm-rr')].filter(e => e.innerText.includes(${JSON.stringify(seed.b)})).length`), 'header now', await q(`document.querySelector('.frm-dt h2')?.innerText`), 'dialog open', await q(`!!document.querySelector('dialog[open]')`));
  // other side still has it: thread as player B via store
  console.log('B side still has letter', await q(`(() => { const s = window.clanfirePreview.ctx.store.mail; const rows = s.conversations ? s.conversations(${seed.meId}, 50, 0) : []; return 'mine ' + rows.length; })()`));
} catch (e) { console.error(e); } finally { chrome.kill(); }
