import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const shim = (name: string): string => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

/**
 * Also emit dist/artifact.html: the same single file as a fragment for hosts that wrap pages in their own skeleton
 * (no doctype / html / head / body; charset and viewport come from the host). Order: title, style, #root, scripts.
 */
function artifactFragment(): Plugin {
  let outDir = '';
  return {
    name: 'clanfire-artifact-fragment',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const page = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const blocks = (tag: string): string[] => {
        const out: string[] = [];
        let from = 0;
        for (;;) {
          const start = page.indexOf(`<${tag}`, from);
          if (start < 0) break;
          const end = page.indexOf(`</${tag}>`, start);
          if (end < 0) throw new Error(`Unclosed <${tag}> in the built page`);
          out.push(page.slice(start, end + tag.length + 3));
          from = end + tag.length + 3;
        }
        return out;
      };
      // Only the head part can hold the tags we move; <script> text inside the bundle is escaped as <\/script>.
      const styles = blocks('style');
      const scripts = blocks('script');
      if (styles.length === 0 || scripts.length === 0) throw new Error('Expected inlined <style> and <script> in the built page');
      const fragment = [
        '<title>Clanfire</title>',
        ...styles,
        '<div id="root"></div>',
        ...scripts,
        '',
      ].join('\n');
      writeFileSync(resolve(outDir, 'artifact.html'), fragment);
    },
  };
}

// The real server code (apps/server/src) and the real web client (apps/web/src) are bundled as they are. The only
// swaps are the Node built-ins the server imports, which get small browser shims.
export default defineConfig({
  plugins: [react(), viteSingleFile(), artifactFragment()],
  resolve: {
    alias: [
      { find: /^node:sqlite$/, replacement: shim('node-sqlite') },
      { find: /^node:crypto$/, replacement: shim('node-crypto') },
      { find: /^node:util$/, replacement: shim('node-util') },
      { find: /^node:fs$/, replacement: shim('node-fs') },
      { find: /^node:path$/, replacement: shim('node-path') },
    ],
  },
  server: { port: 5174, host: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // One self-contained index.html: everything inlined, nothing fetched.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
  },
});
