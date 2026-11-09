# Handoff — Clanfire

Written 2026-11-09 (in-game pages redesign session). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` ("In-game layout redo").

## State in one minute

Owner rejected the floating Game HUD ("scrollview on each tab is really bad … separate pages … see at once").
New direction, built page by page from picture boards in `design/proposals/ingame-pages/` (`mix-*` = owner's picks):
- **Desktop = one fixed 1440x900 frame**, centred; smaller window → browser scrollbars, never reflow (owner rule).
  Phone vs desktop chosen by DEVICE (`hooks/useLayout.ts`, root `layout-desktop|layout-phone`, `?layout=` override).
- Top bar + folder tabs (`components/FrameShell.tsx`, `frame.css`). Pages built, all LOCAL commits, NOT pushed:
  Village (`e801164`), building pages + one `BuildState` button family (`2006728`), Army (`da78726`, `154244d`),
  Reports (`7864e30`), Mail as conversations (API `7778277`, screen `89fc824`, `9958155`), Tribe Overview +
  Members (`c404c1e`). Also older unpushed `045929b` (phone chip band, not approved).
- Phone layout is unchanged everywhere (old HUD/dock) — its redesign comes after desktop.

## Very next steps

1. Owner to OK the 7 other Tribe sub-tab pictures (`board-tribe-tabs.png`) → build them (implementer, sonnet).
2. Ranks and Map: pictures first (design agent: A's top bar + tabs, full width, no left column) → owner → build.
3. Phone (360) pass: draw each new page at 360 → owner → build.
4. Owner tests everything in the preview (http://localhost:5174), then push to main only after his OK.
5. Later (written in NEXT_STEPS): scout rule "total troops outside" at top Keen; report sharing; Boulder Sling
   stored-target check; backdrop choice (toy landscape vs plain paper — plain built).

## How pages are made (repeat this)

- Design agent (opus, one at a time) edits `design/proposals/ingame-pages/tooling/gen.mjs` → `mockups/*.html` →
  `shot.mjs` (fit checks: no page/inner scroll, text ≥13 px, controls ≥36 px) → PNG; boards via `board.mjs`.
- Owner picks pieces ("mix"), then an implementer builds `views/<page>/Frame<Page>.tsx` + `frame-<page>.css`,
  reusing today's data/actions; screenshots via `tooling/*-shot.mjs` into `after/`; I review PNGs and commit.

## Owner decisions this session (don't re-ask)

- Mix pieces page by page; A's tabs + C's parts. Left village column on Village/building/Army only; Reports,
  Mail, Tribe are full width. Recruiting lives on Barracks/Stables; Army = troops + trips + support.
- Scrolling allowed only inside conversation panes (Mail thread, Tribe chat, Forum thread).
- Buttons: one same-size family for Up / wait / queue full / building / next / Max / Locked.

## Traps

- Several worlds of seed data: shot scripts seed via `?demo`; wait for real numbers (1,907 = not seeded yet).
- Vite misses new sprite files until restart. Headless Chrome for screenshots (pane screenshots fail when covered).
- Owner pastes other projects' feedback by mistake (TCG card shop game) — forward to that session, don't act here.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`.
