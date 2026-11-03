# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Name: Clanfire** (owner, 2026-11-02). Before launch: trademark + domain check. The GitHub repo
  is still called `tribewars`; the owner can rename it in GitHub → Settings → General (old links redirect).
- **Hosting.** Where the game server runs (one small always-on server is enough at first; the
  database is a single SQLite file that needs backups).
- **World pace.** Done 2026-11-02: slower original pace, default speed 1; revisit after playtests.
- **Troop ranks + Armory (asked 2026-11-03).** Proposal in `docs/GAME_DESIGN.md` §15 (Training
  Point budget per village, rank tiers). Engine/server/web Drillyard is built; the owner's answers
  to the open questions there decide the rest. Also decide: merged support keeps per-arrival ranks
  or the newest stamp.

## Next big pieces
- **Test-mode follow-ups** (built 2026-11-03): look at the "On the road" summary (360/1440 px) and the desktop side-panel Close; if the phone sheet still can't be dismissed after opening the Town Hall, find where (not reproduced in code). Possible: warp build/training queues too. Cancel (80% back, built 2026-11-03): add a server route test, look at the Cancel buttons and dialog at 360/1440 px; maybe let any build job be cancelled (now newest only); cancelling research is not covered. If conquest is ever built, the village must keep its queues.
- **Stats/achievements/caretaker follow-ups** (built 2026-11-03): look at the profile sheet and top-bar Pop chip at 360/1440 px; tune `BOT_*` and achievement tiers; tribe/world achievements; abandoned-village follow-ups (check the new notice banner and the Members online/last-seen line at 360 px; old stationed support is deliberately unreachable for the returning player); run the caretaker in the preview.
- **Population follow-ups** (built 2026-11-03): playtest and tune `POP_*` numbers in `config.ts` (a full-level village vs the cap); population in the battle/support views if troops stationed elsewhere should count; older villages already over the cap just can't build/train more until the Farm grows.
- **Redesign (Toy Diorama)** — built in: village view, map stages, chieftains. Waiting for owner
  approval on canvas rows H (units), I (tutorial + practice-ruin decision), J (building panels +
  reports), K (terrain + armies); then build each in. Reports need the opponent's chieftain in
  `VillageRefDto` (server) to show both faces. Rivers need engine support before river tiles can be used.
- Clean-up: old `.map-*` / `.map-legend` rules in `apps/web/src/styles.css` are unused; `RELATION_STYLE`
  / `LEGEND_ORDER` in `relations.ts` unused by the map.
- Tribe mass message (forum threads and player mail are done). Look at the forum + per-member tribe rights in a browser.

## Gameplay follow-ups
- **Drillyard (built end to end)** — still to do: look at the panel and the 3 Drillyard sprites in a browser at 360 and 1440 px, and check the new village layout (bigger ring wall, buildings spread out, Drillyard in the middle: tune `PLACEMENT` in `apps/web/src/art/buildings.ts`); show ranks in battle reports; research/rank not audit-logged; tune research/rank costs. Later: new units unlocked per building level (ranged Barracks unit, heavy Stables unit, with art).
- Map panel for abandoned villages: show a rough strength hint (e.g. "weak / strong") so players
  don't send 3 Pikemen into a big one. Their map size (points) is also only refreshed when raided.
- Test mode follow-ups: warp for build/training queues; look at the new "Way out / Way home" inputs in the send form at 360/1440 px. Owner to confirm: abandoned villages never recruit for ALL players now (raided ones stay empty for good), not only in test mode.
- Market follow-ups: draw real Market sprites (placeholder = Storehouse; swap `FILE.market` in `apps/web/src/art/buildings.ts`, check scene spot); NPC villages have no Market; set `SANDBOX_USERS` on the live server if the owner's username differs.
- Shipments follow-ups: tune capacity/speed after playtests. Cancel follow-ups: show Cancel also on the map/tile panel; optional "cancelled" note in reports; tune the 2-minute window.
- Cancel follow-ups: server route tests for cancel-build/train/research; look at the Cancel buttons in a browser; optionally let any build job (not only the newest) be cancelled; optional research queue.
- Rankings follow-ups: weekly/daily gains, filters (own tribe), paging beyond 100.
- More villages per player (settlers or conquest); market trading between players.

## Tech follow-ups
- Ask Mags AI advisor is off (owner: credit spend). If revived: decide a budget first; server code is ready behind `ADVISOR_ENABLED`; add stationed support troops to her snapshot.
- Mobile polish: installable web app (PWA), haptics-free touch tuning, landscape layout.
- Deployment: Dockerfile, health checks, daily database backup; compile the server instead of
  running through `tsx` in production.
- Security: work through `docs/SECURITY_ROADMAP.md` Phase 1 (CSP, session expiry, password policy, CI audit; global rate limits are done) before any public server.
- WebSocket push (design in the roadmap, also replaces 10 s polling above) and a tick-lag metric for troop arrivals.
- Map: if pan is still slow on a phone (`window.__mapFrames` in dev), blit-shift the previous frame while panning.
- Test map drag/pinch and pan frame times on a real phone (only simulated so far).
- Warfare: support owners get no report when their stationed Pathfinders die to enemy scouts;
  stationed troops stay when a relation breaks (by design for now — revisit after playtests).
- Tribes: notify applicants when accepted/declined (now they see it on next poll); look-alike
  letters in tribe names (homoglyphs) aren't blocked; cache the tribe ranking if tribes grow to
  thousands; load the Tribe tab on demand (with an error boundary) to keep the first load small.
