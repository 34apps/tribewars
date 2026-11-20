# Payments plan (draft, 2026-11-20)

Status: **proposal, nothing built.** The company is registered in **Estonia** (EU). Fees and contract terms below
are from general knowledge; confirm each with the provider's sales team before signing. A lawyer checks the
terms, refund policy and privacy policy before the first paid purchase.

## 1. Decisions proposed

| Topic | Proposal |
|---|---|
| What we sell | One in-game currency ("points", name to pick) in packs. No subscriptions. |
| Premium | Bought with points for 30 days at a time, **never renews by itself**. Covers today's premium tools (5 build slots, auto mode, raid lists, wide map). |
| Seller | **Stripe direct** (owner pick 2026-11-20). We are the seller: we handle refunds, disputes and EU VAT (OSS) ourselves. Xsolla/Paddle stay the fallback if disputes grow. |
| Refunds | Unspent points: refunded on request within 14 days, one button. Spent points: never. |
| Disputes | Points removed, balance may go negative, paid features locked until settled; repeat = ban. |

## 2. Stripe direct: what we must set up (owner pick)

- **EU VAT:** register for the One-Stop-Shop (OSS) in Estonia; Stripe Tax calculates the VAT per buyer country; prices shown to players include VAT.
- **3-D Secure on every card payment** (fraud disputes then fall on the bank), **Radar** rules (block mismatched country/IP, cap new accounts), statement name **CLANFIRE**.
- **Disputes:** webhook `charge.dispute.created` removes the points at once; the lobby submits the evidence pack (section 5) through the Stripe API automatically.
- **Watch the dispute rate:** alert the owner above 0.5% of payments in a month (card schemes act around 1%).
- **Terms:** like Tribal Wars' terms, a chargeback without reason costs the player the provider's fee plus a handling fee before the account is unlocked.

## 2b. Fallback: a merchant of record (MoR)

- **Disputes count against their account, not ours.** A wave of "refund for no reason" bank disputes cannot freeze our money or close our account.
- They handle **EU VAT for every country** (otherwise we register for the EU One-Stop-Shop in Estonia and file VAT for each buyer country ourselves), receipts, refund requests and the dispute paperwork.
- Xsolla is built for games: many local methods, including **prepaid vouchers and mobile billing, which cannot be disputed**, plus its own fraud checks.
- Cost: roughly 5% or more per payment against about 1.5-3% for Stripe. Worth it while we are small and have no dispute history.

**Ask Xsolla (and Paddle) before signing:**
1. Do they take the **money loss** of a dispute or fraud, or only do the work and charge it back to us?
2. Exact fee per method, payout schedule, minimum payout, reserve/hold rules.
3. Do they accept an Estonian company for an in-game currency web game (Paddle may not take games)?
4. Webhooks for: payment, refund, dispute opened/won/lost, so the game can react within seconds.
5. Can we send our own evidence (purchase, spending and login logs) into their dispute process?

**Later, Stripe direct** (cheaper) once we have months of low disputes: needs 3-D Secure on every card payment, Radar fraud rules, the statement name "CLANFIRE", and OSS VAT registration (Stripe Tax can calculate it).

## 3. Points rules (EU consumer rules)

The EU consumer authorities (CPC network) published principles for in-game currencies in 2025. To follow them:
- **Every price also shows the euro amount** next to the points (in the shop, at every purchase button).
- Pack sizes fit the prices of what you buy, so players are not forced to buy leftover points they cannot use.
- No fake urgency (no countdowns to force a purchase), no hiding the real cost.
- Points do not expire while the account exists.
- Players under 18: purchase needs a parent's consent statement; a monthly spending cap for young accounts.

**Never for sale** (keep the game fair): troops, resources, protection time, battle strength, Renown. Premium tools
are convenience only. Note: `GAME_DESIGN.md` 18.6 still says "cosmetics only, no paid queues"; the owner chose the
premium 5-slot queue on 2026-11-20, so 18.6 must be updated when this plan is accepted.

## 4. Refund policy

- At checkout a **required tick box**: "I want my points now. I understand I lose my 14-day right of withdrawal for points I use." (EU rule for digital content; stored with date and terms version.)
- **Unspent points**, within 14 days of purchase: "Refund unspent points" button in the account page. Refund goes through the provider, points removed at once. Cheaper than any dispute.
- **Spent points**: not refunded. Support may make exceptions (technical fault, proven bug); every exception is logged.
- **Bank dispute**: on the provider's webhook the purchase's points are removed at once. If they were already spent the balance goes negative; premium and new purchases stay locked until the balance is back to zero. A second dispute on one account: account banned from paying; fraud: account banned.

## 5. Data we keep (for refunds and disputes)

Kept in the lobby database (account level, all worlds):
- **Purchases:** provider id, pack, amount, currency, country, IP, time, consent tick (time + terms version), receipt sent.
- **Points ledger:** every change with reason (bought, spent on X in world Y, refunded, removed by dispute, support grant). Balance is always the ledger sum.
- **Login history:** time, IP, device/browser, world entered.

From these the lobby builds an **evidence pack** per purchase (bought, consented, logged in, spent on ...) for the provider's dispute process.
Retention: accounting records about 7 years (Estonian accounting law; confirm), login history shorter (for example 2 years). The privacy policy names this as fraud prevention and legal duty.

## 6. How it fits the code

- **Lobby** owns the balance, ledger, purchases and the provider webhook (signature verified, idempotent on the provider id, rate limited). Card data never touches our servers (hosted checkout).
- **Worlds** never hold money: spending points (for example "Premium 30 days in world X") is a lobby call; the lobby records it and the signed entry pass tells the world what is active. Today's per-world `players.premium` bits are set from that.
- Security gate (`SECURITY_ROADMAP.md` §4): webhook signatures, replay protection, prices only from a server catalogue, no "owned" from the client, admin grants logged.

## 7. Open questions for the owner

1. ~~Packs~~ (decided 2026-11-20): 3 EUR = 100 pts, 6 = 220, 12 = 480, 25 = 1,100, 60 = 3,000; Premium 30 days = 150 pts. Still open: the currency's name.
2. ~~Points buy~~ (decided 2026-11-20): Premium days + looks (18.6 cosmetics). Never troops, resources, protection, Renown.
3. ~~Seller~~: Stripe direct (decided 2026-11-20).

## 8. Tribal Wars reference (research 2026-11-20, mobile store prices; browser table not found)

- Points packs (App Store, USD): 80 = 2.99, 200 = 5.99, 600 = 9.99, 1,500 = 19.99, 8,000 = 79.99 (per point drops from 3.7 to 1.0 cent).
- Premium Account 30 days about 4.99 USD; a second paid tier (Account Manager: automates building and recruiting) on top; a points-to-resources exchange (we will NOT copy this: it sells resources).
- Terms (InnoGames GTC): 14-day withdrawal ends once the service starts with the player's consent; points are not money and are only paid back if the game closes; chargeback costs the player provider fees + 4 EUR.
