# Handoff — Clanfire

Written 2026-11-18, end of a very long play-test session. Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## State in one minute

- `main` = `origin/main` = `f40af04`, **pushed** 2026-11-18. Game schema **v35**.
- The owner plays the BUILT preview at http://localhost:5174 (`npm run serve:preview`, detached; log in the old session's
  scratchpad). After every merge into main: back up his world, run `npm run build:preview:local`, ask him to reload.
- Workflow that worked: integration worktree `../tribewars-tiers` (branch `originality-tiers`). Each change goes on its own branch
  in its own worktree from main. Merge into tiers, run `npm run check` + `npm run build`, fast-forward main, build the preview.
- Owner's world mirror is `apps/preview/data/preview-world-metinaltinbas.sqlite`, read with `sqlite3 -readonly`. Backups before
  each update are in `apps/preview/data/backups/`.

## Landed 2026-11-18 (all in main, pushed)

- **Chieftain:** deposit 25% + rest claimed at send (v31); 12,000 points per Chieftain; slowest unit (speed 2.5).
- **Drillyard ranks rework** (v32). Fighter points count people defeated (v33). Takes target 110–150.
- **Abandoned villages** grow by seeded personality (farmstead / stronghold / market / mixed). Army buildings are rare (weights
  x0.3). Every personality can build a Wall.
- **Takeover:** occupiers stay as SUPPORT from the sending village, recallable in part (v34; retry pass v35 for worlds where v34
  skipped). The owner's village 81 army is now support from village 86. A taken village KEEPS its name.
- **War Chest:** pay-in always available ("Fill to next village", "All gold here"); the bar shows the whole village price.
- **Pencil "Rename village"** button next to the name in the header.
- **Map:**
  - cloth banners on poles with the tribe tag, no symbols; the protection shield sits on the base;
  - label priority own > site > others; fit-to-world minimum zoom; dot view;
  - map chunks refresh after an owner change.
- **Overview side column:**
  - free view: isometric 100x100 region around the view, round tokens;
  - premium Expand (bit 2 of `players.premium`, `npm run admin -- extra <name> overview on`) adds 200 / World and Large view, drawn
    as a **territory map** (design A, owner pick): cells tinted by majority relation, borders, hatch for abandoned villages,
    gold pins for own villages;
  - `GET /api/map/overview` is premium-only; drag to move, edge notches, no arrow-button row.

## Decisions (don't re-ask)

- **Real worlds are at least 500x500.** Test map screens on the 601x601 synthetic world (generator `gen.ts` from the session
  scratchpad; rebuild if gone).
- Original game: same genre as Tribal Wars, never its look, text, numbers or layouts ("don't make the same design").
- Chieftains: several in one attack OR a chain within 2 h (owner kept both).
- Targets:
  - raider/builder 1.5–2x at 30 days;
  - 2nd village day 21–28;
  - conquest worst ratio ≤ 2;
  - takes 110–150 on 5 seeds (noisy: judge on 12 seeds; recent 12-seed totals 230–255);
  - restarts ≤ 26 on 5 seeds.
- Ask decisions HERE as numbered choice questions, per item before → after. Push only on his OK.

## Open items / next steps

1. **Owner feedback pending** on the territory overview, which so far has only been seen in screenshots. In a synthetic world
   with evenly spread abandoned villages, the whole-world hatch reads as texture; own pins overlap; switching to 200/World widens
   the panel.
2. The owner can't try Premium overview in his preview: offer to enable bit 2 for him (in-browser world, needs an in-app path).
3. Unexplained: why v34 skipped the conversion in his browser (v35 fixed it). If a future data step skips silently, suspect a
   second preview tab during reload; add skip-reason logging.
4. Takes are below target on 5 seeds; a lever if the owner wants more: richer late abandoned villages.
5. Not checked on screen: 1280 px with tile panel + overview (three columns); phone tile sheet inside the scrolling map region;
   the one-village header with the pencil.
6. Old follow-ups are still in NEXT_STEPS: phone pass, Siege icons, bot Wrightyard/Firecarts, Safari never measured.

## Traps

- **Never work in the main checkout for multi-step changes**; hot changes leak into his preview after a rebuild. Never `git stash`.
- **No visible browsers, not even the in-app pane.** Headless Playwright WebKit (installed) on your own port; scripts were in the
  old scratchpad (`br/`, `webkit/`, `terr/shots.mjs`).
- Flaky tests (rerun alone): `warfare-alerts` (scouts-and-support), `mail conversations paging`, `map-points`.
- The Mac gets slow: other sessions run heavy jobs (Whisper ad videos). Ask before stopping another project's processes.
- Uncommitted on purpose: `.claude/launch.json`, `Pasted ... textClipping`, `design/proposals/originality-art/buildings-now-vs-planned.png`.
- Leftover worktrees you can delete when done: `tribewars-{rider,ranks,staff,shrine,chief,npc,mirror,perf,perf-old,takeover,map,ovw,name,region,terr}`.
