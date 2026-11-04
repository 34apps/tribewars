# Deployment & mobile plan

Written 2026-11-04. Goals from the owner: (1) deploy to **AWS**; (2) a **native mobile app** later,
in a separate project, using the same backend. This repo keeps the web client + backend.
Status: ✅ done · 🟡 partly · ☐ open. Sizes: S ≈ hours, M ≈ 1–2 days, L ≈ a week+.

## 1. Verdict

The split is already right: `apps/server` (API + game state), `apps/web` (client), `packages/engine`
(pure rules + types, zero runtime dependencies). The web client imports nothing from the server and no
Node/DB code; it talks to the server only over `/api` with relative URLs. No folder move is needed.
`apps/preview` reaches into `server/src` and `web/src` by relative path — fine, it is a dev tool and
never deployed.

What's missing is deployment plumbing (build, container, backups) and a mobile-friendly login and API
version. **Keep SQLite and one server process per world for launch** (see `SECURITY_ROADMAP.md` §1):
one writer gives the fair, ordered troop timing for free. Move to Postgres only when one machine is too
small or for a shared account service across worlds.

## 2. Target AWS shape (recommended)

```
player ──► CloudFront (one domain, e.g. play.clanfire.com, TLS via ACM)
             ├─ /*      → S3 bucket (apps/web/dist, private, Origin Access Control)
             └─ /api/*  → one EC2 instance (Docker, apps/server) — or ALB → it
                            └─ SQLite on its EBS volume, backed up to S3
```

- **Same domain for client and API** → session cookie, `SameSite=Lax` and the CSRF Origin check keep
  working; no CORS needed. Set `ALLOWED_ORIGINS=https://play.clanfire.com` because CloudFront may send
  the server a different `Host`.
- **Exactly one server instance per world.** No auto-scaling group > 1, no Fargate + EFS (SQLite WAL
  on network file systems is unsafe). EC2 (or Lightsail) with an EBS volume, Docker `restart: always`.
- CloudFront: `/api/*` behaviour with caching **off**, all headers/cookies/query forwarded;
  `/assets/*` long cache; `index.html` no-cache; SPA fallback (403/404 → `/index.html`) only on the S3
  behaviour.
- Server env in production: `NODE_ENV=production`, `DATABASE_PATH=/data/clanfire.sqlite`,
  `TRUST_PROXY=<hops or CloudFront/ALB CIDRs>`, `ALLOWED_ORIGINS`, `MAX_ACCOUNTS_PER_IP`, world settings.
  Secrets (only `ANTHROPIC_API_KEY` if the advisor is ever on) from SSM Parameter Store / Secrets
  Manager into env, never in the image. Full list: `apps/server/.env.example`.
- Health check for the load balancer / uptime alarm: `GET /api/health` (checks the database).

## 3. Before AWS — ranked

| # | Item | Size | Status |
|---|---|---|---|
| 1 | `ALLOWED_ORIGINS` env for the CSRF Origin check behind CloudFront/ALB | S | ✅ 2026-11-04 |
| 2 | `TRUST_PROXY` accepts hop count or proxy IP/CIDR list (a plain `true` lets players fake their IP via `X-Forwarded-For` and dodge rate limits / the multi-account guard) | S | ✅ 2026-11-04 |
| 3 | `/api/health` checks the database (503 when broken) | S | ✅ 2026-11-04 |
| 4 | `SANDBOX_USERS` (test mode) empty by default in production — the old hard-coded default let anyone who registered that name use test mode | S | ✅ 2026-11-04 |
| 5 | **Compiled server**: bundle `apps/server` + engine to plain JS (esbuild or `tsc` emit), `npm start` runs `node dist/index.js`, not `tsx` | S–M | ☐ |
| 6 | **Dockerfile** (non-root, read-only FS except `/data`, `HEALTHCHECK`), `.dockerignore`; server image does **not** include `apps/web/dist` | M | ☐ |
| 7 | **Backups**: nightly `VACUUM INTO` → S3 (or Litestream continuous to S3), tested restore | M | ☐ |
| 8 | **CI** (GitHub Actions): `npm run check`, `npm run build`, `npm audit`, secret scan; deploy job: web → S3 + CloudFront invalidation, server → image → EC2 | M | ☐ |
| 9 | Security Phase 1 from `SECURITY_ROADMAP.md`: CSP + HSTS, session expiry/rotation, password policy | M | ☐ |
| 10 | Graceful shutdown: on SIGTERM stop the tick, finish requests, close the DB (WAL checkpoint) | S | ☐ |
| 11 | Schema version table + numbered migrations (today: `CREATE IF NOT EXISTS` + add-missing-columns) so production upgrades are predictable | M | ☐ |
| 12 | Infrastructure as code (CDK or Terraform) for S3, CloudFront, EC2, IAM, alarms | M | ☐ |

Not needed for launch: Postgres/RDS (L, rewrite of ~8 store files; only for multi-machine worlds),
Redis (rate limits are in memory, fine with one process), WebSockets (polling every 5–20 s works;
add WebSockets later on the same single process).

## 4. Before the mobile app — ranked

| # | Item | Size | Status |
|---|---|---|---|
| 1 | **Token login for apps**: same server-side session table, but the app gets the token in the login response and sends `Authorization: Bearer …`; Origin check not needed for bearer calls; token stored in iOS Keychain / Android Keystore; web keeps the HttpOnly cookie. Additive, not a switch. **Needs owner OK.** | M | ☐ |
| 2 | **API versioning**: serve routes under `/api/v1` (keep `/api` as alias for the web), plus `GET /api/v1/meta` with `{ apiVersion, minClientVersion }` so old app builds can be told to update (app-store releases lag days behind the server) | S–M | ☐ |
| 3 | **Share the engine** with the mobile repo: add a build (`tsup` → JS + `.d.ts`), publish `@34apps/clanfire-engine` to GitHub Packages (private) with semver; server and web keep using the source. Alternative: put the mobile app in this monorepo later if it is React Native. | M | ☐ |
| 4 | Contract discipline: `engine/src/api.ts` is the contract; breaking changes only in a new version (`/api/v2`); add a contract test listing every route | S | ☐ |
| 5 | Push notifications (attacks incoming, build done) via APNs/FCM — needs device-token endpoint + a sender | L | ☐ |
| 6 | Account features stores require: account deletion inside the app, privacy policy, Sign in with Apple if any third-party login is offered | M | ☐ |

## 5. Decisions for the owner

1. Keep SQLite on one machine for launch (recommended) vs Postgres on RDS now.
2. Add token login for the mobile app (recommended, before mobile work starts).
3. AWS shape: one EC2 + CloudFront + S3 (recommended, cheapest, ~US$15–30/month at start) vs a
   managed container service.
