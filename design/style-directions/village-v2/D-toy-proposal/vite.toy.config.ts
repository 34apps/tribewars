// Builds the single-file preview with the Toy Diorama art swapped in (proposal only; nothing in apps/ changes).
import base from '/home/user/tribewars/apps/preview/vite.config.ts';
import { mergeConfig } from 'vite';
const T = '/tmp/claude-0/-home-user/3a835131-ac72-5ec6-b53e-ff70fc61ea1d/scratchpad/toy';
const NM = '/home/user/tribewars/node_modules';
export default mergeConfig(base, {
  root: '/home/user/tribewars/apps/preview',
  resolve: {
    alias: [
      { find: /^(?:\.\.?\/)+(?:art\/)?buildings\.ts$/, replacement: `${T}/art/buildings.ts` },
      { find: /^(?:\.\.?\/)+(?:art\/)?scenery\.tsx$/, replacement: `${T}/art/scenery.tsx` },
      { find: /^\.\/Icon\.tsx$/, replacement: '/home/user/tribewars/apps/web/src/art/Icon.tsx' },
      { find: /^@clanfire\/engine$/, replacement: `${NM}/@clanfire/engine` },
      { find: /^react$/, replacement: `${NM}/react` },
      { find: /^react\/jsx-runtime$/, replacement: `${NM}/react/jsx-runtime.js` },
      { find: /^react\/jsx-dev-runtime$/, replacement: `${NM}/react/jsx-dev-runtime.js` },
    ],
  },
  build: { outDir: `${T}/dist`, emptyOutDir: true },
});
