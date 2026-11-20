# In-game experience vs the genre — what would make Clanflame better (2026-11-17)

**Proposal only. No game code was written.** Written for the owner; plain words first, details after.
Screenshots (60, desktop 1440x900 and phone 360 px): `design/proposals/experience/` (`L1-…` to `L6-…`, one prefix per loop).
Hard rule kept: nothing here copies another game's names, numbers, formulas, text or screen layouts. Their features are
described only to understand what players expect; the screens below are our own design. No balance numbers are proposed
(two sibling sessions cover economy and troops).

## In short

- **The first minutes are good, the second hour is not.** Signing up takes 3 clicks, a bubble on the village always says what to
  build next, and unaffordable buildings say when they will be ready. Then the player is left alone with identical-looking
  reports, no way to repeat a raid and no list of targets.
- **We are clearly behind in one place: owning several villages.** There is no overview of all villages. Queueing the same
  building in 4 villages takes 10 clicks. Tribal Wars and Travian sell this overview (or part of it) for money; ours can be free.
- **Defending is half-done.** The red "attack coming" chip is on every screen and the map shows the enemy army walking in — that
  is good. But the screen never says *which* of your villages is hit (from the Army page), there is no "ask the tribe for help"
  button, and a tribe-mate who sends help is not told that it will arrive hours after the attack lands.
- **The best free wins** are things the genre either sells or leaves to scripts: an all-villages overview, saved raid lists with
  one-click "raid again", an "is my help in time?" check, notes on villages, and free phone alerts for incoming attacks.
- Nothing is live or pushed; this is a document and screenshots, committed on a side branch only.

---

## 1. How this was done (and what it can't tell us)

- Built the current preview in a side worktree, served it on a private port, and drove it with headless Chrome (no window shown)
  at 1440x900 and 360x800 on **copies** of the owner's world (the owner's file was never touched).
- Two walkers: a fresh account (3 sign-ups, one on phone) for the first-15-minutes and daily loops; staged situations (incoming
  attacks, extra villages, a tribe invite) for defending, attacking, several villages and tribe life.
- **Caveats:** (a) the world copy is at game day 87, so the "newcomer" met a mature map, not a fresh world — the raid problem
  in loop 1 is real for anyone who joins a running world, but a brand-new world was not walked; (b) in the copy the owner's player
  has 1 village (the 4-village player is a computer leader), so the several-villages loop used 3 villages moved to the owner
  in the copy; (c) real game pace was kept, but the walkers used the preview's time skip (about 12 "+1 hour", one "+1 day") to get past
  timers; (d) Chrome only, not Safari; (e) the Tribal Wars / Travian facts come from public help pages, many of which would not load,
  so part is marked UNVERIFIED (section 3).

## 2. The loops — what a player does, what it costs, my verdict

Clicks count real clicks (typing into a box counted separately). "Wait" is time with nothing useful to do.

| Loop | Clicks / screens (today) | Waits | Confusion points | Verdict |
|---|---|---|---|---|
| **1. First 15 minutes** | Sign-up 3 clicks + 2 typed fields, 3 screens, straight into the village. Each First-steps item 1–4 clicks (+1 "Claim"); whole list ~25–28 clicks, ~9 screens. | Queue is serial: Lumber 7.5 min, Town Hall 13 min, Barracks 14 min. First raiders ~1 h 40 after sign-up, first raid result ~3 h at real speed (the list cannot finish in 15 min). | Desktop First-steps card shows **one** step at a time (phone shows all 9). Every nearby abandoned village says only "Strong, ≤ 30 troops"; real defence in the walk was 155–707, so the first raid lost 4 of 5 raiders and brought home 28 loot — yet the step is ticked and the report says "Won". Scout report says "Defenders 0" and "troops not seen" at once, and uses "Keen 0" unexplained. "Simulate" opens with an empty defender and promises a win. | **Equal** (ahead on the next-build bubble and "ready in" labels; behind on the first raid, which teaches "raiding is useless") |
| **2. Daily loop** | Queue 2 buildings: 2 clicks, third says "Queue full". Mixed army: 2 clicks + 2 fields. One raid: 2 clicks + 1 field. **Repeat 3 raids: 9 clicks with a saved group, no repeat button.** | Away for a day = all three resources sat at the cap, nothing queued, no warning. | Reports are titled alike ("You raided Abandoned village", no coordinates). "Recent targets" stays empty after raids sent from the Map. No "delete all / mark read", no Won/Lost filter. Map shows no memory of earlier raids on a village. | **Behind** — the genre's paid helpers (farm assistant, farm lists) do this in one click; we offer nothing |
| **3. Defending** | See all incoming attacks: 1 click (red chip → Army page). Ask the tribe for help: **no button**, free chat only (3 clicks, no village or time attached). Tribe-mate sends help: 5 clicks. | Only a countdown. | Army-page list **never names the target village** (only the bell and Tribe › Alerts do). Size always "unknown" without the tribe Watchtower, with no hint why. Help sent can arrive 9 h after a 14-minute attack and nothing warns. With 2+ attacked villages the header pushes the bell and avatar off a 1440 window. Phone alerts sheet is cut off at the right. | **Equal** on alerting (chip on every page, army walking on the map, bell names the village); **behind** on "what can I do now" |
| **4. Attacking a player** | Scout then attack then report: ~15 clicks, 5–6 screens. Map panel already shows distance, travel, arrival clock, carry. Chieftain strike form has an escort helper and a warning. | Trip time (1 h at real pace); nothing to do meanwhile. | Scout report shows "?" for troops even when the target is empty. No exact-arrival planning, no target notes, no "send the same army again", no list of targets. | **Equal** (ahead on the Chieftain hold design — no millisecond trains; behind on planning aids) |
| **5. Several villages** | Switch: 2 clicks. Same building in 4 villages: **10 clicks**. Ship resources: ~7 clicks, must start from the sending village. | Per-village timers only. | **No overview.** Switcher shows points, stock and an attack badge, but not queues, training, troops or "storage full". Army/Village pages show only the current village's queue. "Blocked" buttons give no reason. Drillyard page ~1,331 px tall at 900 with no scrollbar. | **Behind** — the biggest gap |
| **6. Tribe life** | Invite: 3 clicks. Join: 1 click. Support a mate: 5 clicks. Chat 3 clicks. All 9 tribe pages fit 900. | None. | Members list has no troops, no village list. Diplomacy needs a typed tribe tag. No shared notes. Phone: Tribe is 3 taps deep (More › Tribe › Alerts). Tribe badge counts everyone's attacks, bell only yours. | **Equal** — ahead on Alerts + one-tap Support and tribe projects; behind on knowing who can help |

Layout faults found while walking (fold into the fixes list in section 5): header overflow at 1440 with 2+ attacked villages
(bell/avatar at x 1547–1649), phone Alerts sheet rows run to x 448 in a 360 screen, loot tile "3,854" wraps at 1440, "All
buildings" second column clipped on the right of a building page, Army page on phone 4,300–6,000 px tall (incoming list
sits below 8 troop rows), World rules 1,623 px at 1440. Everything else fits 900 at 1440 and has no sideways scroll at 360.

## 3. Comparison with the genre (updated since `GENRE_COMPARISON.md` 2026-11-05)

### What the genre gives players (public pages; ✓ = page read, ? = UNVERIFIED, search snippet or third party)

| Player need | Tribal Wars | Travian (Legends) |
|---|---|---|
| Overview of many villages | Premium adds "additional overviews" and a more detailed village overview ✓ (support.innogames.com/kb/TribalWars/en_DK/1296); named screens ? | Central overview; Plus adds attack alerts, queue lengths ? (support.travian.com 7000062844) |
| Mass build / recruit | Account Manager (paid) automates building and recruiting ✓ list only; mass-recruit screens documented for TW2 only ✓ (kb/TribalWars2/en_DK/1563) | Not found ? |
| Saved raids against abandoned villages | Loot/Farm Assistant sends template raids from the map; Premium per a 2017 guide ? (tribalguide.blogspot.com/2017/01/premium.html) | Farm lists with "Start all" ? (blog.travian.com 2023/01 quality-of-life-vol-3); sources disagree whether Plus or Gold Club |
| Idle-troop income | Scavenging, free base, Premium raises yield ✓ (kb/TribalWars/en_DK/3002) | — |
| Quick bar / hotkeys | Quickbar is Premium ✓ (kb/…/1295); hotkeys ? | Hotkeys not found ? |
| Notes | Notebook is a Premium perk ✓ (list only, kb/…/1296) | Notepad listed as a Plus feature ? |
| Attack planning | No official planner found; community scripts (and a free official Script Library, ✓ kb/…/6023) | Third-party tools only ? |
| Reports | Folders, filters ? (kb/…/5970 snippet) | Filters, share with alliance, auto-delete ? (7000066609) |
| Seeing incoming attacks | Community guides cover timing tricks; official page ? | Attack warning / map movements are Plus per one snippet; Kingdoms shows troop types, not numbers ? |
| Sitting / vacation | Account sitting free; sitter loses attack, support and trade rights after a set time ✓ (kb/…/1291) | Sitter via the sitting function; vacation days per round ? (travian.ru/international/gamerules) |
| Notifications / mobile | App with push for messages and attacks (store listing ✓ apps.apple.com id435365767); Account Manager adds custom attack notifications (Premium) | Attack alerts are Plus ?; mobile app was in limited test ? |
| Beginner help | Getting-started pages; quests ? | Build tasks, beginner protection 3–5 days + 3 ? |
| Tribe progression | Prestige and tribe skills ✓ (kb/TribalWars/en_US/articles/78) | Alliance overview of attacks with filters ? |
| Rule on scripts | Only Script-Library scripts allowed on newer worlds ✓ | Scripts or bots that mimic Plus features forbidden ? |

Read-across: **the convenience layer (overviews, raid templates, notes, quick bar, attack alerts) is where the genre makes money
and where its players complain most** (`GENRE_COMPARISON.md` §2: pay-to-win is complaint #1). A free version of that layer is
our clearest chance to be better, not just different. Honest limit: Travian pages mostly did not load, so its column is
thin.

### Our side, updated (from a source inventory of `apps/web` + the live walks)

| Area | `GENRE_COMPARISON` said (11-05) | Now |
|---|---|---|
| Conquest | "being built" | **Built**: Chieftains, hold, Renown; strike form with escort helper. Ours stays fairer (hours, not milliseconds) |
| Siege | Log Ram / Boulder Sling | **Built**: Firecart; Wrightyard. (Battle report siege line still uses old line icons; computer players never build siege) |
| Several villages | missing | **Built** (switcher, shipments) but **no overview, no mass actions** |
| First steps / onboarding | missing | **Built** (card + phone sheet, Mags the Tinker tips); desktop shows one step only; no "what next" after 9/9 |
| Incoming attacks | "being built" | **Built** (chip everywhere, bell, Tribe Alerts, walking army on map); no help request, no "in time?" check |
| Scouting | 5 tiers + Lookouts | Tiers built; Lookout/Watchtower exist; scout report wording confusing |
| Tribe progression | tribe projects planned | **Built** (Store, Roads, Watchtower, Wards) |
| Reports | filters wanted | Filters + unread built; **no Won/Lost filter, folders, delete, share ("soon")** |
| Raid lists | recommended #4 | **Still missing** (only saved troop groups and a "Recent targets" list that the Map doesn't fill) |
| Steward / sitting | recommended #6 | **Still missing** (only the caretaker bot, which the player can't control) |
| Notes, hotkeys, phone push, installable app | not covered | **Missing** (no manifest, no service worker; only in-tab browser notifications) |
| Paid advantages | decide the shop | **Premium queue removed 2026-11-04**; no payment code. Keep it that way |

## 4. Top 10 improvements, ranked by player value per effort

Effort: S = a day or less, M = a few days, L = a week or more. "Rules" = fits the owner's standing rules (attack/support only,
no new trip types or formulas; one page per feature that fits 1440x900 without scrolling; phone 360 px; light Parchment look;
no paid advantage; own design). Every item that adds an endpoint needs server tests and the `SECURITY_ROADMAP.md` §4 gate
(ownership checks, size caps, rate limits) — noted once here, not repeated.
Pace effect: none of them change how fast a player grows; they only save clicks and guesswork.
The text sketches below are design sketches only: all names and numbers in them are made up.

### 1. All-villages overview — "Realm" page  · M · fits rules: yes (own page, tab/More entry)
- **Player gets:** one screen that shows every village and which one needs me, instead of opening each.
- **How it works:** a page with one row per village: name and place, stock with "full in 2h", what is being built, what is being
  trained, troops at home vs away, an attack badge with countdown. Rows that need attention (idle queue, storage full, attack
  coming) float to the top. Click a row to switch. No new rules; it only reads what the server already knows (a light
  `/api/villages` list exists). Phone: one card per village.
- **Saves:** "which village is idle?" from ~10 clicks to 0; "see all attacks and which village" from 2 screens to 1.
```
 REALM                                            [Attention first ▾]
 ┌──────────────────────┬────────────────────┬──────────────┬─────────┐
 │ Village              │ Stock (full in)    │ Doing        │ Troops  │
 ├──────────────────────┼────────────────────┼──────────────┼─────────┤
 │ ! Brannoch 3 (-7|-24)│ W 64k ▓▓▓▓ 51m    │ nothing built│ 4.2k    │
 │   ⚔ Attack in 3h 9m  │ F  7k ▓▓░░         │ training —   │ 0 away  │
 ├──────────────────────┼────────────────────┼──────────────┼─────────┤
 │   Brannoch 2 (-1|-26)│ W 17k ▓▓▓▓▓ FULL   │ Wall 8 · 12m │ 535     │
 └──────────────────────┴────────────────────┴──────────────┴─────────┘
 click a row = go there      [Send resources…] [Build in all…] (item 10)
```
- Genre: sold (Premium overviews in TW; Plus extras in Travian). Ours free = clearly better.
- Screens today: `L5-02-switcher-open-desktop`, `L5-05-after-4-queues-desktop`, `L5-08-switcher-phone`.

### 2. "Raid again" and readable reports  · S · fits rules: yes
- **Player gets:** a repeat button and reports they can tell apart.
- **How it works:** every battle report gets **Send again** (same target, same saved group, one confirm). Report titles carry
  the village and result ("Raided ruin (23|5) — lost 5 raiders, 0 loot"). Add a Won/Lost filter, "mark all read", "delete read".
  Fold in the known old line-icon siege line of the battle report. The raid-again action is just a normal attack.
- **Saves:** repeat of one raid from 6 clicks (find village, type count, send) to 2; the three identical report lines in
  `L2-09-reports-three-raids-desktop` become three readable ones.
```
 Reports ▸ Battles ▾ [All|Won|Lost]            [Mark all read]
 ● Raided ruin (23|5)  · lost 5 of 6 · loot 0        2h ago
 ○ Raided ruin (18|8)  · won · loot 340              5h ago
 ─ report ──────────────────────────────────────────────────
   Attack 192  vs  Defence 155 · wall 7 …
   [ Send again with “Raid squad” ]  [ Simulate ]  [ Share (soon) ]
```
- Screens today: `L2-09-reports-three-raids-desktop`, `L2-22-reports-phone`, `L4-08-battle-report-desktop`.

### 3. Target memory and honest strength  · S (M if the server must store more)  · rules: yes, **owner call on what the map may reveal**
- **Player gets:** no more blind raids; the map remembers what happened.
- **How it works:** the map panel for any village shows "Last raid: lost, defence seen 523, 2 days ago" built from the player's
  own reports, and the scout report separates "no troops there" from "your scouts could not see". The "Strong ≤ 30 troops" label is
  replaced by a range the player can trust (what range is a balance decision for the economy/troops sessions). "Simulate" fills
  the defender from the last report instead of starting empty. The First-steps raid points to the weakest nearby ruin.
- **Why first-raid matters:** in the walk the First-steps raid was ticked as done and rewarded after a lost fight, which
  teaches the wrong lesson to every newcomer in a running world.
```
 Abandoned village · 18|8          Distance 8.1 fields
 STRENGTH  looks strong   (you last saw 523 defence)
 YOUR HISTORY  ✗ lost 6 raiders (2d ago)   ✓ won (5d ago, loot 340)
 [ Scout first ]  [ Simulate with last report ]  [ Send attack ]
```
- Screens today: `L2-10-map-panel-after-raids-desktop`, `L4-05-scout-report-desktop`, `L1-23-test-only-desktop`.

### 4. "Is my help in time?" for support  · S · rules: yes
- **Player gets:** a tribe-mate who sends help knows whether it lands before the attack.
- **How it works:** in the support form and on Tribe › Alerts, show "Lands 9h 12m **after** the attack — too late" or "Lands
  4 min before: in time", and the latest send time as a countdown. The alert's Support button greys out with the reason when
  no village of mine can make it. Pure arithmetic on times the server already has; no troop counts are revealed.
- **Saves:** a wasted 5-click send; makes defending a team game.
- Screens today: `L6-08-alert-support-click-desktop`, `L6-09-support-form-desktop`.
```
 SUPPORT -23|24   under attack at 16:41 (in 14 min)
 Your help arrives 02:57 tomorrow     ✗ 9h 12m too late
 Closest of your villages that can make it: none
 [ Send anyway ]   [ Tell the tribe I can't make it ]
```

### 5. Raid lists (saved targets for abandoned villages)  · M · rules: yes — only attack, no new trip type
- **Player gets:** raid all my favourite ruins in one click, free.
- **How it works:** a **Raid book** page (opened from the Army tab and the map panel's "Add to raid list"). Each row: village,
  distance, last result, last defence seen, loot per trip (from item 3's memory). Pick a squad (a saved troop group) and press
  **Send to ticked rows**: the server makes ordinary attacks, one per row, limited by troops home. Rows that lost last time
  start unticked with a warning. Sort by "best loot per hour". Limits: 30 rows per list, the existing 200-march cap, no
  automatic sending by timer (nothing that acts while the player is away) — that keeps it a convenience, not a bot.
- **Saves:** 3 raids from 9 clicks to 3 (tick, tick, Send); 20 raids from ~60 to ~4.
```
 RAID BOOK · squad: [Raid squad (16 raiders) ▾]   ruins in range: 9
 ☑ 23|5  8.1 f  last ✓ 340   def ~155   ·loot ready 3h
 ☑ 21|7  7.2 f  last ✗ lost  def 707 ⚠   unticked
 ☐ 18|8  5.0 f  never raided
 [ Send squad to ticked (2) ]   Arrives 14:02 / 14:20
```
- Genre: paid template tool in TW ?, Gold/Plus list in Travian ?; players also reach for scripts. Ours free also answers the
  "scripts" rule question.
- Depends on items 2 and 3.

### 6. Incoming-attack sheet — "what can I do now"  · M · rules: yes (uses attack/support and builds only)
- **Player gets:** one clear screen when an attack is coming, with real options and an honest time check.
- **How it works:** the red chip opens a sheet (not the Army page) that names the village hit, arrival clock time, the
  attacker's village, owner, tribe and points, and "history with you". Below, buttons:
  1. **Ask the tribe for help** — posts a card to tribe chat and Alerts with village, arrival time and "who can make it" (item 4);
  2. **Scout the attacker** — opens the map panel ready to send scouts;
  3. **Raise defence in time** — lists build/recruit orders and marks which would **finish before the landing** ("Wall 8 → 9 done in 6 min ✓");
  4. **Send troops to safety** — support to another of my villages (only if the engine allows support to one's own village; if not, drop this button, don't invent a trip type);
  5. **Simulate** — prefilled with what I know.
  Size stays "unknown" without the Watchtower, but the sheet says so and points to the project.
```
 ⚔ ATTACK on Brannoch 3 (-7|-24)           lands 16:41 · in 13m 53s
 from Odalys's village (5|-20) · Odalys [RFT] · 12,400 pts   size unknown (no Watchtower)
 ┌ What can I do ───────────────────────────────────────────┐
 │ [Ask tribe for help]   [Scout Odalys]   [Simulate]       │
 │ Build before landing:  Wall 8→9  6m ✓   Pikemen ×50 11m ✓│
 │ [Send my troops to Brannoch 2 (support)]                 │
 └──────────────────────────────────────────────────────────┘
```
- Also fixes: header chips no longer overflow (collapse to one chip + sheet); phone sheet rows fit 360 px; tribe badge and bell
  agree on what they count.
- Screens today: `L3-01-chip-click-desktop`, `L3-04-army-incoming-selected-desktop`, `L3-11-bell-phone`, `L3-A-army-phone`.
- Free "better than genre": ours would tell the defender what finishes in time; neither genre game does in the pages found.

### 7. Away-safe: idle warnings, installable app, free phone alerts  · M · rules: yes (no paid advantage — alerts are free)
- **Player gets:** knows what happened while away, and gets a phone alert for an incoming attack without paying.
- **How it works:** (a) the bell and Realm page warn "storage full in 40 min" and "nothing queued in 2 villages"; (b) make the web
  app **installable** (manifest + service worker, icon) and add web-push for incoming attacks and tribe alerts, off by default,
  asked on a button; (c) a "welcome back" card after a day: what arrived, what finished, what is waiting. Notifications are
  throttled (existing "minimum attack size" idea) so fake attacks can't spam.
- Today: no manifest, no service worker; browser notifications only while a tab is open. The day-away test left all
  resources at the cap with nothing queued.
- Genre: attack alerts are an Account Manager/Plus perk ?; the app has push. Free push in the browser is our edge.
- Caution: push services need a real HTTPS host and VAPID keys: a deployment piece for `DEPLOYMENT_PLAN.md`. Safari phone
  push needs the app added to the Home Screen: say so on the screen.

### 8. First steps shown in full + a trustworthy first raid  · S · rules: yes
- **Player gets:** the first hour has a visible path.
- **How it works:** the desktop First-steps card gets the same list as the phone sheet (9 steps, rewards, the next one
  highlighted); after step 9 a "next goals" card (second village at Renown X, first tribe, first scout) instead of just a Standing
  card; the "raid an abandoned village" step only completes on a *won* raid and suggests the weakest ruin (item 3). Add "come back
  in 7 minutes" under the card when only timers remain, so the 3-hour wait for the first raid result is explained, not mysterious.
- Screens today: `L1-03-first-village-desktop`, `L1-43-steps-sheet-phone`, `L1-31-battle-report-desktop`.

### 9. Notes and tags on villages and players  · M · rules: yes (private by default; tribe-shared opt-in)
- **Player gets:** a memory for the world: "this one hits at night", "farm every day", "enemy staging village".
- **How it works:** a one-line note (200 characters) and a colour tag (farm, danger, friend, plan) on any village or player,
  shown in the map panel, Raid book, reports and the incoming sheet. Tribe leaders may publish a note to the tribe (the planning
  surface for coordinated defence, without a separate planner). Server stores plain text only, escaped on display, size-capped.
- Genre: Notebook is a Premium perk in TW; Notepad is Plus in Travian ?. Free here.
- Not needed first: an attack planner or exact-arrival timer; our hold-based conquest does not depend on millisecond timing.

### 10. "Do it everywhere" actions on the Realm page  · M · rules: yes (uses existing builds, training, shipments)
- **Player gets:** manage 4+ villages without 10 clicks per chore.
- **How it works:** on the Realm page: **Build in several** (pick a building, tick villages, queue where affordable, each shown
  with its own result), **Train squad in several**, and **Send resources to one village** (tick sources, press once: ordinary
  shipments, limited by market capacity). No automation, no timers; every row reports what it could and couldn't do.
- **Saves:** same building in 4 villages from 10 clicks to 3; collecting stock for a big build from ~7 clicks per source to 1 per source.
- Screens today: `L5-05-after-4-queues-desktop`, `L5-07-ship-form-desktop`.

### Just below the top 10 (decide later)
- **Steward** (a tribe-mate looks after your village while you sleep): limited scope — queue builds, call troops back, send support, no
  attacks, no gold, a 3-day cap per week and a visible log. Answers the "waking up at night" complaint that the genre has
  (`GENRE_COMPARISON.md` §2) better than a locked-out sitter. L, needs a careful security pass.
- **Tribe member overview** (who has what, distance-only "can reach in time") and a tag picker for diplomacy: M.
- **Report sharing links** (the Share button says "soon"): S–M.

### Quick fixes found in the walks (not ranked — small)
1. Header overflow at 1440 when 2+ villages are attacked (bell/avatar pushed to x 1547–1649).
2. Phone Alerts sheet rows run to x 448; countdown cut off.
3. Loot tile number wraps at 1440 ("3,85 / 4").
4. Building page "All buildings" second column clipped on the right.
5. "All troops" also sends Pathfinders on a raid; "Simulate" opens with empty defender.
6. Army page on phone is 4,300–6,000 px tall; show incoming and movements first.
7. Drillyard page: ~1,331 px content in a 900 px frame with no scrollbar (known; confirmed).
8. "Blocked" buttons give no reason (food/people, Longhouse, Town Hall?).
9. Tribe tab badge counts everyone's attacks, the bell counts only yours — label which is which.

### Known issues folded in
- **Drillyard ~1,400 px tall:** confirmed (1,331 in the walk). Re-layout as two columns or paged tabs so it fits 1440x900.
- **Call-back window of 2 game minutes:** the Cancel button with its live countdown is clear; keep. Note for the owner: it is
  short enough that most players never use it; any change is a balance call, so not proposed here. Show the window in the "Attack sent" toast.
- **Computer players never build siege and stop growing about day 100:** for the experience this means late-game worlds feel
  frozen (the day-87 walk found ruins and computer villages all "Strong" yet static). Not solved by any item above; it belongs in
  the economy/troops sessions' lists.
- **Battle-report siege line icons:** folded into item 2.

## 5. Verdict summary

| Loop | Verdict | One line |
|---|---|---|
| First 15 minutes | Equal | Clearer start than the genre, but the first raid in a running world is a trap |
| Daily loop | Behind | No repeat, no target list, identical reports; the genre sells exactly this |
| Defending | Equal / behind on action | Great alert, no "what can I do" and no time check |
| Attacking a player | Equal | Good panel and Chieftain hold; no notes, no history |
| Several villages | Behind | No overview, 10 clicks for one chore |
| Tribe life | Equal | Strong alerts and projects; no member overview, no help request |

## 6. What I would do first (one safe order)
Items 2, 3, 4 and the quick fixes are all **S** and can ship together in a few days. Then **1 (Realm)** and **5 (Raid book)**
(both M, both build on the first group), then **6**, then **7**. Items 8–10 can slot between. Item 7's push needs the real
deployment first.

## 7. Sources
- Tribal Wars (InnoGames support, pages read ✓ unless noted): Premium perks `support.innogames.com/kb/TribalWars/en_DK/1296`;
  glossary `…/1295` (conflicts with the Script Library page on whether scripts/quickbar need Premium); account sitting `…/1291`;
  scavenging `…/3002`; Script Library `…/6023`; tribe skills `…/en_US/articles/78`; Account Manager `…/1297`; TW2 mass build
  `…/TribalWars2/en_DK/1563`; reports `…/5970` (snippet ?); Getting Started `…/2960`; App Store listing
  `apps.apple.com/gb/app/tribal-wars/id435365767`; farm-assistant history `tribalguide.blogspot.com/2017/01/premium.html` (third party ?);
  defence guide `tribalguide.blogspot.com/2017/01/defense-guide.html` (third party).
- Travian (almost all UNVERIFIED — support pages did not load): central overview `support.travian.com/support/solutions/articles/7000062844`;
  farm lists `…/7000064015`; construction `…/7000062813`; troop movements `…/7000064016`; reports `…/7000066609`; protection
  `…/7000060689`; village list `…/7000063623`; alliance attacks `…/7000082344`; game rules `travian.ru/international/gamerules`;
  blog "Start all button" `blog.travian.com/2023/01/quality-of-life-vol-3-start-all-button-and-abandoned-farmlists`.
  Travian **Kingdoms** Plus read in full ✓ (`support.kingdoms.com/en/articles/164-travian-plus`): convenience only, no combat edge — but it is a
  different edition from Legends.
- Our side: `docs/GENRE_COMPARISON.md`, `docs/GENRE_REVIEW.md`, source inventory of `apps/web` (routes in `game.ts`, switcher
  `VillageSwitcher.tsx`, first steps `FirstSteps.tsx`, army `FrameArmy.tsx`, reports `frame-reports-logic.ts`, notifications
  `notifications.ts`), `NEXT_STEPS.md`, and the live walks (screens in `design/proposals/experience/`).
