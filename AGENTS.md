# Clanfire

Original browser strategy game: villages on a shared world map, four resources (wood, food,
iron, gold), buildings, troops, raids on abandoned villages, later tribes and diplomacy.
Web first, then mobile browsers. **This repo is the only project for this game — don't work on,
read or log other repos (e.g. MeetingNote) from a Clanfire session.**

## Read at the start of every session (in this order)

1. `docs/HANDOFF.md` — one-minute state, work in flight, decisions, traps.
2. `docs/AI-WORKFLOW.md` — **how to work**: the main session orchestrates; hands-on work goes to
   cheaper agents (`.claude/agents/`: `runner`, `scout`, `editor` on haiku; `implementer` on sonnet).
3. Top of `CHANGELOG.md`; `grep` `NEXT_STEPS.md` for your topic.
4. `docs/GAME_DESIGN.md` before touching game rules; `docs/STANDARDS.md` before any code change.

## Layout

- `packages/engine` — pure TypeScript game rules (no I/O). Server and client both import it.
  Numbers in `src/config.ts`, data model in `src/types.ts`, HTTP contract in `src/api.ts`.
- `apps/server` — Fastify API, SQLite (`node:sqlite`), authoritative game state.
- `apps/web` — Vite + React client (map canvas, village, troops, reports). Mobile-first.

## Commands (repo root)

- `npm install` — install all workspaces.
- `npm run dev` — server + web client with hot reload (fast world speed for testing).
- `npm run check` — type-check + all tests. **Must pass before every commit.**
- `npm run build` — production build of the web client.
- `npm start` — production server (serves the built client).

## Rules

- **Original game.** Same genre as Tribal Wars / Travian, aiming to be better with more features —
  never copy their names, numbers, formulas, art, text or screen layouts (owner, 2026-11-02).
- The server is authoritative. Every rule lives in `packages/engine`; the client only previews.
  Never trust client input.
- Balance numbers only in `config.ts`. A rule change updates `docs/GAME_DESIGN.md` in the same commit.
- Every screen works at 360 px wide with touch.
- Before handing off a change: review against `docs/STANDARDS.md`; `npm run check`; `npm run build`
  if `apps/` or dependencies changed; add a dated line to `CHANGELOG.md` (newest first, commit hash);
  update `NEXT_STEPS.md` (remove done items, add new follow-ups). Rewrite `docs/HANDOFF.md` when
  handing off a session.
- Never commit secrets or the game database (`data/`, `*.sqlite` are git-ignored).
