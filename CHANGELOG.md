# Changelog

Rolling, human-readable history of notable changes, newest first. Lets any AI session (or person)
pick up context without the old conversation. Full detail is in `git log`. See `AGENTS.md` for the rule.

## 2026-11-02
- **First playable version (v0.1)** (owner, 2026-11-02): own village at a random spot on a 201×201 world map; wood/food/iron/gold with live counters, storage caps and food upkeep for troops; 10 buildings with upgrade queue; 5 unit types trained in Barracks/Stables; send troops to any coordinates with travel time by distance; battles with luck, wall and loot; ~800 abandoned villages that grow and refill their defenders over time (and slowly mine gold); battle reports; beginner protection. Pure rules engine shared by server and client (`packages/engine`, 83 tests), Fastify + SQLite server (`apps/server`, 35 tests; scrypt passwords, hashed session tokens, cross-site POST block, rate-limited sign-in), mobile-first React client with drag/pinch map (`apps/web`, 91 kB gzip JS). Also: `CLAUDE.md`/`AGENTS.md`, `docs/AI-WORKFLOW.md` (main session orchestrates; haiku/sonnet agents in `.claude/agents/`), `docs/HANDOFF.md`, `docs/GAME_DESIGN.md`, `docs/STANDARDS.md`. (`d74db30`)
