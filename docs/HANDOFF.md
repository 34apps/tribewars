# Handoff — Clanflame

Written 2026-11-20 by the main session ("Village map centering", `local_86849d4a…`). Read this first, then
`docs/AI-WORKFLOW.md`, the top of `CHANGELOG.md`, and `grep` `NEXT_STEPS.md` for your topic.

## State in one minute

- `main` = `origin/main`, everything pushed (owner OK 2026-11-20). Lobby schema v9, game schema v39.
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
- **Roster (owner 2026-11-20, FINAL, genre-style):** Barracks = Pikeman, Raider, Shieldbearer (foot). Stables = Pathfinder (scout), Elk Rider, Hearthwarden, Ember Guard (all riders). The two 'back to Barracks' merges were reverted (`a00df2d`, `cc1ee45`). Never move riders back to the Barracks.
- **Mounted pictures** for Pathfinder (pony), Hearthwarden (elk) and Ember Guard (armoured elk) merged (`a85032a`), pushed. Generator: `design/proposals/mounted-units/gen/build.mjs`. Icons are ~20 KB each (old 4 KB): could be slimmed.
- Nothing in flight. All side sessions are archived (reopen from the Archived list if needed).

## Analytics (owner decided 2026-11-20; merged `d09d8b8`, pushed after his OK; production switch still off)

- Built: the shared sender `packages/analytics`; world schema v40, lobby v10.
- The opt-out reaches worlds as entry-pass claim `ana`. New routes: `POST /api/stats/page` and `POST /lobby/api/account/share-stats`.
- To switch it on in production: `ANALYTICS=1` and the SAME `ANALYTICS_SALT` in the lobby and every world. Then do a test play
  with `ANALYTICS_APP=0.1.0-dev` and ask the card shop session to run `event_counts`.
- Open points:
  - deleting one player's analytics record is manual (`admin_delete_player`);
  - confirm the analytics AWS account is the owner's own (the privacy text relies on it);
  - the 360/1440 px look of the account page switch is not checked in a browser.


- The owner's own analytics service (project `clanflame`) is used for web now and iOS/Android later. Plan and events: `docs/ANALYTICS.md`.
- Owner decisions (don't re-ask):
  - track everyone, no consent card;
  - the lean list;
  - real game only (off in the preview and dev).
- How we do that:
  - events go from OUR world server and lobby, not the browser, so nothing is stored on the device and no card is needed;
  - a quiet opt-out switch in account settings, on by default;
  - the privacy texts are updated.
- Lean list:
  - the sign-up funnel, `world_enter` once a day, `page_open`, `shop_open`, `iap_done`/`iap_refund`, `premium_buy`;
  - build/train/attack numbers come from our own database instead.
- Known cost: no `country`, because our server's address would be read. Getting it back needs the owner's analytics server.
- Never change AWS, the analytics server or keys.

## NEXT JOB

Analytics pushed. Now: check balance with `npm run sim` (the Ember Guard as a rider now meets 'vs riders' defence), then take the owner's next list.

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
