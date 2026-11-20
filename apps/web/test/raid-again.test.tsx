// "Raid again": pressing the button sends nothing. It opens the normal send screen on the report's target (the map tile panel) with
// the troop fields empty, and hands over the earlier troops for the "Same as last time" button, which fills them capped by what is at home.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyUnits } from '@clanfire/engine';
import type { SendAgainDto, Units } from '@clanfire/engine';
import { RaidAgainButton } from '../src/components/RaidAgain.tsx';
import { GameContext } from '../src/game.ts';
import type { GameApi, LastTime } from '../src/game.ts';
import { againLabel, lastTimeOf } from '../src/raidAgain.ts';
import { fillFromGroup } from '../src/troopGroups.ts';
import { selectableUnits } from '../src/villages.ts';

const g = globalThis as { fetch?: unknown };
const again = (units: Partial<Units>, o: Partial<SendAgainDto> = {}): SendAgainDto => ({
  fromVillageId: 100,
  mission: 'attack',
  x: 12,
  y: -4,
  targetName: 'Hillfort',
  units: { ...emptyUnits(), ...units },
  ...o,
});

test('labels: Raid again for an attack, Scout again for scouting', () => {
  assert.equal(againLabel(again({})), 'Raid again');
  assert.equal(againLabel(again({}, { mission: 'scout' })), 'Scout again');
});

test('pressing Raid again opens the send screen on the target and sends no request', () => {
  const calls: unknown[] = [];
  const real = g.fetch;
  g.fetch = async (...a: unknown[]) => {
    calls.push(a);
    return new Response('{}');
  };
  const shown: Array<{ x: number; y: number; options?: { mission?: string; lastTime?: LastTime } }> = [];
  const game = { showOnMap: (x: number, y: number, options?: { mission?: string; lastTime?: LastTime }) => shown.push({ x, y, options }) } as unknown as GameApi;
  let button: ReactElement<{ onClick: () => void }> | undefined;
  const Probe = () => {
    button = RaidAgainButton({ again: again({ raider: 120, pikeman: 5 }), variant: 'phone' }) as ReactElement<{ onClick: () => void }>;
    return null;
  };
  try {
    renderToStaticMarkup(createElement(GameContext.Provider, { value: game }, createElement(Probe)));
    assert.ok(button);
    button.props.onClick();
    assert.equal(calls.length, 0, 'nothing is sent by the button');
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0], { x: 12, y: -4, options: { mission: 'attack', lastTime: { units: { raider: 120, pikeman: 5 }, fromVillageId: 100 } } });
  } finally {
    g.fetch = real;
  }
});

test('the earlier troops are handed over without zeros; the send form starts empty (no counts come with them)', () => {
  const lt = lastTimeOf(again({ raider: 120 }));
  assert.deepEqual(lt, { units: { raider: 120 }, fromVillageId: 100 });
  assert.equal('counts' in lt, false);
});

test('"Same as last time" fills the report troops capped by those at home, and says what is short', () => {
  const lt = lastTimeOf(again({ raider: 120, pikeman: 5 }));
  const home: Units = { ...emptyUnits(), raider: 100, pikeman: 9 };
  const visible = selectableUnits('attack', home, false);
  const fill = fillFromGroup(lt.units, visible, home);
  assert.deepEqual(fill.counts, { raider: '100', pikeman: '5' });
  assert.equal(fill.short.length, 1);
  assert.match(fill.short[0] ?? '', /Only 100 of 120/);
});

test('"Same as last time" with nothing at home fills nothing', () => {
  const lt = lastTimeOf(again({ raider: 120 }));
  const home: Units = emptyUnits();
  const fill = fillFromGroup(lt.units, selectableUnits('attack', home, false), home);
  assert.deepEqual(fill.counts, {});
});
