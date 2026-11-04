// Bundles the lobby (and the engine, plus all npm deps) into dist/*.js so it runs with plain `node`, no node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/admin.ts', 'src/backup.ts', 'src/import.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
