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
- **Storage cap** (same for every resource) from the storehouse level:
  `L == 0 ? STORAGE_LEVEL0 : round(STORAGE_BASE * STORAGE_GROWTH^(L-1))`. Production stops at the
  cap. Anything added (refunds, loot coming home) is also clamped to the cap.
- **Vault** protects `L == 0 ? 0 : round(VAULT_BASE * VAULT_GROWTH^(L-1))` of each resource from loot.

## 3. Buildings

Fixed set (`BUILDINGS`), each with a level, 0 = not built. New player villages start at
`startLevel` for each building.

- Cost of level L: each resource `round(baseCost[r] * costGrowth^(L-1))`.
- Build time of level L in ms:
  `round(baseTimeSec * timeGrowth^(L-1) * HALL_TIME_FACTOR^(hallLevel-1) / speed * 1000)`,
  using the Town Hall level when the job is queued.
- Requirements: `requires` must be met (current levels, not queued) to start level 1 and every later level.
- **Queue:** at most `MAX_BUILD_QUEUE` jobs. Cost paid when queued. A job starts at
  `max(now, finishAt of the previous job)`. Queuing the same building twice targets the next level
  after the queued one (target = current level + jobs for it in queue + 1). Refuse with:
  `max_level` (target > maxLevel), `requirements_not_met`, `exceeds_storage` (any cost > cap — can never
  be afforded), `not_enough_resources`, `queue_full`.
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
  nothing grows) and refills `ceil(full × NPC_GARRISON_REGEN)` of each garrison unit (never above
  full). Apply at most `NPC_MAX_STEPS_PER_SETTLE` steps per settle; production between steps uses
  the levels at that time (accuracy within one step is fine).
- They produce resources like player villages (no upkeep), which is what raiders take.

## 9. Players, spawn, protection

- Register → one village named "<username>'s village" at a random free tile anywhere in the world
  (not mountain/lake, at least `SPAWN_MIN_SPACING` from every village). Up to 2000 random tries, then
  scan outward from a random tile.
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
applications, proposals and relations.

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

## 13. Roadmap (not yet built)

1. Tribe forum threads, mass messages, member notes; player-to-player messages.
2. More villages per player (settlers / conquest), market trading, siege units vs. wall.
3. Live push (WebSocket) for incoming attacks and chat; mobile polish (PWA, install prompt).
4. World lifecycle: player/tribe rankings history, inactive players turning into abandoned
   villages, world end and winners.
5. New visual identity (style directions in progress), characters, isometric map; 3D models later.
