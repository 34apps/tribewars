# Analytics plan — Clanflame (web now, iOS/Android later)

Status 2026-11-20: **plan only, nothing wired.** Waiting for the owner on the three choices in section 4.

## 1. The service (from the owner's `CLANFLAME_ANALYTICS.md`)

- The owner's own analytics service on AWS us-east-1, shared by his projects; Clanflame is project `clanflame`.
- Code and rules live in the private repo `34apps/apps34-analytics`: `clients/web/README.md`, `WIRE_FORMAT.md`.
- Ingest URL: `https://262eqaset3enys6yazdr5suugy0sogto.lambda-url.us-east-1.on.aws/`
- Project key `ak_LO_lUWSO7_GedhmWiCI0YSNf`. It is write-only, so it is safe to ship in the client.
- Client: copy `clients/web/apps34-analytics.js` into `apps/web/src/analytics/`, then `init` / `track` / `step` / `setLevel` / `setConsent`.
- Rules:
  - names `^[a-z][a-z0-9_]{0,39}$`, at most 8 params;
  - text values are fixed ids only (`[a-z0-9_.]`) or a currency like `EUR`;
  - use 1/0, never true/false;
  - never names, chat text, emails, village names or coordinates.
- What it stores:
  - in the browser: a random install id in `localStorage`;
  - on the server: country (no IP stored), OS name and version, language, time zone offset.
- **Do not** change AWS, the server or keys. Anything server-side goes to the owner first, with the service and its monthly cost.
- Check that it works: play once, wait about 5 minutes, then ask the card shop session to run `event_counts` for `clanflame`.

## 2. The debate (product / privacy / engineering)

**Product:** "We need retention (day 1/7/30), the first-hour funnel, and where new players stop. We need to know which
pages are really used: Drillyard, Auto, Market. We need purchases."

**Engineering:** "Not per click. The service's own README says: a few events a minute at most, never per frame or per
menu click. Clicks are noise and cost money. A strategy game has natural 'moments': a build starts, troops are trained,
an attack is sent, someone joins a tribe, a purchase. Pages: one `page_open` per page per session, not every visit."

**Privacy:** "This collides with what we already wrote.
- `docs/legal/privacy.md` says 'We run no analytics or tracking tools'.
- The sign-in note says 'No ads, no tracking'.
- `docs/PRIVACY.md` s.3 decided 'no consent banner', because our only browser id is strictly-necessary security storage.

An analytics install id in localStorage is NOT strictly necessary. Under ePrivacy art. 5(3) (EU players; the company is
Estonian) that needs the player's consent first. The data also goes to AWS in the US (covered by the EU-US Data Privacy
Framework, but it must be named in the policy)."

**Engineering:** "The library already handles that. With `consent: 'unknown'`, events wait in memory: nothing is stored,
nothing is sent. `granted` sends them; `denied` deletes the queue. So a one-time, friendly choice after the first sign-in
costs us one small card."

**Product:** "A banner loses part of the data: people who say no, or never answer."

**Privacy:** "That is the price of being honest. The other way is to send events from our own game server. Then nothing
is stored in the browser and no banner is needed (legitimate interest plus a notice and an opt-out). But the library is
browser-only, the server would have to build batches itself, and session and device data get harder."

**Engineering:** "Purchases are a special case. The real record is the lobby ledger (Stripe webhook). The client sends
`iap_done` only after the shop shows the confirmed purchase, so analytics never counts a payment that failed. Analytics
is a picture, never the source of truth."

**All three agree:**
- no per-click tracking;
- about 15 named moments plus throttled `page_open`;
- off in the preview and in dev, so the owner's test play does not pollute the numbers;
- the same event names for iOS/Android later, only `plat` changes;
- CSP `connect-src` in `apps/server/src/security.ts` and `apps/lobby/src/security.ts` must allow the ingest URL;
- the privacy texts must change in the same commit.

## 3. Proposed events (draft; owner approves)

Sent automatically by the library: `game_install`, `session_begin`, `session_end`.

**Funnel, once per player ever (`step`):**
- `register_done`;
- `world_joined`;
- `first_build`;
- `first_build_done`;
- `first_train`;
- `first_raid`;
- `first_report`;
- `tribe_joined`;
- `second_village`.

**Moments (`track`):**

| Event | Params | When |
|---|---|---|
| `world_enter` | `world` (id, e.g. `w1`) | once per session, after entering a world |
| `build_start` | `building` (BUILDING_IDS), `level`, `premium` 0/1 | a build order is accepted by the server |
| `train` | `unit`, `count` | a recruit order is accepted |
| `research` | `unit`, `rank` | Drillyard research accepted |
| `move_sent` | `kind` (`attack`/`support`), `target` (`abandoned`/`player`/`bot`/`own`), `units` | attack/support accepted |
| `market_send` | `res` (wood/food/iron/gold) | trade sent |
| `tribe_create` / `tribe_join` / `tribe_leave` | none | tribe action accepted |
| `village_gained` / `village_lost` | `how` (`conquer`/`found`) | the client sees the change |
| `page_open` | `page` (fixed page id) | first open of each page per session |
| `shop_open` | `from` (page id) | shop opened |
| `iap_done` | `product` (`flames_100`…`flames_3000`), `price_micros` (net, ex-VAT), `currency` `EUR`, `first` 1/0 | the shop shows a confirmed purchase |
| `premium_buy` | `days` 30 | Premium bought with Flames |
| `flames_spend` | `item` (fixed id) | Flames spent on looks |

- `setLevel`: the main village's Hall level (`hall`). It is added to every event.
- Never sent: account id, names, coordinates, chat, report contents.

## 4. Decisions needed from the owner

1. Consent:
   - a one-time choice card after the first sign-in (recommended);
   - or server-side events with no banner;
   - or 'granted' for everyone (not recommended for EU players).
2. The event list in section 3: OK as is, smaller, or larger.
3. On in production only, off in the preview and dev (recommended).

## 5. After approval (implementation checklist)

- Copy the client file.
- Add `apps/web/src/analytics/index.ts`:
  - one wrapper that no-ops unless `VITE_ANALYTICS=1`;
  - a fixed event-name union type, so names cannot drift.
- Hook the events into the accepted-response paths, not the button clicks.
- Add the CSP `connect-src` entry, with a server test.
- Add the consent card and a Settings toggle, with phone and desktop shots.
- Update `docs/legal/privacy.md` (analytics section, AWS US, retention, opt-out), the sign-in line and `docs/PRIVACY.md` s.3.
- Do the security gate (`docs/SECURITY_ROADMAP.md` §4).
- Do a test play with `app: '0.1.0-dev'`, then `event_counts`.
- Native apps later:
  - reuse this event list;
  - App Store privacy label 'Usage data, not linked to identity';
  - no tracking prompt (ATT) is needed: no ad id and no linking across apps.
