# Clanfire — game design (v0.1)

Original browser strategy game. Players each own a village on a shared square world map,
grow it with four resources, train troops, raid abandoned villages and (later) fight other
players together with their tribe. Web first, mobile browsers next: every screen must work
with touch at 360 px wide.

Numbers live in `packages/engine/src/config.ts`; types in `packages/engine/src/types.ts`;
the HTTP contract in `packages/engine/src/api.ts`. This file holds the **rules and formulas**.
When a rule changes, change it here in the same commit.

## 1. Time and world speed

- All times are ms since epoch. Durations in config are at speed 1.
- `speed` (WorldSettings) multiplies production and upkeep, and divides every duration
  (build, train, travel, protection, abandoned-village growth). Dev servers run fast (e.g. 10).
- Nothing runs on a timer inside the engine. State is brought up to date lazily with
  `settleVillage(state, t, settings)`; the server also processes troop movements in time order.

## 2. Resources

`wood`, `food`, `iron`, `gold`. Stored as floats; players see `Math.floor`.

- Production per hour (speed 1) of building level L for lumber→wood, farm→food, mine→iron,
  goldmine→gold: `L == 0 ? PRODUCTION_LEVEL0 (gold: 0) : round(PRODUCTION_BASE[b] * PRODUCTION_GROWTH^(L-1))`.
  Multiply by `speed`.
- **Food upkeep.** Every unit eats `upkeep * speed` food per hour while queued for training, at home
  or away. Net food per hour = farm production − upkeep. Training is refused if it would make net
  food negative (`not_enough_food`). Net food can only go negative through rule changes; settlement
  then clamps food at 0 (no starvation in v1). Abandoned villages pay no upkeep.
- **Population** (second limit next to food, owner 2026-11-03). Used = building population + troop
  population. Building at level L takes `ceil(POP_BUILDING_FIRST[b] * POP_BUILDING_GROWTH^(L-1))`
  (queued levels are reserved when queued; the Farm takes 0). Each troop takes `POP_PER_UNIT[u]`
  whether at home, away or queued for training. Cap = `popCapForLevel(farm level)` (level 0:
  `POP_CAP_LEVEL0`, else `round(POP_CAP_BASE * POP_CAP_GROWTH^(L-1))`). A build or training order
  that would push used above the cap is refused (`population_full`); losses free population. Checked
  server-side in `planBuild`/`planTrain`. Abandoned villages are exempt. Numbers in `config.ts`.
  Tuning (2026-11-04, Tribal-Wars-like feel): growth 1.10 (buildings) / 1.20 (cap) so a fully built village
  uses roughly 1,650 of the ~4,800 cap at Farm 20, leaving about 3,100 for troops (about 65%); early game unchanged.
  The top bar shows a "Population used / cap" chip next to the resources for the current village (own row
  under the resources on phones), with a mini meter and warning colour from 90% (`aria-label` "Population X of Y").
- **Storage cap** (same for every resource) from the storehouse level:
  `L == 0 ? STORAGE_LEVEL0 : round(STORAGE_BASE * STORAGE_GROWTH^(L-1))`. Production stops at the
  cap. Anything added (refunds, loot coming home) is also clamped to the cap.
- **Market** (start level 0, needs Town Hall 3, max level 10): gates resource shipments and sets their size
  (section 13). Art: placeholder (Storehouse sprites) until a Market sprite exists.
- **Vault** protects `L == 0 ? 0 : round(VAULT_BASE * VAULT_GROWTH^(L-1))` of each resource from loot.

## 3. Buildings

Fixed set (`BUILDINGS`), each with a level, 0 = not built. New player villages start at
`startLevel` for each building.

- Cost of level L: each resource `round(baseCost[r] * costGrowth^(L-1))`.
- Build time of level L in ms:
  `round(baseTimeSec * timeGrowth^(L-1) * HALL_TIME_FACTOR^(hallLevel-1) / speed * 1000)`,
  using the Town Hall level when the job is queued.
- **Intended pace at speed 1** (config: `baseTimeSec` hall 600, lumber/farm 360, mine 420, gold mine 1500, storehouse 480, barracks 900, stables 1800, wall 720, vault 540; `HALL_TIME_FACTOR` 0.95): first levels ~6–15 min, mid levels ~1–3 h, late levels ~8–24 h depending on Town Hall; basic troops ~3–5 min each (`trainTimeSec` pikeman 270, guard 330, raider 300, outrider 600 (population 2, food upkeep 3), knight 1320, pathfinder 180; `TRAIN_TIME_FACTOR` 0.94).
- Requirements: `requires` must be met (current levels, not queued) to start level 1 and every later level.
- **Queue:** at most `MAX_BUILD_QUEUE` (2) jobs per village for players without a premium subscription,
  `MAX_BUILD_QUEUE_PREMIUM` (5) for premium subscribers (`buildQueueLimit(premium)`; the server reads the
  player's `premium` flag, never the client). Cost paid when queued. A job starts at
  `max(now, finishAt of the previous job)`. Queuing the same building twice targets the next level
  after the queued one (target = current level + jobs for it in queue + 1). Refuse with:
  `max_level` (target > maxLevel), `requirements_not_met`, `exceeds_storage` (any cost > cap — can never
  be afforded), `not_enough_resources`, `queue_full`.
- **Cancel** (owner, 2026-11-03): `POST /api/villages/:id/cancel-build {index}` cancels the newest job only
  (later levels depend on earlier ones); `cancel-train {building,index}` cancels any batch (units already
  trained stay, later batches move up). Only `CANCEL_REFUND_PERCENT` (80%) of the paid cost (of the untrained
  rest for training) comes back, rounded down, capped by the storehouse; the rest is lost. The client shows a
  confirm dialog with the amounts before and a toast after. `POST /api/villages/:id/cancel-research {index}`
  cancels a queued Drillyard research the same way (80% of its cost back; index 0 = running: the next queued
  research then starts right away; waiting ones move up; the unit can be researched again). Queues belong to the village: if a village ever
  changes owner (no conquest exists yet), its builds and training must carry on unchanged.
- Effects: hall → faster building; lumber/farm/mine/goldmine → production; storehouse → cap;
  barracks/stables → faster training (`TRAIN_TIME_FACTOR^(L-1)`) and unit unlocks; wall → defense;
  vault → loot protection.

## 4. Units and training

Five units (`UNITS`): infantry Pikeman (anti-cavalry defense), Shieldbearer (anti-infantry defense),
Raider (attack); cavalry Outrider (fast raider, big carry) and Knight (elite, costs gold).

- Train batch of `count` (1..MAX_TRAIN_BATCH) in the unit's building. Cost = unit cost × count, paid
  up front. Needs `requires` met. At most `MAX_TRAIN_QUEUE` batches per building.
- Time per unit (ms): `round(trainTimeSec * TRAIN_TIME_FACTOR^(buildingLevel-1) / speed * 1000)`,
  fixed when queued. A batch starts at `max(now, end of previous batch in that building)`;
  end = startAt + count × perUnitMs. Units finish one by one; each finished unit moves to `troops`.
- **Research gate (Drillyard, see §15):** Shieldbearer, Outrider and Knight have `UnitDef.research`
  (Drillyard level to start, cost, time). They can only be trained after the research finished in that
  village (`VillageState.researched`); refusal is `requirements_not_met`. Research queue per village
  (`VillageState.researchQueue`): `MAX_RESEARCH_QUEUE` (2: one running, one waiting) without a premium subscription,
  `MAX_RESEARCH_QUEUE_PREMIUM` (4) with one (`researchQueueLimit(premium)`; server reads the flag). Cost is paid when
  queued; jobs run one after another; the same unit can't be queued twice (full queue is `queue_full`);
  time is divided by world speed. Pikeman, Raider and Pathfinder need none. Villages saved before the Drillyard
  keep every unit they already have (home, away or queued count as researched; abandoned villages never train).
- Upkeep for the whole batch counts from the moment it is queued (so training never changes the
  food rate later — this keeps settlement simple).

## 5. Settlement — `settleVillage(state, t, settings)`

Pure; returns a new state with `lastUpdate = t`. If `t <= lastUpdate` return the state unchanged.

1. Walk build jobs that finish at or before `t`, in order. For each: add production from the
   current time to `finishAt` (at the rates before the upgrade), clamp to cap, then raise the level
   and drop the job. Then add production from the last point to `t`.
2. For each training batch: finished = clamp(floor((t − startAt) / perUnitMs), 0, count);
   move `finished − done` units into `troops`; drop batches with done = count.
3. Abandoned villages: apply growth (section 8).

Resource accrual for a span: `amount = clamp(amount + ratePerHour * hours, 0, cap)` but never
reduce an amount that is already above the cap (only stop it growing).

## 6. Map, distance, travel

- World tiles `x, y` in `[-radius, radius]`. Distance is Euclidean: `sqrt(dx² + dy²)`.
- An army moves at the speed of its slowest unit. Travel ms =
  `ceil(distance / (slowestSpeed * speed) * 3_600_000)`.
- Sending: target must be a village tile other than your own village; at least one unit; you must
  have the units at home. Units move from `troops` to `away` when sent.
- Arrival → battle (section 7) → survivors travel home along the same route at their own slowest
  speed, carrying loot. On return: `away` −= survivors, `troops` += survivors, resources += loot (clamped).
  Units lost in battle are removed from `away` at battle time.
- **Terrain** is decoration in v1 (`terrainAt(x, y, seed)`: grass, forest, hills, mountain, lake),
  deterministic from the seed so the client draws it without asking the server. Villages are never
  placed on mountain or lake tiles. Use smooth value noise so terrain forms patches, not static.

## 7. Battle — `resolveBattle({ attackerUnits, defender, seed })`

Deterministic for a given seed (`mulberry32`).

1. `luck = rng() * 2 * BATTLE_LUCK − BATTLE_LUCK`.
2. Attack: `A_inf`, `A_cav` = Σ count × attack per class. `A = (A_inf + A_cav) * (1 + luck)`.
3. Share of infantry `si = A_inf / (A_inf + A_cav)`, `sc = 1 − si`.
4. Defense: `D_units = Σ count × (defenseInfantry × si + defenseCavalry × sc)` over defender troops
   at home. `D = (D_units + WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL × wall) × (1 + WALL_BONUS_PER_LEVEL × wall)`.
5. If `A > D`: attacker wins. Attacker loses `round(count × (D/A)^BATTLE_LOSS_EXPONENT)` of each
   unit; every defender unit dies.
   Else defender wins: defender loses `round(count × (A/D)^BATTLE_LOSS_EXPONENT)` of each unit;
   every attacker unit dies.
6. Loot (attacker won only): capacity = Σ survivors × carry. Lootable per resource =
   `max(0, floor(amount) − vaultProtection)`. Fill evenly ("water-filling"): split remaining capacity
   equally over resources that still have lootable stock; repeat until capacity or stock runs out.
   Loot values are integers.

`applyBattleToDefender(defender, result)` removes defender losses and the loot.

## 8. Abandoned villages

Computer-run villages for players to raid. They have `npc` info and no owner.

- Created at world start: `round((2r+1)² × npcDensity)` villages at random free tiles (seeded),
  at least `NPC_MIN_SPACING` (Chebyshev) from each other. Tier from `NPC_TIER_WEIGHTS`.
- Start levels for tier T: hall T; lumber, farm, mine, storehouse 2T; wall, vault and gold mine T−1;
  others 0. Wood, food and iron start at half the cap; gold at `NPC_START_GOLD_PER_TIER × T` (their
  gold mine adds more over time, so stronger abandoned villages are the gold source). Garrison starts full.
- Full garrison = `NPC_GARRISON_PER_HALL[u] × hallLevel` for each unit.
- **Growth:** every `npcGrowthHours / speed` hours since `createdAt` is one step. Step n raises
  `NPC_GROWTH_ORDER[n % length]` by one level (skip buildings at `NPC_MAX_LEVEL`; if all are maxed,
  nothing grows). **Abandoned villages never recruit** (owner, 2026-11-03): the garrison they have
  stays as it is, it is never refilled. Apply at most `NPC_MAX_STEPS_PER_SETTLE` steps per settle; production between steps uses
  the levels at that time (accuracy within one step is fine).
- They produce resources like player villages (no upkeep), which is what raiders take.

## 9. Players, spawn, protection

- Register → one village named "<username>'s village" at a random free tile anywhere in the world
  (not mountain/lake, at least `SPAWN_MIN_SPACING` from every village). Up to 2000 random tries, then
  scan outward from a random tile.
- **Expanding layout** (`layout: 'expanding'`, env `WORLD_LAYOUT`; owner, 2026-11-03; `npm run dev` uses it with
  radius 250 = 501×501 tiles and its own database `clanfire-world.sqlite`). The world starts with only
  abandoned villages in rings around the empty centre (`EXPAND_START_RINGS`, same tiers as always).
  A newcomer lands at a random point of a disc of radius `EXPAND_CORE_RADIUS + sqrt((players+1) ×
  EXPAND_TILES_PER_PLAYER / π)` (grows with the player count; wider disc if crowded), and brings
  `NPC_RING_BASE` abandoned villages at evenly spaced angles `NPC_RING_MIN_RADIUS..MAX_RADIUS` tiles
  around them, plus up to `NPC_RING_EXTRA_MAX` extra ones, each with chance `NPC_RING_EXTRA_CHANCE`,
  so early raiding is close by and the owner of a village grows fast. Existing abandoned villages are never removed.
  In this layout **every abandoned village (start rings and newcomer rings) starts exactly like a new player
  village** (start levels and resources, same small garrison) and grows in its **own random building order**
  (`npc.growthSeed`, a seeded shuffle of `NPC_GROWTH_ORDER`), so they develop in different directions.
  The default layout is `'scattered'` (everything above, random anywhere).
- Terrain shares are tuned so mountains, lakes and forest leave room for many players (mountain+lake < 15% of tiles).
- Beginner protection: nobody can attack the player's villages until
  `createdAt + protectionHours / speed`. It ends early when the player attacks another *player*
  (raiding abandoned villages keeps it).
- Points = sum over buildings of the points of each built level (shown on the map). Level L of a building adds
  `round(BUILDING_POINTS_BASE[b] × 1.2^(L-1))` points, so high levels are worth far more (a new village starts at 40;
  a maxed village is ~10,000). Map stages start at 0 / 100 / 300 / 800 / 1800 / 3500 points. The building panel and
  the construction queue show the points the next level adds.

## 10. Engine public API (`packages/engine/src/index.ts`)

Everything is pure and synchronous; inputs are never mutated.

```ts
// data
export * from './types.ts'; export * from './config.ts'; export * from './api.ts';
// random + math
mulberry32(seed: number): () => number          // [0,1)
hashSeed(...parts: number[]): number              // stable 32-bit mix, e.g. hashSeed(worldSeed, x, y)
distance(a: Coords, b: Coords): number
emptyUnits(): Units; emptyResources(): Resources; totalUnits(u: Units): number
// economy
buildingCost(b: BuildingId, level: number): Resources
buildTimeMs(b: BuildingId, level: number, hallLevel: number, s: WorldSettings): number
productionPerHour(state: VillageState, s: WorldSettings): Resources   // gross, speed applied
upkeepPerHour(state: VillageState, s: WorldSettings): number          // 0 for npc
netProductionPerHour(state: VillageState, s: WorldSettings): Resources // food minus upkeep
storageCap(state: VillageState): number
vaultProtection(state: VillageState): number
canAfford(r: Resources, cost: Resources): boolean
// lifecycle
createPlayerVillage(t: number): VillageState
createNpcVillage(tier: number, t: number): VillageState
settleVillage(state: VillageState, t: number, s: WorldSettings): VillageState
// actions: check* never throws; apply* settles to t first and throws GameError when the check fails
checkBuild(state, b, t, s): CheckResult<{ targetLevel: number; cost: Resources; timeMs: number }>
applyBuild(state, b, t, s): VillageState
trainTimeMs(u: UnitId, state: VillageState, s: WorldSettings): number
checkTrain(state, u, count, t, s): CheckResult<{ cost: Resources; perUnitMs: number }>
applyTrain(state, u, count, t, s): VillageState
armySpeed(units: Units): number                    // slowest unit's tiles/hour, 0 if none
travelTimeMs(from: Coords, to: Coords, units: Units, s: WorldSettings): number
checkSend(state, units: Partial<Units>): CheckResult<{ units: Units }>   // normalises to full Units
applySend(state, units, t, s): VillageState        // troops -> away
resolveBattle(input: BattleInput): BattleResult          // input.support: stationed contingents
resolveScouting(input: ScoutInput): ScoutResult
checkMission(mission: Mission, units: Units): CheckResult<{}>
isSupportAllowed(relation: PlayerRelation): boolean      // tribe | ally
normalizeUnits(u: Partial<Units> | undefined): Units     // missing keys -> 0
normalizeVillage(state: VillageState): VillageState      // fills missing unit keys etc. (old saves)
applyBattleToDefender(defender: VillageState, r: BattleResult): VillageState
applyAttackerLosses(origin: VillageState, losses: Units): VillageState    // away -= losses
applyReturn(origin: VillageState, survivors: Units, loot: Resources, t, s): VillageState
// world
terrainAt(x: number, y: number, seed: number): Terrain
isBuildableTerrain(t: Terrain): boolean
generateNpcPlacements(s: WorldSettings): Array<Coords & { tier: number }>
findSpawnLocation(isOccupied: (x: number, y: number) => boolean, rng: () => number, s: WorldSettings): Coords
protectionEndsAt(createdAt: number, s: WorldSettings): number
villagePoints(state: VillageState): number
```

`findSpawnLocation`'s `isOccupied(x, y)` returns true if a village stands on that exact tile; the
function itself checks spacing by probing the surrounding tiles.

## 11. Tribes

Players band together in tribes. Numbers in `config.ts` (`TRIBE_*`, `PACT_NOTICE_HOURS`); shared
rule helpers in `packages/engine/src/tribes.ts`; HTTP contract at the end of `api.ts`.

**Founding and identity.** Any tribeless player whose Town Hall is at least `TRIBE_FOUND_HALL_LEVEL`
can found a tribe and becomes its leader. Name: normalized with `normalizeTribeName`, then
`checkTribeIdentity`; unique case-insensitively. Tag: `normalizeTribeTag` (upper-case), 2–6 A–Z/0–9,
unique. Both are permanent in v1. Description up to `TRIBE_DESCRIPTION_MAX` characters (plain text;
the client must render it as text, never HTML).

**Membership.** A player is in at most one tribe. At most `TRIBE_MAX_MEMBERS` members (`tribe_full`).
Recruitment mode (leader/officers can change it):
- `open` — any tribeless player joins at once.
- `application` — players apply with a short message (max `TRIBE_APPLICATION_MESSAGE_MAX`); officers
  accept or decline. A player may have `PLAYER_MAX_APPLICATIONS` open applications; joining any
  tribe withdraws the rest.
- `invite` — invitations only. (Invitations also work in the other two modes.)
Invitations: officers+ invite by username (tribeless or not — they can accept only once tribeless);
at most `TRIBE_MAX_OPEN_INVITES` open per tribe; one open invite per player per tribe; expire after
`TRIBE_INVITE_TTL_HOURS` real hours. Accepting checks the member cap again.

**Roles and permissions** (`TRIBE_PERMISSIONS`, `canTribe`, `canKick`): leader (exactly one), officers,
members. Officers can edit settings, invite, handle applications, run diplomacy and remove members;
only the leader removes officers, sets roles, transfers leadership (old leader becomes officer) and
disbands. Anyone can leave, except the leader while other members remain (transfer first). When the
last member leaves, the tribe is disbanded. Disbanding removes all memberships, invites,
applications, proposals, relations and the forum.

**Individual rights.** Effective right = role default OR an explicit grant stored on the membership
(`tribe_members.grants`, JSON, re-validated on read). Only the leader sets grants
(`PUT /api/tribe/members/:id/permissions`); logged in the tribe event log. Grantable (`TRIBE_GRANTABLE`):
`invite`, `handle_applications`, `kick` (still never over officers or the leader), `diplomacy`,
`edit_settings`, `forum_manage`, `forum_moderate`, `view_activity`. Never grantable (leader only): `set_roles`,
`transfer_leadership`, `disband`, changing grants. Grants are kept when the role changes and cleared
when the member leaves or is removed. The tribe state carries `rights` (the caller's effective list).

| right | leader | officer | member (default) |
|---|---|---|---|
| edit_settings, invite, handle_applications, kick, diplomacy | yes | yes | grant |
| forum_manage, forum_moderate | yes | yes | grant |
| view_activity | yes | yes | grant |
| set_roles, transfer_leadership, disband | yes | no | never |
| chat | yes | yes | yes |

`view_activity`: the caller's own tribe view adds `lastActive` (from `players.last_active`, written at most every
5 min) and `online` (active within `ONLINE_WINDOW_MS`, 10 min) to each `TribeMemberDto`; omitted without the right
and in public tribe views. The client shows "Online" or "Offline · last seen 3d ago".

**Forum.** Members only (everyone else gets `not_found`); text and emoji only. Boards (max
`FORUM_BOARDS_MAX` = 8; defaults Announcements [leadership starts threads], General, Leadership
[visible to leadership]) have `visibility` (`members`|`leadership`) and `postRule` (who starts threads).
Leadership = leader, officers and members with `forum_moderate` or `forum_manage`. Replies need a
visible board and an unlocked thread. `forum_manage`: create/rename/delete boards, set visibility and
post rule. `forum_moderate`: pin, lock, delete threads, delete any post. Authors edit their own posts
for 15 minutes (moderators editing their own: any time) and delete their own posts; deleting the first
post deletes the thread. Limits (`FORUM_*` in config.ts): 3000 characters per post, 80 per title,
200 threads per board (oldest unpinned dropped), 500 posts per thread, per-member 3 s gap, 6/min, 60/h.
Posts stay (with the author's name) when a member leaves. Unread = threads with a post newer than the
member's read marker (their join time at first); `forumUnread` feeds the Tribe tab badge. Tribes that
predate the forum get the default boards when the forum is first opened.

**Diplomacy** — one relation per pair of tribes:
- `ally` and `nap` (non-aggression pact): one tribe proposes, the other accepts or declines; the
  proposer can withdraw. Limits per tribe: `TRIBE_MAX_ALLIES` allies, `TRIBE_MAX_NAPS` NAPs (active +
  pending outgoing). Accepting replaces any existing relation between the pair (e.g. ends a war).
  Only one pending proposal per pair.
- `enemy`: declared by one tribe, takes effect at once, visible to both. Not allowed while an
  alliance/NAP between the pair is active or serving notice. Either side may cancel it at once.
- Cancelling an alliance/NAP starts a notice of `pactNoticeMs(settings)` (24 h ÷ world speed). It
  keeps protecting both sides until `endsAt`; both tribes see the countdown. Expired relations are
  ignored on read and cleaned up lazily.

**Effects on attacks** (`isAttackForbidden`): you can't attack your own villages, members of your
tribe, allies or NAP partners. The server checks at send time (`invalid_target` for own tribe,
`target_protected` for pacts, with a clear message) and again on arrival: if the relation became
protected while troops marched, they turn back without a battle (report `outcome: 'called_off'`).
Enemy status has no rule effect in v1 beyond colour (it marks who you're at war with).

**Map colours by relation**: self (gold), tribe (green), ally (blue), NAP (purple), enemy (red),
neutral players (orange), abandoned (grey-brown). Villages show their tribe tag.

**Tribe page**: overview (name, tag, rank, points, members, recruitment, description), member list
with role and points, relations, pending proposals, invitations, applications, an event log
("anna joined", "Alliance with [WOLF] accepted", …; last `TRIBE_EVENTS_KEEP` kept) and tribe chat
(plain text, max `TRIBE_CHAT_MESSAGE_MAX` chars, last `TRIBE_CHAT_KEEP` kept, polled while open).
Tribe list = ranking: all tribes by points (sum of members' points; ties → older tribe first),
searchable by name/tag.

**Details settled while building v0.2** (keep consistent):
- All tribe routes need sign-in. `join` only works on `open` tribes and `apply` only on `application`
  tribes (403 otherwise); both refuse a full tribe. Invites may be sent while the tribe is full; accepting re-checks.
- Invitations count in the badge only while the player is tribeless; an invite to a player who joined
  elsewhere stays and reappears if they leave (until it expires). Applications don't expire.
- Limit reached / duplicate / "leader must transfer first" → `requirements_not_met` (409); missing
  permission or wrong recruitment mode → `forbidden` (403).
- Diplomacy: a pact already in force can't be proposed again, but one serving notice can (accepting
  renews it). Proposals during a war are fine; accepting replaces the war. Declaring enemy deletes a
  pending proposal between the pair. Pacts in notice count toward caps; accepting needs room on the
  accepting side too.
- Arrival re-check is judged at the arrival time; a pact whose `endsAt` equals the arrival no longer
  protects. Only the attacker gets the "called off" report; beginner protection (ended by sending) isn't restored.
- Text (descriptions, applications, chat): NFC-normalized; control characters, bidi overrides and
  lone surrogates rejected; newlines allowed; lengths counted in code points. Chat limit: 1 message/s
  and 20/min per player.
- Event log: joins, leaves, kicks, role changes, leadership transfer, settings, diplomacy; disbanding
  or an ended pact is also logged in the other tribe. Invites/applications aren't logged.

### Rankings
Players are ranked by the sum of their villages' points (top 100 shown, ties share a rank, then by name; the caller's own place is always shown). Tribes are ranked by the sum of their members' points (see above). Both lists are in the Ranks tab.

## 12. Tribe warfare — scouts, support, alerts

Numbers in `config.ts` (`SCOUT_*`, unit `pathfinder`); contract in `api.ts` (`SendRequest.mission`,
`StationedDto`, recall/send-back routes, `TribeAlertDto`, report `type`s).

**Missions.** Every send carries `mission`:
- `attack` — as before (sections 6–7). Needs total attack > 0 (`invalid_input`: "Pathfinders can't attack
  alone — send them on a scouting mission"). Forbidden on self/tribe/ally/NAP; beginner protection applies.
- `scout` — Pathfinders only (any other unit → `invalid_input`), at least one. Same targets as attack
  (forbidden on self/tribe/ally/NAP; protected players refused; abandoned villages allowed). Never shown to
  the target as incoming. Sending a scout or an attack at a *player* ends the sender's beginner protection.
- `support` — any units, only to a village whose owner is in your tribe or an ally (`isSupportAllowed`);
  never to yourself, NAP partners, neutrals, enemies or abandoned villages (`invalid_target`). Visible to the
  host as incoming support (with units).
Travel time is the same for every mission (slowest unit). Engine: `checkMission(mission, units)`; an empty
army is `no_troops` for every mission. An exact scouting tie counts as failure (and, like a battle tie, costs
the defenders all their Pathfinders).

**Scouting** (`resolveScouting`, no luck): defending Pathfinders = the village's own at home + all stationed
support Pathfinders. If `scouts > defenderScouts × SCOUT_DEFENSE_FACTOR`: success — sender loses
`round(scouts × (D/scouts)^SCOUT_LOSS_EXPONENT)` where D = defenderScouts × factor (0 when D = 0); defenders
lose none. Else failure — all scouts are caught; defenders lose `round(defenderScouts × (scouts/D)^exp)`.
Survivors return home (no loot). Reports: the sender always gets one (`type: 'scout'`); on success with
`intel` = resources (floored), building levels, troops at home (own + support) and wall level at arrival.
The target's owner gets one only if they had at least one defending Pathfinder ("N enemy Pathfinders from
X were spotted — they escaped / were caught"). Re-check on arrival: if the target became tribe/ally/NAP
while marching, the scouts turn back (no report needed beyond the movement).

**Support troops.** On arrival they become a *stationed contingent* at the host village (one per home+host
pair; new arrivals merge). They stay in the owner's `away` count, so the owner keeps paying their food.
They defend in every battle at the host: `resolveBattle({..., support: [units...]})` adds them to defense
and applies the same loss rule per contingent (attacker wins → all die; defender wins → each loses
`round(count × ratio)`); dead units also come off the owner's `away` (`applyAttackerLosses` on the home
village). Loot is only ever taken from the host's resources. Each support owner gets a battle report
(`side: 'support'`). Re-check on arrival: if the host is no longer a tribe-mate or ally, the troops turn
back and the sender gets a `type: 'support'` report (`reason: 'relation_changed'`). Once stationed they
stay even if the relation changes later, until the owner **recalls** them (all or some units) or the host
**sends them back** (all); both create a normal return movement from the host to home.

**Battle reports with support:** `supportUnits`/`supportLosses` are the totals of all contingents; hidden
from the attacker exactly when defender units are hidden.

**Tribe alerts.** `GET /api/tribe/alerts`: every incoming *attack* (not scouts, not support) on any member's
village, soonest first, with attacker village, owner and tribe tag. `tribeAlerts` in `/api/state` counts
them for the Tribe tab badge. From an alert, members can open the target on the map and send support.

**Details settled while building v0.3:** scout losses on the defending side hit the host's own Pathfinders
first, then support contingents by size (largest remainder; support owners get no report for that yet).
A support turn-back report has `outcome: 'called_off'`, `side: 'support'`, `won: false`. The sender's scout
report always shows `defenderScoutsLost`; `defenderScouts` and intel only on success. Merged support keeps its
first `arrivedAt`. Support needs the sender to be in a tribe; a pact serving notice still counts as ally.
Recall/send-back: strangers 404, wrong party 403; recall with no body = all units. Tribe alerts list is capped
at 200 (the badge counts all); tribeless callers get 409 `not_in_tribe`. Old databases: `movements`/`reports`
tables are rebuilt in place on start (ids kept) because their CHECK constraints changed.

**Saved data.** Adding a unit changes `Units`: anything loaded from storage (village state, movement and
stationed units, report JSON) must go through `normalizeVillage` / `normalizeUnits`, which add missing
unit keys as 0.

## 13. Resource shipments

A player can send wood, food, iron and gold from a village to any village: their own other
villages, tribe-mates, allies, NAP partners, neutrals, enemies and abandoned villages (owner, 2026-11-03).
Accounts that share a connection (`refuseHousehold`) cannot send each other resources.

- **Send** (`POST /api/villages/:id/ship`): amounts are whole numbers >= 0, total > 0, at most the village's
  stock (after catch-up) and at most the carrier capacity `SHIPMENT_BASE_CAPACITY (300) +
  SHIPMENT_CAPACITY_PER_MARKET_LEVEL (200) * Market level` of the sending village. **The sending village needs a
  Market (level >= `SHIPMENT_MIN_MARKET_LEVEL`, 1)**, else `requirements_not_met`; receiving needs none.
  The cargo leaves the village immediately.
  A village may have at most `SHIPMENT_MAX_IN_TRANSIT` (5) shipments on the road.
- **Travel**: `ceil(distance / (SHIPMENT_SPEED (8 tiles/h) * world speed))` hours. Sending does not touch
  beginner protection (receiving or sending resources is peaceful).
- **Arrival**: the cargo is added to the target (player or abandoned), each resource capped at the storehouse;
  **the overflow is lost**. Only if the sending village no longer belongs to anyone does it turn round (`return`, carrier speed).
- **Visibility**: sender and receiver see the movement with its cargo (`MovementDto.resources`).
- **Reports** (kind `shipment`, side `shipment`, `ShipmentReportData`): when a shipment is delivered the sender gets
  "Shipment delivered" and the receiver (if another player) "Shipment received", each with sent / stored / lost
  (lost = overflow past the storehouse). A shipment that turns round produces no report.
- **Cancel** (all outgoing orders: attack, scout, support, shipment): the sender may cancel within
  `CANCEL_WINDOW_MS` (2 minutes, real time, not scaled by world speed) of departure and before arrival
  (`POST /api/movements/:id/cancel`, `MovementDto.cancellableUntil`). The order becomes a `return` that leaves now
  and arrives after exactly the time already travelled (minimum 1 s: cancel after 30 s, home in 30 s), so
  cancel-and-resend cannot shorten a trip. Troops/cargo come home, nothing is looted, no report. Returns cannot be
  cancelled; others' movements answer 404; a late cancel answers 409 `too_late`.
- **Report kinds** overall: attack (sender, `side attack`), defence (village owner, `defense`), "Your troops at X
  were attacked" (owners of stationed troops, `support` side, battle type), support turned back, scout, shipment.
- Code: `packages/engine/src/shipment.ts`, `GameService.sendShipment/resolveShipment`, web `map/ShipmentForm.tsx`.

### Sandbox (test mode)

Accounts named in the server env `SANDBOX_USERS` (comma list, compared lowercase; default `metinaltinbas`; empty =
nobody) may call `POST /api/sandbox/max` and `POST /api/sandbox/reset`; everyone else gets 403 `forbidden`.
`PlayerDto.sandbox` tells the client to show Settings > Test mode. **Max**: every building of every village of the
player at max level, each store full, `SANDBOX_ARMY_PER_UNIT` (500) of every unit at home (troops already away
stay), build/train queues cleared. **Reset**: each village becomes a fresh starting village (`createPlayerVillage`),
with its own outgoing movements and own stationed support removed; works at any time. World speed is never
changed. **Warp** (`POST /api/sandbox/warp {seconds}`, 0–3600): every movement sent from, returning to or heading for
the player's villages that is due later arrives in `seconds` from now (0 = immediately resolved). **Empty abandoned villages** (`POST /api/sandbox/clear-abandoned`, no body): every
abandoned village is settled to now and its troops set to zero (garrisons never refill). **Own timing**: `POST /api/villages/:id/send` also
takes `travelSeconds` and `returnSeconds` (integers 0–86400, test-mode accounts only, others get `forbidden`): the way out takes exactly that long, and
the way home after the battle or scout (stored on the movement as `return_secs`). Calls are logged (`sandbox action`). Code: `engine/src/sandbox.ts`, `GameService.sandbox`, web
`components/SettingsDialog.tsx` (opened from the account menu).

### Mail (player-to-player messages)

Inbox-style mail, not live chat. Text and emoji only: no images, attachments, links with markup or HTML; the body is
stored and sent as plain text and the client renders it as text (line breaks kept). Same character rules as tribe chat
(control characters, lone surrogates and bidi overrides are refused with `invalid_input`; tab and newline are fine).
- A mail has a sender, one recipient (chosen by username, case-insensitive), a subject (0 to `MAIL_SUBJECT_MAX` = 60
  characters) and a body (1 to `MAIL_BODY_MAX` = 2000 characters, counted in characters, trimmed). You cannot mail yourself;
  an unknown username is `not_found`.
- Each side has its own copy: deleting hides it for that side only; the row is removed when both sides deleted it.
  Only sender and recipient can read or delete a mail; anyone else gets `not_found`.
- The recipient reading a mail marks it read. The number of unread mails (`unreadMail` in `/api/state`) is the badge on the Mail tab.
- Each recipient keeps at most `MAIL_INBOX_KEEP` = 200 mails. When full, their oldest read mail is dropped to make room;
  if all 200 are unread the new mail is refused (`queue_full`, "inbox is full").
- Spam guard per sender: at least `MAIL_MIN_GAP_MS` (2 s) between mails, `MAIL_PER_MINUTE` (6) per minute and
  `MAIL_PER_HOUR` (60) per hour (`rate_limited`).
- Lists page by 30 (`MAIL_PAGE_SIZE`), newest first, with a 120-character preview. There is no blocking yet.
- Code: `engine/src/config.ts` (numbers), `api.ts` (contract), `server/src/mail-store.ts`, `mail-service.ts`, `routes/mail.ts`,
  web `views/MailView.tsx`.

## 16. Player statistics and achievements

- Lifetime counters per player (`player_stats`, one column per `STAT_KEYS` entry in `engine/src/achievements.ts`), counted
  by the server in the same transaction as the event; there is no write endpoint. Never credited to abandoned villages.
  - Raids: `lootWood/Food/Iron/Gold` (floor of the battle loot, counted when the battle resolves, not when it arrives home),
    `attacksWon/Lost`, `abandonedRaided` (won raids on ownerless villages).
  - Kills: `troopsKilled` = the opponent's losses (attacker: home defenders + all support; defender: attacker losses;
    a support owner gets a head-count share of the attacker's losses), `troopsLost` = own losses (incl. stationed
    support and scouts). `defencesWon/Lost` for the village owner only. Scouting: `scoutsSent`, `scoutsSucceeded` per mission.
  - Orders: `buildingLevelsBuilt` and `troopsTrained` at order time (player orders only; the caretaker bot is not counted),
    `shipmentsSent` and `resourcesShipped` at send, `supportSent` when support arrives and is stationed.
- ~20 achievements (`ACHIEVEMENTS`), each reading one counter (or a sum), with bronze / silver / gold thresholds in
  `ACHIEVEMENT_TIERS` (`config.ts`). `achievementProgress(stats)` gives value, tier 0-3 and next threshold (null at gold).
- `GET /api/players/:id` returns `stats` and `achievements`; the profile sheet in the Ranks tab shows badge cards (tier colour,
  progress bar, locked state) and the statistics list.

## 17. Caretaker bot (idle owners)

- Offline progress needs no bot: production, build queues and training are timestamp based and settled lazily
  (`settleVillage`), so a village read 24 h later has produced resources and finished its queue (test:
  `apps/server/test/caretaker.test.ts`).
- `players.last_active` is stamped on login and on authenticated requests, at most once per `ACTIVITY_WRITE_INTERVAL_MS`.
  Existing accounts are stamped at the upgrade. An owner is idle after `BOT_IDLE_DAYS` (divided by world speed).
- A server job every `BOT_PASS_INTERVAL_MS` handles at most `BOT_BATCH_VILLAGES` due villages (indexed on
  `villages.bot_next_at`) whose owner is idle and not banned. Per village: settle to now, then up to
  `BOT_MAX_STEPS_PER_RUN` times pick ONE random affordable upgrade (`botBuildChoice`, weights `BOT_BUILD_WEIGHTS`,
  seeded by village id + step, so it is deterministic) and queue it through the normal build rule
  (`checkBuild`/`applyBuild`: cost, storage, requirements, max level, population cap, regular queue length). Then
  `bot_next_at = now + BOT_STEP_HOURS / speed`.
- The bot never trains troops, researches, ranks up, or sends movements, shipments or support; troop buildings and
  the Drillyard have weight 0. Nothing to undo: the owner's next request moves `last_active` forward and the
  village is theirs again at once. Abandoned villages already grow by section 8 and are left alone.
- **Abandonment** (owner, 2026-11-03): the same job first releases villages whose owner has been away for
  `ABANDON_IDLE_DAYS` (30, divided by world speed): `owner_id` becomes NULL and the name "Abandoned village". The stored
  state is untouched, so troops stay and queued builds/training carry on, and the village can be raided like any
  abandoned one. Movements already under way finish normally. The player keeps the account; on their next login or
  request without any village they get a fresh village and new beginner protection. Nothing else changes (owner,
  2026-11-03): a tribe member or leader who lost all villages stays in the tribe with the same role and rights and starts
  again like a new player; no automatic leave or leadership handover.
  Support the player had stationed in other villages simply stays there (owner, 2026-11-03): the host can send it
  home (it lands in the now-abandoned village); nothing is deleted. The returning player gets no access to those old troops or villages (not listed, not
  recallable; owner, 2026-11-03). Messages and tribe membership stay. Notice: each abandoned village adds 1 to
  `players.abandoned_notice`; `PlayerDto.abandonedNotice` (`{ villages, idleDays }`, days = `ABANDON_IDLE_DAYS / speed`)
  shows a banner on the village view ("You were away for N days, so your villages were abandoned ... you start over
  with a new village") until the player dismisses it (`POST /api/me/abandoned-notice/dismiss`).
- Security gate: the abandonment job has no input. The dismiss endpoint is own-account only, takes no body, writes one
  column and is covered by the global rate limit. The caretaker bot only reads and writes the owner's own village through
  the build planner, so it cannot send resources or troops to anyone.

## 14. Roadmap (not yet built)

1. Tribe forum threads, mass messages, member notes; player-to-player messages.
2. More villages per player (settlers / conquest), market trading, siege units vs. wall.
3. Live push (WebSocket) for incoming attacks and chat; mobile polish (PWA, install prompt).
4. World lifecycle: player/tribe rankings history, inactive players turning into abandoned
   villages, world end and winners.
5. New visual identity (style directions in progress), characters, isometric map; 3D models later.
6. Troop ranks, Armory, scout intel tiers — see §15 (proposal).
7. Seasons with Fire Shrines, taking villages, rest hours, terrain, tribe projects, cosmetics shop — see §18 (proposal, needs owner approval).

## 15. DECIDED, NOT BUILT YET (see owner answers below) — troop ranks, Armory, scout intel tiers

Asked by the owner 2026-11-03. Today units have no levels and a successful scout always reveals
everything (§12). Goals: scouting reveals *tiers* of information; troops can be improved, but a
village can never max everything, so players specialise (attack village, defence village, scout village).

**What Tribal Wars does (from memory, not verified; we borrow only the idea, never names/numbers):** a research
building lets unit types be upgraded under a limited per-village upgrade budget, so players choose which units to
improve. We keep the idea of a scarce budget but design our own system.

**Armory (new building).** Needs Barracks 3 + Town Hall 5, max level 10. Level L gives
`ARMORY_POINTS_PER_LEVEL (3) × L` **Training Points** *per village* (30 at level 10).
- Each unit has up to two rank tracks, rank 0–5: **Edge** (attack) and **Guard** (defence, both classes). Pathfinders
  have **Sight** instead (they do not fight). Buying rank r costs `r` points (1+2+3+4+5 = 15 per track) plus
  resources and research time (all in config).
- Effect per rank: +4% on that stat (max +20%); Sight: +10% scout duel strength per rank.
- The budget makes maxing everything impossible: 5 fighting units × 2 tracks × 15 = 150 points vs 30 at best.
  Typical choices: one village maxes Edge on raiders + outriders (30), another maxes Guard on pikemen + guards.
- **Respec:** reset one unit track to rank 0, **free (no gold)** (owner, 2026-11-03): the points return in full, the
  resources paid for the ranks are lost, so a village can change role (offence ↔ defence) but it still costs real resources.
- Ranks belong to the **home village** of the troops. Away/support troops fight with their home village's ranks,
  stamped on the movement at send time so a later respec can't change a march in flight.
- Server-authoritative: new table `unit_ranks(village_id, unit, track, rank)` and research jobs like training.
  Engine: `resolveBattle` takes optional per-unit multipliers; all numbers in `config.ts`.

**Scout intel tiers** (Sight rank of the sending village, on a *successful* scout):

| Sight | Reveals |
|---|---|
| 0 | resources (floored) only |
| 1 | + troops at home as rough bands (e.g. "about 50") |
| 2 | + exact troops at home and stationed support |
| 3 | + wall level |
| 4 | + all building levels |
| 5 | + the defender's Edge/Guard ranks and Armory level |

The defender's own Pathfinder Sight adds to its side of the duel. Failed scouts reveal nothing (as today).

**Owner answers (2026-11-03), these override the numbers/names above where they differ:**
1. Names "kinda okay, maybe change" → proposed new names (easy to swap, they live in config/UI strings only):
   Armory → **Drillyard**, Edge → **Might**, Guard → **Bulwark**, Sight → **Keen**.
2. **Every village has its own Training Points** for its Drillyard level (not per account). Ranks belong to the village.
3. Bonus is a stepped per-rank percentage like the genre's unit upgrades, with our own numbers: **+5% per rank, max +25%**
   (replaces the 4% / +20% above; `RANK_BONUS` in config).
4. **Ranks never change speed or carry** — only attack, defence (Might/Bulwark) and scout strength (Keen).
Still open: a "what you could see at higher Keen" hint in scout reports.
Status (2026-11-03, latest): **ranks reach battles and scouting.** The home village's ranks are stamped on each attack/scout/support
movement when it leaves (a respec in flight changes nothing); the defender fights with its current ranks; a support contingent defends
with the stamp of its newest arrival. The scout duel uses Keen on both sides, and a successful scout's intel depends on the sender's Keen
(0 resources, 1 rough troops, 2 exact troops, 3 wall, 4 buildings, 5 ranks + Drillyard level); numbers in `config.ts` (`SCOUT_INTEL_KEEN`,
`SCOUT_APPROX_STEP`). Drillyard has its own sprites. Older notes follow.
Status (2026-11-03, later): **server endpoints built** (`POST /api/villages/:id/research|rank|respec`, owner-only, server clock,
schema-validated, saved in the village's `state_json`; research completes in `settleVillage`, which unblocks Shieldbearer/Outrider/Knight
training) and the web Drillyard panel is built. Still not built: ranks stamped on movements/battles in the server (the engine takes them,
the server does not pass them yet), scout intel tiers. Earlier status: **engine built.** The building is called **Drillyard** (it stands in for the
"Armory" name above, per the owner's rename). Engine: `drillyard.ts` (`checkResearch/applyResearch`, `pointsTotal/pointsSpent`,
`checkRank/applyRank`, `checkRespec/applyRespec`, `mightMultiplier/bulwarkMultiplier/keenMultiplier`), optional
`VillageState.researched/researchQueue/ranks`, numbers in `config.ts` (`DRILLYARD_POINTS_PER_LEVEL` 3, `RANK_MAX` 5, `RANK_BONUS` 0.05,
`KEEN_BONUS` 0.1, `RANK_COST`). Ranks are bought one at a time (instant; rank r costs r points plus `RANK_COST[r-1]`);
Might not on Pathfinder, Keen only on Pathfinder, the unit must be researched or free. Respec resets one track to 0: points return in full,
resources do not, no gold fee. `resolveBattle` takes optional `attackerRanks`, `defenderRanks`, `supportRanks` (Might on attackers; Bulwark
on the village's own troops and on each support contingent with its own home ranks); omitted = identical to before. Not built: server
tables/endpoints, stamping ranks on movements, scout intel tiers (Keen stored only), web panel.

**Build order if approved:** config + types → engine (rank multipliers in `resolveBattle`, tier filter on intel,
tests) → server (table, research queue, security gate per SECURITY_ROADMAP §4) → web (Armory panel with a points
bar, tiered scout report) → preview + CHANGELOG.

## 18. PROPOSAL (needs owner approval): what makes Clanfire different

Written 2026-11-04. **Nothing here is built and nothing here is a rule yet.** Each part says how it would work,
why it is fair, first numbers for `config.ts`, what it needs, a size, and what the owner has to decide. When a
part is approved and built, move its rules into the normal sections above in the same commit.

Project rule: every name, number, formula and screen below is our own. The genre gave us the *kind* of game
(villages, raids, tribes), nothing else. Where an idea is common in the genre (taking villages, a world that
ends), the way it works here is different on purpose. This proposal replaces the conquest sketch in
`BALANCE.md` §4 (a loyalty meter that drops with each hit) with the owner's "put out the fire, then hold it"
idea; it keeps that sketch's Banner Hall and gold-limited unit, renamed **Chieftain**.

Sizes: **S** = a day or less, **M** = a few days, **L** = about a week or more (same scale as `GENRE_REVIEW.md`).

### 18.0 The big picture

Clanfire's promise in one sentence: **a season is a story with an ending, and the land, the clock and the tribe
all matter.**

| Pillar | What the player feels | Part |
|---|---|---|
| A season with a finish line | "We are playing for something, and in nine weeks everyone starts fresh." | 18.1 |
| Villages are won by holding, not by one click | "They put our fire out, we have twelve hours to answer." | 18.2 |
| The game respects sleep | "I can sleep without waking up poorer." | 18.3 |
| The land matters | "The mountain is between us, so the real road goes round." | 18.4 |
| A tribe builds together | "Our shipments built the watchtower." | 18.5 |
| Money buys looks, never strength | "I support the game and nobody is stronger for it." | 18.6 |

How they connect: seasons give the goal (Fire Shrines); shrines are sites on the map (18.4); taking and holding
sites reuses the troop-stationing rules; tribe projects make a tribe tougher at holding them; rest hours make
conquest fair across time zones; badges and cosmetics are what players keep when the season ends.

Prerequisites from `GENRE_REVIEW.md` Part C that should land **before** conquest, because conquest raises the
stakes: secret battle seed (#6), tame abandoned-village farming and upkeep rebalance (#3, #4), cap on stationed
support (part of #9; 18.4 adds the cap for sites).

---

### 18.1 Seasons (about nine weeks), won by tribes holding Fire Shrines; badges kept

**How it works**
- One season = one world (the multi-world setup already gives each world its own server and database; the
  lobby lists "Season 3 · week 4 of 9"). At the end the world turns **read-only** (a Hall of Fame page: final
  tribe ranking, player ranking, shrine history) and a new world opens with a fresh map. **Nothing that gives
  power carries over.** Only badges (and cosmetics, 18.6) do.
- Season length is **real time**, 63 days (9 weeks), for the normal speed-1 world. A faster world has the same
  phases scaled by its speed, like every other duration. The owner can pick 56 or 70 days in config.
- **Phases** (days counted from world start):

| Days | Phase | What is different |
|---|---|---|
| 0–13 | **Kindling** | Normal game. No shrines. Tribes form. Beginner protection as today. |
| 14–20 | **Embers** | The Fire Shrines wake on the map with a stone-and-militia garrison. Tribes may take them, but they score nothing yet. This week is for fighting over positions. |
| 21–41 | **Blaze I** | Held shrines score. Each shrine-hour counts ×1. |
| 42–55 | **Blaze II** | Each shrine-hour counts ×2. Comebacks are still possible. |
| 56–62 | **Last Light** | Each shrine-hour counts ×3. At the end of day 62 the season is over. |

- **Fire Shrines** are map sites (18.4) with fixed spots, laid out from the world seed: one **Great Fire** at the
  empty centre and **eight shrines** on two rings (4 inner, 4 outer). The Great Fire is worth 3 points per hour
  held, each other shrine 1. The rings sit inside the area that newcomers settle (the expanding layout's disc
  has radius about `8 + sqrt(players × 150 / π)`, so ring radii 35 and 85 are inside the settled area once
  about 120 players have joined). No shrine is on a mountain or lake, and no village is placed within 4 tiles.
- **Holding**: a tribe holds a shrine while it has troops stationed there and no other tribe has beaten them
  out (rules in 18.4). A tribe's score only grows by hours held; there is no "capture the flag at the last
  second" jump, so sniping at the last minute is worth almost nothing.
- **Score**: every hour, each held shrine adds `points × phase multiplier` to its tribe. To keep one
  super-tribe from running away, the tribe's hourly gain is multiplied by `1 − 0.07 × (shrines held − 1)`
  (never below 0.6). Holding 5 shrines pays about 3.6 times one shrine, not 5 times.
- **Winner**: highest score at the end of day 62. Ties go to the tribe with more shrine-hours in Last Light. The
  top 3 tribes are named. Alliances do not share a win: only the tribe wins (the allies can still be named in
  the Hall of Fame).
- **Joining late**: new accounts can enter until day 45 (`SEASON_JOIN_CLOSES_DAY`); after that the world is
  closed to newcomers and the lobby points them to the next season's sign-up (opens 7 days before the end).
- **Badges** live on the **account** (lobby database `account_badges`), not in the world, so they follow the
  player into every later season. They give no power, only a mark on the profile and in tribe member lists:

| Badge | Earned by |
|---|---|
| Season Winner / Runner-up / Third | Member of a top-3 tribe at the end, in that tribe for at least 14 days, and active (signed in 3+ days in the last 14) |
| Shrine Keeper | Had troops stationed at a shrine for 24+ hours in total |
| Great Fire Keeper | The same at the Great Fire |
| First Strike | Own tribe took a shrine first in the season |
| Pathfinder's Mark, Wall of the Season, Raid Leader | Top 3 players of the season by scouting / defences won / loot (from the existing statistics, §16) |
| Veteran I–V | Seasons finished with the account (a season counts after day 21 with a village) |
| Pioneer | Played in season 1 (can never be earned again, so it stays rare) |

**Why it is fair**
- Everyone starts level on the same day in a fresh world; badges cannot be bought and give no stats.
- The "14 days in the tribe" and "active" rules stop people joining the winner on day 60 for a badge.
- The soft cap on hourly gain and the late multipliers keep the race open into the last week.
- Players who join late (day 40) still get a world that lasts 3 more weeks and a normal beginner start.

**Rough numbers for `config.ts`**
`SEASON_DAYS` 63, `SEASON_KINDLING_DAYS` 14, `SEASON_SCORING_START_DAY` 21, `SEASON_MULTIPLIERS` `[{day 21, ×1}, {day 42, ×2}, {day 56, ×3}]`,
`SEASON_JOIN_CLOSES_DAY` 45, `SHRINE_RING_RADII` `[35, 85]`, `SHRINE_COUNT_PER_RING` 4, `SHRINE_POINTS_PER_HOUR` 1,
`GREAT_FIRE_POINTS_PER_HOUR` 3, `SHRINE_SPREAD_PENALTY` 0.07, `SHRINE_SPREAD_FLOOR` 0.6,
`BADGE_MIN_TRIBE_DAYS` 14, `BADGE_MIN_ACTIVE_DAYS` 3.

**What it needs**
- Engine: `season.ts` (phase for a given day, score per hour, multiplier, ranking and tie-break), shrine placement from the seed; all pure and tested.
- Server: a `season` row on the world (start time, phase), an hourly score tick that catches up lazily like `settleVillage` (so downtime loses nothing), `tribe_season_score` table, a read-only mode flag that makes every write route answer 403 after the end, a `final results` snapshot, and a signed call to the lobby that writes badges (lobby verifies the world's key; an operator CLI command can also grant or revoke a badge).
- Lobby: `account_badges` table, badge list on `/lobby/api/me`, world list shows season phase and week.
- Web: season banner (phase, week, countdown), shrine markers and a score board on the map and in the Tribe tab, Hall of Fame page, badge row on the profile.
- Security: the score tick has no user input; badge writes need the world key; the read-only flag is checked in one place.

**Size: L** (M for engine + server score and phases, plus M for lobby badges + Hall of Fame + web).

**Open questions for the owner**
1. 63 days, or 56 / 70? 9 weeks was your wording ("8–10").
2. Should a tribe be able to win early (e.g. hold 6 of 9 shrines for 7 days in a row)? I suggest **no**: a fixed finish keeps everyone playing and keeps the world schedule predictable.
3. Should allies be allowed to win together (a shared top place)? I suggest no.
4. Should the season world stay open to look at forever, or be deleted after 30 days to save server cost?
5. Do you want a small head-start for veterans (for example a different village name colour)? I suggest only looks, never stats.

---

### 18.2 Taking villages: put out the fire, then hold it

**How it works**
Every village has a **Hearth**, drawn as the campfire in the middle of the town square. A hearth is **lit** or **out**.
A village changes owner in two steps:

1. **Strike.** An attack that contains **Chieftains** and wins the battle (every defender dead) puts the hearth
   out, if at least `need` Chieftains survive. `need` is 1 for a village under 4,000 points, 2 from 4,000, 3
   from 8,000 (a fully built village is about 10,000). The surviving Chieftains do not go home: they stay
   at the cold hearth as the first occupiers. Losses from the battle follow the normal rules (§7). The Chieftain
   is a weak fighter (attack 0, defence 10), so he needs an escort.
2. **Hold.** From the moment the hearth is out, the attacker must keep **occupiers** (their own troops stationed
   at the village, same rule as support, arriving as a new mission `occupy`) of at least `HOLD_MIN_POPULATION`
   (150 population) in the village. The **hold clock** starts at 12 hours (6 for abandoned villages) and runs
   only while enough occupiers are there. When it reaches zero the village changes owner.

While the hearth is out, the owner can still fight and can still send support. What changes in the cold village:
**nothing is produced, nothing new can be trained, and the village is not shown as safe on the map** (a cold
village has a grey ring and a thin line of smoke). Orders already in the queues carry on.

**How the owner (and friends) fight back**
- Any battle at the cold village is a normal battle between the occupiers and the attackers on the owner's side
  (the owner's other villages and tribe-mates' support). **If the occupiers fall under 150 population, the clock
  stops; if they are all dead, the hearth relights at once** and the claim ends. If they stay under 150 for 2 hours
  in a row the claim also fails and the remaining occupiers are sent home.
- Every member of the owner's tribe sees an alert "Hearth out at <village>" at the moment of the strike, plus the
  hold clock on the Tribe alerts list (the clock is also visible to the attacker, so both sides see the same time).
- A third player can also attack the occupiers; if they destroy them and bring a Chieftain they start their own
  claim. Otherwise the village is simply relit.

**When the clock ends**
- The village changes owner. Buildings and stock stay, except the **Wall and Banner Hall go back to level 0**
  and the village starts with a fresh protection: **no new Strike for 24 hours** (`STRIKE_LOCK_HOURS`). Normal
  attacks (raids) are still possible.
- Build, train and research queues carry on for the new owner (this is the existing rule in §3).
- The occupiers **move in**: they become the village's own troops, up to its population cap (extra ones go
  home on a return movement). Their food is paid by the new village, not by the old home.
- The old owner's troops and the support of others that were still inside are sent home.
- Points move to the new owner at once (the ranking already adds up all of a player's villages).

**Abandoned villages**: the same two steps but the hold is only 6 hours and needs 1 Chieftain at any tier. This
is the safest way to get a second village and gives the abandoned villages a new purpose. (They start at the
state a new player village has; their growth is kept.)

**Owning several villages**
- A player can own up to `VILLAGE_LIMIT_BASE (1) + highest Banner Hall level` villages. The Banner Hall (max level 4 in this
  proposal, one level more than in `BALANCE.md`) is built once; the limit therefore tops out at **5 villages**.
- A new village is named "<name>'s village 2" until renamed. Everything that is "per village" (queues, ranks, population,
  Market) already exists per village. The web top bar already has a "current village" switch for this.

**Why it is fair**
- It costs a lot (gold-limited Chieftains, a strong escort, a hold force) and takes real time, so it is an
  event, not a click. The hold gives the defender **a fixed window to answer** that both sides can see.
- Big villages need more Chieftains, so a player cannot snowball by taking everything at the top of the ranking.
- **A player's last village cannot be struck** (`LAST_VILLAGE_SAFE`). Nobody is wiped out and nobody has to quit. They can
  still be raided. (Open question 3.)
- The attacker's hold force is far from home and exposed, which is what lets a smaller tribe win a defence.
- New owners get a 24-hour lock, so a village cannot be flipped back and forth in a night.
- Beginner protection still blocks Strikes. Accounts that share a connection cannot attack each other (existing
  guard), and tribe-mates cannot strike each other (existing `isAttackForbidden`), so villages cannot be "given" by
  fake conquests inside a tribe or household. Add: the same attacker cannot take more than 2 villages from the same
  defender per season (`PAIR_CONQUEST_CAP`).

**Rough numbers for `config.ts`**

| Name | Value | Meaning |
|---|---|---|
| `BANNER_HALL` | max level 4; requires Town Hall 10, Drillyard 3, Market 3, Storehouse 8 (lower than `BALANCE.md`, see questions); cost level 1 about 8,000 of each of wood/food/iron + 300 gold, ×1.35 per level; build time about 20 h | The building that allows more villages and trains Chieftains |
| `UNITS.chieftain` | cost 4,000 wood / 3,000 food / 5,000 iron / 150 gold; train time 6 h (÷0.94 per Banner Hall level); population 8; upkeep 2; attack 0, defence 10/10; speed 5 (slowest in the army, so the army moves at his pace); carry 0 | The conquest unit |
| `HEARTH_POINTS_PER_CHIEFTAIN` | 4,000 | Chieftains needed = 1 + floor(points / 4,000), max 3 |
| `HOLD_HOURS` / `HOLD_HOURS_ABANDONED` | 12 / 6 | Hold clock (÷ world speed) |
| `HOLD_MIN_POPULATION` | 150 | Occupier size that keeps the clock running |
| `HOLD_FAIL_HOURS` | 2 | How long occupiers may stay under the minimum before the claim fails |
| `STRIKE_LOCK_HOURS` | 24 | No new Strike after a change of owner |
| `VILLAGE_LIMIT_BASE` | 1 | Plus Banner Hall level |
| `PAIR_CONQUEST_CAP` | 2 per season | Per attacker–defender pair |

**What it needs**
- Engine: `hearth.ts` (`checkStrike`, `applyStrike`, `holdClock`, `checkOccupy`, `applyOwnerChange` including move-in and wall/hall reset), `Chieftain` unit, `Banner Hall` building, `VillageState.hearth` (`lit | out`, `claimBy`, `outAt`, `holdEndsAt`, `underSince`), changes in `resolveBattle` (count Chieftains among survivors) and in `checkSend` (new mission `occupy`, villages limit). All pure, with tests for every transition, ties and exact-time ends.
- Server: new `claims` table (village, claimant, `ends_at`, `under_since`); the movement processor already works in time order, so claim ends become due events in the same pass (settled lazily, not on a timer); owner change in one transaction (village row, movements and stationed troops cleaned up, tribe alerts, reports for both sides: "Hearth out", "Village taken", "Village lost", "Claim failed"); live update events. Every endpoint with a test (strike, occupy, recall during hold, battle at a cold village, owner change, limit reached, last village, lock, pair cap, banned and shared-connection accounts).
- Web: cold-village look (grey, smoke) on the map and in the village view, "Occupy" in the send dialog, hold clock on both sides, a village list or switcher for up to 5, reports.
- Security: gate in `SECURITY_ROADMAP.md` §4 per route; follow §2 movement timing (no cancelling an occupy after the Strike landed except the normal 2-minute cancel before arrival); occupiers' food and population checked on move-in.

**Size: L.** Cheapest path: first only abandoned villages (engine + server + web, M), then players (second M: alerts, last-village rule, pair cap, lock).

**Open questions for the owner**
1. Is the **Chieftain** name final? (It is generic English; the toy chieftain figures already exist on the map.)
2. `BALANCE.md` wanted Town Hall 15 / Drillyard 6 / Market 5 / Storehouse 14 for the Banner Hall; that is probably day 25+ for a good player, which is late for a nine-week season with shrines waking on day 14. I propose the lower numbers above; they need a `npm run sim` run to check the pace (first second village around day 14–20 for a focused player).
3. Should the **last village** be safe (my suggestion), or should a player be able to lose everything and start over with a new village (as abandoned-village rules already allow)?
4. Should the 12-hour hold be shorter on faster worlds only by speed (my suggestion), or fixed in real time?
5. Move-in of occupiers: good as proposed, or should they always go home and the new owner re-supply?

---

### 18.3 Daily rest hours

**How it works**
- Each player picks **one daily rest window** of fixed length `REST_HOURS` (8) by choosing the start hour in
  their own time zone (the client sends the zone name; the server stores the start hour in UTC and recomputes
  with the zone's rules, so daylight-saving changes do not shift sleep by an hour twice).
- While the window is open, for **all villages of that player**:
  1. **Defence +25%** in battles (`REST_DEFENCE_BONUS`), on top of wall and ranks.
  2. **The hold clock stops** on their villages if the Hearth is out (18.2). A strike at 23:00 lands, but the
     owner has the full 12 awake hours before the village can change hands.
  3. A small moon icon shows on their villages on the map ("Resting"); the exact hours are private.
- Real-time hours, not scaled by world speed (people sleep in real time). This is the same rule as the 2-minute cancel window.

**Abuse limits (so it is a blanket, not a shield)**
- **Change at most once every 7 days**; the new window starts 24 hours after the change (`REST_CHANGE_DELAY_HOURS`). First pick is free.
- **Fixed length.** No longer window, no second window.
- **Sending a hostile order ends your rest for that window.** If a resting player sends an attack, scout or
  Strike at another *player* (raids on abandoned villages and support do not count), the rest effect is off for
  the rest of that window **and for the next 4 hours** (`REST_AGGRESSOR_LOCK_HOURS`). So nobody can strike at
  22:55 and sit behind the bonus at 23:00.
- Only the **owner's side** benefits: **troops that occupy another player's village never get the rest bonus**,
  and a resting owner's support troops in somebody else's village don't carry it either.
- The defence bonus is a bonus, not immunity. A very strong attack still wins. Stacking is not possible
  (one `REST_DEFENCE_BONUS` per battle however many villages or support).
- **A hold cannot be stretched for ever by resting.** Rest pauses the clock for at most `REST_HOLD_PAUSE_MAX_HOURS`
  (36) in total per claim; after that the clock runs through the owner's rest too. Abandonment rules (30 days
  idle, §17) are unchanged.
- Staff can see the hours; they appear in the audit log when changed. Tribe leaders cannot see them (privacy).

**Why it is fair**
- Everyone gets the same 8 hours, same bonus, same limits, whatever the time zone. The bonus is moderate, so a
  tribe in a time zone that is awake while their enemy sleeps gets an edge, but not a free win.
- The aggressor lock removes the one trick that would turn the bonus into a weapon.
- Not everyone is protected at once (the window is per player), so a tribe cannot declare "the night is safe".
  The only way to make a whole tribe safe at the same time is for all of them to be asleep at the same time, which
  also makes the tribe unable to react. That is a real, honest trade-off.

**Rough numbers for `config.ts`**
`REST_HOURS` 8, `REST_DEFENCE_BONUS` 0.25, `REST_CHANGE_COOLDOWN_DAYS` 7, `REST_CHANGE_DELAY_HOURS` 24,
`REST_AGGRESSOR_LOCK_HOURS` 4, `REST_HOLD_PAUSE_MAX_HOURS` 36.

**What it needs**
- Engine: `rest.ts` (`isResting(rest, t)`, `restBonus`), an optional `defenceMultiplier` input in `resolveBattle`, hold-clock pause support (18.2).
- Server: columns on the player (`rest_start_min_utc`, `rest_zone`, `rest_changed_at`, `rest_pending_json`, `last_hostile_at`), `GET/PUT /api/me/rest` (own account only, validated zone name from a fixed list, once per 7 days), the hostile order stamps `last_hostile_at`, battle uses the bonus at arrival time (judged at the arrival time like other timing rules, §11). Tests: every limit above, daylight-saving edges, owner change during a window.
- Web: a Settings section "Rest hours" (a clock picker with the next window shown in local time), the "Resting" moon icon on the map and village view, defence bonus listed in the battle report.
- Security: own account only; no way to read another player's hours; rate limit on the endpoint; the time zone list is a closed list, never free text.

**Size: M.**

**Open questions for the owner**
1. 8 hours and +25%? A shorter window (6 h) with +35% is possible. I suggest 8 / 25% as the first try.
2. Should the rest also pause **building** or **production**? I suggest no: nothing about rest should change the economy.
3. Should the moon icon be public? I suggest yes (the enemy only learns "now", not the hours).
4. Should the first window be forced at sign-up (a nice onboarding step) or skippable?

---

### 18.4 Terrain changes travel speed; neutral sites tribes can hold

#### Terrain and travel

**How it works**
- Terrain stops being decoration (§6). The engine's `terrainAt(x, y, seed)` already gives grass, forest, hills,
  mountain and lake, and the client already draws it. Travel time is now the **sum of the time spent on each
  tile along the straight line** between the two villages (sampled every 1 tile):
  `travelMs = Σ over samples of ( 1 tile / (unitSpeed × terrainFactor) )`, using the slowest unit's total time.
  No path-finding: it is cheap, repeatable and the client can preview it exactly.
- Factors by unit family (our own numbers, tuned so an average trip is about 12% slower than before):

| Terrain | Foot (pikeman, shieldbearer, raider, chieftain) | Mounted (outrider, knight) | Pathfinder | Carriers (shipments) |
|---|---|---|---|---|
| Grass | 1.00 | 1.00 | 1.00 | 1.00 |
| Forest | 0.85 | 0.70 | 0.95 | 0.80 |
| Hills | 0.80 | 0.60 | 0.90 | 0.65 |
| Mountain | 0.55 | 0.40 | 0.75 | 0.40 |
| Lake | 0.45 | 0.35 | 0.70 | 0.30 |

- A trip is never longer than `TERRAIN_MAX_SLOWDOWN` (2.2×) its flat-ground time, so one lake cannot make two
  neighbours unreachable. Villages are never placed on mountain or lake (§6), but armies cross them slowly.
- **Ranks never change speed** (owner rule, §15). Tribe roads (18.5) and Waymarks (below) are the only
  things that reduce the penalty.
- The send dialog shows both times (flat and with terrain) and the map draws the straight line with a
  coloured stretch where the terrain is slow, so players see why a trip is longer.
- Every rule that uses travel time (cancel returns, called-off checks, scout arrival, shipments, tribe alerts, the
  sandbox) goes through one function `travelTimeMs`, so the change is in one place. The return trip is
  the same stretch back (same total).

**Why it is fair**
- The map is the same for everyone and is visible in advance; nobody has hidden terrain.
- It rewards scouting the map and picking where to settle, but it cannot stop anyone from reaching anyone.
- It is a small average change: grass is exactly as before.

**Numbers for `config.ts`:** `TERRAIN_SPEED` (the table), `TERRAIN_SAMPLE_STEP` 1, `TERRAIN_MAX_SLOWDOWN` 2.2.

**What it needs:** Engine: `travelTimeMs` takes the seed and families (and keeps a fast path for a straight
all-grass line); tests for sums, caps and reversal. Server: pass the world seed (already stored); movements keep their
stored `arrive_at`, so nothing in flight changes when the rule ships. Web: preview in the send and shipment forms; legend on the map.
**Size: M.** Run `npm run sim` afterwards (travel time changes every raid cycle).

#### Neutral sites tribes can hold

**How it works**
- **Sites** are fixed tiles on the map, placed from the world seed, belonging to nobody at the start. Each has
  a small **militia** (like an abandoned village, but only defence) so the first capture is a fight.
- A site is **held by a tribe** while at least one of that tribe's members has troops stationed there.
  To take a site, **attack it** (the normal attack mission): the garrison fights the attackers by the usual
  battle rules (§7). If the attackers win, every defender dies, and the attackers' survivors stay as the
  new garrison (same "stationed" rule as support in §12; the troops still cost their home village food).
  If they lose, they die as usual. After a capture the site cannot be attacked for `SITE_CALM_HOURS` (2),
  so the new holders can bring help.
- **Support to a site** is allowed only from the holding tribe's members and its allies, like support to a
  village. A **cap** keeps it from becoming an unbeatable pile: a site takes at most `SITE_MAX_POPULATION`
  population stationed (Great Fire 5,000, others 3,000); further troops are refused. (The same cap idea should
  later apply to villages, see `GENRE_REVIEW.md` B-7.)
- Players can recall their troops at any time. If the last troop leaves, the site becomes neutral again.
- Households that share a connection cannot attack, support or be stationed against each other (existing guard).
- Sites are not villages: they have no resources, no loot, no points, and they cannot be struck with Chieftains.
- **Site types** (all with a toy-style stone-and-fire sprite, drawn in the existing diorama style):

| Site | Count | Effect for the holding tribe |
|---|---|---|
| **Fire Shrine** | 8 (+ the Great Fire) in a season | Season score (18.1). No other effect. |
| **Waymark** | 6 | Terrain penalty is **halved** within 12 tiles of the Waymark for the holding tribe's own troops and shipments (their trips through that area are faster). Never for enemies. |
| **Lookout** | 6 | The holders see every enemy **army march that passes within 20 tiles** of the Lookout (who is going where and when it arrives, the army size in rough bands). They already see attacks aimed at tribe villages; this shows attacks aimed at others. |

  Waymarks and Lookouts are placed outside the shrine rings, between tribes' likely homes, with spacing of at
  least 15 tiles. They persist all season.
- The holder's side can use a Waymark's help only inside its radius, and only on movements that **start after**
  the capture (movements in flight keep the times they were sent with, like everything else).

**Why it is fair**
- A site is won only by beating the troops on it. Nothing is given for free: the holders pay food for
  their stationed troops and carry the risk of the next attack.
- The cap and the 2-hour calm keep a site from being impossible to take or to hold.
- Waymark and Lookout give **information and logistics, not damage**, so holding them is useful but never
  decides a battle. No site gives resources, so sites cannot be "farmed" for an economy.

**Rough numbers for `config.ts`**
`SITE_MILITIA` (garrison per type, in population: Fire Shrine 600, Great Fire 1,500, Waymark 300, Lookout 300, mixed pikemen / shieldbearers),
`SITE_MAX_POPULATION` (3,000 / Great Fire 5,000), `SITE_CALM_HOURS` 2, `WAYMARK_RADIUS` 12, `WAYMARK_PENALTY_FACTOR` 0.5,
`LOOKOUT_RADIUS` 20, `SITE_MIN_SPACING` 15, `SITE_NO_VILLAGE_RADIUS` 4.

**What it needs**
- Engine: `sites.ts` (placement from the seed, `SiteState` with garrison contingents, holder = tribe of the contingents), reuse of `resolveBattle` with a site as defender (walls 0, flat militia), line-vs-circle test for Lookout and Waymark.
- Server: `sites` table, `site_garrison` (reusing the stationed table with a site id), `POST` is the existing send route with a site as target (new target kind, validated); reports for attack on a site; a site list route; hourly score tick (18.1).
- Web: site markers on the map with holder tag, site panel (garrison, Send attack/support), Lookout sightings in the Tribe tab.
- Security: target is checked as a site id on the server; support only for tribe/ally; every amount validated; stationed cap enforced inside the send transaction.

**Size: L for sites, M for terrain** (terrain first, sites with seasons).

**Open questions for the owner**
1. Are the three site types enough, or do you want one more kind (for example a **Ford** that removes lake slowdown for its tribe)?
2. Should sites be reachable by **tribes of any size**? Suggest yes, with the tribe cap of 30 as the natural limit.
3. Terrain: OK to make the average trip about 12% slower? If not, we raise all unit speeds by 12% in the same commit.

---

### 18.5 Tribe projects funded by shipments

**How it works**
- A tribe has a **Tribe Store** (4 resources, cap 1,500,000 each) at a place called the **Seat**: one village chosen by
  the leader (changeable once every 7 days; it must be a member's village and the owner agrees by choosing it).
- Members fund the store by **shipping** to the Seat: the shipment form gets "Tribe Store" as a destination.
  It uses the normal shipment rules (Market gate, carrier capacity, travel time, 5 on the road, cancel
  window, household guard), so the Seat's location matters and a far-away member's help takes longer. On
  arrival the cargo goes **into the store, not into the Seat village** (no storage cap overflow, the Seat owner
  never sees or touches it).
- Leaders, and members with a new grantable right `projects`, **start a project**. Its cost is paid from the store
  at once and it completes after a build time (hours, not scaled by anything but world speed). Only one
  project at a time per tribe; levels one after another like buildings. Cancelling a running project returns 80% to the store (same as village cancel).
- Visible **ledger**: who sent how much and when (so leaders can see who carries the tribe and who does not).
- **Projects** (levels 1–3 unless noted; effects are for **all members' villages**):

| Project | Effect | Why this one |
|---|---|---|
| **Roads** | Support and shipments **between tribe members' villages** travel 10 / 20 / 30% faster (applied on top of terrain). Not for attacks. | Makes defence and logistics better; does not boost offence. |
| **Watchtowers** | Tribe alerts show more about incoming attacks: level 1 the army size in rough bands; level 2 the slowest unit's type; level 3 whether a Chieftain is among them. | Information to answer a Strike (18.2). Defenders still cannot see exact armies. |
| **Ember Wards** | +4 / +8 / +12% defence at **sites the tribe holds** (not villages). | Helps keep shrines without making villages untouchable. |
| **Tribe Banner** (one level) | Map colours, shapes and a banner flag for the tribe (looks only). | A cheap identity goal for new tribes. |

**Why it is fair**
- Every effect is **logistics, information or defence at sites**. None raises attack or production, so a rich tribe cannot buy a stronger army.
- The cost is paid in real resources, shipped by real members with real travel time and exposed to the Market gate.
- **Per-member cap**: a member can fund at most `PROJECT_DAILY_CAP_PER_MEMBER` (60,000 total) per day, and an account needs `PROJECT_MIN_ACCOUNT_DAYS` (3) of age. So one rich account or a stack of fresh alts cannot buy a project alone, and the ledger shows it.
- Tribes cannot hoard forever: the store has a cap. Resources in the store cannot be taken out except by starting projects; a disbanded tribe loses the store (nobody can steal it).
- Members who leave keep their ledger line but not the store (the contribution is a gift to the tribe).

**Rough numbers for `config.ts`**
`TRIBE_STORE_CAP` 1,500,000; project cost level L total goods `300,000 × 1.8^(L−1)` split evenly over 4 resources (level 1 = 75,000 each, so a 20-member tribe giving about 4% of one day's output each pays it in a day or two); build time `24 h × L` (÷ speed); `PROJECT_DAILY_CAP_PER_MEMBER` 60,000; `PROJECT_MIN_ACCOUNT_DAYS` 3; `SEAT_CHANGE_COOLDOWN_DAYS` 7; effects: `ROADS_SPEED_BONUS [0.10, 0.20, 0.30]`, `EMBER_WARD_DEFENCE [0.04, 0.08, 0.12]`, `WATCHTOWER_LEVELS`.
(All to be checked with `npm run sim` against real production at day 20–40.)

**What it needs**
- Engine: `tribe-projects.ts` (cost, time, effect lookups), a `tribeStore` shape, shipment target kind `tribe_store`.
- Server: tables `tribe_store`, `tribe_project` (running/finished), `tribe_ledger`; Seat set route; shipment resolve branch that credits the store; project start/cancel/finish (lazy, due events); alerts add detail by Watchtower level; roads applied inside the one `travelTimeMs` path.
- Web: Tribe tab "Projects" page (store bars, current project, ledger, start button), Seat selector, "Tribe Store" in the shipment form, project icons.
- Security: only leader/`projects` right starts projects; per-member daily cap and account age checked inside the shipment transaction; the store never goes below zero; event log entries; tests for double-spend (two projects started at once).

**Size: M.**

**Open questions for the owner**
1. Is a **Seat village** the right model, or should shipments go to a "tribe stockpile" with no place on the map (simpler, but then no logistics)? I suggest the Seat.
2. Do you want projects to give **permanent** effects (my proposal), or effects that need a small upkeep per week?
3. Which projects do you want first? I suggest Roads and Watchtowers; Ember Wards only when sites exist.

---

### 18.6 Cosmetics-only shop

**How it works**
- The shop sells **looks only**. Nothing sold changes any number, queue, speed, defence, storage, score or
  ranking. This is a hard rule: a cosmetic is an **id** (for example `roof.red`) that the client draws; the
  engine, the battle code and the server's game routes never read it.
- What can be sold, always inside the Toy Diorama style (owner: no restyle, art stays swappable):
  1. **Village skins** (roof colours, banner, garden props around the town square; the Town Hall keeps its shape so
     everybody can still read the game).
  2. **Map markers** for your villages (flag shapes and colour rings, within the map's colour rules: relation colours stay).
  3. **Chieftain figures and profile frames** (portrait on the profile and in tribe lists).
  4. **Tribe look** (extra banner shapes for the tribe, bought by the leader; every member sees it).
  5. **Report and mail themes** (colours only).
- **Not for sale, ever:** anything that speeds, strengthens, protects or scores; extra queue slots; resources, gold or
  troops; village limit; rest-hour changes; protection time. Some looks can only be **earned** (season winner flame
  frame, Pioneer marker) so they remain a sign of play. Badges (18.1) are never sold.
- Items belong to the **account** (lobby database `account_items`) so they work in every season. The server of
  a world only asks the lobby "which cosmetic ids does this account own" (included in the signed entry pass)
  and the client draws them. Equipped ids are checked against ownership every time.
- Payment: the lobby creates a checkout with a hosted payment provider (we never see card data); the provider's signed
  webhook, verified by the lobby, grants the item; the purchase is stored once (idempotent on the provider's id); a refund or
  chargeback removes the item.
- **Premium queues today**: the current premium subscription sells a longer build and research queue (5 vs 2). That is a
  paid speed advantage and does not fit "cosmetics only". My suggestion is to **give 3 slots to everyone, drop the premium queue**
  and let the shop be pure looks. (Open question 1.)

**Why it is fair**
- Free and paying players are equal in every number; the only difference is how the game looks. A player cannot buy a win.
- Earned-only items and badges keep prestige away from the shop.
- Visual items must stay readable: relation colours on the map (self gold, tribe green, ally blue, NAP purple, enemy red) can never be replaced by a purchase.

**Rough numbers**
Prices are the owner's call (suggest 1–5 EUR per village skin, 1–3 for markers and frames, bundles for tribes). In
`config.ts`: only the catalogue ids and `COSMETIC_SLOTS` (one skin, one marker, one frame equipped at a time).

**What it needs**
- Lobby: `account_items`, `catalogue` file, checkout route, webhook route (signature verified, idempotent, rate limited), `/lobby/api/me` lists items, operator CLI to grant or revoke (support cases).
- World server: reads owned ids from the entry pass; stores equipped ids per player (`equipped_json`, validated against the pass), exposes them on the public player and village DTOs (ids only).
- Engine: nothing (must stay untouched; a test that the engine has no import of the catalogue).
- Web: Shop screen (preview on a real village, 360 px and desktop), equip picker, sprite registry entries (skins are alternative registry entries, the registries already exist), "owned" badge.
- Legal and money work that is **not** code: payment provider account, VAT, terms, refund policy, age rules; Apple and Google fees if a native app sells these later.
- Security: webhook signature, replay protection, no client-set prices, no trust in "owned" from the client, items are ids from a closed catalogue.

**Size: M** (L if the art for the first catalogue counts).

**Open questions for the owner**
1. Drop the premium queue and make queues equal for everyone (my suggestion), or keep it? This is the main decision.
2. One-off item purchases (simple, my suggestion) or a currency like "sparks" in packs (more flexible, more legal work)?
3. First catalogue: how many items and who draws them? Each must be in the Toy Diorama style. A first set of about 6 skins, 6 markers and 4 frames is enough.
4. Sell before the first season ends, or only after the first season is live? I suggest after: cosmetics need players to see them.

---

### 18.7 Suggested build order

Order chosen so each step is useful alone, the risky rules arrive when the safety rules are already there, and
every step can be undone alone.

| Step | What | Size | Why here |
|---|---|---|---|
| 0 | Prerequisites from `GENRE_REVIEW.md`: secret battle seed (#6), tame abandoned farming + upkeep (#3, #4), run `npm run sim` | S | Conquest raises the stakes; fix the economy and the predictable-luck hole first. |
| 1 | **Terrain travel** (18.4a) | M | Small, self-contained, visible on the map, and changes every travel time, so do it before any other number depends on it. Re-run `npm run sim`. |
| 2 | **Several villages: Banner Hall, Chieftain, Strike and Hold on abandoned villages only** (18.2, first half) | M | The genre's biggest hole, with only computer-run targets, so no one can be hurt while we learn it. A second village changes the whole game. |
| 3 | **Rest hours** (18.3) | M | Must exist before players can take villages from each other. |
| 4 | **Taking player villages** (18.2, second half: alerts, last-village rule, pair cap, lock, move-in) | M | The payoff for tribes and the reason to defend. |
| 5 | **Sites and Fire Shrines, season clock and score** (18.4b + 18.1 engine/server) | L | The goal of the game. Uses the stationed-troops and battle rules from step 4. |
| 6 | **Badges + Hall of Fame + lobby season list** (18.1 rest) | M | Needed before the first real season ends, not before it starts. |
| 7 | **Tribe projects** (18.5) | M | Needs shipments, terrain (roads), sites (wards): last of the rules. |
| 8 | **Cosmetics shop** (18.6) | M | Independent of the rules; do it when the first season is live and has players to look at it. |

Quick check of the order against the two risks:
- *"Conquest ships without sleep protection."* No: step 3 is before step 4.
- *"Seasons without anyone able to fight for shrines."* No: sites reuse step 4's rules and need step 2's village growth.

Every step follows the usual protocol: config numbers first, engine with tests, server routes with tests, security
gate, web check at 360 px and 1280–1440 px, then docs (this file's rules move up from §18 into the normal sections).

### 18.8 Decisions the owner needs to make first (shortest list)

1. Approve the six parts, or tell me which to drop or change.
2. Season: 63 days with a fixed end (my suggestion), no early win, no shared win for allies?
3. Is a player's **last village** safe from Strikes (my suggestion)?
4. Banner Hall requirements: use the lower ones above (needs a `npm run sim` check)?
5. Rest: 8 hours and +25%?
6. Premium queue: drop it and keep the shop cosmetics-only?
7. Terrain: accept an average trip about 12% slower?
