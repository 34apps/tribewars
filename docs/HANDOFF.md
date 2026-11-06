# Handoff — Clanfire

Written 2026-11-06 (HEAD `9a47a21`). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run (2026-11-06)

- **Village campfire** (`5e36b82`): animated fire + smoke puffs in front of the Town Hall (`scenery.tsx` `fireItem`), cold ash when the hearth is out (not viewed).
- **4 looks per building** (`38b6ad6`): `Stage` 0..4 in `apps/web/src/art/buildings.ts`; look 4 = max level only; missing `-4.svg` falls back to `-3`; wall grand look at level 20 only (`WALL_GRAND_FROM` removed).
- **All 13 buildings redrawn** (`4e0d484`) as escalating sets (owner approved the style on Town Hall + Iron Mine first). Banner Hall has real art now. Compare page: `design/proposals/building-stages/compare.html` (serve the repo root over http, e.g. `python3 -m http.server`, file:// breaks relative paths); image `building-looks-compare.png` (headless Chrome render).
- **Preview tool**: PREVIEW pill → "Show all buildings" Stage 1–4 (`apps/preview/src/showcase*.ts`), preview-only. Preview has its first test (`apps/preview/test`).
- **Design proposals (not in the app)**: homepage mockup `design/proposals/homepage/index.html` — owner: "homepage later".
- Checks: engine 501, lobby 87, preview 1, server 508, web 119 green; build + build:preview pass.

## Very next step

Owner looks at the new buildings (preview → Stage 1–4) and lists touch-ups (NEXT_STEPS top item). Then either
homepage (build from the mockup) or the earlier open items (balance, World rules page check).

## How the owner works (important)

- Owner (Metin) is not a developer, writes Turkish/English, wants **short, plain answers** and
  copy-paste commands. One change at a time; pilot a style on 1–2 pieces before rolling it out.
- Wants to SEE things: send rendered images (headless Chrome screenshot of a page) rather than describing.
- Day-to-day dev also runs via `npm run agent -- "task"` (API credits); see `docs/AI-WORKFLOW.md`.

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian (names, numbers, art, layouts). Web first (360 px + 1280–1440 px).
- Toy Diorama style everywhere, hand-drawn SVG (no AI-painted art). 4 looks per building, 4th at max level.
- No scrollbars inside desktop side panels; server tests for every new endpoint; security gate per feature.

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
