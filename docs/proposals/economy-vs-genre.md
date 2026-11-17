# Economy vs the genre: room, income, time, points, pace

Written 2026-11-17 (branch `claude/hopeful-mccarthy-d05ed7`, local only, not merged, not pushed). Owner's question: "why the population is so small ... compare
the game to Tribal Wars, resources, units etc. but we shouldn't be the same, we might do better ... points, troops, buildings, time."
Scope here: room, income, storage, building costs and times, points, pace. Troops and battles, and the play experience, are other sessions' work.
Raw sim files: `docs/sim/2026-11-17-econ-*.txt`. The model that makes the tables: `npx tsx scripts/sim/econ-model.ts [--pop current|A|B|C|power]`.

## In short (for the owner)

- **The room is small where it matters most: the middle.** Today a village at half the ladder (Longhouse 13) has room for about 1,350 people, at three quarters
  about 4,000, and only the last ten levels bring the rest of the 12,000. A village at a quarter of the ladder fills its room in 3 days of its own income, so
  armies stop growing long before the village is done.
- **Recommended: more room in the middle, the same 12,000 at the top.** The room now grows as fast as the income does, so a village needs about 12 to 13 days of its
  own income to fill its room at every stage, from a quarter of the ladder to the top (today: 3 days at a quarter, 13 at the top). A Longhouse 15 holds 3,720 people
  instead of 1,940. Nobody in an old world loses room. Armies get bigger, so the game gets bigger, not faster.
- **One small speed-up:** a whole village takes 25 builder-days to finish instead of 27, a bit faster in the last levels only. The early game is unchanged.
- **Everything else was checked and left alone** (income, storage, prices, points, the Chieftain rule, pace): the numbers already meet the targets (2nd village day 26.5
  builder, 25.3 raider; raiders score 1.51x builders; the 20-player conquest test gives 37 takes and a worst ratio of 1.73).
- **The genre comparison is thin on purpose.** Only building prices and unit sizes could be confirmed from the public help pages; production, storage, build times, points and
  pace could not be found, and Travian could not be read at all. Those rows say "not verified". Nothing from either game is used as our number. Not pushed; you pick first.

## 1. What could and could not be checked

Reference game: Tribal Wars (TW), public help pages of InnoGames (`support.innogames.com/kb/TribalWars/en_DK/...`). The cost columns on those pages are three
bare numbers; **the order wood / clay / iron is inferred, not stated**. None of the pages names a world speed. **Reference only: no TW number is used in our config.**

| Topic | What the pages gave | Status |
|---|---|---|
| Building price by level (Headquarters, Timber camp, Clay pit, Iron mine, Warehouse, Farm) | 30 levels each (page /5288, /5324, /5327, /5330, /5336, /5333) | verified as numbers, column labels inferred |
| Max level | 30 for all six buildings | verified |
| Unit price and population (8 units, Nobleman) | pages /5249, /5252, /5255, /5261, /5264, /5270, /5273, /5276, /5282 | verified as numbers, column labels inferred |
| Production per hour, Warehouse capacity, Farm capacity | the pages say only "the higher the level, the more" | **not found** |
| Build time per level, Headquarters time factor | none (a third-party gist and a 2017 fan post exist; neither is official or complete) | **not verified** |
| Points per building, points of a full village | an official table exists but its building columns are pictures | **not found** |
| Days to a 2nd/3rd/4th village, days to fill a farm, days to build a village | the FAQ says "differs by world speed and playstyle" | **not found** |
| Noble rule (how many to take a village) | one surviving noble lowers loyalty; counts per world | not verified |
| Travian (all of it) | fandom wiki returns HTTP 402, kirilloid has an expired certificate, support.travian.com returns no text | **nothing read** |

Because production and capacity could not be read, no "hours of income per level" or "days to fill the farm" can be put next to the genre. What can be compared is the
**shape of the price curve** and the **price of a person in the army**, below, as ratios.

## 2. Population room by Longhouse level (item 1)

Today: `151 x 1.2^(L-1)`. The last ten levels hold 84% of the 12,000. Three own curves, all reaching 12,000 at level 25 (all keep level 0 = 120). A, B and C use the
same formula as today with a bigger start and a smaller growth factor, so the engine needs only two numbers. A power curve (`200 + 11,800 x ((L-1)/24)^1.9`, room 592 / 2,030 / 4,438 / 7,770 at
levels 5 / 10 / 15 / 20) is similar to B and C but needs a new formula in the engine and the web client, so it is not recommended.

| room at Longhouse level | 1 | 5 | 10 | 15 | 20 | 25 | old Longhouse 15 becomes |
|---|---|---|---|---|---|---|---|
| **today** `151 x 1.2^(L-1)` | 151 | 313 | 779 | 1,939 | 4,824 | 12,004 | 1,939 |
| **A, gentle:** `260 x 1.1731^(L-1)` | 260 | 492 | 1,094 | 2,431 | 5,401 | 12,000 | 2,431 (+25%) |
| **B, balanced:** `400 x 1.1522^(L-1)` | 400 | 705 | 1,432 | 2,909 | 5,908 | 12,000 | 2,909 (+50%) |
| **C, income-matched:** `720 x 1.1244^(L-1)` | 720 | 1,151 | 2,068 | 3,717 | 6,681 | 12,007 | 3,717 (+92%) |

Every level of A, B and C holds more than today, so in an old world nobody loses room and nobody has to be migrated (the engine computes the room from the level).

**How many days of the village's own income fill its free room with a mixed army** (35% Pikeman, 20% Shieldbearer, 25% Raider, 20% Elk Rider by population; cost per
person 20 wood / 31 food / 23 iron; every building at the same share of the ladder; nothing else bought; buildings use 77 to 221 of the room):

| share of the ladder | today | A | B | C |
|---|---|---|---|---|
| 25% (Longhouse 6) | 3.0 | 5.1 | 7.4 | **12.3** |
| 50% (13) | 5.5 | 7.4 | 9.2 | **12.5** |
| 75% (19) | 8.4 | 10.0 | 10.9 | **12.6** |
| 100% (25) | 12.7 | 13.1 | 12.7 | **12.8** |

Target: a maxed village fills 12,000 room in 12 to 15 days. All four meet it at the top. Only C meets it at every stage, which gives one rule a player can learn:
"a village always needs about two weeks of its own income to fill its room, whatever its size".

**Genre side-by-side for the army:** what one person of the army costs (all prices summed; population as the page says). Reference units 45 to 158 per person
(scout 60, spear 90, light cavalry 119, sword and axe 130, ram 140, heavy cavalry 158; catapult 103), so about 100 to 130 for the common ones. Ours 45 to 103 (Pathfinder 45,
Pikeman 56, Shieldbearer 75, Raider 85, Ember Guard 83, Elk Rider 93, Firecart 103), about 0.6 to 0.7 of the genre. The genre's farm capacity could not be read, so
the room itself cannot be compared. That is the troops session's number; it is why 12 days fills our room. Not changed here.

**Simulator results per option** (same seed 20261104, 30 and 90 days; raw files `econ-pop{A,B,C}-*`):

| | 2nd village day builder / raider / balanced | raider / builder score (30 d) | conquest, 20 players, 5 seeds, 90 d: takes / restarts / worst biggest-to-second |
|---|---|---|---|
| today | 26.6 / 23.7 / 18.8 | 1.60 | 37 / 21 / 1.47 |
| A | 26.6 / 23.8 / 19.1 | 1.57 | not run at 90 d (30 d: 32 / 12 / 1.67) |
| B | 26.6 / 25.3 / 19.3 | 1.57 | 41 / 22 / 1.79 |
| C | 26.6 / 26.1 / 19.3 | 1.51 | 43 / 18 / 1.67 |

All meet the targets. The builder does not change (a builder never fills its room). The raider moves later and scores a little lower because it spends on troops instead of buildings.

**Not what the sim shows:** the computer players sit at 90% of storage for 12,000 to 13,000 player-hours in 90 days whatever the room curve (13,341 today, 12,399 now). The room is not
what stops them: training time and the training queue are (BALANCE 13: one Barracks needs 10 to 13 days for 11,700 population). That belongs to the troops session.

## 3. Income, storage, prices, time (item 2)

Villages with every building at the same share of the ladder, speed 1, current numbers (none changed, except the room and the Town Hall time):

| share | Lumber level | wood / food / iron per hour | gold per hour | storage per resource | average price of the next level (wood+food+iron) | hours of the village's income per level | hours to fill storage |
|---|---|---|---|---|---|---|---|
| 25% | 6 | 97 / 129 / 97 | 5 | 4,066 | 713 | 2.2 | 42 |
| 50% | 13 | 221 / 294 / 221 | 8 | 12,723 | 2,770 | 3.8 | 58 |
| 75% | 19 | 446 / 595 / 446 | 16 | 33,826 | 8,893 | 6.0 | 76 |
| 100% | 25 | 902 / 1,203 / 902 | 27 | 89,931 | 23,557 | 7.8 | 100 |

Reading it: a level costs 2 hours of the village's income early and 8 hours late; storage holds 2 to 4 days of production, so a player who logs in twice a day never overflows,
and raiders can take what is not hidden. The whole village (every level of every building) costs 1.56 million (wood + food + iron + 10 x gold), which is 21 days of a maxed village's income.

**Time to max a village (one builder, Town Hall at 25 for the whole run, speed 1):** 27.2 days today (the Longhouse and Wrightyard added 2.5 days to the 24.8 of BALANCE 13). Target about 25.
**Change: `HALL_TIME_FACTOR` 0.96 -> 0.9566** gives **25.0 days**. It matters only for the late levels (Town Hall 15 builds 5% faster, Town Hall 25 8% faster); an early village is unchanged.
A builder that must also earn every resource, with the Town Hall climbing as it goes and no troops, needs about 71 days, so income, not build time, sets the real pace. Raiding and
loot are what shorten it (the sim raider has 3 villages at day 90).

**Genre side-by-side for prices.** Price of a level divided by the price of level 2, wood column, at the same share of the ladder (TW pages list levels in steps of 5; ours is matched by share):

| share of the ladder | 17% | 33% | 50% | 67% | 83% | 100% |
|---|---|---|---|---|---|---|
| TW Timber camp (levels 5 / 10 / 15 / 20 / 25 / 30) | 1.9x | 5.9x | 18x | 55x | 168x | 513x |
| TW Headquarters | 2.0x | 6.4x | 20x | 64x | 204x | 648x |
| our Lumber Camp (levels 4 / 8 / 13 / 17 / 21 / 25) | 1.5x | 3.1x | 7.9x | 16.7x | 35.5x | 75.3x |
| our Town Hall | 1.5x | 3.5x | 9.8x | 22x | 51x | 117x |

The genre's price curve is steeper: its last level costs 500 to 650 times its second, ours 75 to 117 times. Without its production curve (not found) this cannot be turned into hours of income.
Feel: our late levels are cheaper relative to the start, so the late game is held back by build time, not by resources, and that is by design (25 builder-days). **No change recommended**:
the price curve is ours and meets the targets. Max level: 30 in the genre, 25 here.

## 4. Points and the Chieftain rule (item 3)

A building level is worth `BUILDING_POINTS_BASE x 1.2^(L-1)` points, so points follow the price of the level (price grows 1.207 per level): **a level is worth about the same points per resource spent at every stage.**

| share of the ladder | points of the village | share of a maxed village | Chieftains needed (1 + floor(points / 12,000), max 3) |
|---|---|---|---|
| 25% | 973 | 3% | 1 |
| 50% | 3,747 | 12% | 1 |
| 75% | 11,250 | 36% | 1 |
| 77% to 93% | 12,000 to 24,000 | 38% to 77% | 2 |
| 100% | 31,265 | 100% | 3 |

- The last quarter of the ladder holds 64% of the points. A half-built village is only 12% of a maxed one; rankings in the first weeks are decided by how many villages and how fast, not by
  the top levels. That is intended: points follow the money.
- A maxed village needs 3 Chieftains to take; a village between 77% and 93% needs 2; everything below needs 1. The 12,000 step was set from the 30-to-50-takes target (BALANCE 13.3) and still gives 37 takes.
- Genre: points per building could not be read (see section 1). **No change recommended.** Changing the points formula would also move the morale rule (points share), Renown size factors and the map pictures.
- **Follow-up for the owner (art, not touched here):** the map picture stages start at 0 / 100 / 300 / 800 / 1,800 / 3,500 points (`MAP_STAGE_MIN_POINTS`). A village at half the ladder (3,747) is already
  stage 6, the "Castle", so the second half of the ladder adds no new picture. Scaling the steps about x3 (for example 0 / 300 / 900 / 2,400 / 6,000 / 12,000) would stretch the stages over the whole ladder. It changes what the map shows, so it needs your OK.

## 5. Pace (item 4)

Day on which a computer player gets the Nth village (one player per style, 90 days, speed 1; today -> now). "-" = not within 90 days.

| | builder | raider | turtle | balanced |
|---|---|---|---|---|
| 2nd village | 26.6 -> 26.5 | 23.7 -> 25.3 | - | 18.8 -> 19.3 |
| 3rd village | 40.3 -> 40.2 | 47.8 -> 50.6 | - | 35.3 -> 36.4 |
| 4th village | 56.4 -> 56.3 | - | - | 57.2 -> 58.5 |
| villages at day 90 | 5 -> 5 | 3 -> 3 | 1 -> 1 | 4 -> 4 |
| points at day 90 | 24,740 -> 24,740 | 14,408 -> 13,233 | 2,775 -> 2,775 | 31,311 -> 31,021 |

In the crowded 20-player world (5 seeds, 90 days, averages over players that got one): 2nd village builder day 70 (17 of 25), raider day 40 (7 of 25), balanced day 18 (24 of 25);
3rd: 76 / 45 / 34; 4th: balanced day 54 (14 of 25). Genre pace (guides, typical days to a 2nd village) was not found on any public help page, so there is no side-by-side. Targets: 2nd village
day 21 to 28 (builder and raider: met; balanced is 19, as before and by design, it takes an abandoned village on day 19).

## 6. Recommendation (own numbers, effect on players)

| change | before -> after | effect |
|---|---|---|
| `POP_CAP_BASE` | 151 -> **720** | more room, same pace |
| `POP_CAP_GROWTH` | 1.2 -> **1.1244** (= the production growth, room at Longhouse 25 still 12,000) | bigger armies at the middle levels; the game gets bigger, not faster |
| `HALL_TIME_FACTOR` | 0.96 -> **0.9566** | slightly faster (whole village 27.2 -> 25.0 builder-days, late levels 5-8%) |
| production, storage, prices, points, Chieftain rule, pace | unchanged | same |

Why C and not A or B: C is the only curve with one rule (fill time about 12.5 days at every stage), gives the biggest mid-game gain (+120% room at Longhouse 13, +92% at 15) and passes all
targets. Its one weak spot is the raider / builder score of 1.51 (target 1.5 to 2). If another change pushes it under, the known lever is `NPC_PRODUCTION_FACTOR` (0.45 up to 0.48 raises the
raider; players are not affected). B is the safer middle (1.57) if you want more margin. Switching is two numbers in `config.ts`.

Not changed, on purpose: income and storage curves (meet 12 to 15 days at the top), building prices, points, Chieftain rule. Not touched: troops, training times, Wall, siege, UI.

## 7. Sim results of the recommendation (seed 20261104 and 20261105 to 20261109)

| target | today | now | met |
|---|---|---|---|
| raider / builder score, 30 days | 1.60 | **1.51** | yes (1.5 to 2) |
| 2nd village day, builder / raider | 26.6 / 23.7 | **26.5 / 25.3** | yes (21 to 28) |
| conquest, takes (5 seeds, 90 d) | 37 | **37** | yes (30 to 50) |
| conquest, restarts | 21 | **21** | yes (not above 26) |
| conquest, worst biggest / second | 1.47 | **1.73** | yes (<= 2) |
| days of own income to fill the 12,000 room | 12.7 | **12.7** | yes (12 to 15) |
| days to max a village | 27.2 | **25.0** | yes (about 25) |

Raw: `docs/sim/2026-11-17-econ-baseline-{30d,90d,conquest90-5seeds}.txt` (before), `...-econ-final-{30d,90d,conquest90-5seeds}.txt` (now), `...-econ-pop{A,B,C}-*` (options; the
`conquest30d` files are 30-day conquest runs). Score 30 days now builder 10,615, raider 16,022, turtle 4,190, balanced 24,749 (before 10,611 / 16,926 / 4,708 / 25,634); DOMINANT STYLE balanced 1.54x the raider (was 1.51x).

## 8. Open points and follow-ups

- Training time, not room, limits how fast the computer players' armies grow (pile-ups unchanged). Troops session.
- Map picture stages should be stretched over the 31,000-point ladder (section 4). Owner's call.
- Raider / builder 1.51 is at the low end; lever `NPC_PRODUCTION_FACTOR` (section 6).
- The genre side-by-side for production, storage, build times, points and pace needs a person with access to a running speed-1 world or the blocked wiki pages.
- The model's "builder with real income" figure (71 days) uses a simple build order (lowest share first); it is a rough guide, not a sim result.

## 9. Sources (public pages read 2026-11-17; numbers used as reference only)

- Headquarters prices: https://support.innogames.com/kb/TribalWars/en_DK/5288/Headquarters
- Timber camp, Clay pit, Iron mine, Warehouse, Farm (prices): .../5324/Timber-camp, .../5327/Clay-pit, .../5330/Iron-mine, .../5336/Warehouse, .../5333/Farm
- Units (price, population): .../5249/Spear-fighter, .../5252/Swordsman, .../5255/Axeman, .../5261/Scout, .../5264/Light-cavalry, .../5270/Heavy-cavalry, .../5273/Ram, .../5276/Catapult
- Nobleman: .../5282/Nobleman; FAQ (pace differs by world speed): .../5970/FAQ--Game-Mechanics--Features
- Not read (blocked or empty): tribalwars.fandom.com (HTTP 402), forum.tribalwars.net and help.tribalwars.net (connection reset), travian.fandom.com (402), travian.kirilloid.ru (expired certificate), support.travian.com (no text).
