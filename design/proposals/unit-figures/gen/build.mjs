import { writeFileSync } from 'node:fs';
const root = '/Users/admin/Projects/tribewars/design/sprites/units';
for (const u of process.argv.slice(2)) {
  const out = (await import(`./${u}.mjs?${Date.now()}`)).default;
  for (const [pose, s] of Object.entries(out)) {
    const p = pose === 'icon' ? `${root}/icon/${u}.svg` : `${root}/${u}-${pose}.svg`;
    writeFileSync(p, s);
    const ids = [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    const bad = ids.filter((x) => !x.startsWith(u));
    console.log(`${p.replace(root + '/', '')}: ${s.length} B${dup.length ? ' DUP ' + dup : ''}${bad.length ? ' BADPFX ' + bad : ''}`);
  }
}
