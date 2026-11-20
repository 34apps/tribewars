# Handoff — Clanflame

Written 2026-11-20 by the main session ("Village map centering", `local_86849d4a…`). Read this first, then
`docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## State in one minute

- `main` = `2b50a22`; everything up to `3988169` is pushed; the roster merge after it is NOT pushed (owner tries it first). Lobby schema v9, game schema v39.
- The owner plays the BUILT preview on http://localhost:5174. After every merge into main: back up
  `apps/preview/data/preview-world-metinaltinbas.sqlite` to `apps/preview/data/backups/`, run `npm run build:preview:local`,
  ask him to reload. Push only after he says "works, push it".
- Other sessions also merge into main and push. Before you merge, run `git status` in the main checkout and never commit
  someone else's unsaved edits.

## Landed 2026-11-19/20 (main, pushed)

- **Map:** opens centred on the player's village; far zoom shows tiny flags with group counts.
- **Computer players** keep developing (preview bots v4).
- **Longhouse** is never refused for population.
- **Fire Shrine / Waymark / Lookout panels:** design A, number tiles.
- **Top bar:** fill-up resource pills; bell and profile pinned right.
- **Phone:** village tab.
- **Small fixes:** Support box with one "Bring home ▾" button; Raid again; +1 day refresh.
- **Chieftain:** the full village price is paid at training. It stays banked if he dies or is cancelled. x1.6 per extra Chieftain held (v36).
- **Premium:** 5 build slots, an Auto page (now goal-based, `8420e52`), raid lists, wide overview.
- **Drillyard page:** research grid over ranks. Rider roster changes. Market send. Recruit max.
- **Flames shop** (lobby, Stripe test mode):
  - 5 net packs: 3, 6, 12, 25, 60 EUR → 100 / 220 / 480 / 1,100 / 3,000 Flames;
  - VAT by country added on top (Stripe Tax when `STRIPE_TAX=1`);
  - Premium 30 days = 150 Flames, no auto-renew;
  - no self-service refunds (support command only);
  - disputes lock paid features (fees + 4 EUR to settle);
  - under-18: parent tick + 30 EUR/month cap.
- **Docs:**
  - `docs/PAYMENTS_PLAN.md` (accepted);
  - `docs/legal/` drafts (terms, refunds, privacy, checkout texts; AI-written, not legal advice).

## Merged 2026-11-20 evening (main `7207ad9`, in the owner's preview, NOT pushed: waits for his OK)

- **Privacy** (`claude/mystifying-davinci-fce37a`):
  - self-hosted fonts (run `npm install` after pulling: new @fontsource packages);
  - lobby `#account` with download my data and delete account (the shop's rows are kept 7 years);
  - "While you were away" card with Start again;
  - no 24-month closure;
  - schemas: lobby v9, world v39.
- **Feast in all villages** (`claude/trusting-rubin-e46b57`): Banner Hall switch "This village | All villages", Premium only.
- **Drillyard ranks polish** (`697aaa9`): cards grouped by role (Defence/Attack/Scouting/Breach), one card layout, 3 columns. Known: at Drillyard level 5 with 5 researchable units the Ranks panel is clipped by ~10 px at 1440x900.
- **Pathfinder back at the Barracks** (owner undid the Stables move), **Drillyard Reset = small ↺ button with confirm**, **'foot'/'rider' tag next to unit attack** + explainer line (unit cards, Army recruit). In the preview, not pushed.
- **Roster (owner 2026-11-20):** the Stables now train ONLY the Elk Rider.
  - Ember Guard is back at Barracks 8 + Town Hall 8, on foot.
  - Hearthwarden is at Barracks 5, on foot; its numbers are unchanged.
  - Pathfinder is at Barracks 2, on foot.
  - Merged and in the preview, not pushed.
- Nothing in flight. All side sessions are archived (reopen from the Archived list if needed).

## NEXT JOB (owner decided, not started)

**Two new Stables riders**, each drawn ON a mount (the owner laughed at foot soldiers trained in the Stables):
1. a **mounted scout**: faster and pricier than the foot Pathfinder, which stays the cheap Barracks scout;
2. a **heavy mounted attacker**: costs gold, at a late Stables level.

Rules for the job:
- Original names, numbers and art, same toy style (`docs/ART_DIRECTION.md`).
- Balance with `npm run sim` before showing the owner.
- No new mechanics: attack/defence/speed/carry only (memory "keep mechanics simple").
- Needs: engine units + migration for existing worlds, Drillyard rank tracks, bots, unit cards, recruit page, GAME_DESIGN, BALANCE.
- Show before → after pictures and the sim numbers, then ask the owner.

## Decisions made today (don't re-ask)

- Side sessions NEVER ask the owner. The main session batches questions as numbered choices (AskUserQuestion) with before → after.
- Payments:
  - Stripe direct; currency **Flames**;
  - Flames buy Premium + looks only;
  - no refund button.
- Company is Estonian. VAT (OSS) registration and Stripe Tax come later; live payments stay off (`PAYMENTS_LIVE`) until then.
- Accounts are never closed for inactivity. Only per-world villages are abandoned after 30 days.
- Weak/strong hint on abandoned villages: dropped.

## Open items for the owner

- Company name, registry code, address and contact email for `docs/legal/*` (placeholders `[Company name]` etc.).
- Before real sales: enable Stripe Tax, register for OSS, check the VAT rate table (`apps/lobby/src/shop/vat.ts`), then set
  `STRIPE_TAX=1` and `PAYMENTS_LIVE=1` with live keys himself.
- No email provider yet: receipt, dispute and refund emails are not sent.
- Try in the preview: Drillyard page, Auto goals, Feast in all villages (Banner Hall), the while-you-were-away card (shows only after 30 idle days), then say push.
- Known small issues: Banner Hall header shows "Feast price - -0% at level 1" when unbuilt; GAME_DESIGN has section 18.2 twice.

## Traps

- `npm run check`: the preview bots "run stays fast" test flakes under machine load. It passes when run alone.
- A worktree `../tribewars-chiefprice` still has abandoned uncommitted "price is lost" edits. Never commit them. Removing
  it needs the owner's OK (a permission prompt refused it).
- Many old worktrees and branches are left over (`git worktree list`). Clean up only your own.
