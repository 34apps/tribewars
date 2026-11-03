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
- **Intended pace at speed 1** (config: `baseTimeSec` hall 600, lumber/farm 360, mine 420, gold mine 1500, storehouse 480, barracks 900, stables 1800, wall 720, vault 540; `HALL_TIME_FACTOR` 0.95): first levels ~6–15 min, mid levels ~1–3 h, late levels ~8–24 h depending on Town Hall; basic troops ~3–5 min each (`trainTimeSec` pikeman 270, guard 330, raider 300, outrider 720, knight 1320, pathfinder 180; `TRAIN_TIME_FACTOR` 0.94).
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
  The default layout is `'scattered'` (everything above, random anywhere).
- Terrain shares are tuned so mountains, lakes and forest leave room for many players (mountain+lake < 15% of tiles).
- Beginner protection: nobody can attack the player's villages until
  `createdAt + protectionHours / speed`. It ends early when the player attacks another *player*
  (raiding abandoned villages keeps it).
- Points = sum of building levels (shown on the map).

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
