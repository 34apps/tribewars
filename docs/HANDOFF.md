# Handoff — Clanfire

Written 2026-11-08 (HEAD after step 11: homepage, first steps, Parchment look). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run (2026-11-08, step 11)

Built and pushed (`dde75dc`): signed-out lobby homepage (one screen, real max-level village as hero, public world strip
`GET /lobby/api/worlds/public`); First steps, 8 starter tasks with claimable rewards (`GAME_DESIGN` §20, card on the village screen);
whole web app switched to the owner's pick **"A · Parchment"** (light paper, cream panels, honey bars) with semantic colour tokens in
`styles.css` :root (`--page`, `--surface*`, `--on-surface*`, `--bar*`, `--edge*`). New CSS must use these tokens, never the raw `--c-ink`/literal colours.
Screenshot tooling: `design/proposals/app-colours/tooling/after-shot.mjs` (preview build, every screen), `design/proposals/homepage/tooling/home-shot.mjs`
(vite on 127.0.0.1:5199 + faked lobby API), `design/proposals/first-steps/tooling/shots.mjs`.

## Very next step

Plan step 12, **safety pass** (movements-in-flight cap, rank/respec rate bucket, audit log, IDOR test per route, data export/delete). Then
13 desktop check of every screen + staff route tests, 14 phone pass, 15 originality pass + own ideas (owner: at the end). Step 11 leftovers:
NEXT_STEPS "Step 11 follow-ups". Owner still to decide other small-player protection (NEXT_STEPS "Decisions").
Note: `GAME_DESIGN` 18.2-18.6 is still duplicated (~857-1410 and ~1410-1950); edit both copies or merge them first.

## How the owner works (important)

- Owner (Metin) is not a developer, writes Turkish/English, wants **short, plain answers** and
  copy-paste commands. One change at a time; pilot a style on 1–2 pieces before rolling it out.
- Wants to SEE things: send rendered images (headless Chrome screenshot of a page) rather than describing.
- Day-to-day dev also runs via `npm run agent -- "task"` (API credits); see `docs/AI-WORKFLOW.md`.

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian (names, numbers, art, layouts). Web first (360 px + 1280–1440 px).
- Toy Diorama style everywhere, hand-drawn SVG (no AI-painted art). 4 looks per building, 4th at max level. UI colours: Parchment (2026-11-08), not dark brown.
- No scrollbars inside desktop side panels; server tests for every new endpoint; security gate per feature.
- Keep mechanics simple: troops only Attack or Support (no foraging/scavenging trips, no Scout choice). Explain new rules in 3 plain lines, no formulas; when his words are ambiguous ask one A/B question with pictures.

## Open

- Owner: building touch-ups; AWS account + domain (`DEPLOYMENT_PLAN.md` §5); trademark check; balance decisions (NEXT_STEPS).
- Dev: label height for stage-4 sprites (`ROOF_TOP` uses stage 3); map-view village sprites unchanged; many screens never viewed in a browser (CHANGELOG "not viewed").

## Traps

- **Vite `import.meta.glob` does not pick up NEW sprite files in a running dev server**: restart `npm run dev:preview` / `npm run dev` after adding SVGs.
- Preview dev server takes the next free port (5173 → 5174 → 5175); each port is a separate browser save (new test account needed).
- Browser-pane screenshots fail while the app window is covered; check state with JS or render with headless Chrome.
- Subagents (implementer/runner) CAN run npm here now (2026-11-08); still verify their results.
- Vite dev proxy needs `changeOrigin: false`. `node:sqlite`; `data/`, `*.sqlite` git-ignored. Preview must stay CSP-safe.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`. Never commit secrets.
