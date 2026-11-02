# Handoff — TribeWars

Written 2026-11-02. Read this first, then `docs/AI-WORKFLOW.md` (the main session orchestrates;
haiku agents `runner`/`scout`/`editor`, sonnet agent `implementer`), the top of `CHANGELOG.md`,
and the parts of `NEXT_STEPS.md` you need.

## State in one minute

- v0.1 is playable: register → village on the world map → resources tick → build/upgrade →
  train troops → send to coordinates → battle report → troops return with loot. Abandoned
  villages grow over time. No tribes yet.
- Code: `packages/engine` (pure rules, 83 tests), `apps/server` (Fastify + `node:sqlite`, 35 tests),
  `apps/web` (Vite + React, mobile-first). `npm run check` and `npm run build` pass.
- Work lives on branch `claude/brave-rubin-tyvvnm`; `main` only has the initial README until the
  owner says to merge.
- Not deployed anywhere yet.

## Work in flight / next

| What | Who |
|---|---|
| Owner to choose: merge to `main`; final game name (see NEXT_STEPS); hosting | Owner |
| Phase 2: tribes + diplomacy (spec in `docs/GAME_DESIGN.md` §11 and `NEXT_STEPS.md`) — lead writes the rules/contract, `implementer` agents build server and web in parallel | Claude |

## Decisions already made (don't re-ask)

- Resources: wood, food, iron, gold. Troops eat food (upkeep); training is refused if net food would go below 0.
- Original building/unit names and numbers (`packages/engine/src/config.ts`); don't copy other games.
- Server is authoritative; the client previews with the same engine. Lazy settlement, no per-village timers.
- One village per player in v1; random spawn anywhere on the map; 72 h beginner protection (÷ world speed).
- Abandoned villages: 5 tiers, grow one building level every 6 h (÷ speed), refill 25% garrison per step, have a gold mine.
- Dev world runs at 10× speed (`npm run dev`); production default 1×.

## Traps

- Vite 8's dev proxy rewrites Host unless `changeOrigin: false` — the server then rejects POSTs (403). Keep it explicit in `apps/web/vite.config.ts`.
- `node:sqlite` prints an "experimental" warning on start; harmless.
- World settings are stored in the DB at world creation; changing `WORLD_SPEED` later needs a fresh DB (delete `apps/server/data/`).
- Return movements: in the DB `origin` is the army's home; in the API `origin`/`target` follow travel direction.
- A session started from another repo loads that repo's agents; brief general-purpose agents with `model: "haiku"`/`"sonnet"` instead.

## Open items for the owner

1. Say if the branch should be merged into `main`.
2. Pick a final game name (trademark risk with "Tribal Wars").
3. Decide where to host the game server.
