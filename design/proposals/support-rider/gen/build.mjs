// node build.mjs -> ../support-rider-<pose>.svg and ../icon/support-rider.svg (same layout as apps/web/src/art/units)
import { writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
mkdirSync(`${root}icon`, { recursive: true });
const u = 'support-rider';
const out = (await import(`./${u}.mjs?${Date.now()}`)).default;
for (const [pose, s] of Object.entries(out)) {
  const fp = pose === 'icon' ? `${root}icon/${u}.svg` : `${root}${u}-${pose}.svg`;
  writeFileSync(fp, s);
  const ids = [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  console.log(`${fp.replace(root, '')}: ${s.length} B${dup.length ? ' DUP ' + dup : ''}`);
}
