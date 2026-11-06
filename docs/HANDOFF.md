# Handoff — Clanfire

Written 2026-11-06 (HEAD `9a47a21`). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run (2026-11-06, village layout session)

- **Bigger village ring** (`1671bad`): plate 234 -> 273, the ORIGINAL arrangement kept (owner rejected resource sites outside the wall and a 4-gate plan: "too small, too empty"), no two drawings touch at any look (painted-shape masks: `node scripts/measure-sprites.mjs` -> `apps/web/test/sprite-boxes.json`; re-run after ANY building SVG change or the layout test fails). Earth ramp at the main gate. Wall code now in `apps/web/src/art/wall.tsx` (`GATES` can add gates on any wall).
- **Selection**: ink + gold outline (SVG filter `#vv-sel`; CSS drop-shadow does not show in Safari) + glowing ring on the lot; marker arrow removed.
- **Build animations**: pressing Upgrade raises the scaffold; toy builders (`apps/web/src/art/workers.tsx`, unit-figure style, owner: "much better") hammer while the job runs; finish = look-change moment or scaffold fade. Remembered per village (plays on return, never on page load).
- **Test tools**: preview PREVIEW menu → "Try look animations" opens the design-preview bar for anyone (All buildings / one building, Look 1–4, Replay, "Building work" switch). Headless scene renders: `node design/proposals/village-layout/render.mjs <prefix> 2 4` (env `SEL=<id>`, `WORK=1`), serve the repo root over http.
- Checks: all green (web 127+ incl. 13 layout tests); build + build:preview pass.

## Very next step

Owner looks at the builders/animations in Safari and on a phone (not viewed there). Open items in NEXT_STEPS top entry: design-preview landscapes Current/A/B/C not refitted to plate 273; stage-4 `ROOF_TOP`. Then homepage or the earlier open items (balance, World rules page).

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
