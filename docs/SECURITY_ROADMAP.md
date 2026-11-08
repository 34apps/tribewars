# Security & multiplayer roadmap

Standing rules live in `docs/STANDARDS.md`; this file is the plan to raise the bar and the
checklist every feature must pass. Written 2026-11-02. Update the status column as items land.

## 1. Stack decision (keep it, add only what multiplayer needs)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript strict, one engine package shared by server + client | One source of rules; the server stays the judge. |
| API | **Fastify** (already used) | Fast, schema validation built in, small. No change. |
| Game state | **SQLite (WAL) via `node:sqlite`, one authoritative server process per world** | Troop timing needs one total order of events. A single writer gives it for free and handles thousands of players per world. Don't shard a world. Scale by running more worlds (one process + database each). |
| Move to PostgreSQL | only when a world no longer fits one machine, or for the shared account/login service across worlds | Not before; adds ops cost and no timing benefit. |
| Live updates | **WebSocket** (`@fastify/websocket` / `ws`) for push: incoming attacks, arrivals, reports, chat | Replaces 10 s polling; same session cookie, same validation. Polling stays as fallback. |
| Cache / queues | none until needed; then Redis only for rate-limit counters and cross-world sessions | Avoid moving parts. |
| Client | Vite + React + one canvas for the map (already) | Keep bundle small. |
| Production | compiled server (not `tsx`), Docker, reverse proxy (Caddy/nginx) for TLS, daily DB backup | See Phase 3. |

## 2. Movement timing — rules for the world mechanism

Timing is the core of fairness. Current design (keep): lazy settlement, movements stored with
`depart_at` / `arrive_at` (ms, server clock), resolved in order `arrive_at, id`, each in its own
transaction; a 1 s tick plus resolve-on-request.

Must hold for every feature that sends or receives troops:
1. **Only the server clock counts.** The client never sends a time. Arrival = `now + travelTime(engine)`.
2. **Deterministic order.** Same arrival ms → lower `id` first. Tests with a controllable clock for races
   (two attacks and a support landing in the same second; support arriving 1 ms before an attack).
3. **Resolve at the arrival time, not at tick time.** Battle and loot use the village state settled
   *at `arrive_at`*, even if the tick runs late (server was busy or down). ✅ Verified after restarts (`restart.test.ts`, 2026-11-04); startup catch-up runs before listening; the caretaker resolves due movements before settling villages.
4. **Idempotent.** A movement row is deleted/marked in the same transaction as its outcome; a crash
   never double-resolves or loses it.
5. **Fair under load.** Validate → compute → write inside one `BEGIN IMMEDIATE`; no awaits inside.
   Cap work per tick (`LIMIT`) so one burst can't freeze the API, and keep draining next tick.
6. **Anti-abuse on timing:** per-player cap on movements in flight and per-minute send rate; minimum
   distance/time floors; no cancel-and-resend trick to reset arrival (recall returns on the elapsed time; ✅ cancel within 2 min returns in the elapsed time, one transaction, owner-only 404).
7. **Visible truth:** show incoming attacks to the target with arrival time from the server; countdowns
   tick locally from a server-offset clock (already done on the map).

## 3. Security roadmap

Status: ✅ done · ◐ partly · ☐ open.

### Phase 0 — in place today
- ✅ Server-authoritative rules; every action re-checked in a transaction.
- ✅ scrypt passwords, hashed session tokens, HttpOnly + SameSite=Lax cookie, Origin check on POST,
  prepared statements, request schemas, body size limit, sign-in/registration rate limit, tribe chat limit.
- ✅ `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `no-store` on API.

### Phase 1 — before any public server (do next)
- ✅ **Content-Security-Policy** + `Permissions-Policy` on every server response, HSTS in production only (`apps/server/src/security.ts`, tests `security-headers.test.ts`); CloudFront policy in `DEPLOYMENT_PLAN.md` §2. No inline script in the built client. Allowed beyond `'self'`: Google Fonts (style + font host) until fonts are self-hosted (NEXT_STEPS).
- ✅ **Rate limits** (in-house `RateLimiter`, no new package): global 600 API calls/min per IP, 180 writes/min per IP,
  120 writes/min per session; plus per-account route caps (`ROUTE_LIMITS`: send, build, train, research, market, tribe, mail, search, rankings; 30–60/min, keyed by account id); `429` + `Retry-After`.
- ☑ **Session hygiene** (2026-11-04, lobby + worlds): idle expiry 14 days (slides, one write/hour), absolute 60 days, new token on every sign-in, 10 sessions per account (lobby), "Sign out everywhere" (`POST /lobby/api/auth/logout-all`), lobby `Secure` cookie enforced in production (fail to start without it). Lobby-linked world sessions last 12 h, fixed. Standalone worlds: expiry done; sign-out-everywhere and the cap are lobby-only.
- ☑ **Password policy & lockout** (2026-11-04, lobby): new passwords ≥ 10 chars, not in the bundled common-password list, not containing the username; old passwords keep working (an owner switch can force a change at next sign-in); per-name growing lockout (3rd failure 30 s, doubling to 15 min), one message and one scrypt for wrong/unknown/locked names; password change endpoint. Open: standalone worlds' own sign-in still has the 8-character rule and no lockout.
- ☐ **Email verification + password reset** (single-use hashed tokens, short expiry) when accounts matter; no account enumeration in messages.
- 🟡 **Multi-account guard** (owner 2026-11-03: one account per player): ✅ IPs recorded per account, registration refused past `MAX_ACCOUNTS_PER_IP` (default 3 in production), ✅ ban/unban + shared-IP report via `npm run admin`. Still open: device/cookie clustering, ✅ no attacking/scouting/support between accounts on a shared IP (households may have several accounts; self-report in the account menu); open: block resource sending the day trade exists, admin UI/audit log, privacy text for stored IPs, `TRUST_PROXY` must be set behind a proxy.
- 🟡 **Lobby: one account for all worlds** (2026-11-04, `docs/MULTI_WORLD.md`): ✅ accounts, passwords (scrypt), sessions (`tw_lobby`, `Path=/lobby/`), Origin check, rate limits and the multi-account IP guard live in the lobby; ✅ worlds accept only **Ed25519-signed entry passes** (60 s, one use, bound to one world id, one-time nonce stored until expiry, lifetime cap, clock-skew limit), key list for rotation, no linking of accounts by name (`players.account_id` unique); ✅ the world's own register/login are off when `LOBBY_PUBLIC_KEY` is set; ✅ the signing key is only in the lobby container's env (`deploy/lobby.env`, git-ignored, never in a world env, Caddy or git); ✅ lobby container hardened like a world (read-only, no capabilities, no published port, backups with `lobby/` S3 prefix); ✅ tests for the deploy files in `apps/server/test/deploy-config.test.ts`. Open: a lobby ban does not end a live world session (ban in the world too), password change/reset/e-mail, audit log for lobby admin commands, alert on a failing key (passes refused at a world), CloudFront `/lobby/api/*` rate/WAF rules.
- ☐ **Dependency & secret hygiene:** `npm audit` in CI, lockfile pinned, secret scan (gitleaks) in CI, no secrets in logs.
- ☐ **CI:** run `npm run check` + `npm run build` + audit on every push.

### Phase 2 — before opening to strangers
- 🟡 **Mail** (player-to-player, 2026-11-03): ✅ input schema (recipient/subject/body types and lengths, unknown fields refused), ✅ text only, same sanitiser as tribe chat, rendered as React text (`white-space: pre-wrap`), no markup/images/attachments, ✅ rate limit per sender (gap, per minute, per hour), ✅ inbox cap per recipient (`MAIL_INBOX_KEEP`), ✅ authorisation: only sender/recipient read or delete, others get `not_found`, ✅ tests in `apps/server/test/mail.test.ts`. Open: block/mute and report-abuse, audit log entry, multi-account mail spam (per-recipient cap per sender), admin review of reported mail.
- 🟡 **Tribe forum + per-member rights** (2026-11-03): ✅ input schemas, ✅ text only with the chat/mail sanitiser, ✅ per-member rate limit (gap/minute/hour), ✅ caps (boards, threads per board, posts per thread), ✅ authorisation: tribe members only, leadership boards hidden (`not_found`), edit window, moderation by right, ✅ grants validated against an allow-list (leader-only rights never grantable, only the leader sets grants), every server check uses the effective right, ✅ tests in `apps/server/test/tribes-forum.test.ts`. Open: report/mute, audit-log entry for moderation, per-IP/multi-account forum spam.
- ☐ **Abuse controls for user text** (names, tribe names/descriptions, chat, messages): length + charset limits (incl. homoglyph check noted in NEXT_STEPS), profanity/report/mute/block, render as text only (React escapes; never `dangerouslySetInnerHTML`).
- ☐ **Audit log** table: logins, password changes, troop sends, tribe joins/leaves, admin actions (actor, ip, time). Append-only; never log secrets.
- ☐ **Authorization tests:** every route has a test "player B cannot act on / read player A's village or report" (IDOR). Add as a standing test per new route.
- ☐ **Information leaks:** public endpoints never return troop counts, resources, build queues of others; uniform errors for "not found" vs "not yours".
- ☑ **WebSocket security:** authenticate on upgrade via the session cookie, check `Origin`, per-socket message-rate and size caps, subscribe only to the player's own channels.
- ☐ **Backups & recovery:** daily consistent SQLite backup (`VACUUM INTO`), tested restore, off-machine copy.
- ☐ **Admin tooling** separated from the game API (own auth, 2FA, audit).

### Phase 3 — production hardening
- ☐ Compile server (`tsc`), run as non-root in Docker, read-only filesystem except `data/`, health check, resource limits.
- 🟡 TLS via reverse proxy, HTTP→HTTPS redirect, trusted-proxy config so rate limits see the real client IP (✅ 2026-11-04: `TRUST_PROXY` takes a hop count or proxy IP/CIDR list, `ALLOWED_ORIGINS` for the Origin check behind a CDN, `/api/health` checks the DB; AWS shape in `docs/DEPLOYMENT_PLAN.md`).
- ☐ Structured logs (no PII/tokens), alerting on error rate, tick lag (`now - oldest due arrive_at`), DB size.
- ☐ Load test: N simulated players sending/arriving movements; measure tick lag and API p95.
- ☐ External security review / pen test before launch; responsible-disclosure contact (`security.txt`).
- ☐ Privacy: data-export and account-deletion, minimal data kept, privacy text before collecting email.

## 4. Per-feature security gate (standing rule)

Every new feature, route or screen answers these in its PR/commit before merging; note anything
skipped in `CHANGELOG.md`:
1. **Who may do this?** Ownership/role check on the server; test that another player is refused.
2. **What input arrives?** Schema with types, ranges, lengths; unknown ids are errors.
3. **What can it cost?** Rate limit and per-player caps (actions, rows, bytes); bounded queries.
4. **What does it reveal?** Response contains only what the viewer may see.
5. **Is the timing server-side?** No client-sent times; ordering deterministic; resolution idempotent.
6. **Is it abusable with many accounts?** Think multi-account, spam, and griefing.
7. **Is it logged?** Audit-log sensitive actions; never log secrets.
8. **Does a test prove 1–5?** Add integration tests with the controllable clock.

Gate note, stats/achievements and caretaker bot (2026-11-03): no new input and no write endpoint (profile read only;
counters written by the server inside the event's transaction). The bot only queues builds on the idle owner's own
village via the normal build check; it cannot train, send troops, shipments or support. `last_active` writes are throttled.

Gate note, map sites (2026-11-05, step 5): new `GET /api/sites` (signed in, reads only, bucket `world`) and `POST /api/sites/:id/recall` (owner of the
troops only, bucket `send`; strangers and foreign villages answer 404; strict body schema; world-ended 403). Sending to a site reuses the owner-only `send` route.
Timing is the server's: arrival = now + travel time, resolved in arrival order and re-checked on arrival (calm time, relation, connection, world end); no client
time, no oracle (a refusal only says things about the sender's own tribe or the public site state). Garrison size is public on purpose (it is on the map);
other players' troops per village are not. Multi-account: the same-connection guard on attacks, the tribe-only rule, and the population cap stop a household
stacking a site. Tests: `apps/server/test/sites.test.ts`.

Gate note, Waymarks and Lookouts (2026-11-07; `GET /api/tribe/sightings` in `routes/tribes.ts`, `SiteService.sightings` / `waymarksForPlayer`, `Store.marchesNear`; tests in `apps/server/test/waymark-lookout.test.ts`, `packages/engine/test/{sites,travel}.test.ts`). (1) Who: signed in only; the answer is keyed on the caller's tribe and the Lookouts it holds now (no tribe = empty, `lookouts` 0); another tribe or a tribeless player sees nothing of it. Capture, support and recall reuse the existing tribe-only site checks. (2) Input: the sightings route takes no query keys at all (any extra key is 400 `invalid_input`), no body. (3) Cost: bucket `world` (30 per minute per account); one bounded query (in-flight attack/support rows, bounding box of the line grown by the radius, at most 2,000 rows read, ordered by arrival) then the exact line test in code; at most 100 sightings returned; at most 6 Lookouts exist. (4) Reveals: only enemy attack/support marches that pass a Lookout the viewer's tribe holds: sender village (public on the map) and tribe tag, target, times, mission and a size band; never unit counts, never returns, shipments or Pathfinder-only (scouting) marches, never the viewer's own tribe's or an ally's marches. (5) Timing: all server-side. A Waymark's help is decided from the server's own sites state when each movement is created (send, shipment, and every return at the moment it starts) and stored as the arrival time; the client sends no time and no waymark list, and nothing in flight is ever changed by a later capture or loss. Sightings are computed at read time from the server clock. (6) Many accounts: a Waymark helps only members of the holding tribe (not allies), so an alt outside the tribe gains nothing; holding needs real troops standing there under the 3,000 population cap and the same-connection attack guard of sites; a Lookout shows only size bands, so alts cannot be used to read exact armies. (7) Logging: read route, nothing sensitive to audit; captures go through the normal site reports. (8) Tests cover 1-5: tribe-member vs ally vs enemy vs tribeless travel times, sent-before keeps its time, shipments and returns, own/ally/Pathfinder/out-of-range/lost-Lookout sightings, size bands, no unit counts, ordering and limit, extra query keys, 401 and the bucket mapping.

Gate note, tribe projects (2026-11-07; `GET /api/tribe/projects`, `POST /api/tribe/projects/{store-village,start,cancel}`, `toTribeStore` on `POST /api/villages/:id/ship`; `apps/server/src/tribe-projects-service.ts`, tests in `apps/server/test/tribe-projects.test.ts`, `packages/engine/test/tribe-projects.test.ts`). (1) Who: members only (`not_in_tribe` otherwise); the store village, start and cancel need the `projects` right (leader, or a grant; re-read inside the transaction); every read and write is keyed on the caller's own tribe id taken from the server's membership row, never from the request, so another tribe's store, ledger and runs are unreachable (tested: BRAVO sees its own empty store). (2) Input: strict schemas (`villageId` integer, `project` enum, `toTribeStore` boolean, unknown fields 400); the target of a funding shipment must be the tribe's current store village. (3) Cost: new bucket `projects` (30/min per account, `security.ts`) plus the existing `market` bucket on shipments; per member 60,000 per rolling 24 h (counted from `tribe_store_sends`, cancelled shipments removed) and an account age of 3 days, both checked inside the send transaction; store cap per resource counts cargo already on the road; ledger and event log are bounded (50 rows listed, event log trimmed). (4) Leaks: the map marks the store village (public by design) but never the amounts; the Watchtower shows only a band, the slowest non-Chieftain unit and a rounded number, never Chieftains and never the unit list; own-tribe-only fields (`projectLevels`, `storeVillage`) are absent from other tribes' views. (5) Timing: server clock only; a project finishes lazily on any read (and its level is applied to the very next travel time or battle); funding cargo is credited at its arrival time in arrival order; if the store village changed or the owner left, the cargo turns back; resolution deletes the movement and the cap row in one transaction (idempotent). The store never goes below zero (SQL CHECK plus clamping) and a double start is serialised by one transaction and the one-run-per-tribe primary key (tested: two starts at once, one wins, paid once). (6) Many accounts: the 3-day age and the 60,000 daily cap stop fresh alts from funding; household members cannot ship to each other's villages (existing guard), so a household cannot use the store village as a pipe. Raid laundering (give to the store, let a friend raid it) is bounded by the one-fifth cap per won attack and the existing repeat-raid rules (diminishing pair Renown; the same-connection attack refusal); the Vault shelters the village stock only, so the store has to be defended by support. (7) Audit: tribe event log lines for store village set, project started, cancelled, finished and store raided; no secrets involved. (8) Tests prove 1-5 (forbidden, not_in_tribe, schemas, caps, double start, IDOR, arrival and turn-back, raid split, Roads/Wards/Watchtower).

Gate note, morale (2026-11-08; `moraleFactor` in `packages/engine/src/army.ts`, `GameService.resolveAttack`, `MapVillageDto.ownerPoints`; tests `packages/engine/test/morale.test.ts`, `apps/server/test/morale.test.ts`). No new input and no new route: nothing the client sends changes the outcome. Both players' points are read server-side at the fight (arrival) from the database, never from the request; the world flag is server config. Timing stays server-side (resolved at arrival in order, same seed). The only new output is the owner's total points on map rows (already public in the rankings) and `morale` on the battle report. Multi-account: morale only weakens the attacker, so alts gain nothing by feeding or farming a small account beyond what the existing raid rules allow.

Gate note, badges + Hall of Fame (2026-11-08, plan step 9; engine `badges.ts`, world `domination-service.ts` `endWorld`, `entry-pass.ts`, lobby `finish-world.ts`, `GET /lobby/api/hall-of-fame`; tests in `packages/engine/test/badges.test.ts`, `apps/server/test/badges.test.ts`, `apps/lobby/test/badges.test.ts`). (1) Who: no player route writes a badge. A world writes its badges once, inside the `world_end` transaction (frozen table `world_end_badges`, UPDATE/DELETE blocked by triggers); the lobby writes them only through the operator CLI (`world-finish`, `badge-grant`, `badge-revoke`). Hall of Fame needs a lobby sign-in (401 tested). (2) Input: the new routes take none. The pass claim `bdg` is signed by the lobby and still checked strictly (`parseBadgeSummary`: known kinds, one per kind, integer count 1-999, place 1-10 only for top10, no extra keys); a malformed one refuses the whole pass and stores nothing (tested). `world-finish` opens the world database read-only and checks every value it reads (kinds, places, integers, text stripped and length-capped). (3) Cost: Hall of Fame at most 50 worlds, global per-IP limit; the end screen lists badges only for the 50 players it shows; badge rows per account are at most four per finished world. (4) Leaks: `myBadges` is the caller's own; other players' badges are public results (rank, tribe place); activity times, ban and test flags are never sent. (5) Timing: server clock only, at the recorded end moment; idempotent (a second end and a second `world-finish` change nothing, tested). (6) Many accounts: 14 days in the world and in the tribe, played within the last 7 days, banned and test accounts excluded; badges give no power, so alts gain nothing in play. (7) Audit: `world_end` (existing), lobby `world_finish`, `badge_grant`, `badge_revoke`. (8) Tests prove 1-5.

Gate note, taking player villages (2026-11-05, step 4; full gate in `CHANGELOG.md`): no new route. Strikes, relief attacks and occupiers use the
existing owner-only `send` route (and its rate bucket); the pair cap, protection, lock, household / tribe / ally refusals and the hold clock are all
decided by the server in arrival order (§2); an incoming attack alert never reveals its units; the tribe alert list shows only what the map shows.

Gate note, notifications (2026-11-05; `docs/GAME_DESIGN.md` 18.10, `apps/server/src/routes/notifications.ts`, `notification-store.ts`, tests in
`apps/server/test/notifications.test.ts`). (1) Ownership: both routes need sign-in; every SQL statement is keyed on the caller's player id, so a player never
lists or marks another's row (a foreign id in `read` changes nothing and is not echoed). (2) Input schema: `read` takes only `ids?`, an array of at most 200
positive integers (Fastify schema, anything else 400 `invalid_input`). (3) Rate and caps: own bucket `notifications` (60 per minute per account, `security.ts`),
at most 100 rows per player and none older than 7 real days, pruned on every insert and filtered on read; rows are created only by the server inside the send
transaction. (4) No leaks: a row holds the sender's village (public on the map), send and arrival time and the kind, never units, loot or the resources of a shipment;
scouts, returns and abandoned targets create none (the scout stays invisible); the `notifications` live hint carries no data. (5) Timing: created and deleted together
with the movement (cancel inside the window deletes it), so it cannot be used to see more than the movement list already shows. (6) Multi-account: nothing new to
exploit (read-only information the target is entitled to; no resources or troops move). (7) Audit: the new routes are in the bucket test of `security-headers.test.ts`.
Not done: a browser/push delivery path (client only, no server change).

Gate note, command post search (2026-11-06; `GET /api/search/villages`, `apps/server/src/game.ts` `searchVillages`, tests in `apps/server/test/search-villages.test.ts`). (1) Signed in only; optional `from` must be the caller's own village (else 404). (2) `q` 2..24 characters after trim, no control characters; `by` is `village|player`; `from` digits only; extra query keys 400. (3) Bucket `lookup` (30 per minute per account), 10 rows, one indexed-free LIKE scan, prepared statement with escaped `%` `_` `\\`. (4) Rows are the map's per-viewer rows (shared builder), never troops, stock or queues; banned accounts' villages are left out. (5) Read only. (6) Nothing to stack: public data the map already shows, but the rate limit stops scraping the whole world by name. (7) Not audit-logged (read only, no sensitive action). (8) Tests cover 1-4 and the bucket.

Gate note, map gaps (2026-11-06; `GET /api/scouted/:id`, `chain` on the map rows, tests in `apps/server/test/scouted.test.ts`, `chieftain-chain.test.ts`). (1) Signed in only; both reads are keyed on the caller's player id (own `side = 'attack'` scout reports; own `strike_chain` rows), so nobody sees another player's intel or chain; unknown village 404. (2) `:id` digits only, 1..9 characters (else 400). (3) Bucket `lookup` (30 per minute per account); one query over at most 200 own reports; the chain read is one query of at most 200 own rows per map call. (4) Reveals only the caller's own scout levels with their age, and `have`/`need`/`endsAt` of the caller's own banked Chieftains; `need` follows from public points. (5) Read only. (6) Nothing to stack. (7) Not audit-logged (read only). (8) Tests cover 1-4 and the bucket mapping.

Gate note, troop groups (2026-11-06; `apps/server/src/routes/troop-groups.ts`, `troop-group-store.ts`, tests in `apps/server/test/troop-groups.test.ts`). (1) Signed in only; every SQL statement is keyed on the caller's player id, so someone else's group id answers 404 `not_found` on update and delete and changes nothing. (2) `name` 1..24 characters after trim, no control characters; `units` is a partial map of known unit ids with whole counts 0..1,000,000 and at least one above zero (engine `checkTroopGroup`, also used by the client); extra body keys, a bad id or extra keys in the delete body are 400 `invalid_input`; state changes are POST with JSON and the Origin check. (3) Bucket `groups` (30 per minute per account, `security.ts`); at most 12 groups per player, counted inside the insert transaction (`group_limit`, 409); one small row each. (4) A player only ever receives their own groups (name and unit counts they typed); nothing about villages or other players. (5) No time involved; groups reserve nothing and every send is re-checked by the normal send route. (6) Nothing to stack across accounts: private, capped, no effect on the game. (7) Not audit-logged (personal convenience data, no sensitive action). (8) Tests cover 1 to 3, signed-out 401, cross-site Origin 403 and the bucket (`security-headers.test.ts`). Schema version 12 adds the table.

## 5. Game-rules audit, 2026-11-04

Every probe is a server test in `apps/server/test/security-audit.test.ts` and also asserts that the village state did not change.
(Earlier files cover ownership, protection, household, rate limits and the cancel window in more depth.)

| Tried | Result |
|---|---|
| Village id `-1`, `1.5`, `abc`, `1e3`, 20 digits, `0x10` on build | 400, nothing changed |
| Unknown building / unit / track, extra body fields, empty body | 400 |
| Train count `0`, `-1`, `1.5`, `1e12`, over the batch cap, `"5"`, `null`, `MAX_SAFE_INTEGER` | 400 |
| Cancel build / train / research with negative, fractional, huge, string, null index | 400 |
| Send with huge, negative, fractional, `NaN`, string coordinates; negative, huge, fractional unit counts; unknown mission or field; `__proto__` key in the units | 400, no movement created |
| Ship negative (would add stock to the sender), fractional, string, huge, unknown-resource, empty or `null` cargo; more than the village holds; to the same village; far-off coordinates | 400 / 409, stock unchanged |
| 3 to 4 simultaneous builds, ships, sends, cancels, build-cancels for one affordable action | Accepted once (builds: up to the queue limit); stock never negative; troops and refunds never duplicated |
| Cancel at 119 s, resend, cancel a return, cancel after 2 min, send the troops still walking home | Return takes exactly the elapsed time; return not cancellable; resend not faster; late cancel 409; no battle report |
| Another player: cancel my movement, cancel-build/train/research, research, rank, respec, ship from my village, recall / send back unknown or foreign stationed troops | 404 / 403, my queue untouched |
| Defender's view of an incoming attack | Times only, no army; `/api/state` lists only own villages |
| Reports of another player (stranger and tribe-mate) | 404, stranger's list empty |
| Map, player profile, both rankings, tribe pages as a stranger | No resources, troop counts or queues in any body |
| Banned account on state, build, train, send, ship, cancel, recall, reports, tribe, leave; login | 401 on all; login refused |
| Test-mode extras (`travelSeconds`, `returnSeconds`, `/api/sandbox/*`) as a normal account | 403 |
| Two accounts on one IP: ship to each other | Refused (already) |
| **Two accounts on one IP: ship to an abandoned village, partner raids it** | **HOLE, fixed**: the cargo was credited to the abandoned village's stock. Accounts that share a connection with any other account now get `invalid_target`; a solo player may still feed abandoned villages (owner decision, 2026-11-03) |
| **Predictable battle luck** (seed was `hashSeed(movement id, arrival time)`, computable by the sender, who could cancel and re-send until luck was good) | **HOLE, fixed 2026-11-04**: the seed now mixes in a 128-bit server-only salt (`meta.battle_salt`); tested that luck matches the salted seed, differs from the old recipe, and the salt is in no API body (`npc-raids.test.ts`) |
| Farming one abandoned village over and over with a few raiders (no counter-play) | Fixed 2026-11-04: repeat raids by the same player within a day carry 50%, 25% ... of the load; garrisons refill (GAME_DESIGN §8). **Replaced 2026-11-05 (owner):** both limits were removed; loot is always full, the garrison never refills, and only the diminishing Renown per pair limits farming (`BALANCE.md` §9) |

Not changed, follow-ups: no per-player cap on movements in flight (bounded today by units owned and the 60 per minute send limit; rule 6 asks for a cap);
`rank` / `respec` have no per-route limit bucket; two households on different IPs cannot be detected (accepted, handled by staff tooling).
Concurrency note: handlers are synchronous inside one transaction, so two "simultaneous" requests are serialised; the tests prove the second sees the first's deduction.

Gate note, first steps (2026-11-08; `POST /api/first-steps/:id/claim`, `POST /api/first-steps/hidden`, `firstSteps` on `GET /api/state`; `apps/server/src/first-steps-service.ts`, `routes/first-steps.ts`, tests `apps/server/test/first-steps.test.ts`, `packages/engine/test/first-steps.test.ts`). (1) Who: signed in only; claim names a village that must be the caller's (404 missing, 403 foreign, tested); every SQL statement is keyed on the caller's player id. (2) Input: `:id` is an enum of the eight step ids, body `{villageId: integer}` or `{hidden: boolean}`, no extra keys (400). (3) Cost: bucket `firststeps` (30/min per account), one small row per step (8 per player). The reward is fixed in config and capped at the village's storage. (4) Reveals: only the caller's own progress. (5) Timing: server clock; done is derived from the server's own village state, tribe membership and two events written by the server (`raid` in the send transaction, `report` when a battle report is read); a client cannot mark a step. The claim is one transaction with `UPDATE ... WHERE claimed_at IS NULL`, so concurrent claims pay once (tested). (6) Many accounts: each step needs real play (a build, 5 Raiders, an attack, a tribe) and the whole card is worth under about 1,300 of each resource and 100 gold per account, small next to a village's own income; a farm of alts would have to play each of them. (7) Not audit-logged (fixed small grant, no sensitive action). (8) Tests prove 1-5, schema version 15 adds the tables.

Gate note, homepage world strip (2026-11-08; lobby `GET /lobby/api/worlds/public`, `apps/lobby/src/routes/worlds.ts`, tests in `apps/lobby/test/worlds.test.ts`). (1) No sign-in on purpose (signed-out homepage); read only. (2) No input at all. (3) Global per-IP lobby API limit; list capped at `PUBLIC_WORLDS_MAX` (6). (4) Only id, name, status (open/full), path and created time of joinable worlds; closed/finished worlds and every account field are left out (tested: exact field set). (5) No timing. (6) Nothing to gain with many accounts. (7) Not logged (public read). (8) Tested signed out, hidden statuses, field set, empty list, cap.
