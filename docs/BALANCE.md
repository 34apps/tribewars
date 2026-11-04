# Balance review (2026-11-03) — pace, economy, and a conquest unit

Status: **review + proposal, no numbers changed yet.** Hand-computed from `packages/engine/src/config.ts`
(the agent run could not execute ad-hoc scripts, so nothing was simulated). Owner approves the proposal, then
an implementer applies it in `config.ts` and the tests are re-tuned.

## 1. Why it "gives 400 an hour" at the start

That is `npm run dev:fast`: world speed 10 multiplies everything (Farm 40/h × 10 = 400/h). At real pace
(`npm run dev`, speed 1) a new village makes **Lumber 30, Farm 40, Iron 30, Gold 0 per hour**, with 600/600/600/100
in stock and a 1,000 cap. Fast mode is a test tool; judge the pace at speed 1.

## 2. Speed-1 numbers today (formulas in config.ts)

| Level | Lumber/Iron per h | Storage cap | Lumber cost (wood) | Lumber build time (Hall 1 → Hall = level) |
|---|---|---|---|---|
| 1 | 30 | 1,000 | 50 | 6 min |
| 5 | 56 | 2,400 | 122 | 17 min → ~13 min |
| 10 | 123 | 6,900 | 372 | 64 min → ~40 min |
| 15 | 269 | 20,300 | 1,134 | 4 h → ~2 h |
| 20 | 591 | 59,600 | 3,470 | 14.6 h → ~5.5 h |

This is already the same shape as Tribal Wars (production ×1.17/level, cost ×1.25, time ×1.3): early levels
are minutes, level 20 is a day-scale goal, payback of a late upgrade is 50–80 h. **The building/production curve
is fine; do not change it.**

## 3. Real problems found

1. **Food upkeep caps armies far below the population cap.** Every troop eats 1 food/h. Farm L20 makes 591/h, so a
   village sustains ~590 troops, while the population cap at Farm L20 is ~2,980. Pop cap is never the limit; food
   is. Tribal-Wars-style wars (thousands of troops, conquest trains) are impossible. Proposal: **troop upkeep
   0.25 food/h per population point** (pikeman/guard/raider/pathfinder 0.25, outrider 0.75, knight 1) via
   `UNITS[x].upkeep` (it is already a number per unit, so only config + test expectations change). Then Farm L20
   feeds ~2,400 pop of troops, close to the cap, and the Farm level matters in both ways.
2. **No expensive late-game goal.** Points are the plain sum of building levels (max ≈ 200), so no building can
   stand out. Conquest needs one.
3. **Nothing tells neighbours a village is going for conquest.**

## 4. Proposal: conquest (original names)

- **Building: Banner Hall** (max level 3). Requires Town Hall 15, Drillyard 6, Market 5, Storehouse 14.
  Cost level 1: 15,000 wood / 12,000 food / 18,000 iron / 600 gold (×1.35 per level). Build time ~24 h at speed 1.
  Pop 20.
- **Weighted points** (`BUILDING_POINTS` in config.ts): most buildings 1–3 points per level, Banner Hall **60 per
  level** (so a Banner Hall village jumps ~+60 points at once, a visible spike in rankings and on the map).
  Map stages and ranking thresholds get re-spread (MAP_STAGE_MIN_POINTS ×~3).
- **Visibility:** the village's *recent builds* list (last 7 real days) shows in scout intel at Keen 4+ and the map
  tooltip shows a banner icon for 48 h after a Banner Hall level finishes. Neighbours get a warning window.
- **Unit: Standard-bearer** (trained only in the Banner Hall): cost 4,000 wood / 3,000 food / 5,000 iron / **150 gold**,
  train time 6 h each (÷ 0.94 per level), pop 8, upkeep 2 food/h, speed 4 (slowest unit; the army marches at his
  pace). Gold is the limiter: a max Gold Mine (L15, 90/h) pays for ~1.7 bearers a day.
- **Rule:** a battle won by the attacker with ≥1 bearer alive lowers the target's **Loyalty** (starts 100; each
  bearer −20..−30 random; +1/h regen, scaled by speed; cannot be hit during beginner protection). At ≤0 the village
  changes owner at Loyalty 25, buildings kept (Banner Hall and Wall reset to 0), the old owner's troops there are
  lost or sent home. Abandoned villages start at Loyalty 60. Must be implemented in the engine with tests
  (`resolveBattle` extension), server endpoint tests, and the security gate (SECURITY_ROADMAP §2/§4).
- A player's village limit should grow with Banner Hall levels so one player cannot snowball without limit.

## 5. Order of work

1. Owner approves §3.1 and §4 (or edits numbers).
2. Implementer: upkeep change + tests (small, first).
3. Weighted points + re-spread of map stages.
4. Banner Hall + Standard-bearer + Loyalty in engine, then server, then web (sprites are placeholders).

## 6. Balance simulator and results (2026-11-04)

**Tool:** `npm run sim` (`scripts/sim/balance.ts`, options `--days N --speed N --seed N --full --json`). It plays 30 days at
world speed 1 for four computer styles — **builder** (economy first), **raider** (raids abandoned villages from the
first day), **turtle** (Wall, Vault, defenders), **balanced** — through the real engine: `settleVillage`, `applyBuild`,
`applyResearch`, `applyTrain`, `applySend`, `resolveBattle`, `applyBattleToDefender`, `applyAttackerLosses`,
`applyReturn`. No server, no clock; luck comes from fixed seeds (`hashSeed`), so a run is repeatable. The engine test
`packages/engine/test/sim.test.ts` plays 1 day of every style and checks for errors and repeatability.

It reports per style and per day: resources, building levels and points, army size, attack and defence strength, raid
loot vs unit losses and raids won; the hour each building and unit is first affordable; and these flags: a style that
wins by far (score > 1.5x runner-up), dead periods (nothing worthwhile to do for > 8 h), units nobody trains,
resources at >= 90% storage for a quarter of the time, raids that cost more than they bring, risk-free raiding.

**Model assumptions** (printed at the end of every report): one village per style, 10-minute decision steps, free-player
queues; 8 abandoned villages (tiers 1–5, 3–14 tiles) whose garrisons never refill; loot and losses valued
wood+food+iron+10×gold; troop upkeep not valued; enemy raiders (4 × day) hit each village on days 7, 14, 21, 28.

**Results: NOT YET RUN.** The unattended session that wrote the simulator was not allowed to start it (only
`npm run check` and `npm run build` were permitted), so only the 1-day test run is verified. No numbers are invented
here. Next: run `npm run sim` once, paste the flags and the 7/14/30-day rows here, and derive suggested number
changes (config.ts only, nothing applied). Likely candidates, to be confirmed or dropped by the output: troop upkeep
0.25 (§3.1), a refill or cap for abandoned-village garrisons, knight cost/requirements, gold sinks if gold piles up.
