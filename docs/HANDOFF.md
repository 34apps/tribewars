# Handoff — Clanfire

Written 2026-11-09, updated after the desktop pass (in-game pages redesign). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` ("In-game layout redo").

## State in one minute

Owner rejected the floating Game HUD ("scrollview on each tab is really bad … separate pages … see at once").
New direction, built page by page from picture boards in `design/proposals/ingame-pages/` (`mix-*` = owner's picks):
- **Desktop = one fixed 1440x900 frame**, centred; smaller window → browser scrollbars, never reflow (owner rule).
  Phone vs desktop chosen by DEVICE (`hooks/useLayout.ts`, root `layout-desktop|layout-phone`- Top bar + folder tabs (`components/FrameShell.tsx`, `frame.css`). **Desktop pass complete**, all LOCAL commits, NOT pushed:
  Village (`e801164`), building pages + `BuildState` buttons (`2006728`), Army (`da78726`, `154244d`), Reports (`7864e30`),
  Mail conversations (API `7778277`, screen `89fc824`, `9958155`), Tribe all 9 sub-tabs (`c404c1e`, `bd5ae29`),
  Ranks B + Top three A (`bf7042e`, `77cb68f`), Map A (`e8401ef`), round-1 fixes + simulator, unit card, toasts,
  Mail picker, no-tribe, Domination (`f802505`…`45063fd`). Older unpushed `045929b`
  (phone chip band, not approved).
- Phone layout is unchanged everywhere (old HUD/dock) — its redesign comes next.

## Very next steps

1. Owner test round 2 in the preview (http://localhost:5174; PREVIEW → Fill with sample data). Round 1 fixes and his picks
   (simulator A, unit card A+B, toasts A, Mail picker A, no-tribe A, Domination B) are built: `f802505`…`45063fd`.
   Fix what he reports; push to main only after his OK.
2. Phone (360) pass: draw each new page at 360 (design agent, opus, one at a time) → owner picks → build.
3. Small leftovers: NEXT_STEPS "In-game layout redo" → "Small (desktop pages)".
4. Later (NEXT_STEPS): scout rule "total troops outside" at top Keen; report sharing; Boulder Sling stored-target check;
   backdrop choice (toy landscape vs plain paper — plain built); Contacts list in Mail only if the owner asks (option B, NEW).

## How pages are made (repeat this)

- Design agent (opus, one at a time) edits `design/proposals/ingame-pages/tooling/gen.mjs` (Ranks/Map in `ranks-map.mjs`)
  → `mockups/*.html` → `shot.mjs` (fit checks: no page/inner scroll, text ≥13 px, controls ≥36 px) → PNG; boards via `board.mjs`.
- Owner picks pieces ("mix"), then an implementer builds `views/<page>/Frame<Page>.tsx` + `frame-<page>.css`,
  reusing today's data/actions; screenshots via `tooling/*-shot.mjs` into `after/`; lead reviews PNGs and commits.
- Parallel implementers: split by files; only one may touch `Game.tsx`; none touch `FrameShell.tsx`/`frame.css` at once.

eview PNGs and commit.

## Owner decisions this session (don't re-ask)

- Mix pieces page by page; A's tabs + C's parts. Left village column on Village/building/Army only; Reports,
  Mail, Tribe are full width. Recruiting lives on Barracks/Stables; Army = troops + trips + support.
- Scrolling allowed only inside conversation panes (Mail thread, Tribe chat, Forum thread).
- Buttons: one same-size family for Up / wait / queue full / building / next / Max / Locked.

## Traps

- Several worlds of seed data: shot scripts seed via `?demo`; wait for real numbers (1,907 = not seeded yet).
- Vite misses new sprite files until restart. Headless Chrome for screenshots (pane screenshots fail when covered).
- Owner pastes other projects' feedback by mistake (TCG card shop game) — forward to that session, don't act here.
- A failed CSS import gets cached by Vite (500s on :5174) — restart Vite.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`.
