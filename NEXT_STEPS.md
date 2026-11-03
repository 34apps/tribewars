# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Name: Clanfire** (owner, 2026-11-02). Before launch: trademark + domain check. The GitHub repo
  is still called `tribewars`; the owner can rename it in GitHub → Settings → General (old links redirect).
- **Hosting.** Where the game server runs (one small always-on server is enough at first; the
  database is a single SQLite file that needs backups).
- **World pace.** Default world speed 1 (slow, days-long game) vs a faster world (e.g. 3×).
- **Drillyard follow-ups:** look at the panel and the new Drillyard sprites (3 stages) in a browser at 360 and 1440 px, run `npm run build`; show battle reports' ranks if wanted; decide whether merged support should keep per-arrival ranks instead of the newest stamp.
- **Troop ranks + Armory + scout intel tiers (asked 2026-11-03).** Full proposal in
  `docs/GAME_DESIGN.md` §15: per-village Training Point budget so a village can't max everything,
  Edge/Guard/Sight ranks, Sight gates how much a scout reveals. Needs the owner's answers to the
  open questions there, then build.

## Next big pieces
- **Redesign (Toy Diorama)** — built in: village view, map stages, chieftains. Waiting for owner
  approval on canvas rows H (units), I (tutorial + practice-ruin decision), J (building panels +
  reports), K (terrain + armies); then build each in. Reports need the opponent's chieftain in
  `VillageRefDto` (server) to show both faces. Rivers need engine support before river tiles can be used.
- Clean-up: old `.map-*` / `.map-legend` rules in `apps/web/src/styles.css` are unused; `RELATION_STYLE`
  / `LEGEND_ORDER` in `relations.ts` unused by the map.
- Tribe forum threads / mass message; player-to-player messages.

## Gameplay follow-ups
- **Drillyard (engine built, server/web pending)** — URGENT: the engine now refuses Shieldbearer/Outrider/Knight training until researched, so the server needs persistence for `researched`, `researchJob` and `ranks` plus endpoints (research, buy rank, respec), each through the SECURITY_ROADMAP §4 gate; the server must stamp the home village's ranks on movements (attack/support) and pass them to `resolveBattle`. Web: Drillyard panel (research list, points bar, rank buttons, respec), real Drillyard sprite (placeholder = Barracks). Later: new units unlocked after each building level (a ranged Barracks unit, a heavy Stables unit, with art), scout Keen tiers (intel by Keen rank, GAME_DESIGN §15), use `keenMultiplier` in the scout duel, tune research/rank costs.
- Map panel for abandoned villages: show a rough strength hint (e.g. "weak / strong") so players
  don't send 3 Pikemen into a big one. Their map size (points) is also only refreshed when raided.
- Market follow-ups: draw real Market sprites (placeholder = Storehouse; swap `FILE.market` in `apps/web/src/art/buildings.ts`, check scene spot); NPC villages have no Market; set `SANDBOX_USERS` on the live server if the owner's username differs.
- Shipments follow-ups: tune capacity/speed after playtests. Cancel follow-ups: show Cancel also on the map/tile panel; optional "cancelled" note in reports; tune the 2-minute window.
- Cancel a build/training job (refund rule to decide).
- Rankings follow-ups: weekly/daily gains, filters (own tribe), paging beyond 100.
- Inactive players' villages turn into abandoned villages after N days.
- More villages per player (settlers or conquest); market trading between players.

## Tech follow-ups
- Ask Mags AI advisor is off (owner: credit spend). If revived: decide a budget first; server code is ready behind `ADVISOR_ENABLED`; add stationed support troops to her snapshot.
- Live updates (WebSocket) for incoming attacks instead of 10 s polling.
- Mobile polish: installable web app (PWA), haptics-free touch tuning, landscape layout.
- Deployment: Dockerfile, health checks, daily database backup; compile the server instead of
  running through `tsx` in production.
- Security: work through `docs/SECURITY_ROADMAP.md` Phase 1 (CSP, global rate limits, session expiry, password policy, CI audit) before any public server.
- WebSocket push (design in the roadmap) and a tick-lag metric for troop arrivals.
- Map: measure pan frame times on a real phone (`window.__mapFrames` in dev) after the fling/prefetch change; if still slow, blit-shift the previous frame while panning.
- Test map drag/pinch on a real phone (only simulated so far).
- Warfare: support owners get no report when their stationed Pathfinders die to enemy scouts;
  stationed troops stay when a relation breaks (by design for now — revisit after playtests).
- Tribes: notify applicants when accepted/declined (now they see it on next poll); look-alike
  letters in tribe names (homoglyphs) aren't blocked; cache the tribe ranking if tribes grow to
  thousands; load the Tribe tab on demand (with an error boundary) to keep the first load small.
