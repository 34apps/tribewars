# Balance review (2026-11-03) — pace, economy, and a conquest unit

Status (2026-11-04): §1–§4 were hand-computed from `config.ts`. **Upkeep 0.25 is applied** (§3.1, §7); the conquest
proposal in §4 is superseded by `GAME_DESIGN.md` §18 (Banner Hall with lower requirements, Chieftain, hold instead of
loyalty, owner approved 2026-11-04). The pacing tuning that needs the simulator is open: §7.3.

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

1. **Food upkeep caps armies far below the population cap.** (**Applied 2026-11-04, see §7.**) Every troop ate 1 food/h.
   Farm L20 makes about 790 food/h (config: base 40 × 1.17^19; the 591 first written here was for base 30), so a
   village sustained ~790 troops, while the population cap at Farm L20 is ~4,800 (150 × 1.2^19). Pop cap was never the
   limit; food was. Tribal-Wars-style wars (thousands of troops, conquest trains) were impossible. Now: **troop upkeep
   0.25 food/h per population point** (pikeman/guard/raider/pathfinder 0.25, outrider 0.5 because it takes 2 population,
   knight 1 because it takes 4) via `FOOD_UPKEEP_PER_POP` in `config.ts`. Farm L20 now feeds ~3,200 pop of troops;
   from Farm level 1 up, the population cap is the usual limit and food only binds while the Farm is level 0.
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

**Results:** the baseline run (before any change) is saved as `docs/sim/2026-11-04-baseline.txt`; §7 summarises it.
(Unattended runs may now start `npm run sim`; the first run that wrote this section could not.)

## 7. Step 0 of the conquest build order (GAME_DESIGN §18.7), 2026-11-04

### 7.1 What the baseline showed (`docs/sim/2026-11-04-baseline.txt`, 30 days, speed 1, before any change)

| style | points day 30 | longest dead stretch | units trained | notes |
|---|---|---|---|---|
| builder | 3,797 | **372 h** | pikeman 757 | wood/iron/gold full for 218–414 h of 720; Stables and Drillyard never built |
| raider | 201 | 68 h | pikeman 285, raider 12 | iron full 515 h; no raid reported (0 raids, 0 loot) |
| turtle | 332 | 35 h | pikeman 324 | iron full 536 h |
| balanced | 374 | 2.8 h | pikeman 397, raider 18 | iron full 526 h |

Flags: builder scores 3,977 against 402 for the runner-up (9.9x, the limit is 1.5x); four dead periods; Shieldbearer,
Outrider, Knight and Pathfinder trained by nobody; Stables and Drillyard "never affordable" for all four styles.
Open question about the tool itself: every style shows **0 raids** in the baseline, including the raider style. That
needs a look at `tryRaid` in `scripts/sim/balance.ts` (the target filter `attack > 1.15 x defence` or the 5-unit minimum
may never be met) before raiding numbers can be trusted.

### 7.2 What was changed (rules, tested, `npm run check` green)

| Change | Where | Pace for players |
|---|---|---|
| Troop upkeep 0.25 food per population point | `FOOD_UPKEEP_PER_POP`, `UNITS[x].upkeep` | **Faster**: the same Farm feeds up to four times more troops; the population cap becomes the limit |
| Abandoned-village garrisons refill 20% of full per 6-hour step | `NPC_GARRISON_REFILL_SHARE`, `village.ts` | **Slower** for raiders: a cleared village is defended again after about 30 h |
| Repeat raids by the same player on one abandoned village within 24 h carry 50%, 25%, 12.5% ... (floor 10%) | `NPC_REPEAT_*`, `repeatRaidLootFactor`, table `npc_raids` | **Slower** for farming one village over and over; raiding many villages, or waiting a day, is unchanged |
| Secret battle seed (128-bit server salt) | `battleSeed`, `meta.battle_salt` | Same pace; luck can no longer be predicted or fished for |

The simulator models the refill (it uses the real `settleVillage`) and the repeat-raid limit (`lootFactorAt`).

### 7.3 Not done yet: pacing numbers (step 0, item 4)

The run that made §7.2 could not start `npm run sim` (its command list is fixed when it starts), so **no pacing number
was changed and there is no "after" run**: tuning storage, costs or unit values without a run would be guessing.
`scripts/agent/run.ts` now allows `npm run sim`, so the next run can do it. Targets: no style above 1.5x the next, no dead
period above 8 h, every unit trained by at least one style, Stables and Drillyard reached within ~10 days for a focused player;
raiding should pay but not beat building. Levers (config.ts only): storage growth and Storehouse cost (builder's wood/iron/gold
sit at the cap), Stables/Drillyard requirements and cost (hall 5 + barracks 3 and ~260/200/300 never affordable), Outrider and
Knight cost or research, Shieldbearer and Pathfinder value (nobody trains them), and a sink for the builder's idle hours.

| | before (baseline) | after step 0 |
|---|---|---|
| builder vs runner-up | 9.9x | not measured |
| longest dead stretch | 372 h (builder) | not measured |
| units trained by nobody | 4 of 6 | not measured |
| Stables / Drillyard first affordable | never | not measured |
