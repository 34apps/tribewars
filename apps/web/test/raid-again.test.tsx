// "Raid again": the decision (complete / partial / nothing at home / village gone), the words, and the one send call with the server's
// answer shown as it is. One press is one request (the useLock guard is covered in double-press.test.tsx; here the hook is pressed twice).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_WORLD, createPlayerVillage, emptyUnits } from '@clanfire/engine';
import type { OwnVillageDto, SendAgainDto } from '@clanfire/engine';
import { GameContext } from '../src/game.ts';
import type { GameApi } from '../src/game.ts';
import { useRaidAgain } from '../src/hooks/useRaidAgain.ts';
import type { RaidAgainCtl } from '../src/hooks/useRaidAgain.ts';
import { againLabel, decideAgain, homeTroops, missingText, sendAgain, unitsText } from '../src/raidAgain.ts';

const g = globalThis as { fetch?: unknown };
const again = (units: Partial<SendAgainDto['units']>, o: Partial<SendAgainDto> = {}): SendAgainDto => ({
  fromVillageId: 100,
  mission: 'attack',
  x: 12,
  y: -4,
  targetName: 'Hillfort',
  units: { ...emptyUnits(), ...units },
  ...o,
});

test('everything is at home: send at once, exactly what went before', () => {
  const d = decideAgain(again({ raider: 120 }), { raider: 150, pikeman: 9 });
  assert.deepEqual(d, { kind: 'send', units: { raider: 120 } });
});

test('some are missing: nothing is sent, the words say what and how many are at home, and what can go', () => {
  const d = decideAgain(again({ raider: 120 }), { raider: 100 });
  assert.equal(d.kind, 'partial');
  if (d.kind !== 'partial') return;
  assert.equal(d.text, 'Missing: 20 Raiders — 100 of 120 at home');
  assert.deepEqual(d.units, { raider: 100 });
  assert.deepEqual(d.missing, { raider: 20 });
});

test('several units: each short unit is listed; a single missing unit reads in the singular', () => {
  assert.equal(missingText({ raider: 120, pikeman: 3 }, { raider: 100, pikeman: 0 }), 'Missing: 3 Pikemen — 0 of 3 at home; 20 Raiders — 100 of 120 at home');
  assert.equal(missingText({ pathfinder: 5 }, { pathfinder: 4 }), 'Missing: 1 Pathfinder — 4 of 5 at home');
  assert.equal(unitsText({ raider: 100, pikeman: 1 }), '1 Pikeman, 100 Raiders');
});

test('nothing at home: say so, offer nothing to send', () => {
  const d = decideAgain(again({ raider: 120 }), { raider: 0, pikeman: 50 });
  assert.equal(d.kind, 'none');
  if (d.kind !== 'none') return;
  assert.match(d.text, /^Missing: 120 Raiders — 0 of 120 at home\. None of these troops are at home right now\.$/);
  assert.equal(Object.keys(d.missing).length, 1);
});

test('the sending village is not mine any more: no send, plain words', () => {
  const d = decideAgain(again({ raider: 5 }), null);
  assert.equal(d.kind, 'gone');
  assert.match(d.text, /not yours any more/);
});

test('home troops come from the village the report left from, settled to now; a stranger village gives null', () => {
  const state = createPlayerVillage(1_000);
  state.troops.raider = 42;
  const own = { id: 100, name: 'Home', x: 0, y: 0, state, feastAllowance: { max: 0, used: 0, left: 0 } } as unknown as OwnVillageDto;
  assert.equal(homeTroops([own], 100, 2_000, DEFAULT_WORLD)?.raider, 42);
  assert.equal(homeTroops([own], 999, 2_000, DEFAULT_WORLD), null);
});

test('button text: raid or scout', () => {
  assert.equal(againLabel({ mission: 'attack' }), 'Raid again');
  assert.equal(againLabel({ mission: 'scout' }), 'Scout again');
});

function mockFetch(handler: (url: string, body: unknown) => Response): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const real = g.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  g.fetch = async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  };
  return { calls, restore: () => void (g.fetch = real) };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('sendAgain posts the normal send call with the report target and shows the arrival', async () => {
  const m = mockFetch(() => json(201, { village: { id: 100 }, movement: { id: 7, arriveAt: 70_000 } }));
  try {
    const out = await sendAgain(again({ raider: 120 }), { raider: 120 }, 10_000);
    assert.equal(m.calls.length, 1);
    assert.match(m.calls[0]?.url ?? '', /\/api\/villages\/100\/send$/);
    assert.deepEqual(m.calls[0]?.body, { x: 12, y: -4, units: { raider: 120 }, mission: 'attack' });
    assert.equal(out.ok, true);
    assert.match(out.text, /^Raid sent to Hillfort\. Arrives in 1m 00s\.$/);
  } finally {
    m.restore();
  }
});

test('scout again sends a scout mission', async () => {
  const m = mockFetch(() => json(201, { village: { id: 100 }, movement: { id: 8, arriveAt: 31_000 } }));
  try {
    const out = await sendAgain(again({ pathfinder: 5 }, { mission: 'scout' }), { pathfinder: 5 }, 1_000);
    assert.equal((m.calls[0]?.body as { mission: string }).mission, 'scout');
    assert.match(out.text, /^Scouts sent to Hillfort/);
  } finally {
    m.restore();
  }
});

test('the server refusal is shown in its own words, never swallowed', async () => {
  const m = mockFetch(() => json(400, { error: 'invalid_target', message: 'That village is under protection.' }));
  try {
    const out = await sendAgain(again({ raider: 5 }), { raider: 5 }, 0);
    assert.deepEqual(out, { ok: false, text: 'That village is under protection.' });
  } finally {
    m.restore();
  }
  const net = mockFetch(() => {
    throw new TypeError('offline');
  });
  try {
    const out = await sendAgain(again({ raider: 5 }), { raider: 5 }, 0);
    assert.equal(out.ok, false);
    assert.match(out.text, /Cannot reach the server/);
  } finally {
    net.restore();
  }
});

function pressWith(villages: OwnVillageDto[], fetchHandler: (url: string) => Response, presses: (ctl: RaidAgainCtl) => void) {
  const m = mockFetch((url) => fetchHandler(url));
  const applied: unknown[] = [];
  const game = { villages, settings: DEFAULT_WORLD, now: 5_000, applySend: (r: unknown) => applied.push(r), village: villages[0] } as unknown as GameApi;
  let ctl: RaidAgainCtl | undefined;
  const Probe = () => {
    ctl = useRaidAgain();
    return null;
  };
  renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(Probe)));
  assert.ok(ctl);
  presses(ctl);
  return { m, applied };
}

test('pressing twice in one tick with every troop at home sends one request', async () => {
  const state = createPlayerVillage(1_000);
  state.troops.raider = 150;
  const own = { id: 100, name: 'Home', x: 0, y: 0, state } as unknown as OwnVillageDto;
  const run = pressWith([own], () => json(201, { village: { id: 100 }, movement: { id: 9, arriveAt: 65_000 } }), (ctl) => {
    ctl.press(1, again({ raider: 120 }));
    ctl.press(1, again({ raider: 120 }));
  });
  await new Promise((r) => setTimeout(r, 20));
  try {
    assert.equal(run.m.calls.length, 1);
    assert.equal(run.applied.length, 1, 'the new movement is applied to the game state once');
  } finally {
    run.m.restore();
  }
});

test('missing troops: pressing sends nothing at all', async () => {
  const state = createPlayerVillage(1_000);
  state.troops.raider = 100;
  const own = { id: 100, name: 'Home', x: 0, y: 0, state } as unknown as OwnVillageDto;
  const run = pressWith([own], () => json(201, {}), (ctl) => ctl.press(1, again({ raider: 120 })));
  await new Promise((r) => setTimeout(r, 20));
  try {
    assert.equal(run.m.calls.length, 0);
  } finally {
    run.m.restore();
  }
});
