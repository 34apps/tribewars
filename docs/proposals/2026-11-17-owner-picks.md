# Owner picks after the genre comparison (2026-11-17)

Source proposals: `economy-vs-genre.md` (merged), `troops-vs-genre.md` (branch `claude/brave-boyd-1f323b`),
`experience-vs-genre.md` (branch `claude/magical-raman-46d1ef`). The owner answered choice questions in the main session.

## Numbers (decided)
- Population room: 720 x 1.1244^(L-1) (3,717 at Longhouse 15, ~12,000 at 25). DONE (merged).
- Whole village ~25 builder-days (`HALL_TIME_FACTOR` 0.9566). DONE.
- Map village pictures spread over the climb (castle from 11,250 points). DONE.
- Server speed pass merged (schema v20-v22). Cancel refund stays 80%, taken from the price paid. DONE.
- **Ember Guard** 70/60/60 -> 140/90/90, same price (gold-capped). TO BUILD (troops branch).
- **Firecart** siege power 1 -> 2. TO BUILD (troops branch).
- **Abandoned villages have no defenders at all** (only their Wall); they never recruit. Villages of players away 30 days still
  become abandoned and keep their troops until beaten (`ABANDON_IDLE_DAYS`, unchanged). Lower their loot until the sim targets hold.

## Features (decided)
- **"You need N troops" hint** in the send form after scouting. BUILD.
- **Raid again** button on raid reports + **clear report titles** (won/lost, loot). BUILD.
- **Raid lists** (saved abandoned villages, send all with one press): **a paid extra (real money)**. No shop yet: build it behind a
  per-player entitlement + per-world switch, enforced on the server; on for the owner in the preview. BUILD.
- **Incoming-attack page** (which village, when, what can I do now). BUILD.
- **"Will my help arrive in time?"** on the support form. BUILD.
- **Realm overview** (all villages side by side). BUILD.
- **Notes and tags** on villages and players. BUILD.
- NOT now: phone alerts / installable app (later, with the native mobile app); "do it in all villages"; honest strength labels and
  the fair first raid are covered by "no defenders" (labels must simply stop claiming "Strong").

## Rules for every piece
Own design (never Tribal Wars/Travian names, text or layouts); keep mechanics simple; each feature its own page that fits
1440x900 without scrolling, phone 360 px; Parchment look; server tests for every new endpoint; security gate
(`docs/SECURITY_ROADMAP.md` §4). Questions for the owner go through the main session as choice questions, never asked in a side session.
- 2026-11-18: owner kept NO limit on resources received from other players (unlimited Feasts + shipments accepted as a risk; revisit if pushing becomes a problem).
