# Handoff — Clanfire

Written 2026-11-04 (HEAD `be53d22`+). Read this first, then `docs/AI-WORKFLOW.md`, the top of
`CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## Last run

2026-11-04 (`115a93a`): **defender Renown trickle** (`min(22, 0.006 x defence at home)`/village/day, none in protection, lazy `defenceMark`, paid in `Store.saveVillage`, reads only show it) and **step 1 terrain travel** (`packages/engine/src/travel.ts`, `TERRAIN_SPEED`, cap 2.2x, ~12% slower on average, same both ways; send/shipment forms + coloured map route). Sim: pure defender 2nd village day 25.4, raider 20.4, builder 14.5 (faster than the raider: owner to judge), terrain moved nothing in the sim; idle stretch left for after step 2 (owner). Checks passed (check, build, build:preview); `BALANCE.md` §7.4, `docs/sim/2026-11-04-after-*.txt`.
Left: nothing viewed in a browser (360/1440 px); step 2 (found/take villages, spend Renown, several villages in the sim) not started. Details: `NEXT_STEPS.md` first item.
Very next step: owner looks at the map route + send preview and decides about the builder pace; then §18.7 step 2.
Notes: Bash is an allow list (no python, no `rm`, no `node` directly); `npm test -w <pkg>` runs the whole workspace. Delete the empty scratch file `packages/engine/test/probe.test.ts` (runner cannot).
Uncommitted owner files left alone: `.claude/launch.json`, `Pasted ... textClipping` (stage with explicit paths, not `git add -A`).

Earlier (`bed1ea1`): Security Phase 1A (CSP, Permissions-Policy, HSTS in prod, per-account route limits; CSP allows Google Fonts).

Before that (`b8b8b61`): owner said the scenery around the village looked weird. Current landscape: loaf-shaped hills and triangle crags
replaced by rolling hills and rocky outcrops. Option C: broken mountain cut edges and white-slab cliffs fixed. A and B looked fine in renders.
Viewed live (Current, 1440 + 360 px) and as SVG renders of all four. Next: owner looks again and picks a landscape (NEXT_STEPS "Landscape choice").
Tip: landscapes can be rendered to PNG without a browser via Vite SSR + `qlmanage -t` (see the landscapes test for the SSR setup).
Stray `Pasted ... textClipping` file in the repo root is the owner's; don't commit it.

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
- Tests: engine 297, lobby 82, server 350, web 31, all green. Not deployed; no CI.

## Owner decisions (don't re-ask)

- Original game, never copy Tribal Wars/Travian. Web first (360 px phone + 1280–1440 px desktop), native later.
- Keep Toy Diorama; polish, don't restyle. Keep the current map look (no clearings, labels always shown,
  normal hills). Art stays swappable (sprite registries).
- No scrollbars inside desktop side panels; server tests for every new endpoint; security gate per feature.

## Open

- Owner: Tripo3D test (3D models rendered to flat sprites) — suggested first: Town Hall, Lumber Camp,
  Iron Mine in Toy Diorama style; map village stages later if it works. Check Tripo's commercial licence.
- Owner: approve design rows H–L; practice-ruin decision; AWS account + domain for the deploy (`DEPLOYMENT_PLAN.md` §5); `GAME_DESIGN.md` §15 questions.
- Dev: many screens built but never viewed in a browser (see CHANGELOG "not viewed"): Drillyard, Market,
  Mail, staff screens, town square. View them at 360 and 1440 px.

## Traps

- Vite dev proxy needs `changeOrigin: false` (server's Origin check).
- `node:sqlite`; old DBs get columns added in place. `data/`, `*.sqlite` are git-ignored.
- Preview must stay CSP-safe: sql.js asm build, no wasm/eval/network.
- Scout tests rely on scout village Keen 2–5.
- Dark/light token contexts: set explicit text colours on light surfaces inside dark cards.
- Never put the API key in the repo, a commit or chat; it lives in the owner's `~/.zshrc` only.
