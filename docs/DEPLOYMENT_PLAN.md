# Deployment plan

Written 2026-11-04. Owner goals: deploy to **AWS**, choosing "the best for performance and cost"
(owner, 2026-11-04). **This repo = web client for desktop and phone browsers + the backend.** A native
app comes later in a separate project and will use this backend's API.
Status: ✅ done · 🟡 partly · ☐ open. Sizes: S ≈ hours, M ≈ 1–2 days, L ≈ a week+.

## 1. Decisions (owner delegated the choice, 2026-11-04)

1. **Database: keep SQLite on one machine** for launch. It is the fastest option (inside the server
   process, no network trip per query) and the cheapest (no RDS bill). One writer also gives the fair,
   ordered troop timing for free (`SECURITY_ROADMAP.md` §1). Postgres/RDS only if one machine is too
   small for one world, or for a shared login service across many worlds.
2. **AWS shape: one Graviton EC2 + CloudFront + S3** (below). No load balancer, no managed container
   service, no NAT gateway: they cost more than the whole setup and add nothing for one process.
3. **Native-app items wait** until that project starts (§4); mobile **web** is covered here.

Folder split is already right: `apps/server` (API + game state), `apps/web` (client),
`packages/engine` (pure rules + types, no runtime deps). The web client imports no server/Node/DB code
and calls only relative `/api` URLs. `apps/preview` borrows server and web source, but it is a dev tool
and never deployed.

## 2. Target AWS shape

```
player ──► CloudFront  play.<domain>  (TLS via ACM, HTTP/2+3, brotli)
             ├─ /*      → S3 bucket: apps/web/dist (private, Origin Access Control)
             └─ /api/*  → origin.<domain> → EC2 t4g.small (arm64), Docker Compose:
                             caddy  (Let's Encrypt TLS, gzip/zstd, checks X-Origin-Verify)
                             game   (apps/server, compiled JS, port 3000 internal only)
                             SQLite on EBS gp3 → daily backup to S3
```

- **Region:** eu-central-1 (Frankfurt) by default — low latency for Turkey and Europe. Change it if
  most players are elsewhere.
- **Rough cost at start** (on-demand, before free tier): EC2 t4g.small ≈ $12/mo, EBS 20 GB ≈ $2,
  public IPv4 ≈ $4, S3 + backups < $1, CloudFront free tier covers 1 TB/month. **≈ $20/month.**
  Bigger later: t4g.medium/large (one click, same setup). Savings plan cuts ~30%.
- **Same domain for client and API** → session cookie, `SameSite=Lax` and the Origin check keep
  working, no CORS. CloudFront → origin uses HTTPS; `Host` is the origin name, so the server gets
  `ALLOWED_ORIGINS=https://play.<domain>`.
- **Lock the origin:** EC2 security group allows 443 only from the CloudFront origin-facing prefix list
  (`com.amazonaws.global.cloudfront.origin-facing`), 80 open only for Let's Encrypt; CloudFront adds a
  secret `X-Origin-Verify` header that Caddy checks. SSH via SSM Session Manager (no port 22).
- `TRUST_PROXY=2` (Caddy, then the CloudFront edge; the next address is the player). A player cannot
  fake it: extra `X-Forwarded-For` entries they send sit further left and are ignored.
- **CloudFront behaviours:** `/api/*` → policy CachingDisabled + AllViewerExceptHostHeader, all
  methods. `/assets/*` → cached 1 year (file names carry hashes). Default (`index.html`, sprites) →
  short cache; 403/404 → `/index.html` (SPA) on the S3 behaviour only.
- **Exactly one game container per world.** Never run two against one database (tick, rate limits
  and troop order assume one process). Never put SQLite on EFS.
- Secrets: only `ANTHROPIC_API_KEY` if the advisor is ever on, plus the origin secret; keep them in
  SSM Parameter Store and write `deploy/.env` on the instance — never in git or the image.
- Health: `GET /api/health` (checks the database); Docker `HEALTHCHECK` + a CloudWatch alarm.

## 3. Before going live — ranked

| # | Item | Size | Status |
|---|---|---|---|
| 1 | `ALLOWED_ORIGINS`, `TRUST_PROXY` hops/CIDRs, DB health check, no sandbox default in production | S | ✅ `94f77e4` |
| 2 | **Compiled server** (esbuild bundle incl. engine + npm deps, no `node_modules` needed), `npm start` = `node dist/index.js` | S | ✅ `352b072` |
| 3 | **Dockerfile + `deploy/`** (compose: Caddy + game, Caddyfile, env example) — written, **never built** (no Docker on the dev Mac); first real build on the instance | M | 🟡 `352b072` |
| 4 | **Backups**: `npm run backup` (`VACUUM INTO` in a separate process + check) and `deploy/backup.sh` → S3 daily ✅; still: S3 lifecycle 30 days, **test a restore** | S | 🟡 `352b072` |
| 5 | AWS setup (owner + a session): account, domain, ACM cert, S3, CloudFront, EC2, SSM, alarms — ideally as code (CDK/Terraform) | M | ☐ |
| 6 | **CI** (GitHub Actions): `npm run check`, `npm run build`, `npm audit`, secret scan; deploy: web → S3 + CloudFront invalidation, server → `git pull && docker compose up -d --build` on the instance via SSM | M | ☐ |
| 7 | Security Phase 1 (`SECURITY_ROADMAP.md`): CSP + HSTS, session expiry/rotation, password policy | M | ☐ |
| 8 | Schema version table + numbered migrations (today: `CREATE IF NOT EXISTS` + add-missing-columns) | M | ☐ |

Not needed: Postgres/RDS, Redis, load balancer, auto-scaling. WebSockets later on the same process.

## 4. Phone browsers (this repo) and the native app (later)

Phone browsers already use the same responsive app (360 px rule). For speed on phones:

| # | Item | Size | Status |
|---|---|---|---|
| 1 | Split the 564 kB main JS file (load the tribe tab, scenery and staff screens on demand) | S–M | ☐ |
| 2 | Compressed API replies (Caddy gzip/zstd) and long-cached assets (CloudFront) | S | 🟡 in `deploy/` |
| 3 | Installable web app (manifest + icons; a service worker only for static files) | S | ☐ |
| 4 | Fewer polls on phones: pause when hidden (done for game state), back off chat/tribe polls; WebSockets later | S | ☐ |

When the native app project starts (all additive; the web keeps its cookie login):

| # | Item | Size |
|---|---|---|
| 1 | Token login for apps (`Authorization: Bearer`, same session table, token in Keychain/Keystore) | M |
| 2 | `/api/v1` prefix (keep `/api` for the web) + `GET /api/v1/meta` `{ apiVersion, minClientVersion }` | S–M |
| 3 | Publish the engine (rules + API types) as a private package with a JS + `.d.ts` build | M |
| 4 | Push notifications (APNs/FCM), in-app account deletion, store privacy texts | L |

## 5. First deploy (checklist)

1. Owner: AWS account, a domain (Route 53 or elsewhere), billing alarm at $30.
2. EC2 t4g.small, Amazon Linux 2023 (arm64), 20 GB gp3, Elastic IP, instance role with SSM + `s3:PutObject`
   on the backup bucket. Install Docker + compose plugin and git; `git clone` the repo to `/opt/clanfire`.
3. DNS: `origin.<domain>` → Elastic IP. Security group: 80 from anywhere (Let's Encrypt), 443 from the
   CloudFront origin-facing prefix list only, no 22.
4. `sudo mkdir -p /srv/clanfire/data && sudo chown 1000:1000 /srv/clanfire/data`;
   `cp deploy/.env.example deploy/.env`, fill it in; `cd deploy && docker compose up -d --build`.
5. S3 bucket for the web (private) + one for backups (lifecycle 30 days). `npm run build`, upload
   `apps/web/dist` to the web bucket.
6. CloudFront: ACM cert (us-east-1) for `play.<domain>`; origins S3 (OAC) and `origin.<domain>` (HTTPS
   only, custom header `X-Origin-Verify`); behaviours as in §2; HTTP/3 on; `play.<domain>` → CloudFront.
7. Cron on the host: `deploy/backup.sh` daily (`BACKUP_BUCKET=…`). Restore test: download a backup,
   start a local server on it with `DATABASE_PATH`, sign in.
8. Update: `git pull && docker compose up -d --build` (a few seconds of downtime; in-flight troop
   movements are stored with their arrival time and resolve on restart).
