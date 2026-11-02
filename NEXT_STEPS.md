# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Game name.** Owner agreed to rename ("TribeWars" is too close to "Tribal Wars"). Suggested:
  Clanfire (no game found by that name, 2026-11-02 search), Banner Age; avoid Hearthfall and
  Stoneholds (existing games). Needs a trademark + domain check before launch.
- **Hosting.** Where the game server runs (one small always-on server is enough at first; the
  database is a single SQLite file that needs backups).
- **World pace.** Default world speed 1 (slow, days-long game) vs a faster world (e.g. 3×).

## Phase 3 — tribe warfare (next big piece)
- Support troops to tribe-mates and allies (reinforcements that defend), recall/send back.
- Shared incoming-attack alerts for the whole tribe; scouts and scout reports.
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
- Tribes: notify applicants when accepted/declined (now they see it on next poll); look-alike
  letters in tribe names (homoglyphs) aren't blocked; cache the tribe ranking if tribes grow to
  thousands; load the Tribe tab on demand (with an error boundary) to keep the first load small.
