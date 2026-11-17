// Raid lists: the view-model helpers (paging, ticked rows, form checks, send result) and the page itself (loaded through Vite's SSR
// loader because the unit art uses import.meta.glob): the not-entitled page has only disabled controls, the entitled page pages its rows.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { RAID_LIST_SEND_CAP, createPlayerVillage } from '@clanfire/engine';
import type { OwnVillageDto, RaidListDto, RaidListRowDto, RaidListSendResponse, RaidListsResponse } from '@clanfire/engine';
import {
  RAID_ROWS_DESKTOP,
  RAID_ROWS_PHONE,
  capNote,
  checkNewRow,
  isTicked,
  lastText,
  pageRows,
  parseCounts,
  reasonText,
  rowsPerPage,
  sendLabel,
  summarizeSend,
  tickAll,
  tickedIds,
  toggleTick,
  travelText,
} from '../src/raidLists.ts';

const row = (id: number, o: Partial<RaidListRowDto> = {}): RaidListRowDto => ({
  id,
  villageId: 1000 + id,
  name: `Ruin ${id}`,
  x: id,
  y: -id,
  abandoned: true,
  fromVillageId: 100,
  units: { raider: 10 * id },
  distance: 5.25,
  travelSeconds: 725,
  last: null,
  ...o,
});
const rows = (n: number): RaidListRowDto[] => Array.from({ length: n }, (_, i) => row(i + 1));

test('paging: 8 rows on the desktop page, 5 on the phone, clamped, with the 1-8 of N numbers', () => {
  assert.equal(RAID_ROWS_DESKTOP, 8);
  assert.equal(RAID_ROWS_PHONE, 5);
  assert.equal(rowsPerPage(true), 8);
  assert.equal(rowsPerPage(true, 2), 10);
  assert.equal(rowsPerPage(false, 2), 5);
  const p1 = pageRows(rows(30), 0, 8);
  assert.deepEqual([p1.page, p1.pages, p1.from, p1.to, p1.total, p1.rows.length], [0, 4, 1, 8, 30, 8]);
  const p4 = pageRows(rows(30), 3, 8);
  assert.deepEqual([p4.from, p4.to, p4.rows.length, p4.rows[0]?.id], [25, 30, 6, 25]);
  assert.equal(pageRows(rows(30), 99, 8).page, 3);
  assert.equal(pageRows(rows(30), -4, 8).page, 0);
  assert.deepEqual(pageRows([], 0, 8), { page: 0, pages: 1, from: 0, to: 0, total: 0, rows: [] });
  assert.equal(pageRows(rows(11), 1, 5).rows.length, 5);
});

test('ticked rows: all start ticked, a row that is no longer abandoned never is', () => {
  const list = [row(1), row(2), row(3, { abandoned: false }), row(4)];
  assert.deepEqual(tickedIds(list, new Set()), [1, 2, 4]);
  const un = toggleTick(new Set(), 2);
  assert.deepEqual(tickedIds(list, un), [1, 4]);
  assert.equal(isTicked(list[1]!, un), false);
  assert.deepEqual(tickedIds(list, toggleTick(un, 2)), [1, 2, 4], 'ticking it again brings it back');
  assert.deepEqual(tickedIds(list, tickAll(list, false)), [], 'tick none');
  assert.deepEqual(tickedIds(list, tickAll(list, true)), [1, 2, 4], 'tick all');
  assert.equal(isTicked(list[2]!, new Set()), false);
  // The input set is never changed.
  const keep = new Set([9]);
  toggleTick(keep, 1);
  assert.deepEqual([...keep], [9]);
});

test('send button label and the per-press cap note', () => {
  assert.equal(sendLabel(0), 'Send 0 rows');
  assert.equal(sendLabel(1), 'Send 1 row');
  assert.equal(sendLabel(14), 'Send 14 rows');
  assert.equal(capNote(RAID_LIST_SEND_CAP), null);
  assert.match(capNote(RAID_LIST_SEND_CAP + 1) ?? '', new RegExp(`At most ${RAID_LIST_SEND_CAP} rows go per press`));
});

test('counts typed into the form: whole numbers only, blanks are zero', () => {
  assert.deepEqual(parseCounts({ raider: '12', pikeman: ' 3 ', guard: '' }), { raider: 12, pikeman: 3 });
  assert.ok(Number.isNaN(parseCounts({ raider: '1.5' }).raider));
  assert.ok(Number.isNaN(parseCounts({ raider: '-2' }).raider));
});

test('the add-village form is checked with the same engine rules before anything is sent', () => {
  const ok = checkNewRow({ x: '12', y: '-4', fromVillageId: 100, counts: { raider: '30', pikeman: '0' } });
  assert.deepEqual(ok, { ok: true, body: { x: 12, y: -4, fromVillageId: 100, units: { raider: 30 } } });
  for (const bad of [
    { x: '', y: '3', fromVillageId: 100, counts: { raider: '5' } },
    { x: '1.5', y: '3', fromVillageId: 100, counts: { raider: '5' } },
    { x: 'a', y: '3', fromVillageId: 100, counts: { raider: '5' } },
    { x: '1', y: '3', fromVillageId: null, counts: { raider: '5' } },
    { x: '1', y: '3', fromVillageId: 100, counts: {} },
    { x: '1', y: '3', fromVillageId: 100, counts: { raider: '0' } },
    { x: '1', y: '3', fromVillageId: 100, counts: { raider: '2x' } },
    { x: '1', y: '3', fromVillageId: 100, counts: { raider: '99999999999' } },
    { x: '1', y: '3', fromVillageId: 100, counts: { chieftain: '1' } },
  ]) {
    const r = checkNewRow(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.ok(r.message.length > 3);
  }
  const chief = checkNewRow({ x: '1', y: '3', fromVillageId: 100, counts: { chieftain: '1' } });
  assert.ok(!chief.ok && /Chieftain/.test(chief.message));
});

test('row facts: last result, one-way travel', () => {
  const now = 100 * 3_600_000;
  assert.equal(lastText(null, now), 'Never raided');
  assert.equal(lastText({ at: now - 3 * 3_600_000, won: true, loot: 1340 }, now), `Won, ${(1340).toLocaleString()} loot · 3h ago`);
  assert.equal(lastText({ at: now - 2 * 86_400_000, won: false, loot: 0 }, now), 'Lost · 2d ago');
  assert.equal(lastText({ at: now - 5 * 60_000, won: true, loot: 0 }, now), 'Won, nothing taken · 5m ago');
  assert.equal(travelText(725), '12m 05s');
});

test('send result: how many went, every skipped row with its plain reason, the cap note', () => {
  const list: Pick<RaidListDto, 'rows'> = { rows: [row(1), row(2, { name: 'Far Ruin' }), row(3), row(4)] };
  const res: RaidListSendResponse = {
    sent: 1,
    skipped: 3,
    results: [
      { rowId: 1, ok: true, movementId: 5, arriveAt: 99 },
      { rowId: 2, ok: false, reason: 'not_enough_troops', message: 'Only 4 Raiders are at home in Hillfort.' },
      { rowId: 3, ok: false, reason: 'target_protected' },
      { rowId: 4, ok: false, reason: 'press_cap' },
    ],
  };
  const s = summarizeSend(res, list);
  assert.equal(s.headline, '1 of 4 rows sent.');
  assert.deepEqual(s.skippedRows.map((r) => [r.rowId, r.name, r.text]), [
    [2, 'Far Ruin', 'Only 4 Raiders are at home in Hillfort.'],
    [3, 'Ruin 3', 'The village is still under protection.'],
    [4, 'Ruin 4', `Over the limit of ${RAID_LIST_SEND_CAP} rows per press. It waits for the next press.`],
  ]);
  assert.match(s.capNote ?? '', new RegExp(String(RAID_LIST_SEND_CAP)));
  // A row that is gone from the list still gets a line.
  const gone = summarizeSend({ sent: 0, skipped: 1, results: [{ rowId: 77, ok: false, reason: 'not_abandoned' }] }, list);
  assert.equal(gone.skippedRows[0]?.name, 'Row 77');
  assert.match(gone.skippedRows[0]?.text ?? '', /belongs to a player/);
  assert.equal(gone.capNote, null);
  assert.equal(summarizeSend({ sent: 0, skipped: 0, results: [] }, list).headline, 'Nothing was sent.');
  for (const code of ['invalid_target', 'march_limit', 'rate_limited', 'village_gone', 'other', undefined] as const) assert.ok(reasonText(code, undefined).length > 10, String(code));
});

// ---- The page ----------------------------------------------------------------------------------------------------------------------

let server: ViteDevServer;
let gameMod: { GameContext: React.Context<unknown> };
let viewMod: { RaidListsPanel: (p: { data: RaidListsResponse; desktop?: boolean }) => ReactElement };

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  gameMod = (await server.ssrLoadModule('/src/game.ts')) as typeof gameMod;
  viewMod = (await server.ssrLoadModule('/src/views/RaidListsView.tsx')) as typeof viewMod;
});

after(async () => {
  await server.close();
});

const home = { id: 100, name: 'Home', x: 0, y: 0, state: createPlayerVillage(1_000), feastAllowance: { max: 0, used: 0, left: 0 } } as unknown as OwnVillageDto;
const game = { village: home, villages: [home], now: 5_000_000, refresh: async () => undefined, toast: () => undefined };
const page = (data: RaidListsResponse, desktop = true): string =>
  renderToStaticMarkup(createElement(gameMod.GameContext.Provider, { value: game }, createElement(viewMod.RaidListsPanel, { data, desktop })));
const limits = { lists: 5, rows: 30, sendCap: RAID_LIST_SEND_CAP };
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

test('not entitled: the paid-extra note, and every button and field is disabled (no way to make a request)', () => {
  for (const desktop of [true, false]) {
    const html = page({ enabled: true, entitled: false, limits, lists: [] }, desktop);
    const plain = text(html);
    assert.match(plain, /Raid lists are a paid extra/);
    assert.match(plain, /never sell resources, troops or speed/);
    assert.match(plain, /nothing to buy yet/i);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.length >= 3, 'the controls are drawn');
    for (const b of buttons) assert.match(b, /disabled/, b);
    for (const f of html.match(/<(input|select)\b[^>]*>/g) ?? []) assert.match(f, /disabled/, f);
  }
});

test('entitled: rows are paged 8 on the desktop and 5 on the phone, ticked, with the numbers and the send label', () => {
  const list: RaidListDto = { id: 1, name: 'Ruins north', rows: rows(10) };
  const data: RaidListsResponse = { enabled: true, entitled: true, limits, lists: [list] };
  const d = page(data, true);
  assert.equal((d.match(/<li class="rdl-row/g) ?? []).length, 8);
  assert.match(text(d), /1–8 of 10/);
  assert.match(text(d), /Send 10 rows/);
  assert.equal((d.match(/type="checkbox" checked/g) ?? []).length, 8, 'every row on the page is ticked');
  assert.match(text(d), /Ruin 1 \(1\|-1\)/);
  assert.match(text(d), /Never raided/);
  assert.match(text(d), /12m 05s one way/);
  assert.match(text(d), /5\.3 fields|5\.2 fields/);
  const p = page(data, false);
  assert.equal((p.match(/<li class="rdl-row/g) ?? []).length, 5);
  assert.match(text(p), /1–5 of 10/);
});

test('entitled: a village that is no longer abandoned is greyed, says so, is not ticked and not counted', () => {
  const list: RaidListDto = { id: 1, name: 'Mixed', rows: [row(1), row(2, { abandoned: false }), row(3)] };
  const html = page({ enabled: true, entitled: true, limits, lists: [list] }, true);
  assert.match(html, /class="rdl-row is-gone"/);
  assert.match(text(html), /Now owned by a player\. Remove it\./);
  assert.match(text(html), /Send 2 rows/);
  const gone = html.split('<li class="rdl-row is-gone"')[1]?.split('</li>')[0] ?? '';
  assert.match(gone, /type="checkbox"[^>]*disabled/);
  assert.ok(!/type="checkbox" checked/.test(gone));
});

test('entitled without a list yet: invites to make one, the add form stays off until there is a list', () => {
  const html = page({ enabled: true, entitled: true, limits, lists: [] }, true);
  assert.match(text(html), /\+ New list/);
  assert.ok(!/Raid lists are a paid extra/.test(html));
  const newBtn = (html.match(/<button[^>]*>\s*\+ New list/) ?? [''])[0];
  assert.ok(!/disabled/.test(newBtn), 'making a list is possible');
  const add = (html.match(/<button type="submit"[^>]*>/) ?? [''])[0];
  assert.match(add, /disabled/);
});
