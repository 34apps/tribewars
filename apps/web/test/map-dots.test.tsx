// Map zoom bands (dots, banner tag, label chip), own-village emphasis, and the chunk cache going stale when a village
// changes owner. The map modules use Vite-only features (import.meta.glob), so they load through Vite's SSR loader.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { MapVillageDto } from '@clanfire/engine';

let server: ViteDevServer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let zoom: any, dots: any, revision: any, chunksMod: any, apiMod: any, iso: any, allegiance: any;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  zoom = await server.ssrLoadModule('/src/map/zoomMode.ts');
  dots = await server.ssrLoadModule('/src/map/dots.ts');
  revision = await server.ssrLoadModule('/src/map/revision.ts');
  chunksMod = await server.ssrLoadModule('/src/map/chunks.ts');
  apiMod = await server.ssrLoadModule('/src/api.ts');
  iso = await server.ssrLoadModule('/src/map/iso.ts');
  allegiance = await server.ssrLoadModule('/src/map/allegiance.ts');
});

after(async () => {
  await server.close();
});

const village = (over: Partial<MapVillageDto>): MapVillageDto =>
  ({ id: 1, kind: 'player', name: 'V', x: 3, y: 4, points: 50, ownerId: 2, ownerName: 'O', ownerPoints: 10, protected: false, relation: 'neutral', tribeId: null, tribeTag: null, ...over }) as MapVillageDto;

test('dot mode starts below DOT_TILE and the map zooms out far enough for it', () => {
  assert.equal(zoom.isDotMode(zoom.DOT_TILE - 0.1), true);
  assert.equal(zoom.isDotMode(zoom.DOT_TILE), false);
  assert.ok(iso.MIN_TILE < zoom.DOT_TILE, 'the zoom range reaches dot mode');
  const v = { cx: 0, cy: 0, tile: 1 };
  iso.clampView(v, 100);
  assert.equal(v.tile, iso.MIN_TILE);
});

test('dots use the relation colour, abandoned dark grey, own bigger with a white edge', () => {
  const t = 12;
  for (const rel of ['tribe', 'ally', 'nap', 'enemy', 'neutral'] as const) {
    const d = dots.villageDot(village({ relation: rel }), t);
    assert.equal(d.fill, allegiance.ALLEGIANCE_STYLE[rel].ring, rel);
    assert.equal(d.own, false);
    assert.notEqual(d.edge, dots.DOT_OWN_EDGE);
  }
  const ab = dots.villageDot(village({ kind: 'abandoned', ownerId: null }), t);
  assert.equal(ab.fill, allegiance.ALLEGIANCE_STYLE.abandoned.ring);
  const own = dots.villageDot(village({ kind: 'own', relation: 'self' }), t);
  const other = dots.villageDot(village({ relation: 'neutral' }), t);
  assert.equal(own.edge, '#FFFFFF');
  assert.equal(own.fill, allegiance.ALLEGIANCE_STYLE.own.ring);
  assert.ok(own.radius > other.radius);
  assert.ok(own.edgeWidth > other.edgeWidth);
  assert.ok(zoom.dotHitRadius(2.4) >= 9, 'fingers can hit a tiny dot');
});

test('the tribe tag shows on the banner only when readable, and the label chip covers the rest', () => {
  assert.equal(zoom.bannerTagVisible(zoom.BANNER_TAG_MIN_TILE, 'ASH'), true);
  assert.equal(zoom.bannerTagVisible(zoom.BANNER_TAG_MIN_TILE - 1, 'ASH'), false);
  assert.equal(zoom.bannerTagVisible(160, null), false, 'no tribe, no tag');
  assert.equal(zoom.labelChipVisible(60, 'ASH'), false, 'banner shows it, so no chip');
  assert.equal(zoom.labelChipVisible(40, 'ASH'), true);
  assert.equal(zoom.labelChipVisible(40, null), false);
  assert.ok(zoom.BANNER_TAG_MIN_TILE <= 60, 'the tag is on the banner by the time labels appear');
});

test('far-out maps are re-read less often', () => {
  assert.ok(zoom.chunkStaleMs(10) > zoom.chunkStaleMs(80));
});

test('a village changing owner makes only its chunk stale; a tribe change makes everything stale', () => {
  const base = { tribeId: 1, tribeVersion: 0, villages: [{ id: 1, x: 5, y: 5 }], holds: [] };
  const a = revision.mapRevision(base);
  assert.deepEqual(revision.staleSince(null, a), { all: false, tiles: [] });
  assert.deepEqual(revision.staleSince(a, revision.mapRevision(base)), { all: false, tiles: [] });
  // Took Tolvek's village at (40, 40): it joins my list.
  const took = revision.mapRevision({ ...base, villages: [...base.villages, { id: 9, x: 40, y: 40 }] });
  assert.deepEqual(revision.staleSince(a, took), { all: false, tiles: [{ x: 40, y: 40 }] });
  // Lost it again: the old tile is stale too.
  assert.deepEqual(revision.staleSince(took, a), { all: false, tiles: [{ x: 40, y: 40 }] });
  // A hold starts / hearth goes out.
  const hold = revision.mapRevision({ ...base, holds: [{ villageId: 7, x: -8, y: 3 }] });
  assert.deepEqual(revision.staleSince(a, hold), { all: false, tiles: [{ x: -8, y: 3 }] });
  assert.equal(revision.staleSince(a, revision.mapRevision({ ...base, tribeId: 2 })).all, true);
  assert.equal(revision.staleSince(a, revision.mapRevision({ ...base, tribeVersion: 1 })).all, true);
});

test('MapChunks refetches only the invalidated chunk, and shows the new owner', async () => {
  const calls: string[] = [];
  let owner = 'Tolvek';
  apiMod.api.map = async (x: number, y: number, w: number, h: number) => {
    calls.push(`${x},${y},${w},${h}`);
    return { villages: x <= 40 && 40 < x + w && y <= 40 && 40 < y + h ? [village({ id: 9, x: 40, y: 40, ownerName: owner })] : [] };
  };
  const chunks = new chunksMod.MapChunks(100);
  chunks.attach(() => {});
  const settle = () => new Promise((r) => setTimeout(r, 20));
  chunks.ensure(0, 0, 59, 59, 30, 30);
  await settle();
  assert.equal(calls.length, 4);
  assert.equal(chunks.villageAt(40, 40)?.ownerName, 'Tolvek');
  // Fresh chunks are not refetched.
  chunks.ensure(0, 0, 59, 59, 30, 30);
  await settle();
  assert.equal(calls.length, 4);
  // The village changes hands; only its chunk is stale.
  owner = 'Me';
  chunks.invalidateAt([{ x: 40, y: 40 }]);
  chunks.ensure(0, 0, 59, 59, 30, 30);
  await settle();
  assert.equal(calls.length, 5);
  assert.equal(chunks.villageAt(40, 40)?.ownerName, 'Me');
  // invalidate() makes all of them stale.
  chunks.invalidate();
  chunks.ensure(0, 0, 59, 59, 30, 30);
  await settle();
  assert.equal(calls.length, 9);
  chunks.detach();
});
