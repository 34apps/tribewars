import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const shim = (name: string): string => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', woff2: 'font/woff2' };

/**
 * The web client imports art as separate URLs (`?no-inline`, `new URL(..., import.meta.url)`), which Vite emits as
 * files. Fold every emitted asset into the bundle as a data: URI so dist/ holds only the single HTML file(s).
 */
function inlineAssets(): Plugin {
  return {
    name: 'clanfire-inline-assets',
    apply: 'build',
    generateBundle: {
      order: 'pre',
      handler(_options, bundle) {
        const assets = Object.values(bundle).filter(
          (f) => f.type === 'asset' && !/\.(html|css|js|map)$/.test(f.fileName),
        );
        for (const asset of assets) {
          if (asset.type !== 'asset') continue;
          const ext = asset.fileName.split('.').pop() ?? '';
          const mime = MIME[ext];
          if (!mime) throw new Error(`inlineAssets: no MIME type for ${asset.fileName}`);
          const bytes = typeof asset.source === 'string' ? Buffer.from(asset.source) : Buffer.from(asset.source);
          const uri =
            ext === 'svg'
              ? `data:${mime};charset=utf-8,${encodeURIComponent(bytes.toString('utf8')).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
              : `data:${mime};base64,${bytes.toString('base64')}`;
          let used = false;
          for (const file of Object.values(bundle)) {
            if (file.type === 'chunk' && file.code.includes(asset.fileName)) {
              file.code = file.code.split(asset.fileName).join(uri);
              used = true;
            } else if (file.type === 'asset' && /\.css$/.test(file.fileName) && String(file.source).includes(asset.fileName)) {
              file.source = String(file.source).split(asset.fileName).join(uri);
              used = true;
            }
          }
          if (!used) this.warn(`inlineAssets: ${asset.fileName} is not referenced`);
          delete bundle[asset.fileName];
        }
      },
    },
  };
}

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
      // Google Fonts <link>s (the only external requests allowed) come along from the page head.
      const fontLinks = (page.match(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g) ?? []).join('\n');
      const fragment = [
        '<title>Clanfire</title>',
        fontLinks,
        ...styles,
        '<div id="root"></div>',
        ...scripts,
        '',
      ].join('\n');
      writeFileSync(resolve(outDir, 'artifact.html'), fragment);
    },
  };
}

/** Where the dev server mirrors the preview world, one file per player: data/preview-world-<player>.sqlite (git-ignored). */
const MIRROR_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const MIRROR_PLAYER = /^[A-Za-z0-9_-]{1,32}$/;
const MIRROR_MAX_BYTES = 50 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOCAL_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Local only (`npm run dev:preview`, or the built local copy `npm run serve:preview`): every save of the in-browser world is also POSTed here (host.ts) and written to
 * apps/preview/data/preview-world-<player>.sqlite (the signed-in player, header x-clanfire-player), atomically (temp file, then rename), so sessions can read the owner's world
 * with sqlite3. Only from this machine; the custom header forces a CORS preflight for any other site.
 */
function worldMirror(): Plugin {
  let seq = 0;
  const plugin: Plugin = {
    name: 'clanfire-preview-world-mirror',
    apply: 'serve',
    // The dev server and `vite preview` (the built local copy, `npm run serve:preview`) both take the mirror.
    configureServer(server) {
      mount(server.middlewares, (msg) => server.config.logger.warn(msg));
    },
    configurePreviewServer(server) {
      mount(server.middlewares, (msg) => server.config.logger.warn(msg));
    },
  };
  function mount(middlewares: Connect.Server, warn: (msg: string) => void): void {
      middlewares.use('/__clanfire/preview-world', (req, res) => {
        const done = (status: number): void => {
          res.statusCode = status;
          res.end();
        };
        let originOk = true;
        try {
          if (req.headers.origin) originOk = LOCAL_HOSTS.has(new URL(req.headers.origin).hostname);
        } catch {
          originOk = false;
        }
        if (req.method !== 'POST') return done(405);
        if (!LOCAL_ADDRS.has(req.socket.remoteAddress ?? '') || !originOk || req.headers['x-clanfire-mirror'] !== '1') return done(403);
        if (Number(req.headers['content-length'] ?? 0) > MIRROR_MAX_BYTES) return done(413);
        const player = String(req.headers['x-clanfire-player'] ?? '');
        if (!MIRROR_PLAYER.test(player)) return done(400);
        const target = resolve(MIRROR_DIR, `preview-world-${player}.sqlite`);
        const chunks: Buffer[] = [];
        let size = 0;
        let failed = false;
        req.on('data', (chunk: Buffer) => {
          if (failed) return;
          size += chunk.length;
          if (size > MIRROR_MAX_BYTES) {
            failed = true;
            done(413);
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (failed) return;
          const bytes = Buffer.concat(chunks);
          if (bytes.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') return done(400);
          const tmp = `${target}.${process.pid}-${++seq}.tmp`;
          mkdir(MIRROR_DIR, { recursive: true })
            .then(() => writeFile(tmp, bytes))
            .then(() => rename(tmp, target))
            .then(
              () => done(204),
              (err: unknown) => {
                warn(`preview world mirror failed: ${String(err)}`);
                done(500);
              },
            );
        });
      });
  }
  return plugin;
}

// The real server code (apps/server/src) and the real web client (apps/web/src) are bundled as they are. The only
// swaps are the Node built-ins the server imports, which get small browser shims.
export default defineConfig({
  plugins: [react(), inlineAssets(), viteSingleFile(), artifactFragment(), worldMirror()],
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
