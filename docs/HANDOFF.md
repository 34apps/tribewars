# Handoff — Clanfire

Written 2026-11-08 (HEAD after step 9, badges + Hall of Fame). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run (2026-11-08, step 9)

Badges + Hall of Fame built and pushed (`8238175`): Champion, 2nd/3rd tribe, Top 10, Veteran (14 days in world/tribe, played in the
last 7 days). A world computes its badges once at its end; the operator's lobby command `world-finish <id> <world db>` copies them to
accounts, writes the Hall of Fame row and sets Finished. Shown in the lobby (badge row + Hall of Fame), on profiles and on the end
screen. Follow-up `945b3a7`: badges in tribe member lists, "This world" row on profiles, real end-to-end run (`design/proposals/badges/e2e/`). Screenshot tooling with faked API data: `design/proposals/badges/tooling/badges-shot.mjs` (needs vite on 127.0.0.1:5199).

## Very next step

Step 10 morale DONE 2026-11-08 (`4c95fc8`; owner first cut it, then asked for it). Next: plan step 11, **homepage + first-steps quests** (mockup
`design/proposals/homepage/`; explain to the owner in 3 plain lines and get a yes first). Then 12 safety pass, 13 desktop check of
every screen + staff route tests, 14 phone pass, 15 originality pass + own ideas (owner: at the end). Owner also wants to decide later on other small-player protection (longer beginner protection, or no attacks on very small players): NEXT_STEPS "Decisions".
Note: `GAME_DESIGN` 18.2-18.6 is still duplicated (~857-1410 and ~1410-1950); edit both copies or merge them first.

## How the owner works (important)

- Owner (Metin) is not a developer, writes Turkish/English, wants **short, plain answers** and
  copy-paste commands. One change at a time; pilot a style on 1–2 pieces before rolling it out.
- Wants to SEE things: send rendered images (headless Chrome screenshot of a page) rather than describing.
- Day-to-day dev also runs via `npm run agent -- "task"` (API credits); see `docs/AI-WORKFLOW.md`.

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian (names, numbers, art, layouts). Web first (360 px + 1280–1440 px).
- Toy Diorama style everywhere, hand-drawn SVG (no AI-painted art). 4 looks per building, 4th at max level.
- No scrollbars inside desktop side panels; server tests for every new endpoint; security gate per feature.
- Keep mechanics simple: troops only Attack or Support (no foraging/scavenging trips, no Scout choice). Explain new rules in 3 plain lines, no formulas; when his words are ambiguous ask one A/B question with pictures.

## Open

- Owner: building touch-ups; homepage later; AWS account + domain (`DEPLOYMENT_PLAN.md` §5); trademark check; balance decisions (NEXT_STEPS).
- Dev: label height for stage-4 sprites (`ROOF_TOP` uses stage 3); map-view village sprites unchanged; many screens never viewed in a browser (CHANGELOG "not viewed").

## Traps

- **Vite `import.meta.glob` does not pick up NEW sprite files in a running dev server**: restart `npm run dev:preview` / `npm run dev` after adding SVGs.
- Preview dev server takes the next free port (5173 → 5174 → 5175); each port is a separate browser save (new test account needed).
- Browser-pane screenshots fail while the app window is covered; check state with JS or render with headless Chrome.
- Subagents cannot run npm here; the main session runs `npm run check`, `npm run build`, `npm run build:preview`.
- Vite dev proxy needs `changeOrigin: false`. `node:sqlite`; `data/`, `*.sqlite` git-ignored. Preview must stay CSP-safe.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`. Never commit secrets.
