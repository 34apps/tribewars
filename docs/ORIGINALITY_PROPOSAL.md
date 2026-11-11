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
