# Privacy in the code

How the code keeps the promises in `docs/legal/privacy.md` and `docs/legal/terms.md` (AI drafts, 2026-11-20). Contract: section
"Account data" at the end of `packages/engine/src/api.ts`. Security gate notes stay in `docs/SECURITY_ROADMAP.md`.

## 1. What runs where

| Promise (privacy.md) | Where |
|---|---|
| s.7 no Google Fonts | Fonts are bundled from Fontsource (`@fontsource/rubik`, `@fontsource/bagel-fat-one`, latin + latin-ext). CSP allows only `'self'`. |
| s.9 account deletion | Lobby `POST /lobby/api/account/delete` (password + typing DELETE). Worlds get a signed lobby command (below). Worlds with their own accounts (preview): `POST /api/account/delete`. |
| s.11 data download | Lobby `GET /lobby/api/account/export` (account + every entered world in one JSON file); inside a world `GET /api/account/export` (that world only). |
| s.3.3 / s.5 `cf_device` | Section 3. |

No account closure for inactivity (owner 2026-11-20): accounts stay until the player deletes them; per world, villages are abandoned after 30 days without play (GAME_DESIGN s.17).

## 2. Deletion

- **Lobby account**: the row stays as a tombstone (`deleted-<id>`, no password, `deleted_at`), so purchase and Flames ledger rows that
  the law makes us keep for 7 years still point at a valid id. Sessions, IPs, badges, world list and failed-login counters are deleted;
  the old name is replaced by "Deleted player" in the Hall of Fame. A banned account keeps its name and ban (ban records, s.8).
  Deletion is immediate (no grace period). Flames are not refundable once delivered (owner 2026-11-20; refunds only through support),
  so the confirm screen says "Your unspent Flames (N) will be lost and cannot be refunded." and links to no refund button.
  The balance stays in the append-only ledger untouched (the account can never sign in again, so the Flames are simply lost). The shop hooks
  (`apps/lobby/src/shop/account-data-hooks.ts`) delete premium and owned looks, keep purchases, consents, ledger, dispute fees and Stripe events, and keep
  the login history only for accounts with a paid purchase (2-year evidence rule; non-payers lose it at deletion).
- **Worlds**: the lobby queues one `account_delete` command per entered world (`account_deletions`) and sends it until the world
  answers; a world that is down gets it later (backoff up to 6 h). The world abandons every village at once, exactly as after
  `ABANDON_IDLE_DAYS` (GAME_DESIGN s.17), removes private data (notes, groups, raid lists, IPs, devices, activity, own reports, own inbox)
  and keeps the player row as a tombstone named `Deleted player <id>`, so mail they sent, forum posts and chat stay readable under that
  name. Staff reports and tickets stay (12-month rule).
  The old name is also replaced by the tombstone name in other players' reports (player-name fields only, never village names) and in
  tribe event lines. **Known exception:** `world_end.final_json` (frozen results of a finished world) keeps the name as it was, because the
  results are fixed by triggers.
- **Hook for the Flames shop**: `AccountDataHooks` (`apps/lobby/src/account-hooks.ts`) adds shop sections to the export, the Flames balance to
  the confirm screen, and runs inside the deletion transaction (purchases, ledger, consents stay 7 years).

## 3. The `cf_device` cookie (ePrivacy art. 5(3))

Decision: **no consent banner**; the browser id counts as strictly necessary storage, with a one-line notice under the sign-in forms.

Why: art. 5(3) of the ePrivacy Directive (Estonia: Electronic Communications Act s.102^1) exempts storage that is strictly necessary
for a service the user explicitly asked for. The Article 29 Working Party (Opinion 04/2012, s.3.3) names "user-centric security"
cookies as exempt, and the French CNIL's 2020 guidelines exempt trackers that secure the sign-in against unexpected or abusive access.
The id is used only for that: to protect the accounts and the fair-play rule "one account per person" of the game the player signed
up for. It holds no information about the browser (random 128-bit value), only a hash is stored server-side, it is deleted after
30 days of non-use, it is shown only to staff, and it is never used for analytics or ads.

What the code does to stay inside the exemption:
- The id is created only when the player **signs in, registers or enters a world**, never on a bare visit
  (`apps/web/src/device.ts`: `ensureDeviceId` on those calls, `existingDeviceId` elsewhere). The server sets `cf_device` only when the
  header arrives, so a visitor who never signs in gets neither the cookie nor the local storage entry.
- One line under the sign-in forms: "We keep a small security cookie to stop cheating. No ads, no tracking."
- privacy.md s.3.3 and s.5 describe it.

Residual risk: a regulator could see multi-account detection as the operator's interest rather than the user's request. If the owner
wants zero risk, the alternative is to drop the cookie and keep only the local storage id (same legal question) or ask for consent.

## 4. Still open (see NEXT_STEPS.md)

- Server log retention ("a few weeks") and backup lifecycle (30 days) are set in deployment, not in code.
