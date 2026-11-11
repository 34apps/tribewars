// node build-units.mjs [unit ...] -> ../<unit>-<pose>.svg and ../icon/<unit>.svg (uses the unit-figures toy library)
import { writeFileSync } from 'node:fs';
const ALL = ['elk-rider', 'ember-guard', 'firecart'];
const root = new URL('../', import.meta.url).pathname;
for (const u of process.argv.slice(2).length ? process.argv.slice(2) : ALL) {
  const out = (await import(`./${u}.mjs?${Date.now()}`)).default;
  for (const [pose, s] of Object.entries(out)) {
    const fp = pose === 'icon' ? `${root}icon/${u}.svg` : `${root}${u}-${pose}.svg`;
    writeFileSync(fp, s);
    const ids = [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    console.log(`${fp.replace(root, '')}: ${s.length} B${dup.length ? ' DUP ' + dup : ''}`);
  }
}
