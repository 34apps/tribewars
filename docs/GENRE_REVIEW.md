# Genre review and engine health (2026-11-04)

Read-only review. Nothing was changed in the code and nothing was run or simulated: numbers below are
worked out by hand from `config.ts`, `village.ts`, `army.ts`, `economy.ts`, `world.ts`, `tribes.ts`,
`drillyard.ts`, the server's `send`/`sendShipment`/`processDue`, and the docs.
Rule of the project: ideas only. No other game's names, numbers, formulas, texts or screens are used here.

**In short**
- The base loop works: build, train, raid computer-run villages, tribes, scouting, support, reports,
  chat, forum, rankings, phone layout.
- Three things that define the genre are missing: **owning more than one village / taking villages**,
  **a way to break a wall (siege)**, and **an end to a world with a winner**. Without them there is
  little reason to attack real players, and no reason to keep playing after a few weeks.
- The engine is clean: one authoritative server, every rule in the engine, numbers in `config.ts`,
  no money or troop duplication found. Two real weak spots: battle luck can be predicted, and
  raiding computer villages is risk-free and unlimited, which beats every other way to earn.

---

## Part A. Genre completeness

Importance for launch: **Must** (do not launch without), **Should** (launch is weaker without),
**Later** (good after launch). "Have / Partly / Missing" is the state today.

| # | Idea players expect | State | Launch | What exists / what is missing |
|---|---|---|---|---|
| 1 | Grow a village with timed upgrades, queue, resources, storage, hidden stock | **Have** | Must | 12 buildings, build queue 2 (5 for premium), storehouse, vault, cancel with 80% back, caretaker for idle owners. |
| 2 | Grow **several villages** per player | **Missing** | Must | One village per account. The engine can already ship goods between "own villages", but nothing creates a second village. `BALANCE.md` §4 proposes one way (Banner Hall + conquest unit + loyalty). |
| 3 | **Take villages from other players** (conquest) | **Missing** | Must | Battle only kills troops and takes loot. Nobody can lose or win a village. Without it, a won raid on a player has little payoff and a lost village is never at risk. |
| 4 | Raid computer-run villages for loot | **Have** | Must | Abandoned villages, expanding layout brings new ones with every newcomer. Too generous, see B-5. |
| 5 | **Siege** against walls | **Missing** | Should | Wall gives flat militia + percent bonus (level 20: +320 flat, then x2). Nothing lowers it. No siege unit, no wall damage. Defence only ever goes up. |
| 6 | Different unit roles (attack, defence, fast, carrier, elite) | **Partly** | Should | 6 units exist, but knight and outrider are weaker than simply mass raiders and shieldbearers (B-6). |
| 7 | Scouting with information tiers | **Have** | Must | Pathfinders, defending scouts, 6 intel tiers by Keen rank. Good. |
| 8 | Support: send troops to defend a friend | **Have** | Must | Stationed contingents, recall, send back, tribe alerts. No cap on stacking (B-7). |
| 9 | Tribes: roles, rights, invite/apply, forum, chat, pacts, wars | **Have** | Must | Complete and detailed. Tribe size 30. "Enemy" has no rule effect (colour only). |
| 10 | Rankings and recognition | **Have** | Should | Player and tribe ranking, profile, 20 achievements. Missing: per-world history, "top attackers/defenders" lists. |
| 11 | **End goal** for a world (round ends, winner) | **Missing** | Must | Roadmap line 4 only. Nothing stops a world, nothing names a winner, no season reset or prize. |
| 12 | **Protection for newcomers** | **Partly** | Must | 72 h at speed 1; ends early if you hit a player; raiding abandoned villages keeps it. Missing: protection that ends by size/points, protection for players coming back from abandonment is fine. No limit on big players hitting tiny ones afterwards. |
| 13 | Tutorial / first steps / quests | **Missing** | Should | No guided start in the code (only tips/advisor screens). Newcomers face 12 buildings with no goal list. |
| 14 | Fight against **bots** (scripts) | **Partly** | Should | Rate limits per IP/session, signed lobby entry. No captcha or human check, no detection of inhuman click timing. The "caretaker bot" is a helper for idle players, not an anti-bot. |
| 15 | Fight against **multi-accounts** | **Partly** | Should | Accounts on the same IP cannot attack, scout, support or ship to each other. Easy to bypass with a second connection; no link detection beyond IP, no tribe-level check (B-8). |
| 16 | Trade: sell or swap resources | **Partly** | Later | Shipments between villages/players exist (market gate). No offers, no exchange rate, no merchant limit by market beyond capacity. |
| 17 | Alerts for incoming attacks | **Have** | Must | Live WebSocket hints, tribe alerts, badges. Phone push is not built. |
| 18 | Reports (battle, scout, support, shipment) | **Have** | Must | Good. Missing: grouping/filters for large volumes. |
| 19 | Messaging, support tickets, moderation | **Have** | Must | Mail, tickets, mutes, bans, audit, staff roles. |
| 20 | **Play on phones** | **Partly** | Must | Mobile-first web app at 360 px; not yet checked in a real browser after the last UI changes. No install-as-app (PWA) yet; no push. |
| 21 | Several worlds / fast and slow servers | **Have** | Should | Lobby, world speed setting. Docker rollout still untested. |
| 22 | Premium / support the game without unfair power | **Partly** | Should | Premium = longer build queue (5 vs 2) and research queue. That is mild but is a paid advantage in speed; decide how far it should go before launch. |
| 23 | Heroes / items / special events | **Missing** | Later | Not needed for launch. The Drillyard ranks already give a "specialise" choice. |
| 24 | Fair-play tools for an operator | **Have** | Must | Sandbox for owner only, bans, audit log, backups. |

**Launch blockers (Must + Missing):** 2, 3, 11. Everything else is either present or can follow within weeks.

---

## Part B. Engine health

### B-1 Is every rule deterministic and server-side? **Yes, with one catch**
- All state changes go through the engine (`applyBuild`, `applyTrain`, `applySend`, `resolveBattle`,
  `applyReturn`, ...). The client only previews. The server reads its own clock and re-checks
  everything (target, relation, protection, troops at home, queue limits, premium flag).
- Time is lazy: `settleVillage(state, t)` is pure and uses no random numbers and no `Date.now()`
  (grep of the engine: none). Movements are resolved in arrival order, each in its own transaction, and
  a return that is already due runs before later ones.
- Battle seed is `hashSeed(movementId, arriveAt)`. That is repeatable (good for tests and support),
  **but the attacker can compute it before sending** (see B-4).
- The only real randomness is in world and spawn creation (`randomInt` for abandoned-village growth
  seeds, spawn position). That is fine: it is chosen once on the server and then stored.

### B-2 Are all numbers only in `config.ts`? **Almost**
- I found no balance number hiding in `village.ts`, `economy.ts`, `army.ts`, `drillyard.ts` or the server's
  `game.ts`. Rules only use named config values.
- Small leftovers that are not balance but placement tuning, still inside `world.ts`: 300 spawn tries,
  8 widening rounds, widening factor 1.3, ring jitter 2 and 0.7, 10 attempts per ring slot. Harmless,
  but move them to config if you ever want to tune spawn feel without touching logic.
- Several values in docs are quoted from config; those quotes go stale (see B-3).

### B-3 Docs against code
| Where | Mismatch |
|---|---|
| `GAME_DESIGN.md` §4 | Says "Five units"; there are six (Pathfinder added). |
| `GAME_DESIGN.md` §15 | Title says "DECIDED, NOT BUILT YET" and two paragraphs say ranks are "not built in the server", yet a later paragraph (and the code) says ranks reach battles and scouting. Three conflicting status blocks; keep one. |
| `GAME_DESIGN.md` order | Sections run 11, 12, 13, 16, 17, 14, 15; §14 roadmap is stale (mail, forum, abandonment are done). |
| `GAME_DESIGN.md` §9 | Points text (new village 40, maxed ~10,000) matches config. |
| `BALANCE.md` §2-3 | Says Farm L20 gives 591 food/h and pop cap "~2,980". Config: farm base is 40, so L20 is about 790 food/h; pop cap L20 is about 4,800 after the 2026-11-04 tuning. The conclusion (food, not population, limits armies) still holds and is even stronger. Also says points max "~200"; code gives ~10,000. |
| `BALANCE.md` §3.1 | Proposal "troop upkeep 0.25" is still unapplied; config keeps 1 / 3 / 4. Docs state this as proposal, so consistent, but the owner decision is still open. |
| Code vs docs otherwise | Build, train, cancel, research, battle, loot, scouting, support, shipment, protection rules in the docs match the code I read. |

### B-4 Exploits and tricks
Checked and **not** exploitable (reason in brackets):
- Duplicating resources or troops: costs are paid up front; cancels return 80% rounded down and never
  above the storehouse; troop cancel only refunds the untrained rest; loot is taken from the defender
  and capped by what survivors carry; shipments leave the sender at once and overflow is lost.
- Negative or fractional values: unit counts must be whole numbers 0..1,000,000 and at most what is at home;
  shipment amounts whole and at most stock; resources clamp at 0; losses are `min(count, round(...))`.
- Sending to self: attacks, scouts and support to your own village are refused. Shipments to your own other
  villages are allowed on purpose (no second village exists yet).
- Cancel tricks: cancel returns after exactly the time already travelled, minimum 1 s, only within 2 min;
  cancel-and-resend does not shorten trips. Queue cancel loses 20%, so "free reorder" is not free.
- Timing tricks on queues: settlement walks jobs in order; a build finishing mid-span changes production
  from that moment; training upkeep is counted from queue time. No gain found.
- Respec: free for points, but the resources paid for ranks are lost, so swapping roles costs real goods.
- Support recall/send-back, called-off attacks when a pact appears in flight: handled and tested.

Found (ranked):
1. **Predictable luck (medium).** Luck is +-10% and the seed is `hashSeed(movement id, arrival time)`.
   The client bundle contains the same engine, the movement id and arrival time are shown to the sender,
   so a player can compute the luck of an attack *before* the troops arrive and cancel/resend (new id)
   until it is favourable. Also it makes outcomes at +-10% knowable. Fix: add a server-only secret to the seed.
2. **Rank purchase is instant (low-medium).** Bulwark ranks use the defender's *current* ranks at
   arrival, while the attacker's are stamped at departure. A defender who sees an attack coming can buy
   ranks in seconds (points allowing) or respec Might into Bulwark. Fix: a short delay or cool-down on
   rank purchases, or stamp the defender's ranks when the attack leaves.
3. **Multi-account farming (medium).** Block is by shared IP only. Two accounts on different networks can
   feed each other: ship resources inside a tribe, or let an alt be "raided" for loot (the loot formula
   hands over a lot per trip). In the expanding layout every new account also brings 3+ fresh abandoned
   villages, and the spawn point is random in a disc around the centre, so alts spawn near the main and
   become extra raid targets. Fix: rate/size limits on shipments to non-new players, a "linked accounts"
   check (cookies, sign-in times, device hints), and a cap on loot from the same attacker/target pair per day.
4. **Premium queue is a speed advantage (design).** 5 build jobs against 2 is more active time saved, not a
   bug. Decide whether it stays "comfort only" (no shorter total time) or not.
5. **Risk-free, unlimited abandoned-village farming (balance, big).** Abandoned villages never recruit, so
   after the garrison is killed once, 1-5 raiders (40 attack each; a wall 10 village has ~255 defence with
   no troops) win every time. Their production keeps filling a store (level 10: ~120 per resource per hour,
   up to ~6,900 held). A newcomer's rings bring 3-6 of these. This income can beat building production,
   there is no counter-play and no diminishing return per target. See Part C #3.
6. **Nothing punishes mass defence (design).** See B-5 below.

### B-5 Dominant strategies (from the numbers)
- **Raiders beat the other attackers.** Attack per cost: raider 40 for 160 goods (0.25), outrider 60 for 360
  (0.17), knight 110 for 630 (0.17). Attack per food: raider 40, outrider 20, knight 27. Attack per
  population: raider 40, outrider 30, knight 27. Outriders still win on speed (14 against 6) and carry.
  The knight has a research cost, gold and 4 food, and only beats the raider on raw speed (10 against 6).
  It is effectively **never the right choice**. Its defence (70/50) is also worse per cost than a
  shieldbearer (45/25 for 145).
- **Defence: pikemen and shieldbearers are both worthwhile** (pikeman 45 against horses, shieldbearer 45
  against foot). This pair works as intended and needs no change.
- **Food, not population, limits an army.** Farm L20 feeds ~790 units at 1 food each; the population cap
  is ~4,800. So the ceiling for a single village is about 800 raiders (32,000 attack). The 0.25
  upkeep proposal in `BALANCE.md` is correct and would raise the ceiling roughly fourfold.
- **Turtle wins if there is no siege.** Wall 20 gives +320 flat and x2. A defender who loses a fight loses
  its troops but an attacker who loses loses *everything sent*. With no way to reduce a wall, players who
  stack troops and support in one village face no real threat. No cap on support per village either.
- **Raiding is better than building.** See B-4 #5: build levels cost more each step; raiding abandoned
  villages costs only food and a little time. With no cost on repeated hits, the best plan is to out-farm
  everybody on the map, not to fight.
- **Gold is not a constraint** until knights, and knights are not worth it, so gold is mostly unused.

---

## Part C. Top 10 fixes, by impact on players

Size: S = a day or less, M = a few days, L = about a week or more.
"Pace" = does the fix make a player's progress **faster**, **slower** or the **same**.

| # | Fix | Size | Pace | Why |
|---|---|---|---|---|
| 1 | **Several villages: conquest or settling** (Banner Hall + conquest unit + loyalty as in `BALANCE.md` §4, village limit grows with the hall) | L | slower early, faster growth later | The core genre loop. Gives attacks on players a purpose, gives growth beyond one village, and makes defence matter. Needs engine, server tests, security gate, web. |
| 2 | **World end and winner** (round length or goal such as "hold X% of points / villages", final rankings, new world starts) | M | same | Gives the world a shape; without it players leave after the build-out. |
| 3 | **Tame abandoned-village farming** (loot shrinks on repeated hits within a day; or the garrison refills slowly; or a cap on resources they hold) | S | slower for raiders | Raiding currently beats building and has no counter. One of the first things a player does; must be right before launch. |
| 4 | **Upkeep rebalance** (food 0.25 per population point as in `BALANCE.md`; fix the stale numbers there) | S | faster (bigger armies) | Lets Farm level matter in both ways and allows real wars. Re-tune tests. Do together with #3. |
| 5 | **Siege against walls** (a ram-like unit lowers wall level in a won battle; wall never below a floor of 0) | M | same | Gives attackers an answer to turtling and makes the wall a choice. Add to `config.ts` + a short rule in `GAME_DESIGN.md`. |
| 6 | **Secret battle seed** (server-only salt in `hashSeed`) and stamp the defender's ranks at departure or give rank buys a delay | S | same | Closes the two ways to know/choose an outcome in advance. |
| 7 | **Newcomer path: guided first steps + protection by size** (short quest list, protection ends when points pass a threshold, not only by time) | M | faster for newcomers | The first 30 minutes decide retention; the 12-building screen alone is too much. |
| 8 | **Multi-account and bot defence**: link detection beyond IP, shipment limits to new accounts and per-pair loot cap, a human check at sign-up | M | same | Protects fairness before a public world. Uses the signed lobby entry as a base. |
| 9 | **Fix unit roles**: make the knight worth training (a clear job: e.g. strong at defence-per-food, or carries the conquest bearer), and stack limit of support per village | S | same | Removes one dead unit and one invulnerable stack. Numbers in `config.ts` only. |
| 10 | **Phone: install as an app (PWA) and push alerts for incoming attacks**, then the real 360 px check of the last UI work | M | same (reaction faster) | Attack alerts are the reason players return; today they only help while the tab is open. |

Docs clean-up (GAME_DESIGN order and statuses, `BALANCE.md` numbers) is small (S) and should ride with #4.

## Suggested order
1. #3 and #4 and #6 together (small, change the economy and fix fairness before anyone plays for real).
2. #1 (big), then #5 and #9 as part of the same war-balance pass.
3. #2 and #7 when the world has a first public test.
4. #8 and #10 before opening the lobby to the public.
