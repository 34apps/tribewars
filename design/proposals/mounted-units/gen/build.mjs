// node build.mjs [unit ...] -> apps/web/src/art/units/<unit>-<pose>.svg and icon/<unit>.svg
import { writeFileSync } from 'node:fs';
const root = new URL('../../../../apps/web/src/art/units/', import.meta.url).pathname;
const { default: make, NAMES } = await import(`./mounted.mjs?${Date.now()}`);
for (const u of process.argv.slice(2).length ? process.argv.slice(2) : NAMES) {
  for (const [pose, s] of Object.entries(make(u))) {
    const fp = pose === 'icon' ? `${root}icon/${u}.svg` : `${root}${u}-${pose}.svg`;
    writeFileSync(fp, s);
    const ids = [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    console.log(`${fp.replace(root, '')}: ${s.length} B${dup.length ? ' DUP ' + dup : ''}`);
  }
}
