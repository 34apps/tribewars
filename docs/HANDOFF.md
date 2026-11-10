# Handoff — Clanfire

Written 2026-11-10 (gold balance day). Read this first, then `docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and `grep`
`NEXT_STEPS.md` ("Gold after the cut", "In-game layout redo").

## State in one minute

- **Desktop in-game pages: done**, all LOCAL commits, NOT pushed (`e801164` … `b0dea9c`; older `045929b` phone chip band, not approved).
  Desktop fills the whole window (min 1440x900); phone vs desktop chosen by DEVICE (`hooks/useLayout.ts`). Phone layout unchanged (old HUD/dock).
- **2026-11-10, also local, not pushed:**
  - `9fcb00b` rename pencil in the desktop top bar for one-village players (server always allowed renaming any time).
  - `b0008ef` **Gold Mine makes 1/10 of a Lumber Camp** (`PRODUCTION_BASE.goldmine` 10 -> 3); sim raider now builds a Gold Mine.
  - `c8f2167` "Needs gold · build a Gold Mine" hint on build / train / research buttons (`apps/web/src/shortfall.ts`).
  - Checks in `BALANCE.md` §12 (30 d), §12.1 (90 d, 5 seeds, Knight player), §12.2 (20-player conquest, 90 d). Raw in `docs/sim/2026-11-10-*`.

## Work in flight / very next step

1. **Owner decision pending: late-game gold for conquest.** Owner idea (2026-11-10): "invest gold for Chieftains, save it there, bound
   to the account". Lead's suggestion given to the owner: a **War Chest** — gold deposited one-way from any village into an
   account-wide pool (raid-proof, kept if villages are lost); each Chieftain reserves chest gold like he reserves Renown today
   (same 1.6x growth per village, half back if he dies), replacing his flat 150 gold. Must be our own design (no Tribal Wars
   coin/academy names or numbers). NOT built. Next: sim lever in `scripts/sim/conquest.ts` + `balance.ts` comparing
   (A) flat 150 now, (B) per-Chieftain gold growing 1.6x paid by the village, (C) War Chest, 90+ days, 5 seeds; then owner picks.
   Engine/server/UI only after the pick (security gate `docs/SECURITY_ROADMAP.md` §4, server tests for the deposit endpoint).
2. Owner test in the preview (http://localhost:5174; PREVIEW → Fill with sample data): rename pencil, gold numbers, gold hint,
   plus round-2 of the desktop pages. Push to main only after his OK.
3. Phone (360) pass of the new pages: design agent (opus, one at a time) → owner picks → build.

## Decisions (don't re-ask)

- Gold = elite + conquest resource: research, Stables/Drillyard upgrades, Knights, siege, Banner Hall, Chieftains. 1/10 of wood.
- Mix pieces page by page; left village column on Village/building/Army only; Reports, Mail, Tribe full width.
- Scrolling only inside conversation panes. Buttons: one same-size family (Up / wait / queue full / Needs gold / Locked ...).

## How pages are made

- Design agent edits `design/proposals/ingame-pages/tooling/gen.mjs` → mockups → `shot.mjs` fit checks → boards; owner picks;
  implementer builds `views/<page>/Frame<Page>.tsx`; lead reviews PNGs and commits. Only one implementer touches `Game.tsx`.

## Traps

- Sim runs are fast (balance ~1 s, conquest 90 d x 5 seeds ~2.5 min). For old-vs-new runs copy `packages/engine/src` +
  `scripts/sim` to the scratchpad and run `node_modules/.bin/tsx` there — never flip `config.ts` while an agent runs checks.
- Sim builder keeps its Gold Mine at 8; a Knight-heavy test must raise it (BALANCE §12.1).
- Shot scripts seed via `?demo`; Vite misses new sprite files until restart; a failed CSS import gets cached (restart Vite).
- Owner pastes other projects' feedback by mistake (TCG card shop) — don't act on it here.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`.
