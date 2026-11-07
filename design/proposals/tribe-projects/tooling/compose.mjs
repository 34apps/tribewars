// Numbered labels on the raw screenshots: image on the left, legend on the right. Rendered with headless Chrome.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const RAW = process.argv[2];
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const SCRATCH = '/private/tmp/claude-501/-Users-admin-Projects-tribewars/d574ac8d-eea1-44a6-b7d9-198d45c0229a/scratchpad/shots';

const PICS = [
  {
    out: '1-projects-page-1440.png', src: 'projects-1440.png', scale: 0.62, title: 'Tribe tab → Projects (desktop)',
    marks: [
      [170, 600, 'Tribe Store: what the tribe has saved, for each resource (most it can hold: 1,500,000 each).'],
      [170, 790, 'Store village: the member village that holds the store. Anyone can raid it, so the tribe defends it.'],
      [170, 860, 'Leader moves the store to another member village (once a week).'],
      [170, 1020, 'Send resources: opens the normal shipment form to the store village. Up to 60,000 a day per player.'],
      [170, 1130, 'The project being built now, with time left. Cancel gives most of it back.'],
      [520, 1362, 'Roads: help and shipments between members travel faster (10 / 20 / 30%).'],
      [870, 1362, 'Watchtower: tribe warnings show more about incoming attacks.'],
      [1220, 1362, 'Wards: shrines and sites the tribe holds defend better (4 / 8 / 12%).'],
      [170, 1745, 'Who gave: how much each player sent (so leaders see who helps).'],
    ],
  },
  {
    out: '2-send-to-store-map-1440.png', src: 'send-1440.png', scale: 0.8, title: 'Map → sending to the Tribe Store (desktop)',
    marks: [
      [585, 560, 'Chest next to a village = the Tribe Store is here. Everyone sees it, enemies too.'],
      [1046, 440, '"Tribe Store of [EMF] — can be raided."'],
      [1046, 528, 'Ticked: the cargo goes into the Tribe Store. Untick to help the village owner instead.'],
      [1046, 630, 'With Roads built, the trip is faster.'],
      [1046, 690, 'Daily limit per player, so no single account (or fake accounts) buys a project alone.'],
    ],
  },
  {
    out: '3-watchtower-warning-1440.png', src: 'alerts-1440.png', scale: 0.8, crop: [180, 590, 1080, 250], title: 'Tribe tab → Alerts with a Watchtower (level 2)',
    marks: [
      [190, 750, 'Watchtower level 1: rough size of the attack (small / medium / large / huge).'],
      [500, 750, 'Level 2: its slowest unit (here Log Rams). Level 3 adds "about N troops".'],
      [190, 680, 'Chieftains are never shown (your earlier rule).'],
    ],
  },
];

function html(p) {
  const img = 'data:image/png;base64,' + readFileSync(join(RAW, p.src)).toString('base64');
  const [cx, cy, cw, ch] = p.crop ?? [0, 0, null, null];
  const W = cw ?? 0;
  const imgStyle = p.crop ? `width:${cw * p.scale}px;height:${ch * p.scale}px;overflow:hidden;position:relative` : 'position:relative';
  const inner = p.crop
    ? `<img src="${img}" style="position:absolute;left:${-cx}px;top:${-cy}px;zoom:${p.scale}">`
    : `<img src="${img}" style="display:block;zoom:${p.scale}">`;
  const marks = p.marks.map(([x, y], i) => `<div class="n" style="left:${(x - cx) * p.scale - 16}px;top:${(y - cy) * p.scale - 16}px">${i + 1}</div>`).join('');
  const legend = p.marks.map(([, , t], i) => `<li><span class="n s">${i + 1}</span><span>${t}</span></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#c99a62;font:16px/1.4 -apple-system,Helvetica,Arial,sans-serif;color:#2b211c}
  .wrap{display:flex;gap:24px;padding:20px;align-items:flex-start;width:max-content}
  .shot{${imgStyle};border:3px solid #2b211c;border-radius:12px;box-shadow:0 6px 0 #2b211c}
  .n{position:absolute;width:32px;height:32px;border-radius:50%;background:#c4623a;color:#fff8e8;font-weight:800;font-size:18px;
     display:flex;align-items:center;justify-content:center;border:3px solid #fff8e8;box-shadow:0 0 0 2px #2b211c}
  .side{width:380px;background:#fff8e8;border:3px solid #2b211c;border-radius:12px;padding:16px 18px;box-shadow:0 6px 0 #2b211c}
  h1{font-size:20px;margin:0 0 12px} ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}
  li{display:flex;gap:10px;align-items:flex-start} .n.s{position:static;flex:none;width:28px;height:28px;font-size:15px}
  </style><div class="wrap"><div class="shot">${inner}${marks}</div><div class="side"><h1>${p.title}</h1><ol>${legend}</ol></div></div>`;
}

const PROFILE = join(SCRATCH, 'chrome-profile-2');
rmSync(PROFILE, { recursive: true, force: true });
const PORT = 9341;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--allow-file-access-from-files', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let seq = 0; const pending = new Map();
for (let i = 0; i < 50 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} await sleep(200); }
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, (m) => res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
console.log('connected'); await send('Page.enable'); console.log('enabled');
try {
  for (const p of PICS) {
    const file = join(SCRATCH, 'label-' + p.out.replace('.png', '.html'));
    writeFileSync(file, html(p));
    await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: 2000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + file });
    await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: `(() => { const w = document.querySelector('.wrap').getBoundingClientRect(); return [Math.ceil(w.width), Math.ceil(w.height)]; })()`, returnByValue: true });
    const [w, h] = r.result.value;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, p.out), Buffer.from(s.data, 'base64'));
    console.log('saved', p.out, w, h);
  }
} finally { chrome.kill(); }
