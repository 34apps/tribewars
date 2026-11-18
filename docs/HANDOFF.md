# Handoff — Clanfire

Written 2026-11-17 (originality pass + health check). Read this first, then `docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and
`grep` `NEXT_STEPS.md` for your topic. Decisions and specs of the pass: `docs/ORIGINALITY_PROPOSAL.md`; numbers: `docs/BALANCE.md` §13.

## Scaling branch (2026-11-17) — waiting for the owner

- Branch `claude/quirky-gates-ee4317` (worktree `.claude/worktrees/quirky-gates-ee4317`), 5 commits on top of `e14cfbc`, LOCAL, not merged, not pushed:
  arrivals in budgeted slices, 200 marches per player, site upkeep on change, map without per-row JSON (schema v21), rankings cache + indexes (v22),
  refunds from the price paid (v20). Numbers and player-visible effects: CHANGELOG 2026-11-17; follow-ups: NEXT_STEPS "Scaling pass follow-ups".
- Next step: owner tries it in the preview, then merge into `main` (rebuild the preview after the merge). Bench scripts used: the audit's
  `audit-engine` scratch folder (big world `big.sqlite`), adapted copies were in this session's scratchpad (not kept in the repo).
- Trap: `makeApp` in the server tests turns the rankings cache off (`rankingsCacheMs: 0`); a test that wants it passes its own value.

## State in one minute

- **Everything below is on `main` LOCALLY, NOT pushed (59+ commits ahead of origin). The owner tests in the preview; push only on his OK.**
- **Originality pass built (2026-11-11 … 17):** 25-level ladder (Hall/Lumber/Farm/Mine/Storehouse/Longhouse 25, Wall 22, Barracks 20,
  Stables/Gold Mine 18, Market/Vault/Wrightyard 12, Drillyard 10, Banner Hall 4), economy x1.5 with troop costs x0.55, room 12,000 at
  Longhouse 25; **Longhouse** (population; Farm = food only); **Wrightyard** + **Firecart** (replaces Log Ram + Boulder Sling);
  **Elk Rider** (`outrider`), **Ember Guard** (`knight`, foot, Barracks); "Vault" (was Hidden Vault); 1 Chieftain per 12,000 points.
  Schema v17–v19 migrate old worlds (incl. old reports, troop groups, ranks).
- **Village scene:** plate 312, new layout, roads whose surface follows the building's look (dirt/gravel/cobbles/flagstones), every
  road ends at a door (layout tests), Stables yard. Perf: campfire on the compositor, still landscape cached as one picture, hover pad.
- **Health check 2026-11-17 (3 audits) and fixes:** preview sessions never expire, saves paced by speed, bot reports pruned, worker
  death splash; small village picture from the Village scene (kept in localStorage); memoised `Icon`/`BuildingArt`/`T`; no refetch
  after actions; double-press guard (`hooks/useLock.ts`); map hand cursor; Army page fits 1440x900.
- **Owner's preview is the BUILT copy** (`npm run serve:preview`, :5174, detached). After each merge into main:
  `npm run build:preview:local`, then ask him to reload. No hot reload any more.

- **Later on 2026-11-17 (all merged in main locally, 98 commits ahead of origin, schema v25):** owner picks after the genre
  comparison (`docs/proposals/2026-11-17-owner-picks.md`): population room 720 x 1.1244^(L-1); ~25 builder-days; map stages
  spread; server speed pass (v20-v22); Ember Guard 140/90/90; Firecart power 2; **abandoned villages have no defenders and no
  Wall militia** (player-left villages keep their real troops; v23); **Realm** page (tab from 2 villages) + private **Notes/tags**
  (v24); **incoming-attacks page**, help-in-time line, "you need N troops" hint (`GET /api/intel/:id`); **Raid again**, clear
  report titles, **Raid lists as a paid extra** (v25; `features.raidLists` + bit 1 of `players.premium`; tab only with the
  extra, Army button otherwise; on in the preview). Village first paint fixed (no deferred visible scene).

- **2026-11-18 (merged in main locally, schema v29, not pushed past `3e21e08`):** Drillyard (no Chieftain/Firecart ranks, fits
  1440x900, Ranks/Research switch at 7+ cards); no fixed Recruit limit (`MAX_TRAIN_BATCH` 100,000 sanity bound); map panel Send
  button pinned; **Feasts unlimited** (price 810/2,025/810, -10% per Banner Hall level, count field); **no limit on resources
  received** (owner); **Fighter rankings** (`fighter_totals` v27, Attacker/Defender/Total), report lines (destroyed value,
  Renown reason), close lost attacks reveal the defence (`LOST_ATTACK_SEEN_SHARE` 0.5); **staff Shared connections** page
  (device id, pair log, rules `MULTI_*`, v28); audit/lobby IPs blanked after 30 days (v29, lobby v6); **Hearthwarden** (Stables 4,
  fast support rider); **Log Ram** back (Wall only, power 6) + Firecart buildings only (power 4); `SIEGE_POINTS_PER_LEVEL` 7,
  `SIEGE_EXTRA_POINTS.bannerhall` 40. World mirror works from the built preview (server logs refused saves).

## Work in flight / very next step

1. **Owner tests the built preview in Safari** (hand cursor, lag, small village picture, roads, Longhouse/Wrightyard, Firecart, old
   siege reports). Then push on his OK.
2. Side session "Server speed pass before public launch" (own worktree/branch, not merged): due-movement budget, refunds from the
   price paid, march cap, site upkeep, map NPC settle, rankings cache. Review and merge after it reports; rebuild the preview.
3. Open follow-ups (also in NEXT_STEPS): `Siege.tsx` still draws old line icons; Drillyard page ~1,400 px tall at 900 px; split
   `now`/`live` out of the big game context; builder/smoke animations still inside the scene SVG; bots never build a Wrightyard or
   Firecarts and stagnate after ~day 100; Ironhart has no troops; phone (360 px) pass of everything new; real Safari never measured
   (only headless Chrome and Playwright WebKit in the scratchpad).
4. Worktrees: `../tribewars-tiers` (branch `originality-tiers`, = main; build there, ff-merge into main), `../tribewars-perf` and
   `../tribewars-perf-old` (measuring copies; delete when not needed).

## Decisions (don't re-ask)

- Owner picked (2026-11-11): new roster and buildings as above; keeps the Wall, Vault, Gold Mine and Stables ART; Longhouse without
  dragon heads or knobs; levels decided by balance (25 core). "Balance like Tribal Wars" = same feel, never their numbers.
- Targets: raider/builder 1.5–2x, 2nd village day 21–28, conquest worst ratio ≤ 2x, takes 30–50 (sim 90 d x 5 seeds).
- Preview Reset world: computer players start from zero with the new player. War Chest: Chieftain gold from an account chest.
- Gold = elite + conquest resource. Scrolling only inside conversation panes. One same-size button family.

## Traps

- **Never work in `/Users/admin/Projects/tribewars` itself for multi-step changes** (use a worktree, merge when done). Two agents in
  one worktree: tell each which files are the other's; **never `git stash`** (one agent did; it swept the other's edits).
- **No visible browser windows, not even the in-app pane** (owner): headless Chrome (`--headless=new`) or resvg on your own port.
- Approval questions: per item, before → after, picture or rule. Show only what changes.
- Preview: `clock.ts` replaces `Date` (game time; `realTime()` for the wall clock). Call-back window is game time (1.2 s at 100x).
  World mirror: `apps/preview/data/preview-world-<player>.sqlite` (read the owner's reports with sqlite3; copy before any test).
  World backups of 2026-11-17: `apps/preview/data/backups/` in the main checkout (git-ignored).
- If :5174 is down (Mac restart): `npm run serve:preview` from the main checkout, detached.
- Sim runs are fast; never flip `config.ts` while an agent runs checks. `npm run sim -- --conquest --seeds 5` after Chieftain,
  hold or Renown changes. After changing any building SVG: `node scripts/measure-sprites.mjs`.
- Flaky server tests seen once each: mail-conversations paging, a scouts-and-alerts test (pass on rerun).
- Owner pastes other projects' feedback by mistake (TCG card shop): don't act on it here.
- Owner files left uncommitted on purpose: `.claude/launch.json` (its "preview" entry still starts the DEV server: don't use it
  on 5174), `Pasted ... textClipping`.
