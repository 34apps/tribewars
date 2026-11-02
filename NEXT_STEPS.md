# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Game name.** "TribeWars" is very close to an existing game ("Tribal Wars"). Pick a distinct
  name before any public launch (trademark risk). Same applies to a domain.
- **Hosting.** Where the game server runs (one small always-on server is enough at first; the
  database is a single SQLite file that needs backups).
- **World pace.** Default world speed 1 (slow, days-long game) vs a faster world (e.g. 3×).

## Phase 2 — tribes (next big piece)
- Found/join/leave a tribe (name + tag), roles (leader, officer, member), invites, tribe page.
- Diplomacy between tribes: ally, non-aggression pact, enemy; map colours for allies/enemies;
  no attacks on own tribe members.
- Tribe chat / message board.

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
