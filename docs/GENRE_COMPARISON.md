# Genre comparison: Clanfire vs Tribal Wars (2026-11-05)

Purpose: understand the genre leader completely, then decide what Clanfire keeps, adds, does differently or
avoids. **Rule (AGENTS.md): never copy another game's names, numbers, formulas, texts or screen layouts.**
Their mechanics are described for understanding; our numbers come only from our simulator.

Sources (2026-11-05): Tribal Wars world 158 settings page and public config files; InnoGames support
knowledge base (TW articles on buildings, units, nobles, morale, night bonus, scavenging, sitting, premium,
script library); Wikipedia; community guides (tw-pocket-bible, theroadtotribalwars guides); Trustpilot and
App Store reviews; forum.tribalwars.net search results. The TW help wiki and Reddit refused automated
access, so player sentiment is thinner than ideal. Our side: `packages/engine/src/config.ts` and
`docs/GAME_DESIGN.md` at `2af2d99`.

## 1. How Tribal Wars works (short)

- **Economy:** 3 resources (wood, clay, iron) from mines, a warehouse cap, a hiding place against loot, a
  farm that caps population. No troop upkeep. Market trades between players; a premium exchange sells
  resources for paid points.
- **Buildings:** HQ (build speed), barracks, stable, workshop (siege), smithy (research), statue (paladin),
  academy (nobles), rally point, market, wall, hiding place, warehouse, farm, 3 mines, watchtower (some
  worlds), church (some worlds).
- **Units:** infantry (spear vs cavalry, sword vs infantry, axe attack, archers on some worlds), scouts,
  light/heavy cavalry, rams (wall), catapults (buildings), a **paladin** hero with skill trees and items,
  the **nobleman**, and militia (farm-based emergency defence).
- **Battle:** attack vs defence by unit class, wall, luck, **morale** (big attackers fight weaker vs small
  players), **night bonus** (defence doubled in an 8 h window, players may pick it on newer worlds),
  church, flags, tribe skills. A simulator in the rally point.
- **Conquest:** loyalty 100; each successful noble cuts a random amount; 4-5 nobles usually needed; loyalty
  regrows per hour; nobles bought with coins whose price rises per noble; max noble distance. The core
  skill is the **noble train**: several noble attacks landing within milliseconds; defenders **snipe**
  (time support between nobles) and **backtime** (hit armies as they come home); **fakes** hide the real
  attack.
- **Farming:** the main early income. Light cavalry in alternating groups raid barbarian villages; a paid
  **Loot/Farm Assistant** sends template raids from a list. **Scavenging** sends idle troops to collect
  resources with no target.
- **Barbarians:** abandoned villages that grow up to a cap; bonus villages give special production.
- **Tribes:** size per world, diplomacy labels, tribe forum, **tribe levels and weekly prestige** that buy
  tribe-wide skills (faster support, faster looting, production, build and recruit speed, attack/defence).
- **Protection and help:** beginner protection (days per world), **account sitting** (limited days),
  quests and achievements, shared-connection accounts cannot attack/support each other, multi-accounts
  banned, an **official script library** of approved scripts (since 2026).
- **Worlds:** every world has its own settings (speed, unit speed, morale, night, paladin, archers, church,
  tribe size, win mode). Types: normal, speed rounds, casual (start village can't be lost), classic.
  Wins: domination, rune/special villages held for days, or older rules.
- **Money:** premium account (bigger map, notifications, quick bar), account manager (automation), loot
  assistant, build/recruit speed-ups, premium exchange, paladin respec. Over EUR 180m lifetime revenue;
  growing in 2020.

## 2. What players love and hate (genre-wide)

**Love:** strategy depth that beats money; tribe friendships and coordination; politics and diplomacy;
team conquest operations; long-term planning; a clear world goal.

**Hate (ranked):**
1. **Pay-to-win** (in every source; Trustpilot 1.6/5; "a game of cash").
2. **Time demand and waking up at night** to defend.
3. **Unexplained bans** and slow support; rules differ per server.
4. **Being farmed** by much stronger players, attacks right after protection.
5. **Bots, scripts, multi-accounts.**
6. **Dying worlds**, merges, stagnant barbarian villages.
7. Bugs, laggy mobile app, delayed reports.

## 3. Side by side

| Area | Tribal Wars | Clanfire now | Verdict for us |
|---|---|---|---|
| Resources | 3 + population | 4 (gold) + population | Keep; gold is ours. |
| Troop upkeep | none | none (owner) | Same. **Food needs a use**: more food in costs. |
| Per-world settings | ~100, many vary | speed, map, domination only | **Gap**: per-world WorldConfig (planned run). |
| Hero | paladin with skills and items | Chieftain figure (cosmetic) | Optional later; don't copy the paladin. |
| Battle modifiers | luck, wall, morale, night, church, flags, tribe skills | luck, wall, troop ranks | Keep lean. Morale and night bonus out (owner). |
| Scouting | scouts, watchtower | 5 intel tiers | Ours richer. Add **Lookouts** (our watchtower idea). |
| Incoming attacks | visible at send, types guessed from travel time | being built (Run A) | Same idea. Add a **minimum attack size** so fake spam can't flood notifications. |
| Conquest | loyalty hits, noble trains, ms timing, snipes | Chieftains + **hold** (hours) + Renown | **Ours is different and fairer** (less ms timing, defenders get hours). Keep. |
| Siege | rams (wall), catapults (buildings) | Log Ram, Boulder Sling | Same idea; add Farm/Storehouse min level 1. |
| Farming | core early loop; paid Farm Assistant | full loot by carry; manual sends | Add **free Raid lists** (templates), a clear win over their paid tool. |
| Scavenging | yes | no | Our twist: **Foraging on terrain tiles**. |
| Abandoned villages | grow to a cap | buildings grow on a timer | Owner: they build with their own stock (planned run). |
| Bonus villages | special production | Fire Shrines and Great Fire | Ours is distinctive; could add a few "rich" abandoned villages. |
| Market | player offers + premium exchange | shipments to own/friends | Add **player offers**; never sell resources for money. |
| Tribes | levels, prestige, tribe skills | diplomacy, forum, chat, alerts | Add **tribe projects** (planned) as our version of tribe progression. |
| Sitting | account sitting | caretaker bot | Add **Steward** (a tribe-mate looks after you, limited). |
| Onboarding | quests | none yet | Add **first-steps quests** (retention). |
| Scripts | official library | none allowed, none offered | Publish a clear rule; free raid lists remove most reasons for scripts. |
| World types | normal, speed, casual, classic | one type | With WorldConfig: **speed** and **casual** worlds become settings. |
| Premium | big convenience and speed advantages | none yet; owner plans ~20% faster queue | **Biggest risk** (complaint #1). Keep it small, or cosmetics plus convenience only. |
| World end | domination / held villages / % | 75% points for 14 days after 6 months, min players | Same family; ours is fair. |

## 4. What makes Clanfire different (keep and promote)

Renown (expansion earned by playing), conquest with a **hold** instead of millisecond trains, founding with
an ember, Fire Shrines and the Great Fire, gold as a 4th resource, troop ranks, 5-tier scouting, terrain
travel, the caretaker bot, toy-diorama art, a multi-world lobby, and (if the owner agrees) a fair shop.

## 5. Recommendations (ranked)

1. **Decide the shop now**: complaint #1 everywhere is pay-to-win. Recommendation: cosmetics plus small
   conveniences; if the paid faster queue stays, cap it (one building at a time, ~20%, per-world flag) and
   never sell resources, troops or Renown.
2. **Per-world settings** (WorldConfig) - enables speed and casual worlds and the special short world.
3. **Abandoned villages build with their own stock** + balance pass (raiding too strong, food unused,
   siege unused).
4. **Free Raid lists** (saved raid templates sent from the map) - our answer to their paid assistant.
5. **First-steps quests** for new players.
6. **Steward** (limited account sitting by a tribe-mate).
7. **Minimum attack size** (no 1-unit fake spam; protects notifications).
8. **Tribe projects** as tribe progression.
9. **Lookouts** and **Foraging** (our twists on watchtower and scavenging).
10. **Player market offers.**
11. Open questions for the owner: night-time defence is complaint #2 - with rest hours dropped, the hold,
    notifications, Steward and the caretaker bot are our answer; is that enough?
