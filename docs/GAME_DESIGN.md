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
  or away. Since 2026-11-04 (owner decision, step 0 of §18.7) a unit's upkeep is **0.25 food per population point**
  (`FOOD_UPKEEP_PER_POP`; pikeman, shieldbearer, raider, pathfinder 0.25, outrider 0.5, knight 1; it was 1 / 1 / 1 / 1 / 3 / 4).
  Armies can be four times bigger for the same Farm, so the population cap, not food, is now the usual limit from Farm level 1 up.
  Net food per hour = farm production − upkeep. Training is refused if it would make net
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
- **Intended pace at speed 1** (config: `baseTimeSec` hall 600, lumber/farm 360, mine 420, gold mine 1500, storehouse 480, barracks 900, stables 1800, wall 720, vault 540; `HALL_TIME_FACTOR` 0.95): first levels ~6–15 min, mid levels ~1–3 h, late levels ~8–24 h depending on Town Hall; basic troops ~3–5 min each (`trainTimeSec` pikeman 270, guard 330, raider 300, outrider 600 (population 2, food upkeep 0.5), knight 1320, pathfinder 180; `TRAIN_TIME_FACTOR` 0.94).
- Requirements: `requires` must be met (current levels, not queued) to start level 1 and every later level.
- **Queue:** at most `MAX_BUILD_QUEUE` (2) jobs per village, the same for everyone (the premium queue was removed
  on 2026-11-04, owner decision; the `premium` database column is unused). Cost paid when queued. A job starts at
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
  (`VillageState.researchQueue`): `MAX_RESEARCH_QUEUE` (2: one running, one waiting), the same for everyone. Cost is paid when
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
- An army moves at the speed of its slowest unit. **Travel time is the sum of the time on each tile along the straight
  line, so terrain counts (section 18.4a, built 2026-11-04)**; over grass only it is
  `ceil(distance / (slowestSpeed * speed) * 3_600_000)` ms (`flatTravelTimeMs`). The server computes it from the world
  seed; the client only previews it.
- Sending: target must be a village tile other than your own village; at least one unit; you must
  have the units at home. Units move from `troops` to `away` when sent.
- Arrival → battle (section 7) → survivors travel home along the same route at their own slowest
  speed, carrying loot. On return: `away` −= survivors, `troops` += survivors, resources += loot (clamped).
  Units lost in battle are removed from `away` at battle time.
- **Terrain** (`terrainAt(x, y, seed)`: grass, forest, hills, mountain, lake), deterministic from the seed so the client
  draws it without asking the server. Villages are never placed on mountain or lake tiles. Use smooth value noise so
  terrain forms patches, not static. Since 2026-11-04 terrain also changes travel speed (18.4a); there are no rivers in
  `terrainAt`, "water" on the road is the lake terrain.

## 7. Battle — `resolveBattle({ attackerUnits, defender, seed })`

Deterministic for a given seed (`mulberry32`). **The server's seed is secret** (owner, 2026-11-04): `battleSeed(salt, movementId, arriveAt)` mixes in a
128-bit salt that is created once per world, kept in the world database (`meta.battle_salt`) and never sent to a client.
Before this, `hashSeed(movementId, arriveAt)` could be computed by the sender, who could then cancel and re-send until luck was good.
Tests and the simulator pass their own seeds.

1. `luck = rng() * 2 * BATTLE_LUCK − BATTLE_LUCK`.
2. Attack: `A_inf`, `A_cav` = Σ count × attack per class. `A = (A_inf + A_cav) * (1 + luck)`.
3. Share of infantry `si = A_inf / (A_inf + A_cav)`, `sc = 1 − si`.
4. Defense: `D_units = Σ count × (defenseInfantry × si + defenseCavalry × sc)` over defender troops
   at home. `D = (D_units + WALL_BASE_DEFENSE + WALL_DEFENSE_PER_LEVEL × wall) × (1 + WALL_BONUS_PER_LEVEL × wall)`.
5. If `A > D`: attacker wins. Attacker loses `round(count × (D/A)^BATTLE_LOSS_EXPONENT)` of each
   unit; every defender unit dies.
   Else defender wins: defender loses `round(count × (A/D)^BATTLE_LOSS_EXPONENT)` of each unit;
   every attacker unit dies.
6. Loot (attacker won only): capacity = `floor(Σ survivors × carry × lootFactor)` (`lootFactor` is 1 unless a repeat-raid
   limit applies, see §8). Lootable per resource =
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
  nothing grows). **Garrisons slowly refill** (owner, 2026-11-04; they never recruited before): every step also
  brings back `NPC_GARRISON_REFILL_SHARE` (20%) of the full garrison for the current Town Hall level, rounded up, at least one
  unit of each missing type, never above full. A village whose garrison was wiped out is full again after five steps (30 h at
  speed 1) and keeps refilling after a raid even when all its buildings are maxed. Apply at most `NPC_MAX_STEPS_PER_SETTLE`
  steps per settle; production between steps uses the levels at that time (accuracy within one step is fine).
- They produce resources like player villages (no upkeep), which is what raiders take.
- **Repeat raids carry less** (owner, 2026-11-04): each won raid by a player on an abandoned village is written down
  (`npc_raids`, one row, old rows of that pair pruned). A later raid by the **same player on the same village** within
  `NPC_REPEAT_WINDOW_HOURS / speed` (24 h at speed 1) can carry `NPC_REPEAT_LOOT_FACTOR ^ earlierHits` of the usual load
  (50%, 25%, 12.5%, never below `NPC_REPEAT_LOOT_FLOOR` 10%). Other players are not affected, and after the window the full
  load is back. The report shows "lootShare" (percent) whenever it is below 100. The fight itself is unchanged.

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
travelTimeMs(from: Coords, to: Coords, units: Units, s: WorldSettings): number   // with terrain (s.seed); same both ways
flatTravelTimeMs(from, to, units, s): number                                    // ignores terrain (send preview "without terrain")
travelPreview(from, to, units, s): { flatMs, ms, route }                         // route = travelRoute(from, to, s.seed)
travelRoute(from, to, seed): Route                                              // straight line sampled every tile: terrain per sample
shipmentTravelMs(from, to, s) / flatShipmentTravelMs(from, to, s)               // carriers, same terrain rule
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
Players are ranked by the sum of their villages' points (top 100 shown, ties share a rank, then by name; the caller's own place is always shown). Tribes are ranked by the sum of their members' points (see above). Both lists are in the Ranks tab. A third list ranks players by **Renown earned** (`GET /api/rankings/renown`, §18.2; total earned, never the balance, so spending does not lower the rank); Renown and its rank also show on the profile.

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
stay), build/train queues cleared. The army is fitted to the population room left (buildings, troops at home and away
count) and the food upkeep (the farms must still feed it plus 3 Chieftains), and keeps room for `SANDBOX_CHIEFTAIN_ROOM` (3) Chieftains, so conquest can be tested right after Max. **Clear army**
(`POST /api/sandbox/clear-army`, no body): my own troops at home in every village of mine are removed (away troops and
stationed contingents stay). **Reset**: each village becomes a fresh starting village (`createPlayerVillage`),
with its own outgoing movements and own stationed support removed; works at any time. World speed is never
changed. **Warp** (`POST /api/sandbox/warp {seconds}`, 0–3600): every movement sent from, returning to or heading for
the player's villages that is due later arrives in `seconds` from now (0 = immediately resolved). **Empty abandoned villages** (`POST /api/sandbox/clear-abandoned`, no body): every
abandoned village is settled to now and its troops set to zero (garrisons then slowly refill, §8). **Own timing**: `POST /api/villages/:id/send` also
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
7. Seasons with Fire Shrines, taking villages, terrain, tribe projects, cosmetics shop — see §18 (proposal, needs owner approval).

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

Clanfire's promise in one sentence: **a world is a story with an ending (one tribe takes the land), and the land, the clock and the
tribe all matter.** (Revised 2026-11-05: no short seasons for normal worlds.)

| Pillar | What the player feels | Part |
|---|---|---|
| A world that ends by domination | "A tribe that owns three quarters of the land for two weeks wins; everyone can see the bar." | 18.1 |
| Villages are won by holding, not by one click | "They put our fire out, we have twelve hours to answer." | 18.2 |
| ~~The game respects sleep~~ (dropped 2026-11-05) | ~~"I can sleep without waking up poorer."~~ | 18.3 |
| The land matters | "The mountain is between us, so the real road goes round." | 18.4 |
| A tribe builds together | "Our shipments built the watchtower." | 18.5 |
| Money buys looks, never strength | "I support the game and nobody is stronger for it." | 18.6 |

How they connect: domination gives the goal (taking and holding villages, 18.2); Fire Shrines are bonus sites on the map (18.4b); taking and
holding sites reuses the troop-stationing rules; tribe projects make a tribe tougher; badges and cosmetics are what players keep when a world ends.

Prerequisites from `GENRE_REVIEW.md` Part C that should land **before** conquest, because conquest raises the
stakes: secret battle seed (#6), tame abandoned-village farming and upkeep rebalance (#3, #4), cap on stationed
support (part of #9; 18.4 adds the cap for sites). **Status 2026-11-04 (step 0, part 1):** seed, refill, repeat-raid limit and
upkeep 0.25 are built (§2, §7, §8); the pacing numbers (item 4 of step 0) wait for a simulator run, see `BALANCE.md` §7.

---

### 18.1 How a world ends: domination by one tribe (owner, 2026-11-05; built 2026-11-05, step 5)

**Owner 2026-11-05: short seasons are rejected for normal worlds.** A normal world is long and ends by **domination**: one tribe
owns almost all the land for two weeks in a row. The nine-week season with scoring Fire Shrines is kept only as an idea for a
possible **special limited-time world** (further down in this section; nothing of it is built or planned for normal worlds).

**The rule** (per-world settings, stored in the world's settings at creation; defaults in `config.ts` `DOMINATION_DEFAULTS`; the operator
changes them with `npm run admin -w @clanfire/server -- domination-set <key> <value>`; every duration is divided by the world speed like all
other durations):

| Setting | Default | Meaning |
|---|---|---|
| `minAgeDays` | 180 | Domination does not count before the world is 6 months old (÷ speed). |
| `minActivePlayers` | 50 | Fewest active players for the streak to run. |
| `minPeakShare` | 0.30 | The minimum is `max(minActivePlayers, ceil(0.30 × the world's peak active players))`. The peak is stored and only grows, so a world that once had 400 active players needs 120, and a dying world cannot be "won" by a handful. |
| `winShare` | 0.75 | One tribe must own at least this share of all **village points owned by players**. Abandoned villages do not count. Allies do **not** add up: only the one tribe counts. Exactly 75.00% counts; 74.99% does not. |
| `streakDays` | 14 | The share must hold for this many days **in a row** (÷ speed). |
| `activeDays` | 7 | "Active" = played in the last 7 days (÷ speed), not banned, not a test-mode account; accounts that share a connection count **once**. |

- **Streak.** The start of the current streak is stored (`domination_streak`). It starts at the first check where all three conditions hold
  (world old enough, enough active players, a tribe at or above `winShare`), stays while they keep holding for the same tribe, and is
  cleared the moment any of them fails. The tribe wins when `now − start ≥ streakDays`. It is settled from the stored start time, never by a
  timer loop: the server checks at the end of its normal movement processing (every request and the 1 s tick), at most once per
  `DOMINATION_EVAL_INTERVAL`, so downtime loses nothing. The recorded end time is `start + streak length`.
- **Tribe size.** `TRIBE_MAX_MEMBERS` is 30 (§11); it is enforced on every way into a tribe and tested.
- **World end.** When a tribe wins (or the operator ends the world by hand) the world **freezes**: no new orders of any kind (sends, builds,
  training, tribe changes ... all state-changing requests answer 403 "This world has ended."), except sign-in/out, mail, support tickets, forum
  and tribe chat. New accounts cannot register. Movements already in flight still arrive and resolve. The caretaker and the idle-abandon
  pass stop. The **final tribe ranking and the final player ranking are stored once** in `world_end` at the end moment and never change
  afterwards. The web client switches to a **world-end screen** (the winning tribe, the final tables), and the lobby marks the world
  **Finished** (`world-status <id> finished`, `docs/MULTI_WORLD.md`).
- **Operator tools** (all logged in the audit log): `domination` (status), `domination-set`, `world-end [tribeTag|-] [reason]`, `world-extend <days>`
  (postpones domination by raising `minAgeDays`, clears the streak; refuses on an ended world; reopening a finished world is not built).
- **Domination bar** (everyone, in the Tribe area and on the world-end screen): the leading tribe, its share, the 75% line, the streak in
  days, the world age against the minimum, the active players against the minimum, and a plain list of why it does not count yet.
- **Why it is fair.** Nobody can win by a surprise: it takes six months, a healthy world, three quarters of everything players own and two
  weeks of holding it, and every one of those moments shows on the public bar, so other tribes can join forces against the leader (allies do
  not add up for the *leader*, but any number of tribes can fight it). Raising or lowering the numbers is an operator decision per world.

**Sites and Fire Shrines are not the win condition any more.** They stay on the map as **objectives with bonuses** for the tribe that holds
them (§18.4b).

#### Idea kept: a special limited-time world (nine-week season, Fire Shrine score)

> Not built, not planned for normal worlds. It could be opened later next to the normal worlds (`docs/MULTI_WORLD.md`: one more world with its
> own settings) if the owner wants a short competitive round. The text below is the old proposal, unchanged.

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
- The village changes owner. Buildings stay at their levels (**no level loss**, owner 2026-11-04; the old "Wall and Banner Hall go back to level 0" rule is dropped), stock is partly kept
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

**Owning several villages — Renown (owner decision 2026-11-04, replaces "Banner Hall level allows more villages")**
The number of villages is limited by **Renown**, a score of its own. Purpose: **expanding must be possible without fighting.**
A builder or a defender who is never attacked still reaches the second village; fighting only makes it faster.

**Owner decisions 2026-11-04 for step 2 (several villages) — these override the older text of this section where they differ**
- **The main way to get ahead is TAKING already-developed, high-point villages.** FOUNDING a new village on empty land is the slow, safe path.
  Both cost the same Renown (`RENOWN_VILLAGE_BASE x 1.6^(villages - 1)`), independent of the target's size.
- **A captured village changes owner with ALL buildings intact.** No automatic level loss: the old "Wall and Banner Hall go back to level 0" rule is
  dropped. Buildings only drop through **siege units** (a later run). Resources are partly kept (`TAKE_KEEP_RESOURCE_SHARE`); the old owner's troops are gone;
  the new owner's occupiers move in (up to the population cap); queues are cleared (costs were paid by the old owner, not refunded); the Renown
  already paid for building levels stays remembered by the village, so a taken village earns no building Renown a second time.
- **A player's LAST village CAN be taken** (replaces "last village is safe"; `LAST_VILLAGE_SAFE` is dropped). That player is not wiped out: they get
  a **fresh starting village at the outer edge of the current world circle** (expanding layout: the edge placement a newcomer gets, with its ring of
  abandoned villages; scattered layout: a random free tile), keep account, tribe, Renown and rankings, and get a short **restart protection**
  (`RESTART_PROTECTION_HOURS`, ÷ speed) so the same attacker cannot hunt them again at once. Built in step 2, it has triggered since step 4 (player villages can be taken).
- **Built in step 2** (numbers in `config.ts`): the Banner Hall trains the **Chieftain** (Banner Hall level 1; Renown is **reserved** when training
  starts, `CHIEFTAIN_RENOWN_REFUND_SHARE` comes back if he dies); **Strike and Hold on abandoned villages only** (1 Chieftain survivor puts the hearth
  out, 6 h hold with occupiers); **FOUND** (a Chieftain sent to a free tile carries an ember; the new village starts small, `FOUND_*` numbers);
  **inactive players** (`ABANDON_IDLE_DAYS`) turn their villages abandoned **with buildings kept**, so they become valuable targets (never during
  beginner protection); basic multi-village play (switch villages, per-village queues and resources, send troops and resources between own villages,
  rankings count every village).
- **Anti-abuse:** no taking from same-IP accounts, own tribe or allies (players: step 4); a captured village is **locked for 24 h** (`STRIKE_LOCK_HOURS`);
  strike and hold timing is computed by the server only, in order of arrival time (SECURITY_ROADMAP §2); every new route is rate limited and acts only on
  the caller's own Chieftains and villages.

**Step 4 — taking PLAYER villages (owner decisions 2026-11-05, built the same day; these override older text where they differ)**
- **On for everybody** (`HEARTH_PLAYERS_ENABLED = true`). Same Strike rule as for abandoned villages with `need` = 1 + floor(points / 4,000) Chieftains (max 3); hold
  `HOLD_HOURS` (12 h ÷ speed) with ≥ 150 occupier population. **No rest hours** (dropped). A player's **last village can be taken**; the loser restarts at the
  outer edge with restart protection (rule from step 2). **Captured villages keep all buildings** (levels only drop through siege, §18.9).
- **Cold village, what 18.2 decides (kept):** it produces nothing and eats nothing; **nothing new can be built or trained** (the build block is new in step 4,
  the training block was there); jobs already queued carry on. The caretaker bot skips a cold village.
- **How the owner's side breaks a hold (the new RELIEF attack).** The owner (from another of their villages), a tribe-mate or an ally of the owner may send an
  **attack** at the cold village. It is a battle against the claimant's **occupiers only**: the village's own troops take no part, the Wall does not shelter an
  occupier, nothing is looted, no combat Renown is paid, and Chieftains and siege units are refused. All occupiers dead = the hearth relights at once; fewer than 150
  population left = the clock stops (and the claim fails after `HOLD_FAIL_HOURS`). Relief does not end the sender's beginner protection. The owner **cannot
  "occupy" their own village** with their own troops (decided: relief by battle is the only way; `occupy` stays the claimant's mission), and cannot dismiss the occupiers
  with "send back". A third player who attacks the cold village normally still fights the occupiers together with the village's defenders (§18.2 above).
- **Alerts never leak more than scouting.** An incoming attack alert (to the target's owner and their tribe) shows who and when, **never what it carries**: no hint
  that Chieftains are coming. The first sign is the **Hearth out** alert at the moment of the strike: the tribe's alert list (`GET /api/tribe/alerts`) now has `holds`
  (cold villages of members with claimant, clock, same as the map), the alert badge counts them, and the owner sees the occupiers' strength only on their own village.
  Both sides see a **hold card** with the countdown. Live hints (WebSocket `game` / `tribe` topics) go to the owner, the claimant and the owner's tribe when the hearth
  goes out, the clock starts / pauses, the hold is broken or ends, and when the village is taken.
- **On change of owner** (as already built): all buildings stay, stock × `TAKE_KEEP_RESOURCE_SHARE`, old queues cleared, the old owner's troops there are gone, the old
  owner's support and everyone else's troops are sent home, 24 h Strike lock, the occupiers move in (up to the population cap). Points move at once (rankings add up villages).
- **Anti-abuse (server, deterministic, in order of arrival):** no Strike on same-IP accounts, tribe-mates or allies (refused at send and again at arrival); none on
  players in beginner or restart protection (refused at send; a Strike also checks it at arrival); none on a locked village; **pair cap**: one attacker may take at most
  `PAIR_CONQUEST_CAP` (2) villages from the same victim within `PAIR_CONQUEST_WINDOW_DAYS` (7 days ÷ speed): the send is refused once the cap is used, a Strike at arrival is
  only a battle, and a hold that ends over the cap fails with the report reason `pair_cap` (several holds can run at once, only the first ones get through). Takes are
  recorded in the `conquests` table (schema v7). No new route was added (strike, relief and occupy use the existing send route and its rate limit).
- **Balance:** `BALANCE.md` 7.6: 20-player simulation, biggest ≤ 1.84× the second after 30 days on five seeds.

*Rules*
- Renown is **earned, never bought, never lost, only spent**. A player has `renownTotal` (all earned, used for the Renown
  ranking), `renownSpent` and `balance = total - spent`. Nothing takes Renown away; losing a village or a battle costs none.
- **A new village costs** `RENOWN_VILLAGE_BASE x 1.6^(villages owned - 1)` Renown (the 2nd costs the base, the 3rd 1.6x,
  the 4th 2.56x, the 5th 4.1x). There is no hard village limit, the rising price is the limit. Numbers: `config.ts`.
- **Two ways to get a village** (built in step 2; the rules are fixed here): **FOUND** a new village on a free map spot (the
  Chieftain carries an ember from the home hearth, no attack and no hold needed), or **TAKE** one by the Strike and Hold of
  this section (abandoned villages first, players later). Both cost the same Renown. Training a Chieftain **reserves** the
  cost (it leaves the balance but not `renownTotal`); if he dies on the way, `CHIEFTAIN_RENOWN_REFUND_SHARE` (50%) comes back.
  Banner Hall level 1 is needed to train Chieftains (step 2); until then its use is the Feast (below).
- Ranking points stay **buildings + villages**. Renown has its **own ranking** (by `renownTotal`) and shows on the profile.

*Sources*
1. **MAIN, buildings.** Every finished building level gives `round(RENOWN_BUILD_SCALE x level^RENOWN_BUILD_EXP)` Renown,
   once per village and level (a village remembers the levels already paid, so a Wall rebuilt after a takeover pays nothing
   twice). Levels a village starts with, sandbox villages and abandoned villages pay nothing.
2. **BONUS, fighting** (value = resources + 10 x gold for loot, unit cost for troops):
   - loot taken in a raid: `RENOWN_PER_LOOT_VALUE` per value (credited when the battle is resolved);
   - enemy troop value destroyed, when attacking and when defending: `RENOWN_PER_KILL_VALUE` per value;
   - **support** troops stationed in a village that help kill attackers: the defending side's credit is split between the
     village owner and each support owner by their share of the defence strength and goes to each owner;
   - never credited to computer-run (abandoned) villages, which have no owner.
3. **Feast** (Banner Hall level 1+): turns resources into Renown at a fair rate. One Feast costs `FEAST_COST` (a bundle of
   wood, food, iron, gold) and gives `FEAST_RENOWN`; at most `FEAST_DAILY_PER_LEVEL x Banner Hall level` Feasts per village
   per 24 h (÷ world speed). It is the sink for a builder's full storehouses, deliberately worse per resource than fighting
   well and better than idling.

4. **Defender trickle** (owner approved 2026-11-04, built the same day): a small daily Renown amount for keeping a **real defence at home**,
   so a pure defender who is never attacked still reaches the second village. Strength = the village's **own troops at home**,
   each unit counted at the average of its infantry and cavalry defence (support troops belong to their owners and stay in the
   stationed table; troops away, in training, the Wall and ranks do not count). Renown per 24 h (÷ world speed) =
   `min(DEFENDER_RENOWN_DAILY_CAP, strength x DEFENDER_RENOWN_PER_DEFENCE)` for each village, **nothing during beginner
   protection** (it counts from the natural end of protection even if the player ended it early by attacking a player),
   never for abandoned villages or sandbox accounts. **Settled lazily like resources:** the village remembers when it was
   last paid and how strong its defence was then (`defenceMark`); whenever the village is saved (any action: send, train,
   battle, build...) the span since the mark is paid at the **smaller** of the strength at the mark and now, so troops that were
   away or have left never count for that time and the result does not depend on how often the owner looks. A read of the game
   state never writes: it shows the earned-but-unsaved amount, and the next save pays exactly that. (A batch of troops
   that finishes training mid-span only counts from the next span: a small under-payment, never an over-payment.)

*Anti-abuse (combat Renown only).* A battle earns **nothing** when:
- attacker and target are on the same IP group (`householdShared` guard), in the same tribe, or in allied tribes;
- its value is under `RENOWN_MIN_BATTLE_VALUE` (token pokes pay nothing);
and Renown is reduced:
- **Diminishing per pair.** A battle's raw Renown is `R = loot value x RENOWN_PER_LOOT_VALUE + troop value destroyed x
  RENOWN_PER_KILL_VALUE`. For one earner and one opponent (a player, or one abandoned village) in a 24 h window (÷ speed)
  the pair has earned `F(R_total) = RENOWN_PAIR_CAP x (1 - e^(-R_total / RENOWN_PAIR_CAP))`; a battle pays
  `F(R_total + R) - F(R_total)`. Small amounts pay nearly 1 to 1, then it flattens. This is **path independent: many small
  sends earn exactly what one big send earns**, and `RENOWN_PAIR_CAP` is the daily cap per pair. The window starts at the
  first paying battle.
- **Hitting far smaller players.** The earner's Renown is multiplied by
  `clamp((opponent village points / own village points / RENOWN_SMALL_RATIO)^2, RENOWN_SMALL_FLOOR, 1)`: no reduction when
  the opponent has at least `RENOWN_SMALL_RATIO` (0.5) of your points, at most 95% off for tiny ones.
Building and Feast Renown are never reduced by these rules (the Feast has its own daily limit).

*Built numbers (`config.ts`, tuned with the sim 2026-11-04, `docs/sim/2026-11-04-after-step0.txt`):* building Renown
`max(1, round(0.25 x level^1.25))`; loot 1 Renown per 16 value, troops destroyed 1 per 16 value; pair cap 60 per 24 h;
minimum battle value 300; village base price 500 (then 800, 1,280, 2,048 ...); Feast 600/600/600 for 10 Renown, 3 per
Banner Hall level per day; Chieftain refund 50%; **defender trickle 0.006 Renown per day per point of stationed defence, at most
22 per village per day** (a defence of about 3,700 points reaches the cap). **The size factor is for player targets only: raiding an abandoned village always earns Renown** (they are small by design; the repeat-raid loot limit, the minimum battle value and the pair cap limit farming them). Test-mode accounts earn from abandoned villages too, but not from fights against players. Support owners who kill attackers
and village owners earn the defender share; an attacker sharing an IP group with any defending-side player earns nothing
from that player.

*Pace targets (checked with `npm run sim`, 2026-11-04 after the defender trickle, `docs/sim/2026-11-04-after-terrain.txt`).* An active
raider can afford the 2nd village (Renown 500 and Banner Hall level 1) around **day 19-20** (sim: 20.4; its Renown alone is there on
day 14.5, the Banner Hall is what it waits for); a **pure defender who is never attacked** about **day 24-26** (sim: 25.4); nobody is
blocked for good. A builder who also keeps an army at home gets the trickle too: in the sim it reaches the price on day 14.5, earlier
than the raider, because it builds the Banner Hall by day 7 (owner to judge, `BALANCE.md` 7.4).

**Other notes on several villages**
- A new village is named "<name>'s village 2" until renamed. Everything that is "per village" (queues, ranks, population,
  Market) already exists per village. The web top bar already has a "current village" switch for this.

**No rest hours (owner decision 2026-11-05).** Taking player villages does not use rest hours (18.3 is dropped).
It relies on the hold period, tribe alerts, restart protection and the pair cap instead.

**Why it is fair**
- It costs a lot (gold-limited Chieftains, a strong escort, a hold force) and takes real time, so it is an
  event, not a click. The hold gives the defender **a fixed window to answer** that both sides can see.
- Big villages need more Chieftains, so a player cannot snowball by taking everything at the top of the ranking.
- ~~A player's last village cannot be struck~~ — **replaced 2026-11-04:** the last village can be taken; the player restarts at the outer edge of
  the world with restart protection (see "Owner decisions 2026-11-04 for step 2" above).
- The attacker's hold force is far from home and exposed, which is what lets a smaller tribe win a defence.
- New owners get a 24-hour lock, so a village cannot be flipped back and forth in a night.
- Beginner protection still blocks Strikes. Accounts that share a connection cannot attack each other (existing
  guard), and tribe-mates cannot strike each other (existing `isAttackForbidden`), so villages cannot be "given" by
  fake conquests inside a tribe or household. Built in step 4: the same attacker cannot take more than 2 villages
  from the same defender per 7 days (`PAIR_CONQUEST_CAP`, `PAIR_CONQUEST_WINDOW_DAYS`).

**Rough numbers for `config.ts`**

| Name | Value | Meaning |
|---|---|---|
| `BUILDINGS.bannerhall` (built 2026-11-04) | max level 4; requires Town Hall 7, Drillyard 2, Market 2, Storehouse 6 (tuned with the sim, lower than the first design of Hall 10 / Drillyard 3 / Market 3 / Storehouse 8); cost level 1: 2,500 of each of wood/food/iron + 100 gold, ×1.35 per level; build time 20 h at level 1 | Holds the Feast now; trains Chieftains in step 2 (villages are limited by Renown, not by its level) |
| `UNITS.chieftain` | cost 4,000 wood / 3,000 food / 5,000 iron / 150 gold; train time 6 h (÷0.94 per Banner Hall level); population 8; upkeep 2; attack 0, defence 10/10; speed 5 (slowest in the army, so the army moves at his pace); carry 0 | The conquest unit |
| `HEARTH_POINTS_PER_CHIEFTAIN` | 4,000 | Chieftains needed = 1 + floor(points / 4,000), max 3 |
| `HOLD_HOURS` / `HOLD_HOURS_ABANDONED` | 12 / 6 | Hold clock (÷ world speed) |
| `HOLD_MIN_POPULATION` | 150 | Occupier size that keeps the clock running |
| `HOLD_FAIL_HOURS` | 2 | How long occupiers may stay under the minimum before the claim fails |
| `STRIKE_LOCK_HOURS` | 24 | No new Strike after a change of owner |
| `DEFENDER_RENOWN_PER_DEFENCE` / `DEFENDER_RENOWN_DAILY_CAP` | 0.006 / 22 | Defender trickle: Renown per day per defence point at home, and the cap per village per day |
| `RENOWN_VILLAGE_BASE` | see `config.ts` | Renown price of the 2nd village; each further one x1.6 (replaces `VILLAGE_LIMIT_BASE`, owner 2026-11-04) |
| `PAIR_CONQUEST_CAP` / `PAIR_CONQUEST_WINDOW_DAYS` | 2 / 7 | Villages one attacker may take from the same victim per window (÷ speed); built 2026-11-05 (replaces "per season") |
| `TAKE_KEEP_RESOURCE_SHARE` | 0.5 | Share of each resource a village keeps when it changes owner (built 2026-11-05, engine `hearth.ts`) |
| `HEARTH_MAX_CHIEFTAINS` / `HEARTH_PLAYERS_ENABLED` | 3 / true | Most Chieftains in one attack; Strike on player villages is on since step 4 |
| `CHIEFTAIN_MAX_BATCH` / `CHIEFTAIN_MAX_QUEUED_BATCHES` | 3 / 1 | One batch of at most 3 Chieftains in the Banner Hall queue per village |
| `FOUND_START_RESOURCES` / `FOUND_PROTECTION_HOURS` | 300 wood, 300 food, 150 iron, 0 gold / 24 | Stock of a founded village (levels = new-player start levels); it cannot be attacked for 24 h (÷ speed), `VillageState.protectedUntil` |
| `RESTART_PROTECTION_HOURS` / `RESTART_EDGE_BAND` | 48 / 2 | A player who lost the last village restarts within 2 tiles inside the outer edge of the populated disc, protected 48 h (÷ speed) |
| `MAX_VILLAGES_PER_PLAYER` | 20 | Sanity cap for performance; the Renown price makes it unreachable |

**Server and web as built (2026-11-05).** *Renown ledger:* training a Chieftain adds its price (`villageRenownPrice(villages owned, own other outstanding Chieftains)`, summed
for a batch) to `renown_spent` and to `players.renown_reserved` in the same transaction as the queue and the payment; each Chieftain's share is the average
`reserved / outstanding` (queued + home + away + occupying, all villages); death in any battle, village loss or abandonment releases the share and refunds
`floor(share x 0.5)`; founding or taking releases the share only (the spend stays); cancelling a queued batch refunds the Renown in full. *Strike and Hold*
run inside `processDue` in strict time order with the movements (a `villages.hold_due_at` column holds the next due time); the surviving army stays as an occupier
contingent in `stationed`; a taken village changes owner in one transaction (report "Village taken", old owner's troops away are disbanded and listed in
"Village lost"); the claimant's occupiers cannot be sent home by anyone else, found and occupy movements cannot be cancelled; a Strike attempt carries no loot;
a found mission is re-checked at arrival (tile free, village limit) or the Chieftain walks home. *Restart:* `ensureStartingVillage` runs at sign-in and on every
authenticated request; a player with no village gets a fresh one at the restart place, 48 h protection, ring of abandoned villages in the expanding layout.
*Inactivity:* after `ABANDON_IDLE_DAYS` (÷ speed) the villages turn abandoned with buildings kept (garrison and tier from the Town Hall level); beginner
protection and sandbox accounts are skipped. *Multi-village:* `GET /api/villages`, `POST /api/villages/:id/rename`, support to own other villages, per-village
protection (`protectedUntil`), village switcher in the web top bar. Known gap: a shipment in flight to a village that is taken lands in the conqueror's stock.
*Sim result (`BALANCE.md` 7.5):* balanced takes the 2nd village on day 20.7, builder founds on 15.2, pure defender 26.8 (about a day over the 24-26 target,
the Chieftain's cost is the lever); the pure raider script gets none within 30 days (day 41.9 in a 45-day run): the strike escort (158 population to hold) plus
the Chieftain cost is too much for its economy (levers: `HOLD_MIN_POPULATION`, loot for the strike army, cheaper Chieftain). Idle stretch after day 20: under 3 h
for every style (target under 8 h met, with the weak-sink caveat).

**Engine rules as built (2026-11-05, `hearth.ts`, `found.ts`).** A cold village (hearth out) produces nothing, eats nothing
and its abandoned-village growth clock stands still; build jobs and training batches already queued carry on, but nothing new can be trained.
At a change of owner one Chieftain is used up (his ember lights the new hearth), further Chieftains and troops over the population cap go home;
all buildings keep their levels and `renownPaid` is kept. A found mission needs exactly one Chieftain (escort optional, it becomes the garrison); an
attack may contain 1-3 Chieftains (alone he simply dies); Chieftains cannot scout, support or occupy. Inactive owners' villages become abandoned
with all buildings kept (`abandonVillageKeepBuildings`: tier from Town Hall level 1..5, full garrison for that level).

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

### 18.3 Daily rest hours — dropped by the owner 2026-11-05

Not built and not planned. Dropped by the owner 2026-11-05 (see 18.8 decision 6).

---

### 18.4 Terrain changes travel speed; neutral sites tribes can hold

#### Terrain and travel

**Built 2026-11-04 (step 1).** Numbers in `config.ts` exactly as in the table below; code in `packages/engine/src/travel.ts` (route,
sampling), `army.ts` (`travelTimeMs`, `flatTravelTimeMs`, `travelPreview`) and `shipment.ts` (`shipmentTravelMs`). Decisions made
while building it: (1) the world seed comes from `WorldSettings.seed`, so `travelTimeMs`/`shipmentTravelMs` kept their signatures and
every caller (send, return, recall, scout, shipment, cancel, bots, sim) changed at once; (2) each sample is the tile under the middle of
its 1-tile stretch (`Math.round`), the endpoints are taken in a fixed order (lower x, then lower y) so a route back is exactly the same
stretches reversed and the trip home takes the same time; (3) each unit walks the route by its own family and the army arrives with its
slowest unit (a mixed army of foot and horse loses the foot's pace); (4) the cap is `TERRAIN_MAX_SLOWDOWN` x the flat time **per unit
family**; (5) no rivers exist in `terrainAt`, "water" means the lake terrain; (6) in-flight movements keep their stored `arrive_at`, but a
return trip is timed when the battle is resolved, so it uses the new rule. Measured on the default world (villages 5-35 tiles apart):
foot units 9% slower on average, mounted 20%, pathfinders 3.5%, a mixed army (70% foot, 25% mounted, 5% scouts) about 12%, as
proposed; a trip over grass only is exactly as before. The send dialog and the shipment form show "Travel time" (with terrain),
"Without terrain" with the percentage and which ground slows it, and the map draws the route to the selected tile with yellow dots on
forest and hills and orange dots on mountain and water (key in the map legend). Tests: `packages/engine/test/travel.test.ts`,
`apps/server/test/terrain-travel.test.ts`, `apps/web/test/travel.test.tsx`.

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
| **Fire Shrine** | 8 (+ the Great Fire) | **Bonus for the holding tribe** (see "Step 5" below). Not the win condition (18.1 is domination). |
| **Waymark** | 6 | Terrain penalty is **halved** within 12 tiles of the Waymark for the holding tribe's own troops and shipments (their trips through that area are faster). Never for enemies. |
| **Lookout** | 6 | The holders see every enemy **army march that passes within 20 tiles** of the Lookout (who is going where and when it arrives, the army size in rough bands). They already see attacks aimed at tribe villages; this shows attacks aimed at others. |

  Waymarks and Lookouts are placed outside the shrine rings, between tribes' likely homes, with spacing of at
  least 15 tiles. They persist all season.
- The holder's side can use a Waymark's help only inside its radius, and only on movements that **start after**
  the capture (movements in flight keep the times they were sent with, like everything else).

**Step 5 (owner, 2026-11-05; built 2026-11-05): Fire Shrines as objectives with bonuses, not the win condition.**
- **Built:** the Great Fire and eight Fire Shrines (kinds `great_fire`, `fire_shrine`). Waymarks and Lookouts are **not built yet** (follow-up).
- **Placement** (pure function of the world seed, same for everyone): the Great Fire near the centre (0,0), four shrines on an inner ring
  (radius `SHRINE_RING_RADII[0]` 35) and four on an outer ring (85), at 90° spacing with a seeded rotation; each ideal spot moves to the nearest
  tile that is not mountain or lake and has no site within `SITE_MIN_SPACING`. No village is placed within `SITE_NO_VILLAGE_RADIUS` (4) of a site
  (abandoned-village generation and new-player landing both check it).
- **Holding** is by stationing troops, with the existing support rules (§12): an unheld site has a militia (`SITE_MILITIA` population, pikemen and
  shieldbearers); **attack** it to take it (normal battle rules; if the attackers win, the militia and nothing else dies and the survivors stay as
  the garrison); after a capture it cannot be attacked for `SITE_CALM_HOURS` (2, ÷ speed). Support to a held site only from the holding tribe's
  members and its allies; at most `SITE_MAX_POPULATION` stationed (3,000; Great Fire 5,000). The holder is the tribe of the troops that took it; it
  stays the holder while at least one of its members has troops there; when the last leaves or dies, allies' troops there go home and the site is
  neutral again (militia restored). Players who leave the tribe or are banned send their troops home. The same-connection guard applies. Sites
  have no resources, no loot, no points, and cannot be struck.
- **Wake-up:** shrines are **dormant** for the first `SHRINE_WAKE_DAYS` (120 = about four months, ÷ speed) of the world and then **awake** with a stronger
  bonus and a doubled militia.
- **Bonus** (our own number, one effect so it is easy to read and to test): every member of the holding tribe earns **extra Renown**
  (§18.2, the currency for more villages): dormant shrine +1%, awake shrine +4%, dormant Great Fire +3%, awake Great Fire +10%; the sum is capped at
  `SITE_RENOWN_BONUS_CAP` (+30%). It speeds up settling and taking, never a battle, and no site gives resources. `npm run sim -- --sites` checks it is
  real but not decisive (`BALANCE.md` §7.7).
- **Visible to everyone:** the map shows every site with its holder tag and (when awake or not) a state mark; a site panel lists holder, garrison
  size, calm time and the send buttons; `GET /api/sites`.
- **Server as built (2026-11-05), where it differs from or adds to the text above:**
  - Attack and support go through the normal send route (`POST /api/villages/:id/send`) with the site's tile; the march is stored with the tile (like a
    Chieftain's found mission). Scouts, occupiers, shipments and Chieftains are refused at a site. **Only tribe members** can attack or support a site
    (a holder is a tribe), so a tribeless player gets a clear refusal.
  - The garrison has its own table (`site_garrison`, one contingent per home village) instead of the `stationed` table; troops stay in the home village's
    `away` count like support. They are recalled with **`POST /api/sites/:id/recall`** (`{ villageId, units? }`, added to the contract as `SiteRecallRequest`;
    `SiteDto.myContingents` lists what the player has there), not `/api/stationed/:id/recall`.
  - Tribe-mates, allies and NAP partners of the holder cannot attack its site (the same protection as for villages). The same-connection guard is applied to
    attacks on a held site (refused when any garrison owner shares the attacker's connection); support is not blocked by it.
  - The cap counts what stands there. At send a support that would not fit is refused; supports already on the road can overshoot, so at arrival only
    what fits stays and the rest walks home (nothing fits = the whole army turns back and is told).
  - **Holder housekeeping runs with every request and the 1 s tick**, not at the very instant a player leaves or is banned: troops of players who left the
    tribe, were banned, lost their village, or belong to a tribe that is no longer the holder or an ally walk home from the site; with no troop of the holding
    tribe left the site turns neutral (militia back) and the allies go home. A deleted holder tribe frees the site the same way.
  - An arrival at a site whose conditions changed while marching (calm time, a relation, a shared connection, the world has ended) turns back and the sender
    gets a "called off" / "turned back" report with the reason in its title. Reports reuse the battle and support report kinds; battles at sites pay **no combat
    Renown** and count no battle statistics.
  - A frozen (ended) world keeps its sites as they were: no new orders, arrivals at a site turn back, no housekeeping.
  - The Renown bonus is applied in one place (`Store.addRenown`), so it covers building Renown, the defender trickle, battle Renown and Feasts exactly once;
    test-mode top-ups are not earnings and get no bonus. The GET state shows the pending trickle with the bonus.
  - Existing worlds: a village that already stands near a site stays (the no-village rule only applies to new placements); a village standing exactly on a
    site's tile hides that site from attacks.

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
  troops; village limit; protection time. Some looks can only be **earned** (season winner flame
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
| 3 | ~~**Rest hours** (18.3)~~ — dropped by the owner 2026-11-05 | – | – |
| 4 | **Taking player villages** (18.2, second half: alerts, last-village rule, pair cap, lock, move-in) — **built 2026-11-05** | M | The payoff for tribes and the reason to defend. |
| 5 | **Domination win + world end, Fire Shrines as bonus sites** (18.1 + 18.4b) — **revised by the owner 2026-11-05, built 2026-11-05**: no season clock or score | L | The goal of the game. Uses the stationed-troops and battle rules from step 4. |
| 6 | **Badges + Hall of Fame + lobby world list** (the badge part of the old 18.1: winners of a finished world) | M | Needed before the first real world ends. The lobby already marks finished worlds. |
| 7 | **Tribe projects** (18.5) | M | Needs shipments, terrain (roads), sites (wards): last of the rules. |
| 8 | **Cosmetics shop** (18.6) | M | Independent of the rules; do it when the first season is live and has players to look at it. |

Quick check of the order against the two risks:
- ~~*"Conquest ships without sleep protection."* No: step 3 is before step 4.~~ Rest hours were dropped by the owner
  2026-11-05, so step 4 relies on the hold period, alerts, restart protection and the pair cap (18.2).
- *"A world that cannot end."* Domination (18.1) needs only villages, tribes and taking villages (steps 2 and 4); shrines are optional bonuses on top.

Every step follows the usual protocol: config numbers first, engine with tests, server routes with tests, security
gate, web check at 360 px and 1280–1440 px, then docs (this file's rules move up from §18 into the normal sections).

### 18.8 Decisions

**Owner decisions, 2026-11-04** (these are now rules to build; §18.1–18.7 text still says "proposal" in places, read it with these in mind):

1. **All six parts approved** (seasons + shrines, taking villages by hold, rest hours, terrain + sites, tribe projects, cosmetics shop).
2. ~~**Season: 63 days with a fixed end. No early win and no shared win for allies.**~~ **Replaced 2026-11-05 (decision 12):** worlds end by domination; allies still do not win together.
3. ~~A player's last village is safe from Strikes.~~ **Replaced 2026-11-04 (decision 9).**
4. **Banner Hall: use the lower requirements** from §18.2. They still have to be checked with `npm run sim` (first second village around day 14–20 for a focused player) before step 2 is built.
5. **Premium queue is dropped: queues are equal for everyone, and the shop is cosmetics only.** (Removed from the code 2026-11-04; do not sell or advertise anything that speeds up play.)
8. **Renown (owner, 2026-11-04):** the village limit is Renown, not Banner Hall level; see §18.2 "Owning several villages". Built 2026-11-04: earning (buildings, fights, Feast), anti-abuse, ranking, profile, cost formula. Founding and taking villages: step 2.
6. ~~**Rest hours: 8 hours a day, +25% defence, and no economy pause**~~ — **dropped by the owner 2026-11-05.** Not built, not planned; taking player villages relies on the hold period, tribe alerts, restart protection and the pair cap (18.2).
7. **The name Chieftain is final.**
9. **Taking and founding (owner, 2026-11-04, step 2):** taking developed villages is the main way ahead, founding on empty land the slow safe path; a taken village keeps ALL buildings (no automatic level loss; only siege units, later, damage buildings); a player's LAST village CAN be taken and they restart at the outer edge of the world circle (account, tribe and Renown kept) with a short restart protection. Details: §18.2 "Owner decisions 2026-11-04 for step 2".

11. **Taking player villages (owner, 2026-11-05, step 4):** no rest hours; a player's last village CAN be taken (restart with protection); captured villages keep all buildings; hold 12 h with relief by battle for the owner, tribe-mates and allies; alerts never reveal Chieftains; pair cap 2 takes per 7 days. Details: §18.2 "Step 4".

12. **World end (owner, 2026-11-05, REVISES decision 2):** **no short seasons for normal worlds.** Normal worlds are long and end by **domination**: one tribe with at least 75% of all player-owned village points (abandoned villages excluded, allies not added up) for 14 days in a row, only when the world is at least 6 months old and has at least `max(50, 30% of the peak)` active players. All of it is per-world, stored at creation, changeable by the operator (18.1). The world then freezes, final rankings are stored once, a world-end screen shows the winner, the lobby marks it Finished. Fire Shrines and sites stay as bonus objectives, not the win condition (18.4b). The nine-week season stays only as an idea for a special limited-time world. The old open question "world end rule" is answered.

10. **Siege (owner, 2026-11-04):** building levels only drop through siege, never automatically (no loss on capture, none from time). Our own design, details in §18.9.

Terrain slowing an average trip by about 12% was not answered; it stays as proposed (§18.4a) and was built and re-checked with `npm run sim` on 2026-11-04 (step 1 done; the sim's pace did not move, `BALANCE.md` 7.4).

### 18.9 Siege units: the only way buildings lose levels (owner, 2026-11-04; built 2026-11-05)

Our own design (names, numbers and rules are ours; nothing is copied from another game). Numbers are in `config.ts` (`UNITS.logram`,
`UNITS.boulder`, `SIEGE_*`); the rules live in `packages/engine/src/siege.ts`.

**Rule.** A building level never drops by itself: not on capture, not with time. It drops only when siege units **survive a battle
their side won**. A lost attack, a called-off attack and a scouting mission never lower anything.

**Two units**, both trained in the **Barracks** (simplest fit: no new building, no new queue; they simply sit behind high Barracks
levels) and both **researched at the Drillyard** first, like the other advanced units:

| Unit | Does | Barracks | Drillyard research | Speed | Attack / defence | Cost | Pop |
|---|---|---|---|---|---|---|---|
| **Log Ram** | lowers the **Wall** | 5 | Drillyard 3 | 3 (slowest unit) | 4 / 6 vs foot, 4 vs riders | 220 wood, 120 food, 240 iron, 4 gold | 3 |
| **Boulder Sling** | lowers **one building the sender picks** | 8 | Drillyard 5 | 4 | 6 / 4 vs foot, 3 vs riders | 180 wood, 140 food, 280 iron, 12 gold | 2 |

Both walk over rough ground like heavy carriers (`UNIT_TERRAIN_FAMILY` = carrier) and can only go on an **attack** (not scout, support,
found or occupy; `checkMission` refuses them). They fight, but badly: they add a little attack and a little defence, and die in the
battle like everyone else (loss ratio is the same for every unit of the army).

**Damage (deterministic, `resolveSiege`).** After the battle, in this order: Log Rams on the Wall, then Boulder Slings on their building.
Each kind has `survivors x power` **siege points** (Log Ram power 1, Boulder Sling 0.8). Lowering a building from level L to L-1 costs
`SIEGE_BASE_POINTS (6) + SIEGE_POINTS_PER_LEVEL (2) x L` points, so high levels are harder to knock down (level 10: 26 points, level 5: 16).
A kind lowers **at most `maxLevels`** levels in one attack (Log Ram 3, Boulder Sling 2) and **stops at the floor**: a building never goes below
level 0, the **Town Hall never below 1** (`SIEGE_MIN_LEVEL`). The points of a kind that is not used up are lost; there is no carry-over.

**Order of events.** The battle uses the Wall level as it stood **before** the battle (it counts in full, siege units do not shoot first).
The drop applies **after** the battle, together with the losses and the loot. A queued upgrade of the lowered building aims the same number
of levels lower (its cost is not refunded); levels that already paid Renown stay paid, so rebuilding them earns none. Population, storage and
production simply follow the new levels.

**Picking the building (Boulder Sling).** The send form lists the building **names** (public knowledge) without levels. Levels are only known
from a scouting report with Keen 4 (`SCOUT_INTEL_KEEN.buildings`). The server **never checks the pick against the target village**: it only
accepts a known building id on an attack that carries Boulder Slings, so the send cannot be used to find out what a village has. A pick
that turns out to be level 0 (or at its floor) is a miss, and the report says so. With **no pick** the engine draws one from the battle
seed among the buildings that can still drop (the draw is part of the secret seed, so nobody can predict it).

**Reports.** The battle report (both sides) lists each hit: unit, building, level before and after (`BattleReportData.siege`). `wallLevel`
stays the Wall before the battle. An attacker whose army was wiped out sees nothing of it, like the rest of the defence.

**Balance (`BALANCE.md` section 8).** Siege only acts after the attacker has already won, so a defence that holds loses nothing, and the
defender can rebuild. The siege army is far more expensive than rebuilding what it lowers (Wall levels cost little), is the slowest thing
on the map (a defender sees it coming a long way off and can recall, reinforce or counter), and is capped per attack. So siege makes the
next attack easier; it does not make defending pointless.
