// Measures every village building sprite (ground tile stripped, as the scene draws it) in headless Chrome and writes
// apps/web/test/sprite-boxes.json: { "<file>.svg": { sha1, box: [x, y, w, h], mask: [...] } } in sprite units. `mask` is the
// painted shape on a grid of CELL-unit cells over the frame (-70 -122 140 190): one hex string per row (after a leading 1
// bit), bit set = painted; faint soft shadows (alpha under 110 of 255) do not count.
// The village layout test uses it to prove no two buildings touch at any look, and fails when a sprite changed since it
// was measured. Run after changing building art: node scripts/measure-sprites.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = new URL('../apps/web/src/art/buildings/', import.meta.url).pathname;
const OUT = new URL('../apps/web/test/sprite-boxes.json', import.meta.url).pathname;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Same ground-tile pattern as loadSprite() in apps/web/src/art/buildings.ts.
const TILE_RE = /^\s*(?:<path\b[^>]*\bfill=["']#(?:5E8C3A|3A5E27|A6C964)["'][^>]*>(?:\s*<\/path>)?\s*){3}/i;

const files = readdirSync(DIR).filter((f) => /-\d\.svg$/.test(f)).sort();
const bodies = {};
const hashes = {};
for (const f of files) {
  const text = readFileSync(DIR + f, 'utf8');
  hashes[f] = createHash('sha1').update(text).digest('hex');
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>/i.exec(text);
  bodies[f] = (m?.[1] ?? '').replace(TILE_RE, '');
}
const CELL = 4;
const page = `<!doctype html><meta charset="utf-8"><body><pre id="out"></pre><svg width="400" height="400" viewBox="-70 -122 140 190"><g id="g"></g></svg>
<script>(async()=>{const B=${JSON.stringify(bodies)};const r={};const g=document.getElementById('g');const C=${CELL},K=4;
const cv=document.createElement('canvas');cv.width=140*K;cv.height=190*K;const cx=cv.getContext('2d',{willReadFrequently:true});
for(const f in B){g.innerHTML=B[f];const b=g.getBBox();
 const svg='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+140*K+'" height="'+190*K+'" viewBox="-70 -122 140 190">'+B[f]+'</svg>';
 const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
 cx.clearRect(0,0,cv.width,cv.height);cx.drawImage(img,0,0);const d=cx.getImageData(0,0,cv.width,cv.height).data;
 const rows=[];for(let cy=0;cy<190/C;cy++){let bits='';for(let cc=0;cc<140/C;cc++){let on=0;
  for(let py=cy*C*K;py<(cy+1)*C*K&&!on;py++)for(let px=cc*C*K;px<(cc+1)*C*K;px++){if(d[(py*cv.width+px)*4+3]>110){on=1;break;}}bits+=on;}
  rows.push(BigInt('0b1'+bits).toString(16));}
 r[f]={box:[b.x,b.y,b.width,b.height].map(n=>Math.round(n*10)/10),mask:rows};}
document.getElementById('out').textContent=JSON.stringify(r);})();</script>`;
const tmp = mkdtempSync(join(tmpdir(), 'sprites-'));
writeFileSync(join(tmp, 'm.html'), page);
const dom = execFileSync(CHROME, ['--headless=new', '--virtual-time-budget=20000', '--dump-dom', `file://${join(tmp, 'm.html')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const boxes = JSON.parse(/<pre id="out">([^<]*)<\/pre>/.exec(dom)[1].replace(/&quot;/g, '"'));
const out = Object.fromEntries(files.map((f) => [f, { sha1: hashes[f], cell: CELL, ...boxes[f] }]));
writeFileSync(OUT, `{\n${Object.entries(out).map(([f, e]) => `  ${JSON.stringify(f)}: ${JSON.stringify(e)}`).join(',\n')}\n}\n`);
console.log(`measured ${files.length} sprites -> ${OUT}`);
