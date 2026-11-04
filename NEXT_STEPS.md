# Next steps

Current open work and decisions only (history goes in `CHANGELOG.md`). Newest priorities first.

## Decisions for the owner
- **Name: Clanfire** (owner, 2026-11-02). Before launch: trademark + domain check. The GitHub repo
  is still called `tribewars`; the owner can rename it in GitHub → Settings → General (old links redirect).
- **Hosting: AWS** (owner, 2026-11-04). Plan in `docs/DEPLOYMENT_PLAN.md`. Open owner decisions there (§5):
  keep SQLite on one machine for launch (recommended) vs Postgres/RDS; token login for the mobile app;
  one EC2 + CloudFront + S3 (recommended) vs a managed container service.
- **World pace.** Done 2026-11-02: slower original pace, default speed 1; revisit after playtests.
- **Troop ranks + Armory (asked 2026-11-03).** Proposal in `docs/GAME_DESIGN.md` §15 (Training
  Point budget per village, rank tiers). Engine/server/web Drillyard is built; the owner's answers
  to the open questions there decide the rest. Also decide: merged support keeps per-arrival ranks
  or the newest stamp.

- **Balance + conquest (asked 2026-11-03).** Read `docs/BALANCE.md`: approve or edit the proposal (troop upkeep ×0.25, Banner Hall, Standard-bearer, Loyalty, weighted points), then an implementer applies it step by step (upkeep first).

- **Landscape choice** (`a39bbca`; all four rendered 2026-11-04, Current hills/crags and C mountains fixed): owner opens Design preview → Landscape dropdown, looks at Current / A river valley / B farmland / C forest and hills at 360 and 1440 px and wall levels 1, 10, 20 (tiers grow at ≈20/45/80 % village size), then picks one (becomes the default for everyone; the other files and `landscapeKit.tsx` get deleted) or asks for tweaks. A and B look clean in renders; still check placement (bridge over the river, farmstead spot, anything crossing the walls or the road). Save PNGs in `design/proposals/landscape/`.
- **Design preview picker check** (`b52b6ba`, never rendered): owner picks each building at 360 and 1440 px, steps with slider/−/+/Play; confirm the phone strip under the village doesn't squeeze the scene too much (it is ~3 rows tall) and the desktop bar (bottom right, 420 px, taller now) doesn't hide what you want to see. "All buildings" still shows only the wall (kept as before); say if it should show every building at the level.
- **Village size/headroom check** (`90512c6`, never rendered): owner opens Design preview, compares wall 1, 5, 10, 15, 20 at 360 and 1440 px and screenshots 20: same village size each time, tower tops and flags fully visible, nothing behind the title block top-left. If desktop height-limited layouts (short windows) look too small, trim the 64 px `.vv-fit` top margin.

## Next big pieces
- **Grand wall (levels 18–20) review** (`ea92c87`, never rendered): in Design preview drag to 18, 19, 20 at 360 and 1440 px; check buttress/cap overlap with merlons, gate crest vs banners vs arch, tower banner on the footing, top corner tower and flag inside the viewbox (`sceneViewBox` 376), and that the road now ends cleanly behind the gate doors at levels 1–20. Top tower: draw-order fix `a4eb098` (never rendered) — confirm the back walls now meet its base cleanly at 13–20; if not, try a taller back footing.
- **Wall towers review** (`6056bbb`, `4488363` raised the L3 corner footing to 42 over the back walls; never rendered): check no gap at the four plate corners or where walls meet towers (levels 1–3), stage 3 footing/round tower/gallery proportions, stage 2 turret, tallest towers fit in the viewbox (`SCENE_VIEWBOX`), and that the bigger corner towers don't crowd the corner buildings.
- **Ring wall redesign review** (`b4f74cf`, never rendered): view the village at wall levels 1, 2, 3 at 360 and 1440 px; check the palisade back row, watchtower braces, stone courses/slits, tile-cap band, round towers, gate vs the low front walls, that the near walls are low enough to see inside (tune `hFront`/`hBack` in `wallItems`), and no stray gap between wall pieces or at the plate edge.
- **Wall spacing review** (`da2867c`, never rendered): buildings were moved inward off the ring wall; open the village at 360 and 1440 px and check no two buildings/fields/paths touch now that the ring is tighter (market vs farm, mine path vs greens field, drillyard vs lumber), and whether the tree/rock zones near the wall still look cluttered; if more room is wanted, enlarge the plate instead of moving plots further.
- **Isometric redraw review** (`b3a01ba`, never rendered): barracks, stables, hidden vault, gold/iron mine (3 levels each) were redrawn on the town hall angle; open the village / design preview and check these 15 sprites for broken shapes, plinth overhangs (gold-bars stack in gold-mine-3, cart near the plinth edge), roof/gable overlaps on the stables and tower overlaps on the barracks; then redraw the remaining front-view sprites the same way if any look flat.
- **New building sprites review** (`6be9b60`, never rendered): open the village (Settings → Design preview shows all levels) at 360 and 1440 px; fix any broken/overlapping sprite (check XML validity, e.g. `xmllint`), tile-edge overlaps, skewed wheels/blades; wall sprites still old; `design/sprites/buildings` copy not synced.
- **Village square follow-ups** (built `282cfe1`): open the village at 360 and 1440 px and check the campfire, paving and the north-west Drillyard plot (overlap with Storehouse/Lumber Camp, labels, click areas); delete unused `apps/web/src/art/scene/market.svg`; consider animated flames and a more detailed Drillyard sprite (dummies, rack; needs owner approval of designs).
- **Expanding world follow-ups** (built 2026-11-03; abandoned villages now start at player level, random growth order): add a server test that a new signup's neighbours have player start levels and a `growthSeed`; start a fresh dev DB to see it; run `npm run dev`, register a few accounts, view the map at 360/1440 px (terrain now has fewer mountains/lakes/forest, so old maps look different); tune `EXPAND_*`/`NPC_RING_*` in `config.ts`; maybe a "move to the new world" note for the old DB (`DATABASE_PATH=./data/clanfire.sqlite npm run dev` plays the old one); layout is not in the preview app (it stays 'scattered').
- **Staff tooling UI follow-ups** (UI built `5b39ac6`): look at Support/Staff screens at 360 and 1280–1440 px; global unread-ticket badge; staff list endpoint to assign tickets to others; admin template editor UI; tick SECURITY_ROADMAP items; document roles in GAME_DESIGN/docs.
- **Village desktop scroll** (built 2026-11-03): open the village at 1280/1440 px (page scrolls, board stretches, scene still fits) and at 360 px (phone sheet unchanged).
- **Test-mode follow-ups** (built 2026-11-03): look at the "On the road" summary (360/1440 px) and the desktop side-panel Close; if the phone sheet still can't be dismissed after opening the Town Hall, find where (not reproduced in code). Possible: warp build/training queues too. Cancel (80% back, built 2026-11-03): look at the Cancel buttons and dialog at 360/1440 px; maybe let any build job be cancelled (now newest only); cancelling research is not covered. If conquest is ever built, the village must keep its queues.
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
- **Drillyard (built end to end)** — still to do: look at the panel and the 3 Drillyard sprites in a browser at 360 and 1440 px, and check the new village layout (2026-11-04: smaller buildings, more space, lumber grove/stumps/logs, mine boulders; tune `PLACEMENT` in `apps/web/src/art/buildings.ts` and `PROPS` in `apps/web/src/art/scenery.tsx`; richer lumber/mine sprites with saw, cart, ore are a follow-up); show ranks in battle reports; research/rank not audit-logged; tune research/rank costs. Later: new units unlocked per building level (ranged Barracks unit, heavy Stables unit, with art).
- Map panel for abandoned villages: show a rough strength hint (e.g. "weak / strong") so players
  don't send 3 Pikemen into a big one. Their map size (points) is also only refreshed when raided.
- Test mode follow-ups: warp for build/training queues; look at the new "Way out / Way home" inputs in the send form at 360/1440 px. Owner to confirm: abandoned villages never recruit for ALL players now (raided ones stay empty for good), not only in test mode.
- Market follow-ups: draw real Market sprites (placeholder = Storehouse; swap `FILE.market` in `apps/web/src/art/buildings.ts`, check scene spot); NPC villages have no Market; set `SANDBOX_USERS` on the live server if the owner's username differs.
- Shipments follow-ups: tune capacity/speed after playtests. Cancel follow-ups: show Cancel also on the map/tile panel; optional "cancelled" note in reports; tune the 2-minute window.
- Cancel follow-ups: server route tests for cancel-build/train/research; look at the Cancel buttons in a browser; optionally let any build job (not only the newest) be cancelled; look at the research queue (2 free / 4 premium) in the Drillyard panel at 360/1440 px; research queue limits tuning.
- Rankings follow-ups: weekly/daily gains, filters (own tribe), paging beyond 100.
- More villages per player (settlers or conquest); market trading between players.

## Tech follow-ups
- Ask Mags AI advisor is off (owner: credit spend). If revived: decide a budget first; server code is ready behind `ADVISOR_ENABLED`; add stationed support troops to her snapshot.
- Mobile polish: installable web app (PWA), haptics-free touch tuning, landscape layout.
- Deployment (AWS) and mobile-app readiness: ranked open items in `docs/DEPLOYMENT_PLAN.md` §3–4
  (compiled server, Dockerfile, S3 backups, CI + deploy, graceful shutdown, migrations; then token
  login, `/api/v1` + min-client-version, publish the engine package).
- Security: work through `docs/SECURITY_ROADMAP.md` Phase 1 (CSP, session expiry, password policy, CI audit; global rate limits are done) before any public server.
- WebSocket push (design in the roadmap, also replaces 10 s polling above) and a tick-lag metric for troop arrivals.
- Map: if pan is still slow on a phone (`window.__mapFrames` in dev), blit-shift the previous frame while panning.
- Test map drag/pinch and pan frame times on a real phone (only simulated so far).
- Warfare: support owners get no report when their stationed Pathfinders die to enemy scouts;
  stationed troops stay when a relation breaks (by design for now — revisit after playtests).
- Tribes: notify applicants when accepted/declined (now they see it on next poll); look-alike
  letters in tribe names (homoglyphs) aren't blocked; cache the tribe ranking if tribes grow to
  thousands; load the Tribe tab on demand (with an error boundary) to keep the first load small.
- **Village layout follow-ups** (`443a2e3`): Farm and Market partly hidden behind the front walls/towers; a new village looks sparse on the big plate (roads lead to empty grass until buildings exist); old unused animation CSS (`.vv-puff`, workers, carts) in `village.css`; at 1440 px the board width limits scene size (buildings ~10–15% smaller on screen than before, but spaced); design-preview bar covers the top of the scene on desktop and the bottom on phone; main JS chunk 564 kB (>500 kB warning) — consider code-splitting the scenery.
- **Toy village follow-ups** (`87d3695`): owner will ask for design tweaks inside the toy style; toy sprites have no ground pad (sit on grass); Town Hall drawn at 1.15 to avoid overlapping the Gold Mine/Vault; check the design preview at all levels.
