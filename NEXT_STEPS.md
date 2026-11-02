# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Name: Clanfire** (owner, 2026-11-02). Before launch: trademark + domain check. The GitHub repo
  is still called `tribewars`; the owner can rename it in GitHub → Settings → General (old links redirect).
- **Hosting.** Where the game server runs (one small always-on server is enough at first; the
  database is a single SQLite file that needs backups).
- **World pace.** Default world speed 1 (slow, days-long game) vs a faster world (e.g. 3×).

## Next big pieces
- **Redesign (Toy Diorama)** — built in: village view, map stages, chieftains. Waiting for owner
  approval on canvas rows H (units), I (tutorial + practice-ruin decision), J (building panels +
  reports), K (terrain + armies); then build each in. Reports need the opponent's chieftain in
  `VillageRefDto` (server) to show both faces. Rivers need engine support before river tiles can be used.
- Clean-up: old `.map-*` / `.map-legend` rules in `apps/web/src/styles.css` are unused; `RELATION_STYLE`
  / `LEGEND_ORDER` in `relations.ts` unused by the map.
- Tribe forum threads / mass message; player-to-player messages.

## Gameplay follow-ups
- Map panel for abandoned villages: show a rough strength hint (e.g. "weak / strong") so players
  don't send 3 Pikemen into a big one. Their map size (points) is also only refreshed when raided.
- Send support troops to allied villages; scouts and scouting reports.
- Cancel a build/training job (refund rule to decide).
- Rankings (player points, tribe points).
- Inactive players' villages turn into abandoned villages after N days.
- More villages per player (settlers or conquest); market trading between players.

## Tech follow-ups
- Live updates (WebSocket) for incoming attacks instead of 10 s polling.
- Mobile polish: installable web app (PWA), haptics-free touch tuning, landscape layout.
- Deployment: Dockerfile, health checks, daily database backup; compile the server instead of
  running through `tsx` in production.
- Add a Content-Security-Policy header (other security headers are in place).
- Test map drag/pinch on a real phone (only simulated so far).
- Warfare: support owners get no report when their stationed Pathfinders die to enemy scouts;
  stationed troops stay when a relation breaks (by design for now — revisit after playtests).
- Tribes: notify applicants when accepted/declined (now they see it on next poll); look-alike
  letters in tribe names (homoglyphs) aren't blocked; cache the tribe ranking if tribes grow to
  thousands; load the Tribe tab on demand (with an error boundary) to keep the first load small.
