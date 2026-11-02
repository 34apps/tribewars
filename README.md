# TribeWars

An original browser strategy game. Every player gets a village somewhere on a shared world map.
Grow it with **wood, food, iron and gold**, upgrade buildings, train troops, and send them across
the map (travel time depends on distance) to raid **abandoned villages** — which keep growing on
their own — or other players. Tribes and alliances come next.

Web first; the UI is built mobile-first so it also works in phone browsers.

## Run it locally

Needs Node.js 22.13 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and create an account. The dev world runs at 10× speed so things
happen quickly (set `WORLD_SPEED` to change it; delete `apps/server/data/` to start a fresh world).

## Production

```bash
npm run build
```

```bash
npm start
```

The server listens on `PORT` (default 3000) and serves the built web client. Settings:
`apps/server/.env.example`.

## Project docs

- `docs/GAME_DESIGN.md` — rules and formulas.
- `docs/STANDARDS.md` — security and performance rules.
- `AGENTS.md`, `docs/AI-WORKFLOW.md`, `docs/HANDOFF.md` — how AI sessions work on this repo.
- `CHANGELOG.md`, `NEXT_STEPS.md` — history and what's next.
