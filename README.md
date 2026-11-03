# Clanfire

An original browser strategy game. Every player gets a village somewhere on a shared world map.
Grow it with **wood, food, iron and gold**, upgrade buildings, train troops, and send them across
the map (travel time depends on distance) to raid **abandoned villages** — which keep growing on
their own — or other players. Join or found a **tribe**, chat with it, and make alliances, non-aggression pacts
or enemies with other tribes.

Web first; the UI is built mobile-first so it also works in phone browsers.

## Run it locally

Needs Node.js 22.13 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and create an account. The dev world runs at speed 1 (real pace; `npm run dev:fast` runs 10× with its own database) so things
happen at the real pace (set `WORLD_SPEED` to change it; delete `apps/server/data/` to start a fresh world).

## Production

```bash
npm run build
```

```bash
npm start
```

The server listens on `PORT` (default 3000) and serves the built web client. Settings:
`apps/server/.env.example`.

## Running AI tasks

`npm run agent -- "task"` (needs `ANTHROPIC_API_KEY`; flags `--model`, `--max-usd`, `--max-turns`) runs
one self-contained task. Question-only tasks change nothing. Tasks that change files end with
`npm run check`; if it passes, the run commits, updates `CHANGELOG.md`, `NEXT_STEPS.md` and the
"Last run" box in `docs/HANDOFF.md`, and pushes to `main`. If the check fails, nothing is committed
and the failure is written into "Last run". Details: `docs/AI-WORKFLOW.md` §8.

## Project docs

- `docs/GAME_DESIGN.md` — rules and formulas.
- `docs/STANDARDS.md` — security and performance rules.
- `AGENTS.md`, `docs/AI-WORKFLOW.md`, `docs/HANDOFF.md` — how AI sessions work on this repo.
- `CHANGELOG.md`, `NEXT_STEPS.md` — history and what's next.
