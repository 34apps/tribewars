# Drillyard ranks: more of them, and ranks for the siege units (2026-11-18)

Owner, 2026-11-18: "Drillyard rank increase system is too limited, I should be able to rank more or what — check with Tribal Wars in our game balance; also there should be [ranks for the] ram etc., the newest troops we added recently."
Built on branch `claude/hungry-kapitsa-ba124a` (option 1 below, schema v32, not merged, not pushed). The other two options are a few constants away.

## In short

- **You were right: it was too tight.** A fully built Drillyard gave 30 points and a rank cost 1, 2, 3, 4, 5 points, so a village could max **2 tracks** (about 10 ranks). Built: **50 points and every rank costs 2**, so a village gets **25 ranks** (5 tracks maxed, or any mix). Early on it helps too: Drillyard 2 gives 5 ranks instead of 3.
- **The Log Ram and the Firecart get a rank track called Breach** (more siege power per rank). It is small on purpose: **+2% per rank, +10% at rank 5**. +6% per rank (+30%) made knocking down a Wall level 21-22 cheaper than rebuilding it, which breaks our own siege rule; the numbers are below.
- **Every rank now does something.** Ranks that never mattered are gone (Pikeman or Shieldbearer attack, Raider defence, Hearthwarden attack, Pathfinder defence). That leaves 10 tracks: Defence for Pikeman, Shieldbearer, Hearthwarden and Ember Guard; Attack for Raider, Elk Rider and Ember Guard; Scouting for Pathfinder; Breach for Log Ram and Firecart. The Hearthwarden (a support rider) keeps **Defence only**; the Chieftain stays unrankable.
- **Villages still differ.** All 10 tracks to the top would cost 100 points; a village has 50. So an attack village, a defence village and a siege village each pick their half.
- **Players already in a world lose nothing:** ranks on retired tracks are **refunded in full** (resources back, points free), and in the rare village that would be over its new point pool the highest ranks are trimmed **and refunded**. In the first 30 days the game gets **about the same speed** (raider/builder score ratio 1.87, was 1.81 without ranks in the sims).

## What the genre does (ratios and feel only; no names, numbers or formulas copied)

Looked up on public help pages by a cheap agent. **Verified:**
- Tribal Wars has three research modes (one step, three steps, ten steps per unit type) and the Smithy goes up to level 20. Ram and Catapult are both researchable in the ten-step mode. Each ten-step track costs about 1.6x the previous step, so the last steps are very dear. (https://support.innogames.com/kb/TribalWars/en_DK/1198, .../5273, .../5276, .../5312)
- Travian's Smithy gives a small percentage per level, scaled to the unit's upkeep: about +15% at level 20 for a 1-upkeep unit (a search snippet of its 2023 blog, not read in full).

**Could not verify:** how many unit types a village can finish at once; whether the printed ram numbers are percent or flat; what research does to rams against walls; research time; cost relative to village income; whether the upgrade is per village or per account (a Travian snippet says per village).

**Reading:** the genre lets a village improve *every* unit type, with a steep price on the last steps; the depth at the top is modest (about +15% to +50%). We were tighter on **breadth** (about 14% of all tracks could be maxed) and similar on depth (+25%). So the fix is breadth, not bigger bonuses: option 1 lets a village max about half of all tracks.

## Three options (the numbers a maxed Drillyard 10 village gets)

| | Today (before) | **Option 1 (built)** | Option 2 | Option 3 |
|---|---|---|---|---|
| Points | 3 per level = 30 | **5 per level = 50** | 6 per level = 60 | 3 per level + 1 per Town Hall level above 10 = 30 now, 45 at Hall 25 |
| Cost of ranks 1 to 5 | 1, 2, 3, 4, 5 | **2, 2, 2, 2, 2** | 1, 2, 3, 4, 5 | 2, 2, 2, 2, 2 |
| Ranks a village can buy | about 10 (2 maxed tracks) or 15 spread at rank 3 | **25** (5 maxed tracks) | 20 (4 maxed) or 30 spread at rank 3 | 15 now, 22 at Hall 25 |
| Share of all 10 tracks maxed | 20% (of 150 points of tracks) | **50%** | 40% | 30% now, 45% late |
| What the player feels | "I can max two things, the rest never happens" | "Every step costs the same, I plan 25 steps and a village is clearly an attack or a defence village" | "Like today but roomier; rank 5 stays a luxury, rank 3 everywhere is cheap" | "Old villages (big Town Hall) earn more ranks; a new Drillyard 10 village is no better off than today" |
| Typical attack village | Attack on 2 of 3 attackers (+25%) | Attack on Raider, Elk Rider and Ember Guard (+25% on all three, 30 points) and 20 more points (two more tracks) for Defence | the same three need 45 points, 15 left | the three need 30 points (late 45: three more steps) |
| Cost in resources for 5 maxed tracks | | 19,200 wood+food+iron and 300 gold (about 18 hours of a Lumber/Farm/Mine 16 village; gold about 14 hours) | the same | the same |
| Sims, 30 days: raider / builder score | 1.81 | 1.87 | 1.89 | 1.98 |
| 2nd village (builder / raider) | | day 27.7 / 26.2 | 27.7 / 28.0 | 27.5 / 24.1 |
| 90 days, 3rd village (builder / raider) | | 41.4 / 47.8 | 41.5 / 50.5 | 41.0 / 44.4 |
| Conquest (5 seeds x 90 days): takes / restarts / worst biggest-to-second | | 47 / 20 / 1.69 | 38 / 19 / 1.84 | 45 / 24 / 1.79 |

Targets (raider/builder 1.5-2x, 2nd village day 21-28, takes 30-50, restarts at most 26, worst ratio at most 2x) hold for all three. Option 3 sits right at the edge of the raider/builder limit (1.98) and the restarts limit (24 of 26).

**Speed for players:** options 1 and 3 make the game a little **faster** for fighters (more ranks sooner); option 2 is the closest to **the same**.

**Recommendation: option 1.** It is the easiest to explain ("every rank costs 2 points, you have 5 points per level") and it gives the owner's "rank more" without bigger bonuses.

## Ranks for the siege units and the new troops

| Unit | Tracks | Why |
|---|---|---|
| Log Ram | Breach | +2% siege power per rank on the Wall (during and after the battle) |
| Firecart | Breach | +2% siege power per rank on the building (or the Wall after the rams) |
| Hearthwarden | Defence | a support rider: attack 18, so Attack would be wasted; defence 48/52 is the point |
| Ember Guard | Attack + Defence | strong at both (140 / 90) |
| Elk Rider, Raider | Attack | defence is token (18/16 and 8/6) |
| Pikeman, Shieldbearer | Defence | attack is token (8, 12) |
| Pathfinder | Scouting | unchanged (+10% per rank) |
| Chieftain | none | no stat that a rank could improve |

Speed is **not** a rank for any unit (standing owner rule). Defence ranks on the siege units would do nothing (they only fight when attacked at home, with defence 1.7), so they do not exist.

**Why Breach is only +2% per rank (the one thing to decide, optional).** Siege rule: knocking a Wall level down must never be a bargain, rebuild cost under 2x the attacker's capital at every Wall level, Breach 5 included (`npm run sim -- --siege`):

| Breach per rank | at rank 5 | highest rebuild / capital (Wall 22) | holds? |
|---|---|---|---|
| 0 | none | 1.82 | yes |
| **+2% (built)** | +10% | 1.96 | yes |
| +3% | +15% | 2.06 | **no** |
| +6% | +30% | 2.30 | **no** |
| +4% **and** `SIEGE_POINTS_PER_LEVEL` 7 -> 8 | +20% | 1.91 (1.60 without ranks) | yes, but **every** siege then needs about 12% more rams, ranked or not |

If the owner wants Breach to feel as strong as Attack (+25%), the price is a harder siege for everyone; I did not do that without him.

## Existing worlds (schema v32, once, after the automatic backup)

- Ranks on a track a unit no longer has are removed; the resources paid for ranks 1..n **are refunded in full** (never above the storehouse); the points are free again.
- If a village then still has more points spent than its new pool, the highest rank of all loses its top rank (ties: the later unit) and gets that rank's resources back, until it fits. With 5 points per level this can only happen at a low Drillyard with many rank-1 tracks.
- Movements and stationed troops keep their stamped ranks; retired tracks simply do nothing in a fight.
- v31 is taken by another branch, so this is **v32**.

## How to switch the option (constants in `packages/engine/src/config.ts`)

| Option | `DRILLYARD_POINTS_PER_LEVEL` | `DRILLYARD_POINTS_PER_HALL_LEVEL` | `RANK_POINTS` |
|---|---|---|---|
| 1 (built) | 5 | 0 | `[2, 2, 2, 2, 2]` |
| 2 | 6 | 0 | `[1, 2, 3, 4, 5]` |
| 3 | 3 | 1 (from Hall `DRILLYARD_HALL_FROM` 10) | `[2, 2, 2, 2, 2]` |

The Drillyard page text, the point costs and the rank rows follow the constants. The one test that depends on option 1's exact numbers is the v32 migration test in `apps/server/test/rank-rework.test.ts` (which ranks the trim removes). Tracks per unit are `RANK_TRACKS_OF` (put Might back on the Pikeman there if wanted).

## Not verified

- No real browser (Safari) check; the layout was checked in headless Chrome (screenshots in `design/proposals/drillyard-ranks/`).
- The sim styles buy at most one rank per village per day and keep half the next building's price in reserve (`scripts/sim/ranks.ts`), so the Raider and Balanced styles (low Drillyard) use far fewer ranks than the pool allows: the sims show that the rework **does not break** the targets, not what a veteran player's full 50 points do. Watch real play.
