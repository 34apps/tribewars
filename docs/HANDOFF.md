# Handoff — Clanfire

Written 2026-11-04 (HEAD `be53d22`+). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run

2026-11-04 (`80e2127`): owner screenshot showed the Design preview slider dead (bar sat in `.vv-board-head`, pointer-events:none;
now auto), buildings in the preview (now wall only, other buildings level 0, no queue), and sideways + page scrollbars
(`html:has(.app)` overflow hidden, `.app` clipped, compact top bar up to 1599 px). Not viewed (no renderer).
Very next step: owner opens Settings → Design preview, drags the slider to 20, screenshots the corner tower at 360 and 1440 px,
and confirms no sideways scroll. Desktop village page scroll with sticky board is by design. Checks passed.

## How the owner works (important)

- Owner (Metin) is not a developer, writes Turkish/English, wants **short, plain answers** and
  copy-paste commands. One change at a time, so a disliked change can be undone alone.
- Day-to-day dev runs on the owner's Mac with `agent "task"` (= `npm run agent -- "task"`,
  `scripts/agent/run.ts`), billed to platform.claude.com API credits (not the Max plan). Every run starts
  fresh; the previous final answer (`.agent/last-reply.md`, ≤60 lines) is passed as context; `--continue`
  resumes fully (expensive, avoid); default budget $10 (`--budget N`).
- Runner permissions are an allow list (`dontAsk` mode): chained commands need every part allowed.
  `rm`, `git reset/checkout/stash`, `npm install`, `curl` are denied — ask the owner to run those.
- Each run ends with: check → commit → CHANGELOG/NEXT_STEPS → "Last run" above → docs commit → `git push origin main`.

## State in one minute

- **Clanfire** (GitHub repo `34apps/tribewars`) is playable: villages, 4 resources, buildings, troops,
  raids, growing abandoned villages, tribes + diplomacy + forum + chat, tribe warfare (scouts, support),
  Drillyard research queue + ranks, Market + shipments, rankings + profiles, mail, staff tooling
  (tickets, reports, mute/ban), population cap, cancel within 2 min, rate limits, multi-account guard.
- `npm run dev` = expanding 500x500 world at real pace (own DB `clanfire-world.sqlite`);
  `npm run dev:fast` = speed 10. Preview: `npm run build:preview` → `apps/preview/dist/index.html`.
- Style **D · Toy Diorama** everywhere (village tried style B on 2026-11-04, owner went back to toy): village view (town square + campfire centre, Drillyard on its
  own plot), isometric map with 6 growth stages + ruins, chieftains. Sprites in `design/sprites/`.
- Ask Mags AI advisor is off (owner: no credit spend) unless `ADVISOR_ENABLED=true`.
- Tests: engine 223, server 210, all green. Not deployed; no CI.

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian. Web first (360 px phone + 1280–1440 px desktop), native later.
- Keep Toy Diorama; polish, don't restyle. Keep the current map look (no clearings, labels always shown,
  normal hills). Art stays swappable (sprite registries).
- No scrollbars inside desktop side panels; server tests for every new endpoint; security gate per feature.

## Open

- Owner: Tripo3D test (3D models rendered to flat sprites) — suggested first: Town Hall, Lumber Camp,
  Iron Mine in Toy Diorama style; map village stages later if it works. Check Tripo's commercial licence.
- Owner: approve design rows H–L; practice-ruin decision; hosting; `GAME_DESIGN.md` §15 questions.
- Dev: many screens built but never viewed in a browser (see CHANGELOG "not viewed"): Drillyard, Market,
  Mail, staff screens, town square. View them at 360 and 1440 px.

## Traps

- Vite dev proxy needs `changeOrigin: false` (server's Origin check).
- `node:sqlite`; old DBs get columns added in place. `data/`, `*.sqlite` are git-ignored.
- Preview must stay CSP-safe: sql.js asm build, no wasm/eval/network.
- Scout tests rely on scout village Keen 2–5.
- Dark/light token contexts: set explicit text colours on light surfaces inside dark cards.
- Never put the API key in the repo, a commit or chat; it lives in the owner's `~/.zshrc` only.
