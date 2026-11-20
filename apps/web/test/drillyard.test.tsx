// Drillyard ranks page: one row per (unit, track) the unit really has, plain-words effects and the cost rule, all from the engine constants.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BREACH_BONUS,
  DEFAULT_WORLD,
  DRILLYARD_POINTS_PER_LEVEL,
  KEEN_BONUS,
  RANKABLE_UNITS,
  RANK_BONUS,
  RANK_MAX,
  RANK_POINTS,
  RANK_TRACKS_OF,
  UNITS,
  createPlayerVillage,
  pointsSpent,
  pointsTotal,
} from '@clanfire/engine';
import type { UnitId, VillageState } from '@clanfire/engine';
import type { GameApi } from '../src/game.ts';
import { RANK_GROUP_ORDER, nextRankPoints, pointsHint, pointsRuleText, rankCardUnits, rankCostRule, rankGroups, rankRows, trackBonusPct, trackEffect } from '../src/views/village/drillyardLogic.ts';

// The panel draws unit pictures (import.meta.glob), so it and the game context are loaded through Vite's SSR loader.
let server: ViteDevServer;
let GameContext: React.Context<GameApi | null>;
let DrillyardPanel: React.ComponentType<{ part?: 'research' | 'ranks' }>;
let DrillPoints: React.ComponentType;

before(async () => {
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ GameContext } = await server.ssrLoadModule('/src/game.ts'));
  ({ DrillyardPanel, DrillPoints } = await server.ssrLoadModule('/src/views/village/Drillyard.tsx'));
});

after(async () => {
  await server.close();
});

const village = (over: Partial<VillageState> = {}): VillageState => {
  const v = createPlayerVillage(0);
  v.buildings.drillyard = 10;
  v.researched = RANKABLE_UNITS.filter((u) => UNITS[u].research);
  v.resources = { wood: 9999, food: 9999, iron: 9999, gold: 9999 };
  return Object.assign(v, over);
};

const render = (live: VillageState): string =>
  renderToStaticMarkup(
    createElement(
      GameContext.Provider,
      { value: { live, now: 0, settings: DEFAULT_WORLD, village: { id: 1 }, applyVillage: () => {}, toast: () => {}, refresh: async () => {}, firstSteps: undefined } as unknown as GameApi },
      // As on the desktop page: the points bar (the Ranks panel's header) above the rank rows
      createElement(Fragment, null, createElement(DrillPoints), createElement(DrillyardPanel, { part: 'ranks' })),
    ),
  );

test('rows: only the tracks a unit really has, in page order, a unit with two tracks gets two rows', () => {
  const rows = rankRows(RANKABLE_UNITS);
  assert.equal(rows.length, RANKABLE_UNITS.reduce((n, u) => n + (RANK_TRACKS_OF[u]?.length ?? 0), 0));
  const of = (u: UnitId) => rows.filter((r) => r.unit === u).map((r) => r.track);
  assert.deepEqual(of('pikeman'), ['bulwark']);
  assert.deepEqual(of('hearthwarden'), ['bulwark']);
  assert.deepEqual(of('raider'), ['might']);
  assert.deepEqual(of('knight'), ['might', 'bulwark']);
  assert.deepEqual(of('pathfinder'), ['keen']);
  assert.deepEqual(of('logram'), ['breach']);
  assert.deepEqual(of('firecart'), ['breach']);
  assert.deepEqual(of('chieftain'), []);
  assert.equal(rows.filter((r) => r.first).length, RANKABLE_UNITS.length, 'one picture per unit');
});

test('the Log Ram and Firecart show up once researched, the Chieftain never', () => {
  assert.ok(!rankCardUnits(village({ researched: [] })).includes('logram'));
  const all = rankCardUnits(village());
  for (const u of ['logram', 'firecart', 'hearthwarden'] as const) assert.ok(all.includes(u), u);
  assert.ok(!all.includes('chieftain'));
  assert.deepEqual(all, RANKABLE_UNITS.filter((u) => all.includes(u)), 'page order');
});

test('effect texts come from the constants', () => {
  assert.equal(trackEffect('might', 'raider'), `+${Math.round(RANK_BONUS * 100)}% attack per rank`);
  assert.ok(trackEffect('bulwark', 'pikeman').startsWith(`+${Math.round(RANK_BONUS * 100)}% defence`));
  assert.equal(trackEffect('keen', 'pathfinder'), `+${Math.round(KEEN_BONUS * 100)}% scouting per rank`);
  assert.ok(trackEffect('breach', 'logram').startsWith(`+${Math.round(BREACH_BONUS * 100)}% siege power per rank`));
  assert.ok(trackEffect('breach', 'logram').includes('Wall'));
  assert.ok(trackEffect('breach', 'firecart').includes('buildings'));
  assert.equal(trackBonusPct('breach', 3), Math.round(BREACH_BONUS * 3 * 100));
  assert.equal(trackBonusPct('might', 0), 0);
});

test('next rank cost: RANK_POINTS[rank], nothing at the top', () => {
  assert.equal(nextRankPoints(0), RANK_POINTS[0]);
  assert.equal(nextRankPoints(RANK_MAX - 1), RANK_POINTS[RANK_MAX - 1]);
  assert.equal(nextRankPoints(RANK_MAX), null);
});

test('the rule text states the real cost rule, not "rank 1 costs 1 point"', () => {
  const text = pointsRuleText();
  assert.ok(text.includes(`${DRILLYARD_POINTS_PER_LEVEL} points`));
  assert.ok(text.includes(rankCostRule()));
  assert.ok(!/Rank 1 costs 1 point/.test(text));
  assert.ok(text.includes('Reset gives the points back'));
  if (RANK_POINTS.every((c) => c === RANK_POINTS[0])) assert.equal(rankCostRule(), `Every rank costs ${RANK_POINTS[0]} points`);
});

test('the page renders a row per (unit, track) with effect, next cost and a Buy button', () => {
  const live = village();
  const html = render(live);
  const rows = rankRows(rankCardUnits(live));
  assert.equal((html.match(/class="drill-uc"/g) ?? []).length, rows.length);
  assert.ok(html.includes(`>${pointsTotal(live)}</strong> free`) || html.includes(String(pointsTotal(live))));
  assert.ok(html.includes('Buy Log Ram Breach rank 1'));
  assert.ok(html.includes('Buy Firecart Breach rank 1'));
  assert.ok(html.includes('Buy Hearthwarden Defence rank 1'));
  assert.ok(!html.includes('Buy Hearthwarden Attack'), 'a Hearthwarden has no Attack track');
  assert.ok(!html.includes('Buy Raider Defence') && !html.includes('Buy Pikeman Attack'));
  assert.ok(html.includes(`${RANK_POINTS[0]} pts`));
  assert.ok(html.includes(pointsRuleText().replace(/&/g, '&amp;')));
});

test('a bought rank shows pips, the bonus now, Reset with the refund, and Max at the top', () => {
  const live = village({ ranks: { logram: { might: 0, bulwark: 0, keen: 0, breach: 2 }, raider: { might: RANK_MAX, bulwark: 0, keen: 0 } } });
  const html = render(live);
  assert.ok(html.includes(`>+${Math.round(BREACH_BONUS * 2 * 100)}%</strong>`), 'the bonus reached sits beside the dots');
  assert.ok(html.includes(`Now +${Math.round(BREACH_BONUS * 2 * 100)}%`));
  assert.ok(html.includes('aria-label="Log Ram Breach rank 2 of 5"'));
  const back = RANK_POINTS[0]! + RANK_POINTS[1]!;
  assert.ok(html.includes(`aria-label="Reset Log Ram ranks (+${back} points back)"`), 'a part-bought rank has a round Reset icon button');
  assert.ok(html.includes(`title="Reset Log Ram ranks (+${back} points back)"`), 'with the same tooltip');
  assert.ok(html.includes(`aria-label="Reset Raider ranks (+${RANK_POINTS[0]! * RANK_MAX} points back)"`), 'a maxed card can be reset too');
  assert.equal((html.match(/class="drill-reset"/g) ?? []).length, 2, 'only cards with a rank bought get Reset');
  assert.ok(!/Reset \(\+|Reset \+/.test(html), 'no text link any more');
  assert.ok(html.includes('class="drill-max">Max<'));
});

test('not enough points: the row says how many are needed and the Buy button is off', () => {
  const live = village();
  live.buildings.drillyard = 1;
  // Put points into Pikeman Defence until fewer are free than the next rank of a fresh track costs.
  live.ranks = { pikeman: { might: 0, bulwark: 0, keen: 0 } };
  for (let r = 1; r <= RANK_MAX && pointsTotal(live) - pointsSpent(live) >= RANK_POINTS[0]!; r++) live.ranks.pikeman!.bulwark = r;
  const free = pointsTotal(live) - pointsSpent(live);
  assert.ok(free < RANK_POINTS[0]!, 'the setup leaves too few points');
  const html = render(live);
  assert.ok(html.includes(`Needs ${RANK_POINTS[0]} points · ${free} free`));
  const buy = html.match(new RegExp(`<button[^>]*Buy ${UNITS.guard.name} Defence rank 1[^>]*>`))?.[0] ?? '';
  assert.ok(buy.includes('disabled'), buy);
});

test('groups by role from RANK_TRACKS_OF: Defence, Attack, Scouting, Breach; the Ember Guard sits in two groups', () => {
  const groups = rankGroups(rankCardUnits(village()));
  assert.deepEqual(groups.map((g) => g.label), ['Defence', 'Attack', 'Scouting', 'Breach']);
  assert.deepEqual(groups.map((g) => g.track), [...RANK_GROUP_ORDER]);
  for (const g of groups) assert.deepEqual(g.units, RANKABLE_UNITS.filter((u) => RANK_TRACKS_OF[u]?.includes(g.track)), g.label);
  const names = (label: string) => groups.find((g) => g.label === label)!.units.map((u) => UNITS[u].name);
  assert.deepEqual(names('Defence'), ['Pikeman', 'Shieldbearer', 'Hearthwarden', 'Ember Guard']);
  assert.deepEqual(names('Attack'), ['Raider', 'Elk Rider', 'Ember Guard']);
  assert.deepEqual(names('Scouting'), ['Pathfinder']);
  assert.deepEqual(names('Breach'), ['Log Ram', 'Firecart']);
  assert.equal(rankGroups([]).length, 0, 'no empty groups');
  assert.equal(groups.reduce((n, g) => n + g.units.length, 0), rankRows(rankCardUnits(village())).length);
});

test('the page shows one labelled section per role and every card, both Ember Guards included, has a unit picture', () => {
  const html = render(village());
  const sections = html.split('<section ').slice(1).map((chunk) => chunk.split('</section>')[0]!);
  assert.deepEqual(sections.map((c) => c.match(/aria-label="([^"]+)"/)?.[1]), ['Defence ranks', 'Attack ranks', 'Scouting ranks', 'Breach ranks']);
  const cards = html.split('<li class="drill-uc">').slice(1).map((chunk) => chunk.split('</li>')[0]!);
  assert.equal(cards.length, rankRows(rankCardUnits(village())).length);
  for (const card of cards) assert.ok(/<svg|<img/.test(card.split('class="drill-who"')[0]!), `picture on every card: ${card.slice(0, 120)}`);
  assert.equal(cards.filter((c) => c.includes('>Ember Guard<')).length, 2);
  assert.ok(!/class="drill-tag is-[a-z]+">[^<]*<\/span><\/span><span class="drill-fx/.test(html), 'no role tag on the cards');
  // The same three rows on every card: top, dots + bonus, bottom (cost + Buy here)
  for (const card of cards) for (const part of ['class="drill-top"', 'class="drill-pr"', 'class="drill-bot"']) assert.ok(card.includes(part), part);
});

test('points hint says where more points come from', () => {
  assert.ok(pointsHint().startsWith(`+${DRILLYARD_POINTS_PER_LEVEL} per Drillyard level`));
  assert.ok(render(village()).includes('class="drill-phint"'));
});

test('an unbought card shows +0% muted, a maxed one the Max tag instead of Buy', () => {
  const html = render(village({ ranks: { raider: { might: RANK_MAX, bulwark: 0, keen: 0 } } }));
  assert.ok(html.includes('class="drill-bonus is-zero"'));
  assert.ok(!html.includes('Buy Raider Attack'));
});
