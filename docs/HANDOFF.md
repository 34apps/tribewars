# Handoff — Clanfire

Written 2026-11-09 (in-game redesign session). Read this first, then `docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`,
and `grep` `NEXT_STEPS.md` for your topic.

## Where the in-game UI stands (2026-11-09)

Owner said the village screen was "too messy". Built and pushed, each picked by the owner from picture boards:
- `d7f5506` / `88a935c` **"B · Game HUD"**: no top/tab bar; floating cream pills (village, resources, bell, avatar), floating
  bottom dock (7 tabs desktop, 5 + More phone), one attack card, alerts as a non-modal sheet (On the way / Earlier),
  full-bleed village art; village stays mounted (KeepAlive) so returning is instant. Boards: `design/proposals/ingame-clarity/`.
- `ca37103` **"A · Panel over the village"** for page tabs: village art behind one cream `.page-sheet`, `PageHeader`,
  `pages.css`, one-line Reports rows, Army with portraits. Boards: `design/proposals/page-tabs/`.
- `2d36d92` map opens clean (coordinates behind a magnifier, map key closed by default).
- `045929b` (LOCAL, NOT PUSHED): paper band behind the phone resource chips. Owner then said the chips and dock are
  "still awful" — don't push it as is.

## Very next step: owner rejected the direction

Owner, 2026-11-09: "the general ui ux is not good, scrollview on each tab etc is really bad. Tribal Wars has them in
separate pages with different ux that you can see at once in the browser. We need to aim for that. This design went bad."
Meaning (structure only — AGENTS.md: never copy their layouts, names, numbers, art or text):
- Each feature is its **own page** with its own layout, not one floating sheet style for everything.
- On a desktop browser (1280-1440 x ~800-900) a page shows **everything at once**: no long page scroll, no inner scroll;
  dense multi-column layouts, tables/lists that fit, clear fixed navigation and resource bar.
- Phone (360) still has to work, but desktop "see it all at once" is the aim.

Do: **pictures first** (2-3 original options, Parchment + toy style) for Village overview, one building page
(e.g. Barracks or Town Hall), Army/rally, Reports, at 1440x900 with Now next to them; then phone 360 for the pick.
Owner picks, then build with agents. Decide with the owner what happens to the floating HUD / full-bleed art.

## How the owner works (important)

- Owner (Metin) is not a developer, writes Turkish/English, short blunt feedback, wants **short plain answers**.
- **Pictures before any look change**; he picks from A/B/C boards (`design/proposals/*/board*.png` format,
  tooling in `design/proposals/ingame-clarity/tooling/`, `page-tabs/tooling/`).
- **He tests each screen himself before a push** (preview at http://localhost:5174 hot-reloads); push only after his OK.
- Explain any term in plain words (he was confused by "start closed").

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian. Web first (360 px + 1280-1440 px). Toy Diorama SVG art, Parchment UI colours.
- No scrollbars inside desktop side panels (now: no long scrolling pages either); server tests for every new endpoint;
  security gate per feature. Keep mechanics simple (troops only Attack or Support).

## Traps

- `tabs-shot.mjs`: the 1440 pass often shots before the seed lands (resources 1,907, 0 troops); the 360 pass is right.
- Preview dev server takes the next free port (5173 → 5174); each port is a separate browser save.
- Vite `import.meta.glob` misses NEW sprite files in a running dev server; restart it.
- Browser-pane screenshots fail while the app window is covered; use headless Chrome scripts.
- `GAME_DESIGN` 18.2-18.6 is duplicated (~857-1410 and ~1410-1950); edit both copies or merge first.
- Owner files left uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`. Never commit secrets.

## Open (older)

- Plan step 12 safety pass, 13 desktop check, 14 phone pass, 15 originality pass (NEXT_STEPS). Owner: AWS + domain, trademark, balance.
