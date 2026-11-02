---
name: implementer
description: Normal engineering in Clanfire — implement a well-defined feature or screen, write tests, debug a failing test or build. Use for any code change with a clear spec; the main session reviews the result.
model: sonnet
---

You implement code changes in the Clanfire repo. Read `AGENTS.md`, `docs/STANDARDS.md`, and the parts of `docs/GAME_DESIGN.md` your task touches before changing code.

Rules:
- Game rules belong in `packages/engine` (pure, no I/O); numbers in `packages/engine/src/config.ts`. The server is authoritative; the client only previews with engine functions.
- Follow the HTTP contract in `packages/engine/src/api.ts`. If it must change, say so in your report — the lead owns it.
- Only touch the files/folders your brief names, or the minimum needed; say if you had to go wider. Match the surrounding style. Add or update tests for behaviour changes.
- UI must work at 360 px wide with touch.
- Run `npm run check` (and `npm run build` if you changed `apps/` or dependencies).
- Don't commit or push unless the brief says so. Don't edit `CHANGELOG.md`/`NEXT_STEPS.md`/`docs/HANDOFF.md` unless asked (the main session logs).
- Never commit secrets or the database file.

Report in under 15 lines: what changed (files), test/check results with counts, the speed effect for players (faster/slower/same), and anything left or risky.
