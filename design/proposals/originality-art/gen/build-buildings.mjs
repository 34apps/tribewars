// node build-buildings.mjs [name ...] -> ../<name>-<1..4>.svg
import { writeFileSync } from 'node:fs';
const ALL = ['longhouse', 'wrightyard', 'root-cellar', 'gold-sluice', 'palisade', 'elk-pens'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const out = new URL('../', import.meta.url).pathname;
for (const n of names) {
  const mod = (await import(`./${n}.mjs?${Date.now()}`)).default;
  for (let s = 1; s <= 4; s++) {
    const svg = mod(s);
    writeFileSync(`${out}${n}-${s}.svg`, svg);
    console.log(`${n}-${s}.svg ${svg.length} B`);
  }
}
