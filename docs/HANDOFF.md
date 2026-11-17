# Handoff — Clanfire

Written 2026-11-10 (gold balance day). Read this first, then `docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and `grep`
`NEXT_STEPS.md` ("Gold after the cut", "In-game layout redo").

## Scaling branch (2026-11-17) — waiting for the owner

- Branch `claude/quirky-gates-ee4317` (worktree `.claude/worktrees/quirky-gates-ee4317`), 5 commits on top of `e14cfbc`, LOCAL, not merged, not pushed:
  arrivals in budgeted slices, 200 marches per player, site upkeep on change, map without per-row JSON (schema v21), rankings cache + indexes (v22),
  refunds from the price paid (v20). Numbers and player-visible effects: CHANGELOG 2026-11-17; follow-ups: NEXT_STEPS "Scaling pass follow-ups".
- Next step: owner tries it in the preview, then merge into `main` (rebuild the preview after the merge). Bench scripts used: the audit's
  `audit-engine` scratch folder (big world `big.sqlite`), adapted copies were in this session's scratchpad (not kept in the repo).
- Trap: `makeApp` in the server tests turns the rankings cache off (`rankingsCacheMs: 0`); a test that wants it passes its own value.

## State in one minute

- **Desktop in-game pages: done**, all LOCAL commits, NOT pushed (`e801164` … `b0dea9c`; older `045929b` phone chip band, not approved).
  Desktop fills the whole window (min 1440x900); phone vs desktop chosen by DEVICE (`hooks/useLayout.ts`). Phone layout unchanged (old HUD/dock).
- **2026-11-10, also local, not pushed:**
  - `9fcb00b` rename pencil in the desktop top bar for one-village players (server always allowed renaming any time).
  - `b0008ef` **Gold Mine makes 1/10 of a Lumber Camp** (`PRODUCTION_BASE.goldmine` 10 -> 3); sim raider now builds a Gold Mine.
  - `c8f2167` "Needs gold · build a Gold Mine" hint on build / train / research buttons (`apps/web/src/shortfall.ts`).
  - Checks in `BALANCE.md` §12 (30 d), §12.1 (90 d, 5 seeds, Knight player), §12.2 (20-player conquest, 90 d). Raw in `docs/sim/2026-11-10-*`.
  - `8be3bbc` **War Chest** (Chieftains reserve account gold, deposit endpoint, Banner Hall card).
  - `dd0a92c` sim levers for Chieftain gold (A flat / B growing / C War Chest) + `BALANCE.md` §12.3 (120 d, 5 seeds). Sim only.

## Work in flight / very next step

00. **2026-11-11 play-test fixes `5cc8cdc` (LOCAL, not pushed):** village CPU fix (scene split in two SVG layers), next-upgrade guide, centred scene, storehouse box, reward toast icons, preview bot cap. Owner tests in the preview; push after his OK. Follow-ups in NEXT_STEPS (Play-test fixes 2026-11-11).
0. **Play-from-zero preview** (`7dd2a6f`, PUSHED 2026-11-10): new preview worlds run at real pace; "Speed" chip (left edge) = 1x-1000x + skip 1 hour/day;
   Ember Wardens' 5 computer players invite the new player and grow by the real rules. Owner tests: PREVIEW → Reset world → new account →
   accept the invite. Follow-ups in NEXT_STEPS ("play from zero").
1. **War Chest built and PUSHED 2026-11-10** (owner tested in the preview; all 50 local commits up to `43426c8` pushed to main, incl. the
   desktop pages and the unapproved phone chip band `045929b`). Banner Hall simplified to Feast + Chieftain checklist cards; building
   switcher is one "Other buildings" list; toasts at the window edge. Not deployed to AWS. Follow-ups in NEXT_STEPS ("War Chest built").
2. Owner test in the preview (http://localhost:5174; PREVIEW → Fill with sample data): rename pencil, gold numbers, gold hint,
   plus round-2 of the desktop pages. Push to main only after his OK.
3. Phone (360) pass of the new pages: design agent (opus, one at a time) → owner picks → build.

## Decisions (don't re-ask)

- Preview Reset world (2026-11-11): computer players start from zero together with the new player (owner's choice; no head start).
- War Chest (2026-11-10): Chieftain gold comes from an account chest, base 2,000 x1.6/village; deposits one way, by the player.
- Gold = elite + conquest resource: research, Stables/Drillyard upgrades, Knights, siege, Banner Hall, Chieftains. 1/10 of wood.
- Mix pieces page by page; left village column on Village/building/Army only; Reports, Mail, Tribe full width.
- Scrolling only inside conversation panes. Buttons: one same-size family (Up / wait / queue full / Needs gold / Locked ...).

## How pages are made

- Design agent edits `design/proposals/ingame-pages/tooling/gen.mjs` → mockups → `shot.mjs` fit checks → boards; owner picks;
  implementer builds `views/<page>/Frame<Page>.tsx`; lead reviews PNGs and commits. Only one implementer touches `Game.tsx`.

## Traps

- Each preview player's world mirrors to `apps/preview/data/preview-world-<username>.sqlite` (owner: `preview-world-metinaltinbas.sqlite`; `?demo` accounts skipped) on every save while `npm run dev:preview` runs (worker mode, `8f8a523`). The preview game runs in a Web Worker; `?inpage` = old in-page mode (needed for design tooling that reads `clanfirePreview.ctx`).
- Owner's preview tab gets laggy after a day of live edits (2026-11-11: fixed by a full reload, Cmd+R). Hot reload likely leaves old preview timers/bot loops running; after changing `apps/preview` ask him to reload before judging speed.
- Preview: `apps/preview/src/clock.ts` replaces `Date` page-wide (game time); use `realTime()` for anything that must follow the wall clock.
  Old saved preview worlds keep speed 25 (chip then shows 25x/250x/2500x); "Reset world" gives a real-pace world.
- Sim runs are fast (balance ~1 s, conquest 90 d x 5 seeds ~2.5 min). For old-vs-new runs copy `packages/engine/src` +
  `scripts/sim` to the scratchpad and run `node_modules/.bin/tsx` there — never flip `config.ts` while an agent runs checks.
- Sim builder keeps its Gold Mine at 8; a Knight-heavy test uses `--knight-builders` (Gold Mine 12/15, 65% Knights).
- Sim "binding limit per Chieftain" counter almost always says `resources` (saving wood/food/iron comes last); read the wait hours instead.
- Shot scripts seed via `?demo`; Vite misses new sprite files until restart; a failed CSS import gets cached (restart Vite).
- Owner pastes other projects' feedback by mistake (TCG card shop) — don't act on it here.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`.
