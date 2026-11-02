# Handoff — Clanfire

Written 2026-11-02 (late, during the redesign). Read this first, then `docs/AI-WORKFLOW.md` (main
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
- `main` = work branch `claude/brave-rubin-tyvvnm` up to the warfare/preview merge; later commits are
  on the branch only until the redesign build passes checks.
- Not deployed anywhere; no CI yet.

## Owner decisions (don't re-ask)

- Same genre as Tribal Wars but original and better — never copy. Web app first (desktop + phone
  browsers), native app later.
- Style **D · Toy Diorama** chosen. Approved: village view (E), map growth stages (F), chieftains (G).
  Owner may still tweak designs → keep art swappable via sprite map modules.
- Village view = walled village around a square, resource buildings outside, level badges, click opens
  panel. Map = 2.5D isometric; villages grow in 6 stages by points (`mapStage`), ruins for abandoned.

## Work in flight (at the moment of writing)

| What | Status |
|---|---|
| Build village view + Toy design system + new shell into apps/web | agent running |
| Isometric map with stage sprites (apps/web/src/map/**) | agent running |
| Chieftains server side | done (`048baed`) |
| Chieftain web UI (sign-up picker, avatars) | next, after village view lands (Shell conflicts) |
| Designs for approval: unit characters (H), advisor tutorial (I), building panels + reports (J) | agents drawing; publish to canvas rows H/I/J, merge index with live |

Next after those: verify (`npm run check`, build, Playwright at 1440/390), rebuild + republish preview,
CHANGELOG/NEXT_STEPS, push branch, merge to `main`.

## Traps

- Vite dev proxy needs `changeOrigin: false` (server's Origin check).
- Old databases upgrade in place on start (new columns/tables; movements/reports tables rebuilt).
- Preview build must stay CSP-safe: sql.js asm build (no wasm), no Ajv/eval, no network.
- Several agents share `apps/web`: give each a disjoint set of files.

## Open items for the owner

1. Approve designs H, I, J when published.
2. Where to host the real server (needed for playing with other people).
