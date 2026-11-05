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

A world started **without** `LOBBY_PUBLIC_KEY` still has its own accounts (the same name in w1 and w2 is two
unrelated accounts). Part 2 turns that off per world.

## How it works (part 2: the lobby, one account for many worlds)

A small **lobby service** (`apps/lobby`, image `clanfire-lobby`, one process with its own SQLite file
`/data/lobby.sqlite`, like a world) owns the accounts and the world list. Worlds stay independent: one can be down,
moved or deleted without touching the others, and the only thing they share with the lobby is a **public key**.
A world never sees a password once it uses the lobby.

**Lobby side**
- Accounts, scrypt password hashes, bans and staff roles live in the lobby. Sessions use the cookie **`tw_lobby`**
  with `Path=/lobby/` (HttpOnly, SameSite=Lax), so it is never sent to a world. The lobby answers only under
  `/lobby/api/...` (contract at the end of `packages/engine/src/api.ts`); the page `/lobby/` is the same web build.
- The multi-account guard (IPs per account, `MAX_ACCOUNTS_PER_IP`, shared-IP report) moved from the worlds into the
  lobby: one person, one account across all worlds. Origin check and rate limits work as in a world.
- The **world list** (id, name, status `open` / `full` / `closed` / `finished`, page path such as `/w/w1/`) is a table in the lobby
  database. `full` = returning players still enter, nobody new; `closed` = nobody enters (403). The operator manages
  it, and everything else, with the CLI: `docker compose exec lobby node admin.js <command>` (dev:
  `npm run lobby:admin -- <command>`): `keygen`, `public-key`, `worlds`, `world-add <id> <name...> [--path=/w/<id>/]
  [--status=open]`, `world-status <id> <open|full|closed|finished>`, `world-rename`, `world-remove`, `shared-ips`,
  `ban <username> [reason...]`, `unban`, `grant <username> <support|moderator|admin>`, `revoke`.
  When a world ends by domination, run `lobby:admin -- world-status <id> finished`: it stays enterable for viewing the
  results (the lobby list marks it "Finished", button "View results"); new accounts are not routed to it.

**Entry pass.** `POST /lobby/api/worlds/:id/enter` (signed in, status not `closed`, not banned) returns a pass:
`base64url(JSON claims) + "." + base64url(Ed25519 signature)`. The signature covers the UTF-8 bytes of
`clanfire-entry-pass-v1\n<payload part exactly as sent>`. Claims: `v` (1), `kid`, `aid` (account id), `name`, `wid`
(the one world id it is for), `chn` (chieftain portrait), `role` (staff role or null), `iat`, `exp` (60 s, a world
refuses a lifetime above 120 s whatever the signer says; `iat` may be at most 10 s in the future), `nonce`
(22+ random characters). Keys travel as base64 DER: private = PKCS#8 (`LOBBY_SIGNING_KEY`, lobby only), public =
SPKI (`LOBBY_PUBLIC_KEY`, worlds); `kid` = first 16 hex characters of the SHA-256 of the public SPKI DER.

**World side** (`POST /w/<id>/api/auth/enter`, body `{ pass }`; 404 when `LOBBY_PUBLIC_KEY` is not set)
1. Verify the signature with the matching key from the key list (no call to the lobby, no shared database), then
   `wid` equals this world, `iat`/`exp` and the lifetime cap.
2. Burn the **nonce**: it is stored in the world database until the pass would have expired anyway, so a second use
   (replay) is refused; expired nonces are deleted.
3. Find the player by `players.account_id` (**unique**), or create it on the first entry, using the name and chieftain
   from the pass. **There is never linking by name**: a name alone is not a claim on a player.
4. Copy the staff role from the pass onto the player **at every entry**, then set the world's own session cookie
   (`Path=/w/<id>/`) and answer with `MeResponse`. After that the lobby is not needed for play.
- With `LOBBY_PUBLIC_KEY` set the world's own register/login answer 403 `forbidden`; `GET /w/<id>/api/world/info`
  reports `lobby: true`. The value is a comma list, so a world can trust two keys during a rotation.

**Web flow.** `/lobby/` (sign in or register) -> world picker (names and statuses) -> **Play** -> the client gets a
pass and POSTs it to `/w/<id>/api/auth/enter` (the pass is never put in a URL) -> navigates to `/w/<id>/`.

**Keys.** `keygen` prints a `LOBBY_SIGNING_KEY=` line (secret: `deploy/lobby.env` only) and a `LOBBY_PUBLIC_KEY=` line
(into every world's env file). **Rotation:** 1) add the new public key to every world's list (old,new) and restart them;
2) switch the lobby to the new private key; 3) after a few minutes (passes live 60 s) remove the old public key from the
worlds. A stolen or leaked signing key means rotating at once: worlds that have only the new key refuse every old pass.

**Existing install: import.** `npm run lobby:import -- <world db>` (Docker: both services stopped,
`docker compose run --rm --no-deps -v /srv/clanfire/w1:/world lobby node import.js /world/clanfire.sqlite`) backs up both
databases first (`pre-import-<stamp>-*` in each `backups` folder), then copies the world's players into the lobby as
accounts (same name, **same password hash**, so passwords keep working; bans, staff role and chieftain are copied) and
writes `players.account_id` in the world database. Safe to run twice (linked players are skipped). A name that already
exists in the lobby from another world with a different password is reported as a **conflict**, left untouched, and the
command exits with status 2: rename one account in that world's database, or let that player register anew after
the other. Players who were signed in keep their world session cookie (30 days) after the switch. Order, with
commands: `deploy/README.md` ("Lobby").

**Bans and roles.** A lobby ban blocks only NEW passes. The world keeps its own bans and sessions, so ban in the world too
(or with the staff tools) to end a session at once. Staff roles are granted in the lobby (`grant`) and copied at each entry.

### Threats and what stops them

| Threat | Mitigation |
|---|---|
| Stolen pass | Valid 60 s, one use (nonce), travels in a POST body over TLS and is never put in a URL, a log line or a referrer. |
| Replay of a used pass | The world stores each nonce until expiry and refuses a second use; the lifetime cap (120 s) bounds the table. |
| Pass for another world | `wid` is signed and compared with the world's own id; any other world refuses it. |
| Name takeover (a world player or a new lobby account claiming an existing name) | No linking by name; `players.account_id` is unique; the import copies players one-to-one and reports a name clash instead of merging. |
| Open redirect via the world path | The client navigates only to the `path` of the lobby's own world table (set by the operator with `world-add`, always a same-site `/.../` path), never to a value taken from a request or a URL. |
| Brute force on login/register | Rate limits per IP and per session, multi-account IP guard, scrypt hashes; password lockout per account is still open in `docs/SECURITY_ROADMAP.md`. |
| Key leak (signing key) | The key exists only in the lobby container's env; worlds hold the public key only. If it leaks, whoever has it forges a pass for any world: rotate (above) at once. |
| Forged pass with a key that is not the lobby's | The world checks the signature against its key list only; an unknown `kid` is refused. |
| Cookie leak between lobby and worlds | Different cookie names and paths (`tw_lobby` `/lobby/`, world cookie `/w/<id>/`); the lobby cookie never reaches a world. |

## Open

- **Postgres** only if the lobby ever needs more than one machine; until then one process with one SQLite file.
- Password change/reset and e-mail are not built.
- A lobby ban does not end live world sessions (ban in the world too).
- One pass key for all worlds: a stolen signing key forges any pass. Keep it in the lobby container's env only and
  rotate on suspicion.
