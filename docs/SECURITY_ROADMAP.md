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

Not changed, follow-ups: no per-player cap on movements in flight (bounded today by units owned and the 60 per minute send limit; rule 6 asks for a cap);
`rank` / `respec` have no per-route limit bucket; two households on different IPs cannot be detected (accepted, handled by staff tooling).
Concurrency note: handlers are synchronous inside one transaction, so two "simultaneous" requests are serialised; the tests prove the second sees the first's deduction.
