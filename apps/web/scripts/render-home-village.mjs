// Regenerates the pictures of the signed-out homepage's village (apps/web/src/art/home-village/*.webp + index.ts).
//   npm run home:art        (run it again whenever building art, the landscape or the scene layout changes)
// It starts the vite dev server on a free port, opens /render-home.html (the real SceneArt with every building at max
// level, see src/dev/), waits until all sprites are painted and captures it with headless Chrome (CDP, WebP) in three
// widths plus a tiny placeholder that is inlined as a data URI. Needs Google Chrome (CHROME=/path/to/chrome to override).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(WEB, 'src/art/home-village');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME} (set CHROME=...)`);

// The scene box is 1104 x 714 units. The picture adds landscape around it so any hero frame (phone, desktop) can crop it.
const STAGE_W = 1104;
const STAGE_H = 714;
const FRAME_W = 1236; // +6 % each side
const FRAME_H = 1266; // +25 % of the width above and below
const WIDTHS = [800, 1200, 1800];
const QUALITY = 68;
const PLACEHOLDER_W = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

const vitePort = await freePort();
const chromePort = await freePort();
const profile = join(tmpdir(), `clanfire-home-art-${process.pid}`);
const vite = spawn(join(WEB, '../../node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: WEB, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => {
  vite.kill();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
};
process.on('exit', cleanup);

let ws;
let seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        break;
      }
    } catch {}
    await sleep(200);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

async function capture(widthPx, quality) {
  const dsf = widthPx / FRAME_W;
  await send('Emulation.setDeviceMetricsOverride', { width: FRAME_W, height: FRAME_H, deviceScaleFactor: dsf, mobile: false });
  await sleep(1200); // let the scene repaint at the new scale
  const r = await send('Page.captureScreenshot', { format: 'webp', quality, clip: { x: 0, y: 0, width: FRAME_W, height: FRAME_H, scale: 1 } });
  return { data: Buffer.from(r.data, 'base64'), w: Math.round(FRAME_W * dsf), h: Math.round(FRAME_H * dsf) };
}

try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${vitePort}/render-home.html`)).ok) break;
    } catch {}
    await sleep(200);
  }
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: FRAME_W, height: FRAME_H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/render-home.html?w=${FRAME_W}&h=${FRAME_H}` });
  for (let i = 0; i < 300; i++) {
    if (await evalJs(`document.body.dataset.artReady === '1'`).catch(() => false)) break;
    await sleep(200);
    if (i === 299) throw new Error('timeout: the scene never finished loading');
  }
  mkdirSync(OUT, { recursive: true });
  const files = [];
  for (const w of WIDTHS) {
    const { data, w: pw, h: ph } = await capture(w, QUALITY);
    writeFileSync(join(OUT, `home-village-${w}.webp`), data);
    files.push({ w: pw, h: ph, name: `home-village-${w}.webp` });
    console.log(`home-village-${w}.webp  ${pw}x${ph}  ${(data.length / 1024).toFixed(0)} kB`);
  }
  const tiny = await capture(PLACEHOLDER_W, 60);
  const placeholder = `data:image/webp;base64,${tiny.data.toString('base64')}`;
  console.log(`placeholder ${tiny.w}x${tiny.h}  ${tiny.data.length} bytes`);

  const imports = files.map((f, i) => `import src${f.w} from './${f.name}';`).join('\n');
  const mod = `// GENERATED by scripts/render-home-village.mjs (npm run home:art) - do not edit by hand.
${imports}

/** Scene units: the village box is STAGE_W wide; the picture is FRAME_W x FRAME_H units (landscape around the box). */
export const HOME_ART = {
  stageW: ${STAGE_W},
  stageH: ${STAGE_H},
  frameW: ${FRAME_W},
  frameH: ${FRAME_H},
  /** Blurry ${PLACEHOLDER_W}px preview, inlined so it paints with the first frame. */
  placeholder: '${placeholder}',
  sources: [
${files.map((f) => `    { src: src${f.w}, width: ${f.w}, height: ${f.h} },`).join('\n')}
  ],
} as const;
`;
  writeFileSync(join(OUT, 'index.ts'), mod);
  console.log('wrote src/art/home-village/index.ts');
} finally {
  cleanup();
}
process.exit(0);
