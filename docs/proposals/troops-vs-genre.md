# Troops and battles: Clanfire against the genre, and our own better numbers

Written 2026-11-17 on branch `claude/brave-boyd-1f323b` (local, not merged, not pushed). Owner's ask: "compare the game to Tribal Wars,
resources, units etc. but we shouldn't be the same, we might do better ... troops ... time". This session covers troops, recruit time,
battles and raiding (the economy and the play experience are other sessions). Numbers: `docs/BALANCE.md` §15. Raw tables and sims: `docs/sim/2026-11-17-troops-*.txt`;
the analysis tool is `npm run sim:troops` (it reads the real engine, so it can be rerun after any number change).

## In short (5 bullets)

1. **Most of the army already works.** Raiders, Pikemen, Shieldbearers, Elk Riders and Pathfinders each have a clear job and none is a bad buy. Attack against defence per coin is about the same balance as the genre; our troops are cheaper and faster than theirs, on purpose.
2. **Two units were never worth building:** the **Ember Guard** (the gold elite: dearer than a Raider and worse in every measure) and the **Firecart** (the siege cart: 200 of them could not even take two levels off a level-22 Wall). Both are fixed by changing numbers only.
3. **Your lost battle was a planning gap, not weak troops.** Against ~4,100 defenders behind a level-20 Wall, 2,667 Raiders (attack ~96k) needed about 3,955 (attack ~142k). A level-22 Wall makes an attacker pay about twice the defender's coin, the same shape as the genre; the fix is to see that cost *before* sending (the battle simulator and Pathfinders already show it), not to make attackers stronger.
4. **Time:** until a village is nearly maxed, **money** (food for Raiders, iron for defenders), not the Barracks queue, is what limits an army. At the top of the ladder the Barracks (965 Raiders a day) and income (825 a day) are almost equal, and filling the whole 12,000 room takes ~12 days. A wiped 3,000-troop army is back in ~3 days at the top, ~5 days at three-quarters ladder. Nothing to change.
5. **Recommended: change two units, nothing else.** Pace for players: **the same** (the Ember Guard is a gold-capped trickle; the Firecart only matters for big, late attacks). Raider/builder score, 2nd village day, conquest and takes in the sims come out **unchanged** (they hardly use either unit). Saved only on this branch; you pick first.

## 1. What we compared to (sources, and what is NOT verified)

Reference numbers come from InnoGames' public help pages for Tribal Wars (world-speed-1 defaults) and Travian's support pages. Following the project rule, **no
reference stat line, formula or name is used in our config or docs as ours**; below they appear only as ratios, per 100 coins (coin = wood + clay + iron for them;
wood + food + iron + 10 x gold for us), with the page each came from.

- Tribal Wars unit table (cost, population, attack, defence, speed, carry): <https://support.innogames.com/kb/TribalWars/en_DK/1185>; per-unit pages (spear fighter, light cavalry, heavy cavalry) <https://support.innogames.com/kb/TribalWars/en_DK/5249>, <https://support.innogames.com/kb/TribalWars/en_DK/5264>, <https://support.innogames.com/kb/TribalWars/en_DK/5270>; unit classes <https://support.innogames.com/kb/TribalWars/en_DK/4433>.
- Tribal Wars Wall (max level 20, no percent given): <https://support.innogames.com/kb/TribalWars/en_DK/5342>, <https://support.innogames.com/kb/TribalWars/en_DK/1190>; Barracks (max 25, no speed-up numbers): <https://support.innogames.com/kb/TribalWars/en_DK/5291>.
- Travian Wall (bonus 1.5-3% per level, compounding): <https://support.travian.com/en/articles/64-walls-and-rams>.
- **Not verified** (the pages could not be reached or do not say): Tribal Wars morale and luck ranges, the Wall's percent per level, the battle loss formula, Barracks speed-up per level, barbarian-village loot and production, the Farm's capacity, Travian's battle loss formula. (`help.tribalwars.net` and its wiki mirror both failed with connection or certificate errors, twice.) Where a comparison needs one of these, the table says "unverified".

## 2. Roster: ours against the genre (ratios, not stat lines)

Per 100 coins and per population. "Genre" = the closest unit in the Tribal Wars table above (cheap attacker, defender, anti-rider, fast raider, elite, siege, conqueror).

| Role | Ours | Per 100 coins (ours / genre / ours is...) | Per pop (ours / genre) | Feel |
|---|---|---|---|---|
| Cheap attacker | Raider | attack 42 / 31 / 1.4x | 36 / 40 | genre-like, a bit cheaper |
| Defender vs foot | Shieldbearer | defence 56 / 38 / 1.5x | 42 / 50 | same |
| Defender vs riders | Pikeman | defence 71 / 50 / 1.4x | 40 / 45 | same |
| Fast raider | Elk Rider | attack 35 / 27 / 1.3x; carry 41 / 17 / 2.4x | carry 37.5 / 20 | we carry far more |
| Scout | Pathfinder | (no attack) | speed 18 against 6.7 tiles an hour: 2.7x | scouts are cheap and fast |
| Elite | Ember Guard (before) | attack 18 / 16 / 1.1x; defence 15 / 21 | 23 / 25 attack | worse than the cheap unit **and** slower: no niche |
| Siege | Firecart | n/a | n/a | see section 5 |
| Conqueror | Chieftain | gold + Renown (ours) | n/a | not compared |

Reading it: our troops are about **1.4x stronger per coin** across the board (the deliberate x0.55 cost cut) and the ratio of best attack to best defence per coin is the same
as the genre (ours 0.76, theirs 0.80). So the *shape* of attack against defence is genre-like. Where we differ on purpose:

- **Speed** (tiles per hour at world speed 1; the genre's "minutes per field" turned into the same unit): Raider 6 against 3.3 for their axe (1.8x), Elk Rider 13 against 6 (2.2x), Firecart 3 against 2 (1.5x), Chieftain 5 against 1.7 (2.9x), Pathfinder 18 against 6.7 (2.7x). Our map is large and a trip of 10 / 30 / 60 tiles takes a Raider 1.7 / 5 / 10 h and an Elk Rider 0.8 / 2.3 / 4.6 h on flat ground (terrain slows both).
- **Carry** is 2-4x the genre per coin. That is safe because raid income is limited by what an abandoned village *produces*, not by what the army can carry (section 6).
- **Wall:** ours is +4.5% defence per level (linear, +99% at level 22) plus militia; Travian's is 1.5-3% compounding (about +34% to +81% by level 10-20 for the strong end); the Tribal Wars percent is unverified. Ours sits at the strong end of the range.
- The genre's elite unit is worse per population than its cheap unit too, but earns its place with **speed and carry**. Ours was slow and carried 20, so it had no reason to exist.

## 3. Unit by unit: is anything never worth building? (current numbers, `docs/sim/2026-11-17-troops-analysis-before.txt`)

| Unit | Best at | Verdict |
|---|---|---|
| Pikeman (8/14/40, 56 coins) | defence vs riders per coin (71) | worth it only as the rider counter and the cheap first unit; keeps a job because the Elk Rider is the only rider |
| Shieldbearer (12/42/22, 75) | defence vs foot per coin (56) and per pop (42) | the standard defender |
| Raider (36/8/6, 85) | attack per coin (42) and per pop (36) | the standard attacker |
| Elk Rider (65/18/16, 185, pop 2) | speed (2.2x), carry per coin (41) | the far-raid unit; round trip at 30 tiles earns ~2.7x a Raider's loot per coin |
| Pathfinder (0/3/2, 45) | scouting; free against abandoned villages | worth it: 5 of them cost 225 coins and tell you if a 33k-coin army is needed |
| **Ember Guard (70/60/60, 390, pop 3)** | **nothing: not best in any of 9 measures** | **never worth building** |
| **Firecart (5/7/5, 368, pop 3)** | **nothing in battle** | **never worth building**: in a 2,000-defender / Wall 22 fight 100 carts cost 36.8k coins and saved 13k worth of Raiders (net -24k); after a win, two Wall-22 levels needed 98 surviving carts (36k) against 30k of rebuild |
| Chieftain | conquest | own rules, unchanged |

## 4. Recruit time (current numbers; `docs/sim/2026-11-17-troops-analysis-before.txt` section 2)

Ladder = every building at 25 / 50 / 75 / 100% of its top level (income per hour of wood / food / iron: 97 / 129 / 97 at 25%, 221 / 294 / 221 at 50%, 446 / 595 / 446 at 75%, 902 / 1,203 / 902 at 100%).

| Ladder | Room for troops | Raiders per day: money pays / Barracks trains | Binding limit | Days to fill the room with Raiders | Days to rebuild a wiped army of 1,000 / 3,000 |
|---|---|---|---|---|---|
| 25% | 299 | 88 / 382 | **money (food)** | 2.1 | 10 / 33 (room is smaller than the army) |
| 50% | 1,238 | 202 / 520 | money | 4.3 | 3.2 / 13 |
| 75% | 3,868 | 408 / 708 | money | 7.1 | 1.4 / 5 |
| 100% | 11,783 | 825 / 965 | **Barracks, nearly tied with money** | 12.2 | 1 / 3.1 |

- Population room is **never** what limits you before the top: it fills last (~12 days for the 12,000 room, on target).
- Money first (food for Raiders, iron for defenders), the Barracks queue only at the very top. That is a good shape: you cannot "queue your way" past income, and nobody waits on a building while rich.
- **One finding:** Pikemen and Shieldbearers take 4.3-4.6 seconds of Barracks time per coin, Raiders 3.4. Defence is about 30% slower to raise than attack, per coin. I simulated making them equal (Pikeman 260 -> 200 s, Shieldbearer 320 -> 260 s): the whole picture then tilts toward defenders (villages taken from players 37 -> 30, restarts 21 -> 17, the raider's 2nd village day 23.7 -> 25.6; all still inside the targets but at their edge). Not recommended; kept as Option B.
- Genre training times: unverified (no page numbers), so no ratio.

## 5. Attack against defence (the owner's lost battle)

Real engine, luck 0, no morale. Defender 2,000 troops (Pikeman + Shieldbearer 50/50) at home, Town Hall 10 (`docs/sim/2026-11-17-troops-analysis-before.txt` section 3).

| Wall | Raiders needed | Attacker coins / defender coins | Attacker troops / defender troops | With Raiders + Elk Riders (coins) |
|---|---|---|---|---|
| 0 | 1,557 | 1.01x | 0.78x | 1.17x |
| 10 | 2,263 | 1.47x | 1.13x | 1.71x |
| 22 | 3,114 | 2.02x | 1.56x | 2.35x |

- A level-22 Wall (+99% and militia) makes the attacker pay about **twice** the defender's coin. With the genre-like ratio of attack to defence per coin, that is the same shape as the genre.
- **What a failed attack costs.** The loser's whole army dies; the winner loses (loser / winner) to the power 1.5 of the winner's side. At 90% of the winning count against Wall 22 (500 defenders): the attacker loses 60.7k coins, the defender 28k (2.2x). At Wall 0 the same near-miss costs 29.8k against 28.0k, an even trade. Luck of -10% turns an exactly-sufficient army into a loss, +10% still wins: **never send at less than about 1.2x the defence.**
- **Your battle:** 4,100 defenders (about 85% Pikemen, 15% Shieldbearers) behind Wall 20 give D = 142k. 2,667 Raiders (A = 96k, ratio 0.68) lose everything and kill (0.68)^1.5 = 56%, about 2,300 defenders, worth about 135k coins against your 227k: a 1.7-to-1 loss. Winning needed 3,955 Raiders (and 1.2x more to be safe). An all-Shieldbearer village of that size would have needed 9,105.
- **Turtling or raiding?** Neither dominates. Raiding abandoned villages pays most early (section 6); against a player with a high Wall the attacker pays twice, but the defender must keep the troops at home, cannot raid at the same time, and the sims' turtle style scores the lowest of the four (4.7k against 10.6k / 16.9k / 25.6k at 30 days). Morale (x0.75 attack against a much smaller player) and the 72 h protection cover the small end.
- **Firecarts today:** in the battle, 100 carts take two Wall levels off at the 2,000-defender fight only if the Wall is 10; at 22 they take one (cost 36.8k, saved 7k). After a win the carts are the only way to lower buildings, and they pay only against the expensive ones: per cart-coin the defender loses 0.2x at Wall 10, 0.9x at Wall 22, 2x at Barracks 20, 4x at Banner Hall 4.

## 6. Scouting, raiding and loot (current numbers; section 4 of the analysis file)

- Abandoned villages hold 5.5k to 13.5k coins when fresh (tier 1 to 5) and **produce 91 to 182 coins an hour** (`NPC_PRODUCTION_FACTOR` 0.45). So the supply is **production-limited**: sustained loot is 2.2k to 4.4k a day per village however many Raiders you send. A trip at 10 tiles takes 3.3 h (7.2 round trips a day).
- Against your own income that is **24-49% at 25% ladder, 11-22% at 50%, 6-11% at 75%, 3-6% at 100%**: a big early boost that fades by design, so late loot has to come from players. With two abandoned villages per newcomer, early raiding adds about two thirds to your income, then it becomes a small bonus.
- Raiders carry 28; the garrison dies in the first raid and never refills. 185 to 394 Raiders would carry a whole fresh village away. Carry is not the limit; do not touch it (and the economy session owns loot supply).
- **Pathfinders:** scouting an abandoned village is free (no scouts defend); against a player 5 Pathfinders (225 coins) succeed against up to 4 defenders, lose 1-4 against 2-4, and are caught by 5. Worth it before any attack of 10k+ coins; the Wall and troop counts need Keen ranks (`SCOUT_INTEL_KEEN`).

## 7. Options

| | What changes | Pace for players | Not changed |
|---|---|---|---|
| **A (recommended)** | **Ember Guard 70/60/60 -> 140/90/90** (the best attack per population: 46.7 against the Raider's 36, still the dearest per coin, so it is the elite you buy when population room runs out; gold-capped at about 46 a day). **Firecart siege power 1 -> 2** (half the carts for the same effect: two Wall-22 levels after a win: 49 survivors, 18k coins, against 30k to rebuild). | **Same.** The Guard is a gold trickle; Firecarts only pay in big late attacks. | everything else |
| B | A, plus defenders train as fast per coin as attackers (Pikeman 260 -> 200 s, Shieldbearer 320 -> 260 s) | **Defence faster;** attack the same. Simulated: villages taken 37 -> 30, raider 2nd village day 23.7 -> 25.6 (inside targets, at the edge). | |
| C (not simulated) | A, plus Wall +4.5% -> +4% per level, Firecart power 3, and more of the Firecart fire in the battle (`SIEGE_DURING_SHARE` 0.5 -> 0.75) | **Attacks succeed more often;** turtling weaker; wars faster. | |

Why A and not C: the attacker's price for a deep Wall (2x) is already genre-like, the conquest sim is on target, and your lost battle was an unscouted size problem, not weak troops. C would trade a documented choice (Wall 22 = old Wall 20) for a feel the data does not ask for. If play shows attackers giving up, C is the next lever, and it is numbers only.

### Why these two numbers

- **Ember Guard 140/90/90.** Per coin it stays worse than the Raider (36 against 42 attack per 100 coins), so nobody replaces cheap Raiders with it while population room is free. Per population room it is 1.3x better (46.7 against 36), so a maxed player who has filled 12,000 room can still grow attack by swapping in Guards. A gold price of 14 each against a Gold Mine's ~650 gold a day at the top caps it at ~46 a day, so it cannot dominate. Its defence rises from 20 to 30 per population (still below the Shieldbearer's 42), so it is not a defender either. A pure-Guard army to beat Wall 22 against 2,000 defenders is 801 Guards (312k coins, 2.4k population) against 3,114 Raiders (265k coins, 3.1k population).
- **Firecart power 2.** Siege cost scales with building level linearly but the rebuild price scales steeply (about x1.21 a level), so power 1 left deep buildings out of reach. At power 2 the carts are a bargain only where they should be: Banner Hall 8x, Barracks 4x, Storehouse 2x, Wall 22 1.8x, Wall 10 0.35x (not worth). In the *battle* carts still do not pay (that stays the late, big-attack tool); I kept the in-battle share (0.5) unchanged. One siege invariant moved on purpose: "Wall levels are cheap to rebuild vs the Firecarts that lower them" was `rebuild < 1 x attacker capital` and is now `< 1.5 x` (Wall 22 comes out at 1.12).

## 8. Sim results (recommended set A; baseline = `docs/sim/2026-11-11-chieftain-points-*`)

Raw: `docs/sim/2026-11-17-troops-{30d,90d,conquest90-5seeds,siege}.txt`; Option B raw: `docs/sim/2026-11-17-troops-option2-trainfaster-*.txt`. The sims barely use either changed unit (bots build neither a Wrightyard nor Firecarts; the builder style trains 5% Guards late), so with A **they are essentially identical to the baseline**, which is the point: the targets still hold, and the case for A rests on the analysis tables above.

| Target | Baseline | A (recommended) | B (defence faster) |
|---|---|---|---|
| Raider / builder score, 30 days (1.5-2x) | 1.60x | **1.60x** | 1.60x |
| 2nd village day, builder / raider / balanced (21-28) | 26.6 / 23.7 / 18.8 | **26.6 / 23.7 / 18.8** | 26.5 / 25.6 / 18.6 |
| Conquest, 20 players, 90 days, 5 seeds: villages taken (30-50) | 37 | **37** | 30 |
| Restarts (not above 26) | 21 | **21** | 17 |
| Worst biggest / second (<= 2x) | 1.47 | **1.47** | 1.74 |
| 90 days: 3rd village day builder / raider / balanced | 40.3 / 47.8 / 35.3 | 40.3 / 47.8 / 35.3 | 40.3 / 49.4 / 35.3 |
| Dominant style flag | balanced 1.51x raider | balanced 1.51x raider (1.5x line, unchanged) | same |
| `--siege` invariants | pass | **pass (one line moved, see above)** | n/a |

`npm run check`: engine 553, lobby 99, preview 20, server 621, web 306, all pass. `npm run build`: passes (see BALANCE §15 for the final run).

## 9. What changed on this branch (recommended set A)

`packages/engine/src/config.ts` only: `knight` attack 140, defence 90 / 90; `firecart.siege.power` 2. `docs/GAME_DESIGN.md` §4 and §18.9, `docs/BALANCE.md` §15, tests that hard-coded the old numbers now read from `UNITS` (roster, siege, village, warfare), the analysis tool `scripts/sim/troops.ts` (`npm run sim:troops`, with `--set unit.field=value` previews), one siege invariant line in `scripts/sim/siege.ts`. Existing worlds: unit lines come from config, so battles in progress use the new numbers from the first fight after deployment; nothing is stored, so no migration.

## 10. Open for later (not done)

- Computer players never build a Wrightyard or Firecarts (known), so the `--siege` sim cannot judge real siege use; judge it in play: Banner Hall and Barracks levels lowered per week.
- Show "this attack needs about N Raiders" (from the battle simulator) in the send form, so the owner's lost battle cannot repeat unseen (UI session).
- Option C is ready to test if attackers still feel weak after play.
