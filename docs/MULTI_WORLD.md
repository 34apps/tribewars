# Several worlds

Owner decision (2026-11-04): **each world is its own server process with its own SQLite file and its own
container.** Worlds may share a machine or run on different machines. **A world is never split across
processes** (SQLite is single-writer; rate limiters, live sockets and the movement tick live in memory).

## How it works today (part 1: routing and deployment)

- `WORLD_ID` (default `w1`; letters, digits, dash; 1-32 characters; anything else refuses to start) and
  `WORLD_NAME` (default `World <id>`). Set per container in `deploy/docker-compose.yml` / the world's env file.
- Every route answers under `/w/<WORLD_ID>/api/...` **and** the old `/api/...` (kept for the current world, dev
  and tests). The server strips the prefix before routing (`rewriteUrl`), so both paths share one set of
  routes, Origin check, rate limits and `/api/health`. Another world's prefix is a 404.
- The session cookie gets `Path=/w/<WORLD_ID>/` when the request came in under the world path, so two worlds
  on one domain never mix sessions. The old path keeps `Path=/`. Signing in under a world path also clears a
  leftover `Path=/` cookie, so a pre-prefix cookie cannot outlive a logout.
- `GET /w/<id>/api/world/info` (public): `{ id, name, speed, startedAt }`. Nothing else.
- The web client is one build. It reads `/w/<id>/` from the page URL and uses `/w/<id>/api` (default `/api`,
  which is what dev and the preview use). Hash tabs are unaffected. Pages: `play.example.com/w/w1/`, `/w/w2/`.
- Deployment: one `game-<id>` service per world with data in `/srv/clanfire/<id>`; Caddy routes
  `/w/<id>/*` to that service; one CloudFront behaviour per world (`/w/w1/api/*` to that world's origin), so a
  world can live on another server. `update.sh`, `backup.sh`, `restore.sh`, `rollback.sh` take a world id
  (default `w1`). See `deploy/README.md` ("Several worlds") and `docs/DEPLOYMENT_PLAN.md` §2 and §7.

Accounts are still per world: the same name in w1 and w2 is two unrelated accounts.

## Next step (part 2: shared login)

A small **lobby service** owns accounts and the world list.

1. The player signs in at the lobby (accounts, passwords, bans live there) and sees the world list.
2. Picking a world, the lobby issues a **short-lived entry pass** (about 60 s, one use): a token signed with an
   **Ed25519** private key that only the lobby holds. It carries account id, name, world id, expiry and a nonce.
3. The world checks the pass with the lobby's **public key** (an env var or file; no shared database, no call to
   the lobby), creates or finds that account's player in its own database, and sets its own world-scoped session
   cookie. After that the lobby is not needed for play.
4. Key rotation: worlds accept a small list of public keys with ids.

Why: worlds stay independent (one can be down, moved or deleted without touching the others) and the only shared
secret is a public key. A world never sees a password once the lobby exists.

**Postgres** is added only if the lobby ever needs more than one machine; until then the lobby is one process
with its own SQLite file, like a world.

## Open for part 2

Where the lobby lives (same domain, `/` and `/lobby/api`), how existing w1 accounts are linked to lobby accounts,
and rules that are per account across worlds (multi-account guard, bans). Run the `docs/SECURITY_ROADMAP.md` §4
gate on it.
