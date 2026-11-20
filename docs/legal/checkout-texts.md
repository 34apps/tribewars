# Clanflame checkout texts

> Draft written by AI on 2026-11-20, not legal advice; review before the first real sale.

Exact short texts for the shop. Words in `{{double braces}}` are filled in by the code. Do not reword the tick box text without changing the terms version, because the consent we store is tied to this exact wording.

Terms version to store with each purchase: `2026-11-20-v1` (bump it whenever `terms.md`, `refunds.md` or the tick box text changes).

Links used below: `[Terms]` = `/legal/terms`, `[Refunds]` = `/legal/refunds`, `[Privacy]` = `/legal/privacy` (the shop session decides the real URLs).

---

## 1. Price display (every Flames price, every buy button)

Show the euro price next to the Flames amount, always, with VAT included:

- Pack card: `{{flames}} Flames · {{eur}} EUR` and under it in small text `incl. VAT where it applies`
- Spend button: `Buy Premium · 150 Flames ({{eur_equivalent}} EUR)`. Show the euro equivalent as the pack price per Flame that the player paid on average, or the price per Flame of the cheapest pack; the shop session picks one rule and uses it everywhere.
- No countdown timers, no "only N left", no crossed-out fake prices.

## 2. Tick box before paying (required, unticked by default)

**Label (exact text):**

> I want my Flames now. I understand that I lose my 14-day right of withdrawal for Flames that I use.

**Small text under the box (exact text):**

> You can still get a refund for any purchase whose Flames you have not spent, within 14 days. [Refund policy]

**Rules for the code:**
- The pay button stays disabled until the box is ticked.
- Store: account id, purchase id, time (UTC), terms version, the label text shown, and the IP.
- For players under 18 show a second required box before the first purchase and store it the same way:

> I am a parent or guardian, or I have my parent's or guardian's consent to buy Flames.

## 3. Line above the pay button

> By paying you accept the [Terms] and the [Refund policy]. Payment is handled by Stripe; we never see your card details. Flames are an in-game currency, not money.

## 4. Spend confirmation (Premium and looks)

Shown before Flames are spent, with a confirm button.

**Premium:**

> **Premium for 30 days in {{world_name}}** · 150 Flames ({{eur_equivalent}} EUR)
> It starts now and ends after 30 days. It does **not** renew by itself.
> Spending Flames ends your right of withdrawal for them. Flames left after this: {{balance_after}}.
>
> [Cancel] [Spend 150 Flames]

**Look:**

> **{{item_name}}** · {{flames}} Flames ({{eur_equivalent}} EUR)
> This look is yours as long as your account exists. Spending Flames ends your right of withdrawal for them. Flames left after this: {{balance_after}}.
>
> [Cancel] [Spend {{flames}} Flames]

## 5. Refund button texts

- Button on the purchase: `Refund unspent Flames`
- Confirmation dialog:

> Refund {{eur}} EUR to your {{card_brand}} ending {{last4}}? The {{flames}} Flames from this purchase will be removed from your account now. The money usually reaches you within a few days; your bank may need longer.
>
> [Keep the Flames] [Refund me]

- When not possible (some Flames from that purchase are spent):

> This purchase can no longer be refunded because some of its Flames have been spent. If something went wrong, write to {{contact_email}} and we will look at it.

- When too late (more than 14 days):

> The 14-day refund time for this purchase has passed. If something went wrong, write to {{contact_email}}.

## 6. Receipt email

**Sender:** Clanflame <{{noreply_address}}> · **Reply-to:** {{contact_email}}
**Subject:** `Your Clanflame receipt {{receipt_no}}: {{flames}} Flames`

**Body:**

```
Hello {{player_name}},

Thank you. This is your receipt.

Receipt number:  {{receipt_no}}
Date and time:   {{date_time_utc}} (UTC)
Seller:          [Company name], registry code [registry code], [address]
                 {{vat_number_line}}
Item:            {{flames}} Flames (an in-game currency for Clanflame)
Price:           {{eur}} EUR
{{vat_line}}
Paid with:       {{card_brand}} ending {{last4}} (through Stripe)
Player account:  {{player_name}}

Your Flames were added to your account when the payment was confirmed.

Your rights
- You asked for the Flames to be delivered at once and confirmed that you lose
  your right of withdrawal for Flames you use.
- You can still get a full refund within 14 days of today ({{refund_until_date}}) as long as you
  have not spent any Flames from this purchase. Press "Refund unspent Flames" in your
  account page, or write to {{contact_email}}.
- Flames are not money and cannot be exchanged for cash. They do not expire while your
  account exists.
- Please contact us before asking your bank to reverse a payment. A bank dispute removes
  the Flames and can lock paid features and add fees (see the refund policy).

Terms version you accepted: {{terms_version}}
Terms:   {{terms_url}}
Refunds: {{refunds_url}}
Privacy: {{privacy_url}}

Questions? Reply to this email or write to {{contact_email}}.

Clanflame
[Company name]
```

**Notes for the code:**
- `{{vat_line}}` before VAT registration: leave the line out; once registered: `Included VAT ({{vat_country}} {{vat_rate}}%): {{vat_amount}} EUR`. The owner decides when it changes; do not invent a VAT line.
- `{{vat_number_line}}` is empty until there is a VAT number, then `VAT number: [VAT number]`.
- Send to the email the buyer typed at Stripe checkout. Stripe's own receipt may also go out; ours is the one with the terms and refund details.
- Plain text works; if HTML is used, keep the same wording.

## 7. Dispute notice (bank dispute or chargeback)

Sent by email to the purchase email **within one working day**, and shown as a banner in the account page until settled.

**Subject:** `Clanflame: a payment of yours was disputed with your bank`

**Email body:**

```
Hello {{player_name}},

Your bank told us that this payment was disputed:

  Receipt {{receipt_no}} from {{purchase_date}}: {{flames}} Flames, {{eur}} EUR

We did not receive a refund request from you first. Here is what happens now:

1. The {{flames}} Flames from this purchase were removed from your account.
2. Your Flames balance is now {{balance}}. {{minus_line}}
3. Paid features (buying Flames for Premium or looks, running Premium and looks) are
   locked until the account is settled. You can keep playing the free game.
4. Fees: the dispute fee our payment provider charged us ({{provider_fee}} EUR) plus
   a handling fee of 4 EUR. Total open: {{fees_total}} EUR.

How to settle
- If the payment was made by you or with your permission: open "Settle account" in your
  account page and pay the open amount {{settle_amount}} EUR. The lock ends when your
  balance is zero or higher and the fees are paid.
- If you withdraw the dispute with your bank, or the bank decides for you and the money
  comes back to us, your Flames are returned and the fees are cancelled.
- If your card was used without your permission, or you did not make this purchase,
  reply to this email and tell us. We will look at it before charging you anything.

Please note: a second bank dispute on the same account means we stop it from paying.
Payment fraud means we close the account. To avoid all of this, ask us for a refund
first: unspent Flames can be refunded within 14 days with one button.

We may send Stripe the evidence it asks for in a dispute: your purchase record,
your consent, your login times and what the Flames were spent on.

Refund policy: {{refunds_url}}
Questions: {{contact_email}}

Clanflame
[Company name]
```

`{{minus_line}}`: if the balance is below zero: `That is below zero because you had already spent some of them. The minus will be filled by Flames you buy next.` Otherwise leave it out.

**Banner in the account page:**

> A payment of {{eur}} EUR was disputed with your bank. {{flames}} Flames were removed and paid features are locked. Open amount: {{settle_amount}} EUR. [Settle account] [Read what this means]

**Banner after settlement:**

> Your account is settled. Paid features are unlocked again.

**Banner after a second dispute:**

> Because of a second bank dispute, buying is switched off for this account. Write to {{contact_email}} if you think this is a mistake.

## 8. Other short notices

**Refund done (email subject and one line):**
`Your Clanflame refund of {{eur}} EUR is on its way` — "We refunded receipt {{receipt_no}} to your {{card_brand}} ending {{last4}}. Your bank may need a few days to show it. The {{flames}} Flames were removed from your account."

**Premium ending soon (in the game, 3 days before; no email):**
`Your Premium in {{world_name}} ends on {{end_date}}. It will not renew by itself.`

**Game closing for good (email and in the game, at least 30 days ahead):**

> Clanflame will close for good on {{close_date}}. You do not need to do anything: we will pay back the money for your unspent Flames, {{refund_total}} EUR, to the way you paid. If you cannot receive it there, write to {{contact_email}} before {{claim_until_date}}.
