# Clanflame Privacy Policy

> Draft written by AI on 2026-11-20, not legal advice; review before the first real sale.

Version: **2026-11-20 (draft v2)** · Written for the GDPR (EU 2016/679) and the Estonian Personal Data Protection Act.

Placeholders to fill before publishing: `[Company name]`, `[registry code]`, `[address]`, `[contact email]`.

This policy describes what the game stores **at the time of the first sale** (the shop, with Flames, is part of it). Sections marked **(when live)** describe tools that must exist before we sell anything; see the note for the owner at the end of this file.

---

## 1. Who is responsible

**[Company name]**, registry code **[registry code]**, **[address]**, Estonia ("we"). We decide why and how your data is used (the "controller"). Contact for anything about your data: **[contact email]**. We have no data protection officer; the same address reaches the person who handles this.

## 2. The short version

- We keep what a game with accounts needs: a **username**, a **password** (stored only as a scrambled hash we cannot read), your **game actions** and the **messages** you write.
- We do **not** ask for your real name, address, phone number or birth date. We have **no email on your account**. If you buy Flames, the payment page asks for an email so that we can send a receipt.
- We never see your **card number**. **Stripe** handles payments.
- To stop cheating and fraud we keep **IP addresses and a random browser id** for a short time (30 days), and a longer login record for accounts that **paid** (2 years).
- Records of purchases are kept for **7 years** because the law makes us.
- You can ask to see, fix, download or delete your data (section 11).
- We do not sell your data and we do not use it for advertising. We run no analytics or tracking tools.

## 3. What data we keep, why, and on what legal ground

### 3.1 Your account (all worlds)

| Data | Why | Legal ground (GDPR art. 6) |
|---|---|---|
| Username, password hash (scrypt), chieftain portrait choice, created and last login time | Run your account; let you sign in | Contract (the game) |
| Which worlds you entered and when | Show "your worlds", route you | Contract |
| Badges, Hall of Fame entries, cosmetic looks you own | Your results and purchases | Contract |
| Staff role, ban and mute status and reason | Enforce the terms | Legitimate interest (fair play, safe community) |
| Sign-in attempt counter for a name (failed tries) | Stop password guessing | Legitimate interest (security) |

Your username is **public**: other players see it on the map, in rankings, in tribes, in reports and mail.

### 3.2 Playing in a world

| Data | Who sees it | Why | Legal ground |
|---|---|---|---|
| Villages, buildings, troops, movements, reports, statistics, achievements | The game rules decide: some of it is public on the map and in rankings (your name, tribe, points, village positions), the rest is yours | Run the game | Contract |
| Mail (subject and text), tribe chat, tribe forum posts, tribe descriptions and applications | Mail: sender and recipient. Chat and forum: the tribe. Staff only when reported | Run the game | Contract |
| Private notes, tags, troop groups, raid lists | Only you | Run the game | Contract |
| Reports to staff about a message or player (reporter, who was reported, a copy of the text, the category, your note), support tickets and the answers | Moderators and administrators | Handle abuse and complaints | Legitimate interest |
| Last-active time | The game (to decide when a village is abandoned) | Run the rules about inactivity | Contract |
| "Ask Mags" questions, if the advisor is switched on: a snapshot of your game state and your question | Our service provider Anthropic (section 7) | Answer you. Only your question's count is kept, not the text | Contract |

### 3.3 Security and fair play (staff only)

| Data | Kept | Why | Legal ground |
|---|---|---|---|
| IP addresses per account (first and last seen) | **30 days** after last use | One account per person; find hacked accounts and attacks | Legitimate interest |
| A random **browser id** (we store only a hash of it) and a cookie `cf_device` | Hash **30 days**; the cookie lasts up to 400 days in your browser | Link several accounts on one device | Legitimate interest |
| 10-minute activity slots, a log of attacks and shipments between pairs of accounts | **30 days** | Judge multi-account and "pushing" cases | Legitimate interest |
| Audit log of important actions (sign-ins, bans, admin actions) with the IP | Entries stay; the **IP is erased after 30 days** | Prove what happened, fix mistakes | Legitimate interest |
| Server logs (requests, which may include your IP) | A few weeks, then they roll over | Keep the service running, find errors | Legitimate interest |

We do **not** fingerprint your browser beyond this random id. Nothing here bans you automatically: a person looks. IPs and device hashes are shown only to our staff, never to players.

### 3.4 Buying Flames (when live)

| Data | Kept | Why | Legal ground |
|---|---|---|---|
| Purchase record: Stripe payment id, pack, net price, VAT amount, VAT rate and country, currency, time, the **IP at purchase**, your **consent tick** (time and terms version), receipt sent | **7 years** | Accounting, tax, prove the purchase and your consent, defend against disputes | Legal duty (Estonian accounting law); legitimate interest for the consent proof and the IP |
| Email address you entered at checkout | **7 years** with the purchase record | Send your receipt and notices about this purchase | Contract; legal duty |
| Flames ledger: every change to your balance and the reason (bought, spent on what in which world, refunded, removed after a dispute, support gift) | 7 years for entries linked to a purchase; the rest while the account exists | Show your balance; settle refunds and disputes | Contract; legitimate interest |
| **Login history of accounts that bought something:** time, IP, browser type, world entered | **2 years** | Fraud prevention and the evidence we send to Stripe in a dispute | Legitimate interest |
| Parental consent confirmation for players under 18 | As long as the purchase record | Prove the rule was followed | Legal duty; legitimate interest |

Payment details (card number, bank data) are entered **on Stripe's pages**. We receive from Stripe only the result, a payment id, the last digits of the card, the card brand and country.

### 3.5 What we do **not** do

- No advertising, no ad networks, no data sales.
- No analytics or tracking scripts, no social media pixels.
- No profiling that has a legal effect on you. The one automatic step is payment fraud screening by Stripe (Radar), which may block a payment; you can ask us to have a person look at it.

## 4. Children and young players

- You may create an account on your own from **age 16**. Between **13 and 15** a parent or guardian must agree (you confirm this when you register). Under **13** you may not play.
- Players under **18** may buy only with a parent's consent and within a monthly limit (see the [refund policy](refunds.md)).
- We keep children's data to the same minimum as everybody's. We do not ask a child for more. A parent may ask us at any time to see, fix or delete the data of their child (section 11).

## 5. Cookies and browser storage

We use only what the game needs:

| Name | Where | What it does | How long |
|---|---|---|---|
| `tw_lobby` | cookie, only for the account service | Keeps you signed in | Up to 60 days; signs out after 14 days of no use |
| `tw_session` | cookie, per world | Keeps you signed in to a world | Up to 60 days, or 12 hours when you enter through the account service |
| `cf_device` | cookie | The random browser id described in 3.3 | Up to 400 days |
| Local storage (`clanfire_device`, village choice, notification and map settings) and session storage (sign-out marker) | your browser | Remembers your choices, the browser id | Until you clear it |

These are all set by us, not by anybody else. The sign-in cookies are essential; if you block them you cannot play. The browser id exists to protect the game from cheating. You can delete the cookie and local storage in your browser at any time.

## 6. Who sees your data

- **Other players:** only what the game shows: your username, tribe and tag, points, villages on the map, rankings, badges, reports of fights, and the messages you send.
- **Our staff:** moderators and administrators, for the reasons in section 3. Staff cannot act against staff of an equal or higher role.
- **Service providers** (section 7), only as needed.
- **Authorities, courts, banks, Stripe in a dispute:** when the law requires it or to defend our rights. We give the minimum.
- **A buyer of our business**, if it ever happens, under the same promises.

## 7. Service providers and countries

| Provider | For | Data | Where |
|---|---|---|---|
| **Amazon Web Services** (hosting, storage and backups) | Run the servers, database, backups | Everything on the game servers | EU (Frankfurt, `eu-central-1`) [confirm when hosting is set up] |
| **Stripe Payments Europe, Ltd.** (Ireland) and Stripe, Inc. | Take payments, work out VAT, fraud screening, refunds, disputes | Payment details you enter; your email; purchase data we send | EU and USA. Stripe is also responsible for its own legal duties (anti-fraud, banking rules); see stripe.com/privacy |
| **Anthropic** (only if "Ask Mags" is switched on) | The in-game advisor | Your question and a snapshot of your game state, no name or contact data | USA |

If data leaves the EU/EEA, it goes only to a provider that uses the EU's Standard Contractual Clauses or is certified under the EU–US Data Privacy Framework. We have the contracts that GDPR demands with the providers that work for us.

## 8. How long we keep data (summary)

| Data | Kept |
|---|---|
| Account, game data, messages | While your account exists, until you delete it. In each world, after about 30 days without play your villages become abandoned villages (terms, section 4); your account stays |
| IPs, browser id hashes, activity slots, pair log | 30 days |
| Login history of accounts that bought something | 2 years |
| Reports and tickets sent to staff | 12 months after they are closed |
| Bans (name and reason, so that a banned person cannot simply return) | While the ban lasts and 2 years after |
| Purchase records, receipts, Flames ledger entries, consent ticks, refund and dispute records | 7 years from the end of the financial year |
| Backups | Up to 30 days longer than the live data (backups roll over) |
| Server logs | A few weeks |

When a time is up, the data is deleted or made anonymous.

## 9. If you delete your account

- Your account, username, password hash, worlds list and personal settings are deleted. Your cosmetics, badges and Flames go with it.
- Your villages in running worlds become abandoned villages. Your **name in mail, forum posts, chat and reports is replaced** by "deleted player". Mail you sent may stay in the other person's mailbox without your name. Private notes, troop groups and raid lists are deleted.
- What we keep because the law requires it or because we need it to defend a claim: purchase records and Flames ledger entries linked to purchases (7 years), the login history of paying accounts (2 years), ban records (section 8). They are kept apart from the game and used only for those purposes.
- Backups age out within about 30 days.

## 10. Data security

Passwords are stored with a slow one-way hash (scrypt). Sessions use a token that we store only as a hash. Connections use HTTPS. Sign-in cookies are `HttpOnly` and `SameSite`. The signing key for entering worlds stays on the account server. Access for staff is limited by role. Servers are hardened and backed up. No system is perfect: if a breach puts your data at risk, we tell you and the Estonian Data Protection Inspectorate within the times the law sets.

## 11. Your rights

You can ask us for:

- **Access:** a copy of the data we hold about you.
- **Correction** of wrong data.
- **Deletion** ("right to be forgotten"), except for records we must keep (section 9).
- **Restriction** of how we use it, or **objection** to the uses based on our legitimate interest (the security and fair-play data in 3.3). If you object, we stop unless we have a strong reason that outweighs yours, or need the data to defend a claim.
- **A portable copy** of the data you gave us, in a common file format (the "Download my data" button in the account page, which includes your IPs with first and last seen, browser id labels, notes, mail, and purchases).
- **Withdrawal of consent** (for example parental consent) at any time. That does not undo what happened before.

Use the account page buttons or write to **[contact email]** from an address we can connect to you; we may ask you to prove it is you. We answer within **one month**. It is free, unless the requests are clearly unfounded or excessive.

## 12. Automated decisions

We do not make decisions that have legal effects on you by machine alone. Fraud screening by Stripe may block a payment automatically; you can ask for a human to check. Multi-account and cheating findings are shown to staff as hints; a person decides on every ban.

## 13. Complaints

If you think we are handling your data wrongly, please write to us first at **[contact email]**. You also have the right to complain to a data protection authority, in particular in the country where you live or work. In Estonia: **Andmekaitse Inspektsioon** (Data Protection Inspectorate), Tatari 39, 10134 Tallinn, **info@aki.ee**, www.aki.ee.

## 14. Changes to this policy

We will update this text when the game or the law changes and tell you in the game and by email (where we have one) before a significant change takes effect. The date and version are at the top.

---

### Notes for the owner (delete before publishing)

These points are about the code, not the player text. The policy promises them, so they must be true on the day of the first sale:

1. ~~Account deletion and data export~~ built 2026-11-20 (lobby Account page; `docs/PRIVACY.md`).
2. **The lobby stores no email.** The receipt and dispute notice need one. The shop must store the email Stripe collects at checkout with the purchase record (7 years). If a login email is added later, update section 3.1.
3. **Login history for paying accounts (2 years)** does not exist: today IPs are purged after 30 days. The shop needs its own log (time, IP, browser type, world) kept 2 years, only for accounts with a purchase.
4. Inactive-account deletion after 24 months was DROPPED (owner 2026-11-20): accounts stay until the player deletes them. **12-month report retention** is a default I chose; no job does this yet.
5. `cf_device` cookie and the localStorage device id: decided 2026-11-20, no banner (strictly necessary security storage), created only at sign-in/register/enter, one-line note under the sign-in forms; reasoning in `docs/PRIVACY.md` s.3.
6. ~~Google Fonts~~ fonts are self-hosted since 2026-11-20; the Google row was removed from section 7.
7. **Server logs**: check whether the Fastify logs contain client IPs and how long Docker keeps them (now 10 MB x 5 files); the text says "a few weeks".
8. **Production hosting** (AWS Frankfurt) is a plan, not confirmed; the 30-day S3 backup lifecycle is still open.
9. **Ask Mags** (Anthropic): remove the row if the advisor stays off; if on, a data processing agreement with Anthropic is needed.
10. **Records of processing** (GDPR art. 30) and a short DPA with Stripe/AWS are an internal paperwork duty; not part of this text.
