# Handoff — Clanfire

Written 2026-11-02 (after v0.2 tribes). Read this first, then `docs/AI-WORKFLOW.md` (the main session orchestrates;
haiku agents `runner`/`scout`/`editor`, sonnet agent `implementer`), the top of `CHANGELOG.md`,
and the parts of `NEXT_STEPS.md` you need.

## State in one minute

- v0.2 is playable: register → village on the world map → resources tick → build/upgrade →
  train troops → send to coordinates → battle report → troops return with loot. Abandoned
  villages grow over time. **Tribes** (v0.2): found/join/apply/invite, roles, diplomacy (ally, NAP
  with 24 h cancel notice, enemy), attack blocking for tribe/allies/NAP, chat, log, ranking, map colours.
- Code: `packages/engine` (pure rules, 101 tests), `apps/server` (Fastify + `node:sqlite`, 67 tests),
  `apps/web` (Vite + React, mobile-first, 102 kB gzip JS). `npm run check` and `npm run build` pass.
- `main` = latest work (owner asked to merge 2026-11-02). Work branch `claude/brave-rubin-tyvvnm`.
- Not deployed anywhere yet. No CI yet.

## Work in flight / next

| What | Who |
|---|---|
| Owner to choose: final game name (suggestions in NEXT_STEPS); hosting | Owner |
| Phase 3: support troops, tribe-wide attack alerts, scouts (`NEXT_STEPS.md`) — lead writes rules in `docs/GAME_DESIGN.md` + contract in `api.ts` first, then `implementer` agents build `apps/server` and `apps/web` in parallel | Claude |

## Decisions already made (don't re-ask)

- Resources: wood, food, iron, gold. Troops eat food (upkeep); training is refused if net food would go below 0.
- Original building/unit names and numbers (`packages/engine/src/config.ts`); don't copy other games.
- Server is authoritative; the client previews with the same engine. Lazy settlement, no per-village timers.
- One village per player in v1; random spawn anywhere on the map; 72 h beginner protection (÷ world speed).
- Abandoned villages: 5 tiers, grow one building level every 6 h (÷ speed), refill 25% garrison per step, have a gold mine.
- Dev world runs at 10× speed (`npm run dev`); production default 1×.
- Same genre as Tribal Wars, but original and better — never copy names, numbers, text or layouts (owner).
- Tribes: one tribe per player, 30 members, found at Town Hall 3; alliances/NAPs need both sides,
  cancelling gives 24 h notice (÷ speed); enemy is one-sided. Details settled in `GAME_DESIGN.md` §11.

## Traps

- Vite 8's dev proxy rewrites Host unless `changeOrigin: false` — the server then rejects POSTs (403). Keep it explicit in `apps/web/vite.config.ts`.
- `node:sqlite` prints an "experimental" warning on start; harmless.
- World settings are stored in the DB at world creation; changing `WORLD_SPEED` later needs a fresh DB (delete `apps/server/data/`).
- Return movements: in the DB `origin` is the army's home; in the API `origin`/`target` follow travel direction.
- A session started from another repo loads that repo's agents; brief general-purpose agents with `model: "haiku"`/`"sonnet"` instead.

## How this session worked (repeat it)

Lead wrote rules + `api.ts` contract → server and web `implementer` (sonnet) agents in parallel, each
owning one folder, no `npm install` by agents → lead reviewed security-critical code and screenshots →
one small follow-up agent for contract gaps → lead ran `npm run check`/build/prod smoke → log → push.

## Open items for the owner

1. Decide where to host the game server.
