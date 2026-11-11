# Originality pass — proposal (NEXT_STEPS item 15)

Written 2026-11-11. **Proposal only: nothing is built until the owner picks.** Folds in the two owner asks of the
same day: siege gets its own building, and the Farm is split (food vs population room).
Rules kept: attack and support only, no new trip types, no new battle formula, nothing copied from Tribal Wars (TW) or
Travian (names, numbers, formulas, art, text, screen layouts). TW numbers below are from memory of its public help
pages, only to show where we are too close; re-check before building, never reuse them.

## 1. Where Clanfire still mirrors Tribal Wars (honest list)

**Troops: same 9-slot shape** (2 defenders, 1 foot attacker, scout, light rider, heavy rider, ram, catapult, conqueror).
Worse, some stat lines are **identical**:

| Ours | TW twin | Same numbers? |
|---|---|---|
| Pikeman 10 attack / 15 vs foot / 45 vs riders | spear fighter | **identical** |
| Raider 40 / 10 / 5 | axeman | **identical** |
| Pathfinder 0 / 2 / 1 | scout | **identical** |
| Shieldbearer 15 / 45 / 25 | swordsman (25 / 50 / 15) | close |
| Outrider, Knight, Log Ram, Boulder Sling | light cav, heavy cav, ram, catapult | roles same, numbers ours |
| Chieftain | nobleman | ours (hold + Renown, ember) |

**Buildings: one-to-one map.** Town Hall = headquarters, Lumber Camp = timber camp, Iron Mine = iron mine,
Farm = farm (**sets population, exactly TW's farm job**), Storehouse = warehouse, Barracks = barracks, Stables = stable,
Wall = wall, Hidden Vault = hiding place, Market = market, Drillyard ~ smithy, Banner Hall ~ academy.
Ours alone: Gold Mine and the gold resource (Travian has food/crop, so food is not ours either).

**Numbers and curves:**
- Town Hall level-1 cost 90 / 80 / 70 growing x1.26 = TW headquarters, **identical**. Hall makes building 5% faster per level = TW.
- Lumber Camp and Barracks cost growth x1.25 / x1.26 = TW's factors.
- Production 30 per hour at level 1 growing x1.17 (TW ~x1.16); Storehouse 1,000 growing x1.24 (TW ~x1.23). **Near-identical.**
- Hidden Vault max 10 and Wall max 20 = TW. Other max levels are ours (20 instead of TW's 30, Market 10, Banner Hall 4).
- Ours already: gold, troops eat nothing, Renown, the hold, founding with an ember, troop ranks, 5 scout tiers, terrain travel.

## 2. Options per area (each says faster / slower / same for players)

### A. Troops
- **A1 Own numbers only.** Keep the 9 units; give every one fresh attack, defence, speed, carry, cost and population so no
  line matches TW. Art untouched. Small. *Same pace.*
- **A2 Own numbers + own look.** A1, plus riders on **elks** instead of horses (Outrider, Knight) and fire-theme siege
  (a **Firecart** look for the Boulder Sling). 3 unit sets redrawn. Medium. *Same pace.*
- **A3 New shape (recommended).** 8 units instead of 9, so the roster no longer maps slot for slot:
  - Foot: Pikeman (holds riders), Shieldbearer (holds foot), Raider (attacker), Pathfinder (scout); all new numbers.
  - **Elk Rider**: the only rider. Fast, carries the most (replaces Outrider).
  - **Ember Guard**: the gold elite, now **on foot**. Strong at attack and defence, slow (replaces the Knight).
  - **Firecart**: the only siege unit. During the battle it burns down part of the Wall (today's Log Ram step).
    After a win it burns one building you pick (today's Sling step). It uses the two siege steps we already have,
    so there is no new formula, and you have one siege unit to learn instead of two.
  - Chieftain unchanged.
  Bigger: needs a balance rerun (`npm run sim`) and 2 new unit art sets. *Same pace; simpler for players.*

### B. Buildings (the siege building and the Farm split live here)
- **B1 Add two, keep the rest.** New **Wrightyard** (siege only, own queue, levels 1–10, needs Barracks 5) and
  **Longhouse** (population room, the Farm's old job; Farm makes food only). Plus new numbers everywhere (see C).
  *A little slower: one more building to raise (~+2 builder-days to max a village).*
- **B2 Clan village (recommended).** B1, plus three changes so the list stops reading like TW's:
  - **Hidden Vault becomes the Root Cellar**, dug under the Storehouse. Same hiding rule, and it replaces the rock art the owner dislikes.
  - The **Gold Mine becomes a Gold Sluice** on a stream (panning). Same production, and it replaces the pyramid art.
  - The **Wall becomes a Palisade** (sharpened logs, then stone-footed at higher levels). Same rule.
  - With A3 the **Stables become Elk Pens**.
  *Same pace as B1.*
- **B3 Fewer, deeper buildings.** B2, plus the Barracks and Elk Pens merge into one **Muster Field** with two queues (foot,
  riders), so a village has 12 buildings, not 14. *Slightly faster (one building fewer to raise).* More UI rework.

### C. Max levels, costs, curves, economy
- **C1 Own numbers, same idea.** Every base cost, growth factor and production/storage curve redone so none equals TW;
  max levels stay. Engine numbers only, plus a sim run. *Same pace.*
- **C2 Tiered ladders (recommended).** Every building has **15 levels in 3 tiers of 5**. Tier 1 is built with wood,
  tier 2 needs iron, tier 3 needs gold. Each new tier also needs a Town Hall level. This matches the art stages we
  already draw (wood hut, stone, iron-banded), so the picture changes when the tier changes. Each level
  does more than today (15 steps instead of 20), and production and storage get our own curves. *Same total time to
  max a village (tuned with the sim); fewer, bigger clicks.*
- **C3 Food gets a real job.** On top of C1 or C2: troops cost mostly food, buildings mostly wood, weapons-heavy units
  iron, elite gold. One clear rule a player can learn in a minute. *Same pace; easier to plan.*

## 3. Art (Toy Diorama SVG only, no painted art)
- B1: new Longhouse and Wrightyard, 4 stages each (8 sprites).
- B2: + Root Cellar, Gold Sluice, Palisade (12 more; replaces the disliked Gold Mine and Vault art).
- A2/A3: Elk Rider, Ember Guard (A3) / Elk Knight (A2), Firecart: 4 poses + 1 icon each (15 sprites); the Log Ram set is
  retired under A3.
- C2: the 4 building stages become 3 tiers (stage 1 = tier 1, ...); existing art reused, a few touch-ups.
- One design agent at a time (opus), owner picks from a comparison sheet, as before.

## 4. Existing worlds (migration)
No real world is live yet (not deployed). So: **new rules apply to new worlds; the preview's Reset world gives a fresh
world.** Old test worlds get a safe automatic update so they don't break:
- Longhouse starts at the old Farm level (nobody loses room); a queued Farm level finishes as food.
- Wrightyard starts free at 1 if Barracks is 5+ (4 if Barracks 8+); siege already training at the Barracks finishes there.
- C2: levels mapped 20 -> 15 (level L becomes round(L x 0.75)); queued upgrades refunded.
- A3: Outriders -> Elk Riders, Knights -> Ember Guards, Log Rams and Slings -> Firecarts by population; queued batches refunded.

## 5. Suggested build order (each piece its own session, one at a time where files overlap)
1. **Numbers pass (C1 or C2)**: engine config + sim + BALANCE notes. No art.
2. **Farm split (Longhouse)**: engine, server migration, web, bots, sim. Art runs alongside in a design session.
3. **Siege building (Wrightyard)**, with the Firecart if A3 is picked.
4. **Building renames (B2)**: Root Cellar, Gold Sluice, Palisade; art.
5. **Troop roster (A1/A2/A3)**: engine + sim + art.
Pieces 2–5 all touch `config.ts` and the village scene, so they run one after another. Art can be drawn in parallel.

## Recommendation in one line
A3 + B2 + C2 (+ C3): a roster and village that no longer read like TW, with fewer and clearer pieces.
Pace for players stays about the same.

---

# DECIDED 2026-11-11 (owner): A3 + B2 + C2 (C3 not picked) — build spec

Lead's spec for the implementers. Internal ids stay where a role survives (only the shown name, text and art change), so
saved worlds, routes and tests keep working: `wall` = Palisade, `vault` = Root Cellar, `goldmine` = Gold Sluice,
`stables` = Elk Pens, `outrider` = Elk Rider, `knight` = Ember Guard. New ids: `longhouse`, `wrightyard`, `firecart`.
Removed ids: `logram`, `boulder` (migrated to `firecart`). Never use these Tribal Wars numbers (from memory): costs
90/80/70, 50/60/40, 200/170/90, 270/240/260, 50/100/20, 50/60/50; growth 1.26 / 1.25 / 1.163 / 1.2294 / 1.172; production 30
at level 1; storage 1,000 at level 1; any unit line 10/15/45, 25/50/15, 40/10/5, 0/2/1, 130/30/40, 150/200/80.

## Piece 1 — C2: 15 levels in 3 tiers, own curves
- Tiers: levels 1–5 = tier 1, 6–10 = tier 2, 11–15 = tier 3. Max levels: Town Hall, Lumber Camp, Farm, Iron Mine, Storehouse,
  Barracks, Palisade, Longhouse, Gold Sluice, Elk Pens, Root Cellar = 15; Market, Drillyard, Wrightyard = 10; Banner Hall stays 4.
- Tier costs: tier 1 costs wood + food only; tier 2 adds iron; tier 3 adds gold. Buildings whose cost already has gold
  (Elk Pens, Drillyard, Banner Hall, Wrightyard) pay gold from level 1. Every building gets a `baseCost.gold` used from tier 3.
- Tier gates: a tier-2 level (6+) needs Town Hall 5, a tier-3 level (11+) needs Town Hall 10 (the Hall itself is exempt).
  Shown as "Tier 2 needs Town Hall 5" on the building page and in the Town Hall list.
- Curves (rule: level 15 does what level 20 does today; own clean numbers):
  production level 1 = 36 wood / 48 food / 36 iron, growth ~1.222 (L15 ≈ 600 / 800 / 600); Gold Sluice so L15 ≈ today's L15 gold;
  level-0 trickle 6. Storage level 1 = 1,200, growth ~1.32 (L15 ≈ 60,000), level 0 = 900. Population room (Longhouse, piece 2)
  level 1 = 160, growth ~1.275 (L15 ≈ 4,800), level 0 = 120. Town Hall build speed x0.93 per level; training speed x0.92 per level.
  Palisade +7% defence per level, militia 20 + 20 per level. Root Cellar 15 levels, L15 hides what Vault L10 hides today.
  Building population growth 1.14; village points, building Renown and siege points per level rescaled so a maxed
  building counts as today.
- Costs and times: per building, own base numbers and growth so the total cost and total time to max each building are within
  ±5% of today (compute with a script, round to clean numbers, none equal to the list above). Unit unlock levels
  rescaled ~x0.75 (e.g. Barracks 8 -> 6). Abandoned-village levels x0.75. First-steps "level 2" steps unchanged.
- Old worlds: levels of buildings that had 20 levels map to round(L x 0.75) (min 1 if it was ≥1), queued building jobs for them
  are cancelled with a full refund. Others unchanged.
- Sim: `npm run sim` (+ conquest 90 d x 5 seeds); targets in BALANCE.md (raider 1.5–2x builder, 2nd village day 21–28).

## Piece 2 — Longhouse (Farm split)
- Longhouse (`longhouse`): sets population room (the curve above); starts at 1, max 15, no requirement, uses no population;
  cost/time like the Farm. Farm makes food only and uses population like the Lumber Camp. Siege floor 1 for Farm and Longhouse.
- Old worlds: Longhouse = current Farm level. A queued Farm level finishes as a Farm.
- First steps: add "Raise the Longhouse to 2". Tips, Farm text, abandoned villages (Longhouse = Farm level), bots, sim.

## Piece 3 — Wrightyard + Firecart
- Wrightyard (`wrightyard`): trains siege only, own queue; needs Barracks 5; max 10; training x0.92 per level; costs like the Elk Pens.
- Firecart (`firecart`, replaces Log Ram + Boulder Sling): Wrightyard 1, Drillyard research at 3. During the battle it burns the
  Palisade (today's ram step); after a won battle the survivors burn the building the sender picked (Palisade if none picked).
  Own numbers: attack 5, 7 vs foot, 5 vs riders, speed 3, carry 0, population 3, cost 180 wood 160 food 220 iron 10 gold,
  1,400 s. Same SIEGE_* step rules; max 2 levels per phase.
- Old worlds: Log Rams + Boulder Slings at home/away -> Firecarts by population (3 per ram, 2 per sling, rounded down /3);
  queued siege batches and research refunded; villages with Barracks ≥4 (post-remap) get Wrightyard 1 free.

## Piece 4 — B2 names and art hookup
- Palisade, Root Cellar ("dug under the Storehouse"), Gold Sluice (panning on a stream), Elk Pens: names, descriptions, tips,
  sprites wired in (art made by the design agent), Town Hall list order.

## Piece 5 — A3 troop roster (own numbers; attack / vs foot / vs riders, speed, carry, pop, cost w/f/i/g, train s)
| Unit | Where | Line | Notes |
|---|---|---|---|
| Pikeman | Barracks 1 | 8 / 14 / 40, speed 6, carry 12, pop 1, 35/45/25, 260 s | holds riders |
| Shieldbearer | Barracks 3 | 12 / 42 / 22, speed 5, carry 10, pop 1, 30/60/50, 320 s | holds foot; research Drillyard 1 |
| Raider | Barracks 2 | 36 / 8 / 6, speed 6, carry 28, pop 1, 45/70/45, 290 s | attacker |
| Pathfinder | Barracks 2 | 0 / 3 / 2, speed 18, carry 0, pop 1, 20/40/25, 170 s | scout |
| Elk Rider (`outrider`) | Elk Pens 1 | 65 / 18 / 16, speed 13, carry 75, pop 2, 70/160/120, 620 s | the only rider; research Drillyard 3 |
| Ember Guard (`knight`) | Barracks 8, Town Hall 8 | 70 / 60 / 60, speed 5, carry 20, pop 3, 90/180/200 + 25 gold, 1,100 s | gold elite ON FOOT (infantry); research Drillyard 6 |
| Firecart | Wrightyard 1 | piece 3 | siege |
| Chieftain | Banner Hall | unchanged | |
- Old worlds: Knights stay as Ember Guards 1:1 (now foot, pop 3); Knight batches queued at the Stables finish there.
- Sim: rerun all modes; tune only these lines if targets miss.

## Owner decision 2026-11-11 (later): more room for troops, genre-feel balance
- A maxed Longhouse (until piece 2: the Farm's room) holds **12,000** people (own curve: level 1 = 200, growth ~1.34; level 0 = 150).
- "Balance it like Tribal Wars" = the same *feel*, never their numbers: a maxed village can fill its 12,000 room with a mixed
  army in about **12–15 days of its own income**. Today it is ~19 days for only 4,792 room.
- Levers (tuned with the sim): production and storage at max about x1.5; building costs x1.5 with them, so building pace
  stays the same; troop costs about x0.55 (current units now, the A3 roster in piece 5). Targets in BALANCE.md still hold
  (raider 1.5–2x builder, 2nd village day 21–28); if raiding gets too strong, tune loot/carry, not the room.

## Owner changes 2026-11-11 (after seeing the art)
- **B2 mostly dropped:** Wall, Gold Mine and Stables keep their names and pictures. The Hidden Vault keeps its picture and is
  renamed **"Vault"** (drop the word "Hidden"). The Palisade, Root Cellar, Gold Sluice and Elk Pens art is not used.
- Longhouse and Wrightyard art is being redrawn: each stage must look clearly grander, and stage 4 (max level only) must be magnificent.
- Owner questioned the 15-level change (C2). It is on hold in the `originality-tiers` worktree until he chooses 20 or 15.
- 2026-11-11: owner approved the Longhouse and Wrightyard v2 art (`design/proposals/originality-art/longhouse-*.svg`, `wrightyard-*.svg`).
