// Map zoom bands (dots, banner tag, label chip), own-village emphasis, and the chunk cache going stale when a village
// changes owner. The map modules use Vite-only features (import.meta.glob), so they load through Vite's SSR loader.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { MapVillageDto } from '@clanfire/engine';

let server: ViteDevServer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let zoom: any, markers: any, overview: any, dots: any, revision: any, chunksMod: any, apiMod: any, iso: any, allegiance: any;

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
  markers = await server.ssrLoadModule('/src/map/markers.ts');
  overview = await server.ssrLoadModule('/src/map/overview.ts');
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
  assert.equal(v.tile, iso.MIN_TILE, 'without a map size only the absolute floor applies');
});

test('the minimum zoom is the whole world fitting the map area, on desktop and phone, never smaller', () => {
  for (const [radius, size] of [
    [30, { w: 1100, h: 760 }],
    [30, { w: 360, h: 600 }],
    [100, { w: 1100, h: 760 }],
    [100, { w: 360, h: 600 }],
  ] as const) {
    const t = iso.fitTile(radius, size);
    const span = 2 * radius + 1;
    // The board's bounding box (width = span * tile, height = span * tile / 2) fits with a small margin ...
    assert.ok(span * t <= size.w, `${radius} ${size.w}: fits across`);
    assert.ok((span * t) / 2 <= size.h, `${radius} ${size.w}: fits down`);
    // ... and fills it: the limiting side uses at least 80%.
    const fillW = (span * t) / size.w;
    const fillH = (span * t) / 2 / size.h;
    assert.ok(Math.max(fillW, fillH) >= 0.8, `${radius} ${size.w}: no empty slab (${fillW.toFixed(2)}, ${fillH.toFixed(2)})`);
    // Zooming out stops there, and the board is centred.
    const v = { cx: 20, cy: -9, tile: 1 };
    iso.zoomAround(v, size, size.w / 2, size.h / 2, 1, radius);
    assert.equal(v.tile, t);
    assert.deepEqual([v.cx, v.cy], [0, 0]);
  }
  assert.equal(iso.fitTile(30, { w: 0, h: 0 }), iso.MIN_TILE);
  const bigger = { cx: 0, cy: 0, tile: 50 };
  iso.clampView(bigger, 30, { w: 1100, h: 760 });
  assert.equal(bigger.tile, 50, 'zoomed in views are left alone');
});

test('dots use the relation colour, abandoned dark grey, own bigger with a white edge', () => {
  const t = 12;
  for (const rel of ['tribe', 'ally', 'nap', 'enemy', 'neutral'] as const) {
    const d = dots.villageDot(village({ relation: rel }), t);
    assert.equal(d.fill, dots.STRONG_COLOR[rel], rel);
    assert.equal(d.hollow, false);
    assert.equal(d.own, false);
    assert.notEqual(d.edge, dots.DOT_OWN_EDGE);
  }
  const ab = dots.villageDot(village({ kind: 'abandoned', ownerId: null }), t);
  const own = dots.villageDot(village({ kind: 'own', relation: 'self' }), t);
  const other = dots.villageDot(village({ relation: 'neutral' }), t);
  assert.equal(ab.fill, dots.STRONG_COLOR.abandoned);
  assert.equal(ab.hollow, true, 'abandoned dots are hollow');
  assert.ok(ab.radius < other.radius, 'and smaller than a neutral player');
  assert.equal(own.edge, '#FFFFFF');
  assert.equal(own.fill, dots.STRONG_COLOR.own);
  assert.ok(own.radius >= other.radius + 3, 'own villages are clearly the biggest');
  assert.ok(own.radius > other.radius);
  assert.ok(own.edgeWidth > other.edgeWidth);
  assert.ok(zoom.dotHitRadius(2.4) >= 9, 'fingers can hit a tiny dot');
});

test('every relation colour is clearly apart from neutral and from each other', () => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((c, i) => c - rgb(b)[i]!));
  const keys = Object.keys(dots.STRONG_COLOR);
  for (const a of keys) for (const b of keys) if (a < b) assert.ok(dist(dots.STRONG_COLOR[a], dots.STRONG_COLOR[b]) > 70, `${a} vs ${b}`);
});

test('dot radius grows with the zoom within sensible bounds', () => {
  for (const tile of [3, 5.5, 12, 20, 29]) {
    const r = zoom.dotRadius(tile, false);
    assert.ok(r >= 3 && r <= 7, `${tile}: ${r}`);
    assert.ok(zoom.dotRadius(tile, true) >= 6.5);
  }
  assert.ok(zoom.dotRadius(25, false) > zoom.dotRadius(5, false));
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

test('the banner text is at least 8 px tall wherever the tag shows', () => {
  for (const tile of [zoom.BANNER_TAG_MIN_TILE, 55, 84, 160]) {
    assert.ok(zoom.bannerScale(tile, true) * zoom.BANNER_TEXT_PX >= zoom.BANNER_MIN_TEXT_PX - 1e-9, String(tile));
  }
  assert.ok(zoom.bannerScale(40, false) < zoom.bannerScale(40, true), 'without a tag the banner just follows the zoom');
});

test('the protection shield never sits on the pole or the cloth', () => {
  // Banner pole feet per growth stage (tile-centre SVG px, from sprites.ts); cloth and pole rise above the foot, up to
  // POLE_H + 4 banner units, and the widest cloth reaches 34 units to the left (crossbar of a war banner).
  const feet: Array<[number, number]> = [[25, -6], [18.2, -26.4], [0, -57.8], [0, -57.8], [0, -57.8], [0, -57.8]];
  for (const s of [0.3, 0.55, 0.875, 1.2, 1.67]) {
    const sh = markers.shieldBox(0, 0, s);
    for (const [fx, fy] of feet) {
      const k = s * zoom.BANNER_K;
      const banner = { x0: (fx - 34 * zoom.BANNER_K) * s, y0: (fy - 44 * zoom.BANNER_K) * s, x1: (fx + 60 * zoom.BANNER_K) * s, y1: fy * s };
      assert.equal(markers.rectsOverlap(sh, banner), false, `scale ${s} foot ${fx},${fy} (k ${k})`);
    }
  }
});

test('labels: own beats sites beats other villages; the lower one is nudged or dropped', () => {
  const L = (cx: number, cy: number, priority: number, nudges: number[] = []) => ({ cx, cy, w: 60, h: 20, priority, nudges });
  // The own label overlaps a site label: the site (lower priority than own) is nudged down, the other village's label is dropped.
  const out = markers.placeLabels([L(100, 100, markers.LABEL_PRIORITY.other), L(100, 100, markers.LABEL_PRIORITY.site, [22]), L(100, 100, markers.LABEL_PRIORITY.own, [22])]);
  assert.deepEqual(out[2], { cx: 100, cy: 100 }, 'own stays');
  assert.deepEqual(out[1], { cx: 100, cy: 122 }, 'site shifts clear of it');
  assert.equal(out[0], null, 'the other village loses');
  // Input order does not matter.
  const rev = markers.placeLabels([L(100, 100, markers.LABEL_PRIORITY.own, [22]), L(100, 100, markers.LABEL_PRIORITY.site, [22])]);
  assert.deepEqual(rev[0], { cx: 100, cy: 100 });
  assert.deepEqual(rev[1], { cx: 100, cy: 122 });
  // A banner is an obstacle for every label.
  const hit = markers.placeLabels([L(100, 100, 2)], [{ x0: 90, y0: 80, x1: 120, y1: 105 }]);
  assert.equal(hit[0], null);
  const siteNudged = markers.placeLabels([L(100, 100, 1, [30])], [{ x0: 90, y0: 80, x1: 120, y1: 105 }]);
  assert.deepEqual(siteNudged[0], { cx: 100, cy: 130 }, 'a site label moves clear of a banner');
  const ownStays = markers.placeLabels([{ ...L(100, 100, 0, [30]), overBanners: true }], [{ x0: 90, y0: 80, x1: 120, y1: 105 }]);
  assert.deepEqual(ownStays[0], { cx: 100, cy: 100 }, 'the own label is never pushed away from its village by a neighbour banner');
  // Far apart labels never interfere.
  const apart = markers.placeLabels([L(0, 0, 2), L(200, 0, 2)]);
  assert.ok(apart[0] && apart[1]);
});

test('overview: counts per relation, flat square mapping, click to world, own squares biggest', () => {
  const vs = [
    village({ kind: 'own', relation: 'self' }),
    village({ relation: 'tribe' }), village({ relation: 'tribe' }),
    village({ relation: 'enemy' }),
    village({ relation: 'neutral' }),
    village({ kind: 'abandoned', ownerId: null, relation: null }),
  ];
  assert.deepEqual(overview.countVillages(vs), { own: 1, tribe: 2, ally: 0, nap: 0, enemy: 1, neutral: 1, abandoned: 1 });
  assert.deepEqual(overview.OVERVIEW_ROWS.map((r: { label: string }) => r.label), ['Your villages', 'Tribe', 'Allies', 'Pact', 'Enemies', 'Others', 'Abandoned']);
  // Corners and centre of the board.
  const R = 30;
  const px = 244;
  const a = overview.worldToOverview(-R, -R, R, px);
  const b = overview.worldToOverview(R, R, R, px);
  assert.ok(a.x > 0 && a.y > 0 && b.x < px && b.y < px);
  const mid = overview.worldToOverview(0, 0, R, px);
  assert.ok(Math.abs(mid.x - px / 2) < 1e-9 && Math.abs(mid.y - px / 2) < 1e-9);
  // Round trip, and clicks outside the square stay on the board.
  for (const [x, y] of [[-30, -30], [0, 0], [12, -7], [30, 30]]) {
    const p = overview.worldToOverview(x, y, R, px);
    assert.deepEqual(overview.overviewToWorld(p.x, p.y, R, px), { x, y });
  }
  assert.deepEqual(overview.overviewToWorld(-50, 9999, R, px), { x: -30, y: 30 });
  const sc = overview.overviewScale(R, px);
  assert.ok(overview.squareSize('own', sc) >= overview.squareSize('enemy', sc) * 1.4);
  assert.ok(overview.squareSize('abandoned', sc) < overview.squareSize('neutral', sc));
  // Sizes follow the world: about 0.55 tile, 2-4 px (own 3-6, abandoned from 1.5), at radius 30 and radius 300.
  for (const [r, px2] of [[30, 300], [30, 200], [300, 300]] as const) {
    const s2 = overview.overviewScale(r, px2);
    for (const k of ['neutral', 'enemy', 'tribe', 'ally', 'nap'] as const) {
      const z = overview.squareSize(k, s2);
      assert.ok(z >= 2 && z <= 4, `${k} ${r} ${z}`);
    }
    const ab = overview.squareSize('abandoned', s2);
    assert.ok(ab >= 1.5 && ab <= overview.squareSize('neutral', s2));
    const own = overview.squareSize('own', s2);
    assert.ok(own >= 3 && own <= 6);
  }
  assert.equal(overview.squareSize('neutral', overview.overviewScale(300, 300)), 2);
  assert.equal(overview.squareSize('abandoned', overview.overviewScale(300, 300)), 1.5);
  // Frame vs crosshair: a small view is an upright rectangle (bounding box of the corners), a view over most of the world a crosshair.
  const sq = (c: number, hw: number) => [{ x: c, y: c - hw }, { x: c + hw, y: c }, { x: c, y: c + hw }, { x: c - hw, y: c }];
  const small = overview.frameShape(sq(100, 30), 300);
  assert.equal(small.kind, 'frame');
  assert.deepEqual([small.x0, small.y0, small.x1, small.y1], [70, 70, 130, 130]);
  const big = overview.frameShape(sq(150, 140), 300);
  assert.equal(big.kind, 'cross');
  assert.ok(Math.abs(big.cx - 150) < 1e-9 && Math.abs(big.cy - 150) < 1e-9);
  // The main view's frame: a screen of 800x600 at tile 40 sees a diamond around the centre.
  const f = overview.frameCorners({ cx: 5, cy: 5, tile: 40 }, { w: 800, h: 600 });
  assert.equal(f.length, 4);
  assert.ok(Math.abs((f[0].x + f[2].x) / 2 - 5) < 1e-9);
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
