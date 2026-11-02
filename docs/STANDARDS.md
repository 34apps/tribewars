# Engineering standards — read before every change

## Security
- **Server is authoritative.** The client never decides resources, timings or battle results;
  every action is re-checked on the server with engine functions, inside one DB transaction.
- Validate every request body/query (types, ranges, lengths); reject unknown fields' values with
  `invalid_input`. Unknown building/unit ids are errors, never defaults.
- Passwords: `scrypt` with a per-user random salt, constant-time compare. Never log passwords or
  session tokens. Sessions: random 32-byte token in an HttpOnly, SameSite=Lax cookie (`Secure` in
  production); only a SHA-256 hash of the token is stored.
- State-changing requests: POST with JSON body only, and the `Origin` header (when present) must
  match the server's host — blocks cross-site form posts.
- Rate-limit sign-in and registration per IP. Limit request body size.
- Players may only act on their own villages (check ownership on every village action) and only
  see others' public info (no troop counts or resources of other villages, except in battle
  reports the rules allow).
- SQL only with prepared statements and bound parameters.
- Secrets only from environment variables; `.env*` and the database are never committed.

## Performance
- Lazy evaluation: no per-second timers per village. State is settled on read; troop movements are
  processed in arrival order (one cheap indexed query per request plus a 1 s server tick).
- Map requests are bounded (`MAP_MAX_SPAN`) and use the `(x, y)` index.
- The client ticks counters locally (engine `settleVillage`) and polls the server about every 10 s,
  not every second. The map is one `<canvas>`, redrawn only on change.
- Keep the web bundle small: no UI framework beyond React, no heavy libraries without a reason
  written in the changelog.

## Code
- TypeScript strict. Engine functions are pure and never mutate inputs.
- Tests: engine rules have unit tests; server routes have integration tests (in-memory DB,
  controllable clock).
- Mobile-first UI: works at 360 px wide, touch targets ≥ 40 px, no hover-only features.
