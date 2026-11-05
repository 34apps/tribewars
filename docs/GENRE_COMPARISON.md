# Genre comparison: Clanfire vs Tribal Wars (2026-11-05)

Purpose: find balance problems and missing mechanics by comparing **how things work**. Rule (AGENTS.md):
never copy another game's names, numbers, formulas, texts or layouts. Their values below are context only;
our numbers come from our own simulator (`npm run sim`, `docs/BALANCE.md`).

Sources: Tribal Wars public world settings of one live world (en158: `interface.php?func=get_config`,
`get_unit_info`, `get_building_info`, read 2026-11-05), general genre knowledge (marked *genre*), and our
`packages/engine/src/config.ts` at `2af2d99`. The Tribal Wars help wiki refused automated access, so some
of their mechanics are from general knowledge, not a fetched page.

## 1. Per-world settings (biggest structural gap)

Tribal Wars publishes ~100 settings per world and many differ per world: world speed and a separate unit
speed, morale on/off, night bonus, beginner protection days, noble system (coins vs packets, distance limit),
optional units and buildings (archers, knight, church, watchtower), barbarian growth rate and max points,
haul limits, scavenging on/off, premium features on/off, win condition (domination %, world age, hold days,
other win modes), tribe size, account sitting, attack/support gaps, map size.

**Ours:** per-world today: speed, seed, radius, layout, id, name, domination settings. Everything else
(costs, unit stats, protection, NPC growth, hold times, Renown, siege, terrain, tribe size, sites) is the
same in every world (`config.ts`).

**Recommendation:** one `WorldConfig` per world, written into the world's database at creation (defaults
from `config.ts`, operator can set them with `lobby:admin` before the world opens), read everywhere
instead of the constants, and published read-only at `GET /w/<id>/api/world/config` (players and fan tools
can see the rules). Groups: pace (world speed, unit speed), protection, feature flags (siege, shrines,
scavenging, paid speed-ups, morale), NPC villages (density, growth rate, max level, stock), conquest (Renown
base and growth, chain window, hold times, lock), win condition, tribe limit. This also makes the planned
"special short world" a config, not code.

## 2. Mechanic by mechanic

| Area | Tribal Wars | Ours now | Verdict |
|---|---|---|---|
| Speed | world speed + separate unit speed | one speed for everything | Add unit speed per world. |
| Resources | 3 resources, per-level mines, warehouse, hiding place | 4 (gold extra), same model | OK. Gold makes us different. |
| Upkeep | none, farm = population | none (owner 2026-11-05), Farm = population | Same. **Food now has no sink** (piles up in every sim style): put more food into unit and Banner Hall costs. |
| Build levels | most buildings 20-30 | most 20, some 10-15 | OK (slower late game is fine). |
| Premium speed | build-time reduction, instant build, more (per world) | removed; owner plans a paid ~20% faster queue later | Make it a per-world flag; keep it modest (fair play is a selling point). |
| Units | ~10-12 classic units, optional archers/knight | 9 (incl. Chieftain, 2 siege) | OK. Sim: **nobody trains siege**; check costs. |
| Battle | attack vs weighted defence, wall bonus, luck, **morale**, **night bonus** (per world) | same core, luck ±10%, no morale, no night bonus (rest hours dropped) | Add **morale as a per-world option** (protects small players from big ones); night bonus stays out (owner). |
| Scouting | scouts, watchtower sees incoming troop types nearby | Pathfinders with 5 intel tiers | Ours is richer. Consider a **Watchtower**: shows what kind of army approaches (fits owner's "see Chieftains coming"). |
| Incoming attacks | shown at send, arrival time, slowest-unit speed tells the type | being built (Run A, 2026-11-05) | Same idea; good. |
| Barbarian / abandoned villages | grow points slowly, max points per world, no troop growth | grow buildings to level 10, start with 50% stock, no troop refill | **Too rich**: sim raider makes 38x the builder's loot and takes a 2nd village on day 10.7. Lower start stock and production of abandoned villages (per world), keep full loot (owner rule). |
| Loot | carry per unit; some worlds cap hauls | carry per unit, always full | OK; a per-world haul cap is an option if raiding stays too strong. |
| Resource gathering without a target | **scavenging**: send idle troops to collect resources | none | Likely what the owner meant by "resource gathering". Candidate feature, per-world flag. |
| Conquest | nobles lower loyalty per hit, several nobles in a fast train, loyalty regrows, coins/packets with rising cost | Chieftains (1-3 by size), Strike puts hearth out, **Hold** 6/12 h, Renown price x1.6 | Ours is different on purpose (hold gives defenders time). Chains of separate Chieftain attacks are in Run B. Hold times should depend on typical support travel time (Run B). |
| Siege | rams lower wall before battle; catapults hit a building after; min levels per building | Log Ram during battle, Boulder Sling after, Hall min 1 | Same idea, own numbers. Add **min level 1 for Farm and Storehouse** too (a village must keep working). |
| Protection | beginner days per world; vacation/sitting | 72 h beginner, 24 h found, 48 h restart, caretaker bot | Ours has the caretaker bot. **Account sitting / vacation mode** missing (players travel; a tribe-mate looks after the account). |
| Command ordering | minimum gap between attacks/supports, cancel window | deterministic order by arrival ms + id; 2 min cancel | OK (server-side, fair). |
| Market | player offers + premium exchange | shipments to own villages and friends only | **Player-to-player trading** missing (offers with ratios). |
| Tribes | size per world, wars, diplomacy | 30 members, allies/NAP/enemy, forum, chat | OK; make size per world. |
| World end | domination % + world age + hold days (per world), other win modes | domination 75% / 14 days / 6 months / min players (per world) | Same family, good. |
| Map objectives | some worlds add bonus villages or special win villages | Fire Shrines + Great Fire as bonus sites | Ours is distinctive. |

## 3. Balance problems found (from our sim, docs/BALANCE.md §9)

1. **Raiding too strong**: raider 2.57M loot vs builder 66k in 30 days; 2nd village day 10.7 (target 21-28
   after the owner's "harder expansion" decision). Fix: poorer abandoned villages (start stock, production),
   Renown base 1000 (Run B), check per-loot Renown (now 1/4000).
2. **Food has no use** since upkeep was removed: shift unit and Banner Hall costs toward food.
3. **Siege never trained** in any sim style: check cost and research gates; add siege to one sim style.
4. **Expansion too fast** overall vs the owner's wish: Run B (base 1000, chains, hold times).

## 4. Suggested order

1. Run B (conquest changes, already written).
2. Per-world `WorldConfig` (section 1).
3. Balance pass (section 3) with the sim, numbers into the per-world defaults.
4. New features, each a per-world flag, owner to pick: morale, Watchtower, scavenging, account sitting /
   vacation, player trading, siege min levels for Farm/Storehouse.
