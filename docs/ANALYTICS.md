# Analytics — Clanflame (web now, iOS/Android later)

Status 2026-11-20: **owner decided**:
- track everyone, with no consent card;
- the lean event list in section 3;
- on in the real game only.

Being built in a worktree; see `docs/HANDOFF.md`.

## 1. The service (from the owner's `CLANFLAME_ANALYTICS.md`)

- The owner's own analytics service on AWS us-east-1, shared by his projects; Clanflame is project `clanflame`.
- Code and rules live in the private repo `34apps/apps34-analytics`: `WIRE_FORMAT.md` (the exact batch format), `clients/web/README.md`.
- Ingest: `POST https://262eqaset3enys6yazdr5suugy0sogto.lambda-url.us-east-1.on.aws/v1/batch`, header `X-Project-Key: ak_LO_lUWSO7_GedhmWiCI0YSNf`.
  The key is write-only.
- Rules:
  - names `^[a-z][a-z0-9_]{0,39}$`, at most 8 params;
  - string values `^[a-z0-9_.]{1,40}$` or a currency like `EUR`;
  - numbers are fine; 1/0, never booleans;
  - never names, chat, emails, village names or coordinates.
- **Do not** change AWS, the analytics server or keys. Anything there goes to the owner first, with the service and its monthly cost.
- Check: one test play marked `app: 0.1.0-dev`, wait about 5 minutes, then ask the card shop session to run `event_counts` for `clanflame`.

## 2. Why the events are sent from OUR server, not the browser

The owner wants every player counted with no question asked. The browser library cannot do that legally:
- it saves an analytics id in `localStorage`;
- in the EU that needs consent first (ePrivacy art. 5(3); the company is Estonian).

Sending from our own game server and lobby stores nothing on the player's device, so no card is needed. The legal basis
is legitimate interest. That needs three things: a notice in the privacy policy, a 'Share play stats' switch in account
settings (on by default, no popup), and honouring it.

Other upsides:
- the events are the server's facts (cheat-proof);
- moments that happen while the player is away are counted;
- purchases come from the confirmed Stripe webhook;
- no CSP change;
- iOS/Android later get the same events for free.

Costs:
- `country` is lost, because the service reads it from the sender's address, which would be our server's. Getting it
  back would need a change on the owner's analytics server; that is his call;
- there is no browser OS or language data.

The debate (product / privacy / engineering):
- no per-click tracking. The service's own README says a few events a minute at most;
- **most game numbers are already in our own database** (buildings, troops, attacks, reports, tribes). We can query those
  any time. Analytics should send only what the database cannot easily answer: where new players quit, who comes back,
  which pages are used, and the money funnel.

## 3. Events (final, lean)

- `iid` = the first 32 hex of HMAC-SHA256(`ANALYTICS_SALT`, lobby account id). It is the same player across worlds and
  devices, and it can't be turned back into the account id.
- `plat` `web`.
- `lvl` = the Hall level of the player's best village.

| Event | Params | Sent by | Why we need it |
|---|---|---|---|
| `register_done` | none | lobby | top of the funnel |
| `ftue_step` | `step`: `world_joined`, `first_build`, `first_build_done`, `first_train`, `first_raid`, `first_report`, `tribe_joined`, `second_village` | world server, once per player ever | where new players stop |
| `world_enter` | `world` (id) | world server, at most once per player per world per UTC day | daily active players and day 1/7/30 retention, per world |
| `page_open` | `page` (fixed page id) | client → our server → analytics, first open per page per session | which pages are used: the only thing the database cannot know |
| `shop_open` | `from` (page id) | lobby | money funnel: shop seen |
| `iap_done` | `product` (`flames_100`…`flames_3000`), `price_micros` (net, ex-VAT), `currency` `EUR`, `first` 1/0 | lobby, from the confirmed Stripe webhook | revenue |
| `iap_refund` | same as `iap_done` | lobby, on a refund or a lost dispute | correct revenue |
| `premium_buy` | `days` 30 | lobby | what Flames are spent on |

Dropped on purpose (the database already has them):
- `build_start`, `train`, `research`, `move_sent`, `market_send`;
- the tribe events, village gained/lost and `flames_spend`.

Add one later only when a real question needs it.

## 4. Build checklist

- One small sender module, used by both the world server and the lobby:
  - an in-memory queue;
  - a batch per `iid` at 20 events or every 30 s;
  - `seq` = the flush time in ms × 1000 + a counter, the same on retry;
  - retry only on network errors, 429 and 5xx, with backoff;
  - a bounded queue (drop and count `dropped`);
  - a timeout;
  - it never blocks or fails a game request.
- Off unless `ANALYTICS=1` and `ANALYTICS_SALT` are set. Not set in dev, `dev:fast`, the preview or tests.
- `POST /api/stats/page`:
  - the page id is checked against a fixed list;
  - the caller must be signed in;
  - rate-limited;
  - it drops quietly when tracking is off.
- The opt-out switch is stored on the lobby account, and the world servers read it.
- Privacy texts:
  - replace 'We run no analytics or tracking tools' and 'No ads, no tracking';
  - name AWS us-east-1 (EU-US Data Privacy Framework);
  - state the opt-out;
  - update `docs/PRIVACY.md`.
- Server tests for every new endpoint and for the sender (validation, no-op when off, opt-out honoured).
- Run the security gate (`docs/SECURITY_ROADMAP.md` §4).
- Native apps later:
  - same events, `plat` `ios`/`android`;
  - App Store label 'Usage data, not linked to identity';
  - no ATT prompt.
