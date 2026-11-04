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

**Tool:** `npm run sim` (`scripts/sim/balance.ts`, options `--days N --speed N --seed N --home x,y --out file --full --json`;
`--out docs/sim/<date>-<name>.txt` saves the report; since step 2 each style plays several villages, §7.5). It plays 30 days at
world speed 1 for four computer styles — **builder** (economy first), **raider** (raids abandoned villages from the
first day), **turtle** (Wall, Vault, defenders), **balanced** — through the real engine: `settleVillage`, `applyBuild`,
`applyResearch`, `applyTrain`, `applySend`, `resolveBattle`, `applyBattleToDefender`, `applyAttackerLosses`,
`applyReturn`. No server, no clock; luck comes from fixed seeds (`hashSeed`), so a run is repeatable. The engine test
`packages/engine/test/sim.test.ts` plays 1 day of every style and checks for errors and repeatability.

It reports per style and per day: resources, building levels and points, army size, attack and defence strength, raid
loot vs unit losses and raids won; the hour each building and unit is first affordable; and these flags: a style that
wins by far (score > 1.5x runner-up), dead periods (nothing worthwhile to do for > 8 h), units nobody trains,
resources at >= 90% storage for a quarter of the time, raids that cost more than they bring, risk-free raiding.

**Model assumptions** (printed at the end of every report; the one-village and never-refill parts below are the first version,
see §7.2 and §7.5 for what changed): one village per style, 10-minute decision steps, free-player
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

### 7.3 Pacing numbers and Renown (step 0 part 2, 2026-11-04), `docs/sim/2026-11-04-after-step0.txt`

**Why the baseline showed 0 raids (simulator bug, fixed).** (a) The training wheel let the cheapest unit win every race for
scarce wood, so raiders were almost never trained (raider style: 12 raiders, 285 pikemen) and the raid step had no raiders
to send. (b) The raider style spent all its wood on units and never built Barracks 2+. (c) A won battle costs the winner
about (defence/attack)^1.5 of its army, so the old 1.15x attack margin lost most of every raid; raids now pick the target by
net profit (loot minus dead units) per travel time and need 1.25x. Raiders now net a profit (loot 73k vs losses 51k in 30 days).

**What was changed (numbers only, `config.ts`):** wood was the binding resource while food and iron piled up, so unit costs
moved from wood to iron/food (pikeman 35/30/40, shieldbearer 30/40/75, raider 50/40/70, outrider 80/100/180, knight
130/150/320 + 30 gold, pathfinder 20/30/40); Banner Hall (new, max 4) requires Hall 7, Drillyard 2, Market 2, Storehouse 6
and costs 2,500 x3 + 100 gold; Renown numbers in GAME_DESIGN §18.2. Upkeep 0.25, the 20% refill and the repeat-raid limit were
re-checked and kept (raiding stays clearly below building: raider 3.3k score vs builder 7.7k; the refill keeps one village from
being farmed). Stables and Drillyard are reached by day ~4-6 (they were never affordable: the sim styles now build them).

| | before (baseline) | after step 0 |
|---|---|---|
| builder vs runner-up | 9.9x | 1.15x (builder 7,700 vs balanced 6,696; score now counts Renown, army, net raid) |
| longest dead stretch | 372 h (builder) | 70 h (builder, from day 16: nothing left in its script but max-level buildings); turtle 13 h; raider 1.3 h; balanced 4.7 h. **Still above the 8 h target for builder and turtle.** |
| units trained by nobody | 4 of 6 | 0 (knight only by the builder, day 12; outrider by raider and balanced) |
| Stables / Drillyard first affordable | never | day 4.3-5.7 / day 3.7-5.7 |
| 2nd village (Renown 500 + Banner Hall 1) | n/a | raider day 20.4 (Renown alone day 14.5), balanced 18.6, builder 21.5, turtle not within 30 days in the script (it almost never holds a Feast; with Feasts about day 28-30) |

**What feels different for players:** *faster*: armies and early military (cheaper wood-light units), Stables/Drillyard
appear in the first week, builders get Renown from the first level on. *Slower*: nothing existing except raiding one village
over and over (step 0 part 1). *New*: Renown pace is about 3 weeks to a second village. **Open:** a pure defender is slowest
(about 5-10 days after the raider, close to the target but not proven by the sim), the builder's late-game idle stretch needs
more sinks (higher max levels), and food piles up for the weaker styles (Farm/storage balance).

### 7.4 Defender Renown trickle and terrain travel (steps 0 part 3 and 1, 2026-11-04)

Files: `docs/sim/2026-11-04-after-step0.txt` (before, the run of 7.3), `docs/sim/2026-11-04-after-trickle.txt` (trickle on, terrain
switched off by setting `TERRAIN_MAX_SLOWDOWN` to 1 for that run), `docs/sim/2026-11-04-after-terrain.txt` (both on, the final
numbers), `docs/sim/2026-11-04-after-terrain-home-m10.txt` (same, village on another start tile). The sim now places the eight
abandoned villages in eight directions around the village at (-30, -10), a start tile where foot units lose about 9% on the raid
routes (the world average for foot units); before, the targets all lay along the +x axis from (0, 0). That layout change moved the
balanced style from 18.6 to 19.1 days; everything else in the first column below is the 7.3 run.

**Defender trickle** (owner approved; `DEFENDER_RENOWN_PER_DEFENCE` 0.006, `DEFENDER_RENOWN_DAILY_CAP` 22, rule in GAME_DESIGN 18.2
source 4). First try 0.005 / 20 gave the pure defender day 27.0; the final numbers give day 25.4.

| 2nd village (Renown 500 and Banner Hall 1), days | before (7.3) | after trickle | after trickle + terrain |
|---|---|---|---|
| raider (target 19-20) | 20.4 | 20.4 | **20.4** |
| turtle = pure defender, never attacked (target 24-26) | not within 30 days | 25.4 | **25.4** |
| balanced | 18.6 | 19.1 | 19.1 |
| builder (keeps an army at home) | 21.5 | 14.5 | 14.5 |
| score (points + 2 x Renown + army + net raid) builder / raider / turtle / balanced | 7,700 / 3,266 / 3,641 / 6,696 | 8,444 / 3,668 / 4,465 / 7,772 | same |

Where the Renown came from by day 30 (final run): turtle 633 = buildings 211 + trickle 412 + Feast 10; builder 1,098 = buildings 378 +
kills 238 + trickle 371 + Feast 110; raider 969 = buildings 120 + raids 538 + kills 203 + trickle 107; balanced 1,602.
**Finding for the owner:** the builder style (a large home army of Pikemen from day 4) now reaches the price on day 14.5 and waits for
nothing (its Banner Hall is built on day 7.3), so it is the *fastest* to the 2nd village, faster than the raider (day 20.4, waiting for
its Banner Hall). That is a consequence of rewarding any defence at home: a builder is a defender. If fighting should always be faster,
the cheapest levers are the daily cap (22) or a higher Banner Hall requirement; not changed, because the target for the pure defender
leaves no room to lower the trickle. The raider's pace is set by the Banner Hall (day 19.8-20.4), not by Renown (day 14.5).

**Terrain travel** (`TERRAIN_SPEED` as designed, 18.4a). World average on the default seed, villages 5-35 tiles apart: foot units 9%
slower, mounted 20%, pathfinders 3.5%, a mixed army about 12% (test `travel.test.ts`). **The sim's pace targets did not move at all:**
the raiders only ever hit the two nearest tier-1 villages (3 and 5 tiles, grass on both routes from this start tile), and the sim
decides in 10-minute steps, so even the 4% slowdown on another start tile (`--home -10,-10`) lands on the same step. Longer routes
(tiers 3-5, 8-14 tiles) lose 16-21% (table "Raid routes" in the report) but are not chosen: their raids cost more than the nearest
villages bring. So terrain makes the map matter for *where* a player settles and whom they can reach in time, not for the pace
targets (the raider style made 40 raids in 30 days, all on the two nearest villages). Check again when step 2 puts the first
second villages on the map.

**Dead stretches (unchanged, deliberately).** Builder 70.2 h from day 16, turtle 13.2 h. The owner's decision (2026-11-04): no
late-game sinks now; the idle stretch comes from the simulator having a single village, and new villages are the late-game sink.
**The idle stretch is re-measured after step 2, when the simulator models several villages.** Until then the DEAD PERIOD flags for
builder and turtle in the report are expected.

**What feels different for players:** *slower* travel by about 12% for an average mixed army (grass roads exactly as before; rough
ground up to 2.2 times the flat time); *faster* to the 2nd village for anyone who keeps troops at home (pure defender about day 25
instead of never within 30 days, builder about a week earlier). Nothing becomes unreachable.

### 7.5 Several villages in the simulator (step 2, 2026-11-05), `docs/sim/2026-11-05-after-step2.txt` (30 days), `docs/sim/2026-11-05-after-step2-45days.txt`

**What the sim does now** (`scripts/sim/balance.ts`; real engine calls: `villageRenownPrice`, `applyTrain` for the Chieftain, `checkStrike`,
`applyStrike`, `updateHold`, `applyOwnerChange`, `checkFoundTarget`, `createFoundedVillage`). Once Renown balance >= `villageRenownPrice` and a Banner Hall
exists, a style reserves the Renown and trains **one Chieftain at a time** (4,000/3,000/5,000 + 150 gold, 6 h). Then:
- **take** (raider, balanced): the whole home army + the Chieftain strike the abandoned village with the **most points** that it beats (attack >= 1.25 x
  defence in a preview with another seed, the Chieftain survives, survivors >= 150 population so the hold clock runs); the survivors hold 6 h; the village
  keeps all buildings, stock x 0.5. Before the Chieftain, a take style stops raiding and trains an escort of 158 fighters (raids burn the army). A
  Chieftain that finds no beatable village for 72 h founds instead.
- **found** (builder, turtle): Chieftain + up to 30 defenders walk to the nearest free buildable tile.
- Extra villages play the same style script (build list, army, research, raids, Feast) from their own start; production, building Renown and the defender
  trickle accrue per village; the assumed enemy raids hit every village outside founding protection.
- **Idle stretch (definition):** after the player has done everything the style wants at a 10-minute step, the longest time until the next step at which
  something useful is still possible in ANY village (a building, a batch of 10 units, a research, a Feast, a Chieftain). Reported for the whole run and for
  gaps that start on or after day 20. Target: under 8 hours.

| 30 days, speed 1 | builder | raider | turtle (pure defender) | balanced |
|---|---|---|---|---|
| Renown reaches 500 / Banner Hall 1 (unchanged, 7.4) | 14.5 / 7.3 | 14.5 / 20.3 | 25.4 / 7.8 | 13.6 / 18.9 |
| Chieftain queued | 14.9 | not within 30 days | 26.5 | 20.2 |
| 2nd village, **before** (7.4: Renown + Banner Hall only) | 14.5 | 20.4 | 25.4 | 19.1 |
| 2nd village, **after** (village really in hand) | **15.2, founded** | **not within 30 days** (day 41.9 in a 45-day run, taken) | **26.8, founded** | **20.7, taken (tier 1)** |
| 3rd village | day 34.9 (45-day run) | - | day 41.8 (45-day run) | 27.8, taken |
| villages on day 30 | 2 | 1 | 2 | 3 |
| points day 30 (all villages), before -> after | 4,288 -> 8,423 | 1,243 -> 1,067 | 2,136 -> 2,547 | 3,647 -> 7,957 |
| score, before -> after | 8,444 -> 13,504 | 3,668 -> 3,389 | 4,465 -> 4,912 | 7,772 -> 12,035 |
| **longest idle stretch, whole run, before -> after** | 70.2 h -> 7.3 h | 1.3 h -> 1.3 h | 13.2 h -> 6.0 h | 4.7 h -> 5.2 h |
| longest idle stretch starting after day 20 (after) | 2.0 h | 0.8 h | 2.2 h | 1.3 h |

**Idle stretch against the 8 h target: met.** The 70 h builder gap (nothing left to build after day 16) is gone: from the day the 2nd village exists
it has a whole village to build (the founded village reaches about 4,100 points in 15 days, the same as the home village did), and the next Chieftain
is saved for. The whole-run figures (7.3 h builder, 6.0 h turtle) are early-game gaps (hours 5 and 18, waiting for the first affordable
batch), not late-game idling. Caveat: "something useful" includes a batch of 10 cheap troops or a Feast, which are weak sinks; the real test is whether
players find those worthwhile. In the 45-day run the idle stretch after day 20 stays at or below 2.2 h for all four.

**Pace against the GAME_DESIGN 18.2 targets**
- **Pure defender (turtle): day 26.8**, target 24-26. About 1 day over: Renown is there on day 25.4 (unchanged), then 1.1 days to collect
  4,000/3,000/5,000 resources while it builds nothing else, 6 h of training and the walk. Route: founded. If 24-26 must hold, the cheapest lever is
  the Chieftain cost (e.g. wood 4,000 -> 3,000) or the defender trickle cap; owner decides.
- **Active raider: not met with the pure-raid script, met by the balanced style (day 20.7, taken).** The pure raider has Renown on day 14.5 and the
  Banner Hall on day 20.3, but its economy is small (48 building levels on day 21 against 138 for the builder's home village): it needs 158 fighters
  (its army sits around 120-150) AND about 12,000 resources for the Chieftain, and had neither by day 30. The balanced
  style, which is the same player with a real economy, hits day 20.7 and then a 2nd taken village on day 27.8 (3rd price 800 Renown). Read this as:
  **raiding as the only plan is too poor for conquest in the first month**; conquest rewards an economy plus an army. Levers if the owner wants the raider
  at day 19-20: lower `HOLD_MIN_POPULATION` (150) or allow a second wave of occupiers, a cheaper Chieftain, or let the Strike army carry loot home.
- Builder: founds on day 15.2 (Renown is what it waits for; saving up and walking add 0.7 days). Faster than any fighting style, as noted in 7.4.

**What the numbers say about the design**
- Founding is strong: a founded village starts with 40 points and was worth 4,100 points after 15 days, a taken tier-1 village is worth about 1,700
  points on arrival (2,000-3,000 by day 30). Taking is faster to a *useful* village for a balanced player; founding is slower per village but needs no
  fight, no escort and works for builder and defender, as intended (GAME_DESIGN 18.2 "expanding must be possible without fighting"). All taken villages
  in the sim had about the same points (the abandoned villages grow to the same cap), so "highest points" mattered little.
- The take route's real cost is the **150-population hold**, not the Chieftain: a style with a small army cannot hold at all, and it loses its raids
  while it builds the escort.

**Not modeled / simplified:** troops or resources sent between the player's villages (extra villages start from their own small stock, so founding is
if anything harsher than for a player who ships goods); a second hold wave (late occupiers); Chieftains trained in villages other than the first with a
Banner Hall; players as targets and real Strike defence (abandoned villages only in step 2); loot carried by the strike army (set to 0). The enemy raids
(4 x day raiders on every unprotected village, days 7-28) are an assumption: they hit weakly defended raider villages hard once the army stays home,
which is part of why the pure raider does not make it. **Nothing in `config.ts` was changed for this run.**
