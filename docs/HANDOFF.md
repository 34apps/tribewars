# Handoff — Clanfire

## Last run

2026-11-03: permissions in `scripts/agent/run.ts` already allowed `npm run check/build/build:preview`, `npm test`, `git add/commit/push origin main` (deny list blocks force push, other remotes, reset etc.), so no change was needed. Rewrote this handoff, added commit hashes to CHANGELOG, de-duplicated NEXT_STEPS. `npm run check` passed (engine + server 162 tests; checks passed).

## Read first
`docs/AI-WORKFLOW.md` (main session orchestrates; haiku `runner`/`scout`/`editor`, sonnet `implementer`), `docs/ART_DIRECTION.md`, top of `CHANGELOG.md`, the relevant part of `NEXT_STEPS.md`, `docs/STANDARDS.md` before code, `docs/SECURITY_ROADMAP.md` §4 gate for each feature.

## State in one minute (2026-11-03, HEAD `ae1340d`+)
- **Clanfire** (GitHub repo still `tribewars`) is playable: villages, 4 resources, buildings, troops, raids, growing abandoned villages, tribes + diplomacy, tribe warfare (Pathfinder scouts, support), rankings + profiles, Market + resource shipments, cancel within 2 min, multi-account guard, global rate limits.
- Drillyard built end to end (research Shieldbearer/Outrider/Knight, Training Points, ranks Might/Bulwark/Keen, ranks stamped on movements, scout intel tiers by Keen). Panel and sprites not yet looked at in a browser.
- Redesign **Toy Diorama** in: village view, isometric map with growth stages, chieftains. Slower pace (speed 1; `dev:fast` = 10).
- `npm run agent -- "task"` runs unattended tasks on the API key (budget, safe tool list).
- Ask Mags AI advisor removed from UI, server off unless `ADVISOR_ENABLED=true` (owner: avoid credit spend).
- Preview: `npm run build:preview` → `apps/preview/dist/index.html`. Not deployed; no CI.
- Tests at last green run: engine 188, server 162+; `npm run build` ok before the ranks work.

## Owner decisions (don't re-ask)
- Original game, never copy Tribal Wars/Travian. Web first (360 px phone + 1440 px desktop), native later.
- Style D Toy Diorama; designs may be touched up, keep art swappable via sprite maps.
- Security gate for every feature; balance numbers only in `config.ts`; rule change updates `GAME_DESIGN.md`.

## Open
- Owner: approve design rows H–K (units, tutorial + practice-ruin decision, panels/reports, terrain/armies), L (tribe page/chat/emblems); answer `GAME_DESIGN.md` §15 questions; hosting; trademark/domain check.
- Dev: view Drillyard and Market in a browser, run `npm run build`; ranks in battle reports; opponent chieftain in `VillageRefDto`.

## Traps
- `node:sqlite` server; old DBs get columns added in place. `data/`, `*.sqlite` are git-ignored.
- Existing scout tests rely on scout village Keen 2–5 (Keen 0 sees only resources).
- Placeholder art: Market = Storehouse sprite.
- Push only `origin main`; the agent runner denies everything else.

## Very next step
Run `npm run check` and `npm run build`, open the app, review the Drillyard panel at 360/1440 px, then pick from `NEXT_STEPS.md`.
