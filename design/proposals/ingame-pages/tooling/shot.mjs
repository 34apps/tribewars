// Headless Chrome screenshots of mockups/{a,b,c,mix}-<page>-1440.html -> ../<name>.png (1440x900 @1x), with fit checks:
//   H-SCROLL / V-SCROLL  the document is wider than 1440 or taller than 900
//   SCROLL               an element whose content is taller (or wider) than its box (scrollHeight > clientHeight)
//   OUT                  an element that sticks out of the 1440x900 window
//   SMALL                text under 13 px (badge counts of 12 px are allowed), CONTROL = a button/input under 36 px tall
//   IMG                  an image that failed to load
//   (text cut off with an ellipsis counts as SCROLL-X with no tolerance)
//   One owner-approved exception: an element marked data-scroll-ok (the mail thread pane) may scroll; its content is not OUT-checked.
// Usage: node tooling/shot.mjs [name filter] [--file other.html] [--no-png = check only]   Exit code 1 if any check failed.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const MOCK = join(here, '..', 'mockups'); const OUT = join(here, '..');
const PROFILE = '/private/tmp/claude-501/ingame-pages-shot'; rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9491;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pend = new Map();
for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const W = 1440, H = 900;
const CHECK = `(() => {
  const d = document.documentElement, out = [];
  if (d.scrollWidth > ${W}) out.push('H-SCROLL ' + d.scrollWidth);
  if (d.scrollHeight > ${H}) out.push('V-SCROLL ' + d.scrollHeight);
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + (e.textContent ? ' "' + e.textContent.trim().slice(0, 28) + '"' : '');
  for (const e of document.querySelectorAll('body, body *')) {
    if (e.closest('svg') || e.tagName === 'IMG' || e.tagName === 'BR') continue;
    const cs = getComputedStyle(e); if (cs.display === 'inline' || cs.display === 'none') continue;
    if (e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0 && !e.hasAttribute('data-scroll-ok')) out.push('SCROLL ' + name(e) + ' ' + e.scrollHeight + '>' + e.clientHeight);
    if (e.scrollWidth > e.clientWidth + (cs.textOverflow === 'ellipsis' ? 0 : 1) && e.clientWidth > 0 && cs.overflowX !== 'visible') out.push('SCROLL-X ' + name(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    const r = e.getBoundingClientRect();
    if (r.width > 0 && !e.closest('.scene') && !e.closest('[data-scroll-ok]') && (r.right > ${W} + 1 || r.left < -1 || r.bottom > ${H} + 1 || r.top < -1)) out.push('OUT ' + name(e));
  }
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('svg')) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize); const badge = e.closest('.bd,.lvb');
    if (fs < (badge ? 11.5 : 12.9)) out.push('SMALL ' + fs + 'px ' + name(e));
  }
  for (const e of document.querySelectorAll('.btn,.inp,.tb,.nv,.ft,.mx,.sw,.pg-b')) { const r = e.getBoundingClientRect(); if (r.height < 35.5) out.push('CONTROL ' + Math.round(r.height) + 'px ' + name(e)); }
  for (const i of document.images) if (!i.naturalWidth) out.push('IMG ' + i.getAttribute('src'));
  return { out: [...new Set(out)], fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i).join(',') };
})()`;

let bad = 0;
try {
  await send('Page.enable'); await send('Runtime.enable');
  const fi = process.argv.indexOf('--file');
  const f = fi < 0 ? (process.argv.slice(2).find((a) => !a.startsWith('--')) || '') : '';
  const names = fi >= 0 ? [basename(process.argv[fi + 1], '.html')] : readdirSync(MOCK).filter((x) => /^(?:[abc]|mix)-(village|building|army|reports|mail)\d?(?:-done|-big|-scout|-compose)?-1440\.html$/.test(x) && x.includes(f)).map((x) => x.replace('.html', '')).sort();
  for (const n of names) {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(join(MOCK, n + '.html')).href });
    await sleep(500); await ev('document.fonts.ready.then(()=>true)'); await ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))'); await sleep(600);
    const m = await ev(CHECK);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!process.argv.includes('--no-png')) writeFileSync(join(OUT, `${n}.png`), Buffer.from(r.data, 'base64'));
    if (m.out.length) bad++;
    console.log(n.padEnd(22), m.out.length ? 'FAIL' : 'clean', '·', m.fonts); for (const o of m.out.slice(0, 25)) console.log('   ', o); if (m.out.length > 25) console.log('    ... +' + (m.out.length - 25));
  }
} finally { chrome.kill(); }
process.exitCode = bad ? 1 : 0;
