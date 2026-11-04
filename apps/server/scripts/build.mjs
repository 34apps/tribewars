// Bundles the server (and the engine, plus all npm deps) into dist/*.js so it runs with plain `node`, no node_modules.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// advisor.ts reads docs/GAME_DESIGN.md at import time via a path relative to the source file; embed it instead.
const embedRules = {
  name: 'embed-game-design',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]advisor\.ts$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const call = /readFileSync\(new URL\('\.\.\/\.\.\/\.\.\/docs\/GAME_DESIGN\.md', import\.meta\.url\), 'utf8'\)/;
      if (!call.test(src)) throw new Error('build: GAME_DESIGN.md read in advisor.ts not found; update scripts/build.mjs');
      const md = readFileSync(new URL('../../../docs/GAME_DESIGN.md', import.meta.url), 'utf8');
      return { contents: src.replace(call, JSON.stringify(md)), loader: 'ts' };
    });
  },
};

await build({
  entryPoints: ['src/index.ts', 'src/admin.ts', 'src/backup.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  logLevel: 'info',
  plugins: [embedRules],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
