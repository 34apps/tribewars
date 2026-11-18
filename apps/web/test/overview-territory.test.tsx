// Territory overview (200 x 200, whole world): cell majority, hatch threshold, own pins, edge notch hit areas.
// The map modules load through Vite's SSR loader (same as map-dots.test.tsx).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

let server: ViteDevServer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let terr: any, overview: any;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  terr = await server.ssrLoadModule('/src/map/territory.ts');
  overview = await server.ssrLoadModule('/src/map/overview.ts');
});

after(async () => {
  await server.close();
});

type A = 'own' | 'tribe' | 'ally' | 'nap' | 'enemy' | 'neutral' | 'abandoned';
const pt = (x: number, y: number, a: A) => ({ x, y, a });
const R = 300;

test('cell size lives in one place: about 8 fields on the world, 4 on 200, and grows when the board is small', () => {
  assert.deepEqual({ ...terr.CELL_FIELDS }, { whole: 8, wide: 4 });
  assert.equal(terr.cellSize(601, 601 * 1.2, true), 8, 'a large board keeps the base size');
  assert.equal(terr.cellSize(200, 200 * 2.6, false), 4);
  assert.ok(terr.cellSize(601, 268, true) > 8, 'a small panel gets coarser cells');
  assert.ok(terr.cellSize(601, 268, true) * (268 / 601) >= terr.MIN_CELL_PX.whole - 0.01, 'never narrower than the minimum');
  assert.ok(terr.cellSize(200, 330, false) * (330 / 200) >= terr.MIN_CELL_PX.wide - 0.01);
});

test('a cell is tinted by the relation holding the most player villages; own counts as the tribe', () => {
  const g = terr.buildCells(
    [pt(-300, -300, 'enemy'), pt(-299, -300, 'enemy'), pt(-298, -299, 'ally'), pt(-297, -299, 'neutral'), pt(-296, -299, 'neutral'), pt(-295, -299, 'neutral')],
    8,
    R,
  );
  assert.equal(g.cells.length, 1);
  assert.equal(g.cells[0].tint, 'neutral', 'three others beat two enemies and one ally');
  assert.equal(g.cells[0].players, 6);
  const own = terr.buildCells([pt(0, 0, 'own'), pt(1, 0, 'own'), pt(2, 0, 'enemy')], 8, R);
  assert.equal(own.cells[0].tint, 'tribe', 'two own villages are the tribe side');
  assert.equal(own.cells[0].own, 2);
  // Equal counts: the enemy side wins, then tribe, ally, pact, others.
  assert.equal(terr.majorityRelation({ tribe: 1, ally: 1, nap: 1, enemy: 1, neutral: 1 }), 'enemy');
  assert.equal(terr.majorityRelation({ tribe: 1, ally: 1, nap: 0, enemy: 0, neutral: 1 }), 'tribe');
  assert.equal(terr.majorityRelation({ tribe: 0, ally: 0, nap: 0, enemy: 0, neutral: 0 }), null);
  // Cells are keyed on the world, so the same field always lands in the same cell.
  const k = (x: number, y: number) => terr.buildCells([pt(x, y, 'ally')], 8, R).cells[0];
  assert.deepEqual([k(-300, -300).i, k(-293, -293).j, k(-292, -300).i], [0, 0, 1]);
});

test('cells with no player villages stay plain ground; abandoned ones are counted apart and never tint', () => {
  const g = terr.buildCells([pt(10, 10, 'abandoned'), pt(11, 10, 'abandoned')], 8, R);
  assert.equal(g.cells.length, 1);
  assert.equal(g.cells[0].tint, null);
  assert.equal(g.cells[0].abandoned, 2);
  assert.equal(g.cells[0].players, 0);
});

test('hatch: starts from a low threshold and gets denser with the abandoned count; counts show on fine cells only', () => {
  // Fine cells (200 region): one abandoned village already hatches.
  assert.deepEqual([0, 1, 2, 3, 6].map((n) => terr.hatchLevel(n, 4)), [0, 1, 2, 3, 3]);
  // Coarse cells (whole world): from two villages, denser at four and six.
  assert.deepEqual([0, 1, 2, 3, 4, 6, 20].map((n) => terr.hatchLevel(n, 12)), [0, 0, 1, 1, 2, 3, 3]);
  assert.ok(terr.hatchMin(8) <= 2 && terr.hatchMin(4) === 1, 'a low threshold');
  // Never less dense for a bigger count.
  for (const size of [4, 8, 12]) for (let n = 1; n < 30; n++) assert.ok(terr.hatchLevel(n + 1, size) >= terr.hatchLevel(n, size));
  assert.equal(terr.showsCount(3, 4), true);
  assert.equal(terr.showsCount(2, 4), false, 'only the cells with the most');
  assert.equal(terr.showsCount(9, 12), false, 'no numbers on the coarse world cells');
});

test('tint strength grows with the village count; the area borders are where the tint changes', () => {
  assert.ok(terr.tintAlpha('enemy', 3) > terr.tintAlpha('enemy', 1));
  assert.ok(terr.tintAlpha('neutral', 2) < terr.tintAlpha('tribe', 2), 'others are paler than the relations');
  const g = terr.buildCells([pt(-300, -300, 'tribe'), pt(-292, -300, 'tribe'), pt(-292, -292, 'enemy')], 8, R);
  const cell = (i: number, j: number) => g.byKey.get(terr.cellKey(i, j));
  const a = cell(0, 0);
  const b = cell(1, 0);
  const c = cell(1, 1);
  assert.deepEqual(terr.borderSides(g, a), [0, 2, 3], 'open on top, bottom and left; shares its right side with the same tribe tint');
  assert.deepEqual(terr.borderSides(g, b), [0, 1, 2], 'top, right and the bottom side next to the enemy cell');
  assert.ok(terr.borderSides(g, c).includes(0), 'the enemy cell borders the tribe cell above it');
  assert.deepEqual([...terr.BORDERED].sort(), ['ally', 'enemy', 'nap', 'tribe']);
});

test('own villages are the gold pins', () => {
  const pins = terr.ownPins([pt(1, 1, 'tribe'), pt(2, 2, 'own'), pt(3, 3, 'abandoned'), pt(4, 4, 'own')]);
  assert.deepEqual(pins.map((p: { x: number }) => p.x), [2, 4]);
});

test('edge notches: four, one per diamond edge, a touch area of at least 40 px, pointing the way the map moves', () => {
  const region = overview.regionOf(200, 300, 0, 0);
  for (const width of [268, 330, 520]) {
    const l = { ...overview.diamondLayout(region, width, 4), ox: width / 2 + 2 };
    const notches = overview.notchSpots(l, region, 14);
    assert.deepEqual(notches.map((n: { key: string }) => n.key), ['up', 'right', 'down', 'left']);
    assert.ok(overview.NOTCH_HIT >= 40, 'tappable on a phone');
    for (const n of notches) {
      assert.ok(Math.abs(n.dx) + Math.abs(n.dy) === 1, 'one world axis per notch');
      assert.ok(n.x - overview.NOTCH_HIT / 2 >= -overview.NOTCH_HIT / 2 && n.x + overview.NOTCH_HIT / 2 <= width + overview.NOTCH_HIT / 2 + 4, 'near the board, not off the card');
    }
    // The four hit squares never overlap each other.
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const sep = Math.max(Math.abs(notches[i].x - notches[j].x), Math.abs(notches[i].y - notches[j].y));
        assert.ok(sep >= overview.NOTCH_HIT, `notches ${i} and ${j} are apart (${width})`);
      }
    // The arrow of each notch lies just outside its edge, on the right side of the centre.
    const c = overview.worldToDiamond(l, region, region.cx, region.cy);
    const by = (k: string) => notches.find((n: { key: string }) => n.key === k);
    assert.ok(by('up').x > c.x && by('up').y < c.y, 'up: the top-right edge');
    assert.ok(by('right').x > c.x && by('right').y > c.y, 'right: the bottom-right edge');
    assert.ok(by('down').x < c.x && by('down').y > c.y, 'down: the bottom-left edge');
    assert.ok(by('left').x < c.x && by('left').y < c.y, 'left: the top-left edge');
  }
  assert.equal(overview.OVERVIEW_HINT, 'Drag to move · tap to jump');
});

test('view shape: clipped to the board diamond, a cross clamped onto the board when almost nothing is inside', () => {
  const region = overview.regionOf(0, R, 0, 0);
  const l = overview.diamondLayout(region, 400, 20);
  const size = { w: 800, h: 500 };
  const inDiamond = (p: { x: number; y: number }) => Math.abs(p.x - l.ox) / (l.width / 2) + Math.abs(p.y - l.oy) / (l.width / 4) <= 1 + 1e-9;
  // View at the top corner of the world: the frame is cut by the diamond edges, every vertex lies on the board.
  const top = overview.viewShape(l, region, { cx: -R, cy: -R, tile: 400 / 601 / 0.05 }, size);
  assert.equal(top.kind, 'frame');
  assert.ok(top.poly.length >= 3 && top.poly.every(inDiamond), 'no point outside the diamond');
  // A view well inside keeps its four corners.
  const mid = overview.viewShape(l, region, { cx: 0, cy: 0, tile: 400 / 601 / 0.05 }, size);
  assert.equal(mid.kind, 'frame');
  assert.equal(mid.poly.length, 4);
  // A view centred far outside the world (only a sliver inside): cross only, centre pulled onto the board.
  const out = overview.viewShape(l, region, { cx: -R - 400, cy: -R - 400, tile: 400 / 601 / 0.05 }, size);
  assert.equal(out.kind, 'cross');
  assert.equal(out.poly.length, 0);
  assert.ok(inDiamond({ x: out.cx, y: out.cy }));
  // A view bigger than the board is a cross at its (on-board) centre.
  assert.equal(overview.viewShape(l, region, { cx: 0, cy: 0, tile: 400 / 601 / 5 }, size).kind, 'cross');
});
