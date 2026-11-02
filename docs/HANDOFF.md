# Handoff — Clanfire

Written 2026-11-02 (after v0.4, slower pace, Agent SDK runner; Ask Mags AI box built then removed by owner). Read this first, then `docs/AI-WORKFLOW.md` (main
session orchestrates; haiku `runner`/`scout`/`editor`, sonnet `implementer`; opus for art/design
agents), `docs/ART_DIRECTION.md`, the top of `CHANGELOG.md`, and the parts of `NEXT_STEPS.md` you need.

## State in one minute

- Game (renamed **Clanfire**; GitHub repo still `34apps/tribewars`) v0.3 is playable: villages,
  resources, buildings, troops, raids, abandoned villages that grow, tribes + diplomacy, tribe warfare
  (Pathfinder scouts, support troops, tribe alerts). Engine 160 tests, server 120 tests.
- **Playable preview** (whole game in one page, real server code on sql.js, computer tribes):
  https://claude.ai/artifact/EkSiAxXuuTvVTLpLJyEuyv — rebuild with `npm run build:preview`, publish
  `apps/preview/dist/artifact.html` to that URL (Artifact tool, same URL).
- **Design canvas** (all art for approval, rows A–J): https://claude.ai/artifact/MBeYhuGXimx6ASUkUGGQDB.
  Re-read its `project/canvas.json` before every index publish and merge — the page itself saves it.
  Artboard sources + renders are copied into `design/style-directions/`, sprites into `design/sprites/`.
- `main` = work branch `claude/brave-rubin-tyvvnm` (merged after every verified step).
- Not deployed anywhere; no CI yet.

## Owner decisions (don't re-ask)

- Same genre as Tribal Wars but original and better — never copy. Web app first (desktop + phone
  browsers), native app later.
- Style **D · Toy Diorama** chosen. Approved: village view (E), map growth stages (F), chieftains (G).
  Owner may still tweak designs → keep art swappable via sprite map modules.
- Village view = walled village around a square, resource buildings outside, level badges, click opens
  panel. Map = 2.5D isometric; villages grow in 6 stages by points (`mapStage`), ruins for abandoned.

## Work in flight / next

| What | Status |
|---|---|
| Village view, isometric map + growth stages, chieftains | **built, in `main`** (v0.4) |
| Designs H–K on canvas; **L (tribe page + chat + emblems) done but only in `design/` (artboards + renders), not yet on canvas** | waiting for owner approval |
| Owner decision: first raid too punishing — "practice ruin" near each new village (recommended) vs easier weak NPCs | open |
| After approvals: build H–K in (one agent per disjoint file set), reports need opponent chieftain in `VillageRefDto` | next |

Verify every build: `npm run check`, `npm run build`, `npm run build:preview` (single file), Playwright at
1440 and 390, then republish the preview and merge to `main` (owner allowed merging).

## Added this session (2026-11-02, later)

- **Slower original pace** (owner approved): builds ~6–30 min at level 1, ~1–3 h mid, ~8–24 h late; Town Hall
  -5%/level; troops 3–22 min. Benchmarked only against the genre's pace (never copy numbers). `npm run dev` =
  speed 1 (`apps/server/data/clanfire.sqlite`, fresh world); `npm run dev:fast` = speed 10 (`clanfire-fast.sqlite`,
  the old world). Preview (speed 25) not rebuilt/republished with the new pace yet.
- **Ask Mags AI advisor**: server endpoint + tests exist (`apps/server/src/advisor.ts`) but are **off** unless
  `ADVISOR_ENABLED=true` + key. Web box removed (owner: AI credit spend). The free fixed **Mags tip box stays** —
  owner wants it as the first tooltips of the web app. Don't re-add AI features without a budget decision.
- **`npm run agent -- "task"`**: Claude Agent SDK runner billed to `ANTHROPIC_API_KEY` (sonnet default, $2 cap,
  no commit/push/install/network). `docs/AI-WORKFLOW.md` §8. Owner's key is in the shell environment.

## Traps (new)

- A world keeps the speed it was created with; changing `WORLD_SPEED` needs a new database.
- GitHub `main` gets commits from other sessions (design rows): `git fetch` + rebase before pushing, fix the
  changelog hash after a rebase.

## Traps

- Vite dev proxy needs `changeOrigin: false` (server's Origin check).
- Old databases upgrade in place on start (new columns/tables; movements/reports tables rebuilt).
- Preview build must stay CSP-safe: sql.js asm build (no wasm), no Ajv/eval, no network.
- Several agents share `apps/web`: give each a disjoint set of files; commit each agent's files as soon
  as it reports (an agent once deleted another's untracked files).
- Dark/light token contexts: panels redefine `--ink`; set explicit text colours on light surfaces inside
  dark cards (several contrast bugs came from this).
- An agent may keep re-sending its final report; stop it with TaskStop.

## Open items for the owner

1. Approve designs H, I, J when published.
2. Where to host the real server (needed for playing with other people).
