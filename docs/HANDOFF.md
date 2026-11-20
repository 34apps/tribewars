# Handoff — Clanflame

Written 2026-11-20 by the main session ("Village map centering", `local_86849d4a…`). Read this first, then
`docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## State in one minute

- `main` = `origin/main` = `e437ffb` (pushed). Lobby schema v9, game schema v37 (privacy branch brings v38).
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

## In flight (side sessions; they report to the MAIN session, never to the owner)

1. **Privacy** — session `local_10fc4a9d-cb07-4f58-aac7-51f2c927cdcf`, branch `claude/mystifying-davinci-fce37a`.
   - Already built:
     - self-hosted fonts;
     - account deletion + data export (lobby `#account`, tombstone row keeps purchases 7 years);
     - `cf_device` cookie created only at sign-in;
     - signed lobby→world delete command.
   - This round:
     - merging main into its branch (it conflicted in 15 files; lobby stays v9, world v38);
     - wiring the shop into `AccountDataHooks`;
     - removing the 24-month closure (owner: dropped);
     - NEW "welcome back" summary in a world after the 30-day abandon, with "start again like a new player".
   - **MERGE-READY (reported 2026-11-20): head `700397c`** (contains `e437ffb`).
     - Schemas: lobby v9, world v39 (39 = `abandoned_villages`). Its report says 2,203 tests pass.
     - Shots of the "while you were away" card are under the privacy session's scratchpad `shots/return/`.
     - Next step: look at the shots, merge `--no-ff`, run check and build, back up the world, rebuild the preview, show the owner.
2. **Feast in all villages (Premium)** — session `local_89979f9f-10b1-4d4e-bd0f-b2035f55e686`, branch `claude/trusting-rubin-e46b57`.
   - Owner picks:
     - a list of all villages;
     - max Feasts each village can pay, editable;
     - a switch "This village | All villages" at the top of the Banner Hall;
     - greyed list + shop link without Premium.
   - It was fixing layout bugs its shots found. Next step: same merge flow.

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
- Try in the preview: the Drillyard page, Auto goals, and everything above that he hasn't seen.

## Traps

- `npm run check`: the preview bots "run stays fast" test flakes under machine load. It passes when run alone.
- A worktree `../tribewars-chiefprice` still has abandoned uncommitted "price is lost" edits. Never commit them. Removing
  it needs the owner's OK (a permission prompt refused it).
- Many old worktrees and branches are left over (`git worktree list`). Clean up only your own.
