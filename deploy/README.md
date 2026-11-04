# Deploying Clanfire (one EC2 host, Docker Compose)

Files: `docker-compose.yml` (one game service per world + the lobby + Caddy), `Caddyfile`, `.env` (Caddy secrets), `game.env`
(settings of world w1; `game-w2.env` for w2, ...), `lobby.env` (lobby settings and its signing key), `update.sh`, `rollback.sh`,
`restore.sh`, `backup.sh`. All commands run from this folder on the server. Every script takes an optional world id first
(default `w1`); `lobby` is accepted in the same place, and `all` by `update.sh` and `backup.sh`.

## First install
Follow `docs/DEPLOYMENT_PLAN.md` section 5. In short: `cp .env.example .env; cp game.env.example game.env`, edit both,
create `/srv/clanfire/w1` owned by `1000:1000`, then `docker compose up -d --build`.

## Update (the one command)
`./update.sh [world]` pulls, builds the new image while the old game keeps running, backs up (and uploads to S3 if
`BACKUP_BUCKET` is set), switches only that world, and waits up to 90 s for "healthy". If it never gets healthy it
prints the logs, puts the previous image back and exits 1. The world stops for a few seconds only while switching.
All worlds: run it once per world (`./update.sh w1; ./update.sh w2`).

## Rollback
`./rollback.sh [world]` returns that world to the previous image (`clanfire-game:previous`). It does not touch the database.
The image tag is shared by all worlds; the others pick it up at their next restart.

## Restore a backup
`./restore.sh [world] /srv/clanfire/w1/backups/clanfire-XXXX.sqlite` (or a file downloaded from S3; `./restore.sh <file>`
means w1). It stops that world, moves the current database to `<data folder>/replaced-<time>/` (never deleted), puts the
backup in place, starts the world and waits for healthy. Use it if a new version migrated the database and the old image
cannot read it.

## Backups
`backup.sh [world]` makes a consistent copy in `/srv/clanfire/<world>/backups` and uploads to S3 when `BACKUP_BUCKET` is
set (environment or `.env`; w1 at the bucket root, other worlds under `<world>/`). Cron daily, one line per world:
`17 3 * * * /opt/clanfire/deploy/backup.sh >> /var/log/clanfire-backup.log 2>&1` (add `w2` for w2).
The game also backs itself up before a migration on startup.

## What survives an update
Everything is in `/srv/clanfire/<world>` (database, backups). Containers are disposable. Never run `docker compose down -v`
on caddy volumes casually (they hold the TLS certificate), and never run two game containers on one data folder.

## Several worlds
Each world is its own process, SQLite file and container (`game-w1`, `game-w2`, ...); a world is never split across
processes. The web client is one build; it reads `/w/<id>/` from the page URL (`play.example.com/w/w1/`, `/w/w2/`).
The server answers under `/w/<id>/api/...` and the old `/api/...`.

**Add world w2** on this machine:
1. `sudo mkdir -p /srv/clanfire/w2 && sudo chown 1000:1000 /srv/clanfire/w2`
2. `cp game.env.example game-w2.env`; set `WORLD_NAME` and the world settings (own speed, seed, ...). `WORLD_ID=w2` is set in the compose file.
3. Uncomment the `game-w2` block in `docker-compose.yml` and the `/w/w2/*` block in `Caddyfile`
   (`docker compose restart caddy`, or `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`).
4. CloudFront: add a behaviour `/w/w2/api/*` to the origin (same settings as `/w/w1/api/*`; see `docs/DEPLOYMENT_PLAN.md`).
5. `docker compose up -d game-w2`. Later: `./update.sh w2`, `./backup.sh w2` (cron), `./restore.sh w2 <file>`.

**Existing install** (service `game`, data in `/srv/clanfire/data`): nothing moves automatically. Either keep the data
where it is with `DATA_W1=/srv/clanfire/data` in `deploy/.env` (compose and scripts read it; the scripts also fall back to
that folder, with a warning, when `/srv/clanfire/w1` does not exist), or move it once with the game stopped:
`docker compose stop game && sudo mv /srv/clanfire/data /srv/clanfire/w1`. Then remove the old container once
(`docker ps` shows `*-game-1`: `docker stop <id> && docker rm <id>`); the scripts refuse to start `game-w1` while it runs.
An old compose file that still defines `game` keeps working with the scripts (w1 only).

**World on another machine:** run the same compose file there with only that world's service (and Caddy with its own
origin domain and secret), then point the CloudFront behaviour `/w/w2/api/*` at that machine's origin. The Caddy route
on the first machine is not needed. Backups and updates run on that machine.

## Lobby (one account, many worlds)
The lobby is one more container (`lobby`, image `clanfire-lobby`, port 3001 inside the compose network only, data in
`/srv/clanfire/lobby`, database `lobby.sqlite`). It owns accounts and the world list and signs short-lived entry passes;
worlds that have `LOBBY_PUBLIC_KEY` accept only those passes. How it works: `docs/MULTI_WORLD.md`. Scripts take `lobby` as a
target: `./update.sh lobby`, `./backup.sh lobby`, `./restore.sh lobby <file>`, `./rollback.sh lobby`. `./update.sh all` and
`./backup.sh all` mean the lobby first, then every `game-*` service.

**Upgrading a running install:** the compose file now names `lobby.env`, and `docker compose` (so every script, even `./update.sh w1`)
refuses to run while that file is missing. Right after `git pull`, run `cp lobby.env.example lobby.env` once. The lobby container does not
start until `LOBBY_SIGNING_KEY` is filled in; the worlds are not affected.

**First-time setup (new install, no players yet)**
1. `sudo mkdir -p /srv/clanfire/lobby && sudo chown 1000:1000 /srv/clanfire/lobby`
2. `cp lobby.env.example lobby.env` and edit `ALLOWED_ORIGINS` (and `TRUST_PROXY`, `MAX_ACCOUNTS_PER_IP`).
3. Make the key pair (needs no database): `docker compose run --rm --no-deps lobby node admin.js keygen`. It prints a
   `LOBBY_SIGNING_KEY=...` line and a `LOBBY_PUBLIC_KEY=...` line. Put the private line ONLY into `lobby.env` (git-ignored; never into
   a world's file, `.env` or git). Put the public line into every world's env file (`game.env`, `game-w2.env`, ...).
4. `docker compose up -d --build` (lobby, worlds, caddy). Check: `docker compose ps` shows `lobby` healthy.
5. Add every world to the list (the id must match the world's `WORLD_ID`):
   `docker compose exec lobby node admin.js world-add w1 "Clanfire One"` (default page path `/w/<id>/`, status `open`).
   More: `worlds`, `world-status <id> <open|full|closed>`, `world-rename`, `world-remove`, `shared-ips`, `ban`, `unban`,
   `grant <username> <support|moderator|admin>`, `revoke` (same command, `node admin.js <command>`).
6. CloudFront and Caddy: see below. Open `https://play.example.com/lobby/`.

**Existing install: import the players of a world once** (do this per existing world; passwords keep working)
1. Back everything up: `./backup.sh w1`.
2. Create the lobby folder and `lobby.env` with the key (steps 1-3 above), start only the lobby: `docker compose up -d --build lobby`.
3. Stop the world and the lobby (nobody may write to either database): `docker compose stop game-w1 lobby`.
4. `docker compose run --rm --no-deps -v /srv/clanfire/w1:/world lobby node import.js /world/clanfire.sqlite`
   (if the world's data is elsewhere, mount that folder instead; dev: `npm run lobby:import -- <world db>`).
   It first backs up both databases (world: `/world/backups/pre-import-<stamp>-*.sqlite`, lobby: `/data/backups/pre-import-...`), then copies the
   world's players into the lobby as accounts (same username and password hash; bans, staff role and chieftain are copied) and sets
   `players.account_id` in the world database. Running it twice is safe (linked players are skipped). A name that already exists in
   the lobby from another world with a different password is a conflict: it is reported, left untouched, and the command exits with
   status 2. Then rename one of the two accounts in that world's database, or let that player register anew, and run it again.
5. Put `LOBBY_PUBLIC_KEY=...` into the world's env file, start both: `docker compose up -d lobby game-w1`.
6. Add the world: `docker compose exec lobby node admin.js world-add w1 "Clanfire One"`.
Players who were signed in keep their world session cookie (30 days). A lobby ban blocks only NEW passes; the world keeps its own
bans and sessions, so ban in the world too (staff tools) to end a session at once.

**Update, backup, restore:** `./update.sh lobby` (own image tag `clanfire-lobby:latest`/`previous`; backs up first and rolls back if
it never becomes healthy), `./backup.sh lobby` (`/srv/clanfire/lobby/backups/clanfire-lobby-*.sqlite`, S3 prefix `lobby/`), `./restore.sh lobby <file>`
(replaces `lobby.sqlite`, moves the old one to `replaced-<time>/`). Cron: `./backup.sh all` covers the lobby and all worlds.
Keep the lobby's backups as private as the world's: they hold password hashes.

**Rotating the key** (suspicion of a leak, or yearly): 1) `docker compose exec lobby node admin.js keygen` (prints a new pair; it
needs no database and changes nothing); 2) in every world's env file make `LOBBY_PUBLIC_KEY` a list, old key first: `old,new`, and
restart the worlds; 3) replace `LOBBY_SIGNING_KEY` in `lobby.env` with the new private key and restart the lobby (`docker compose up -d lobby`);
4) after a few minutes (passes live 60 s) remove the old public key from the worlds and restart them. After a leak do 2-4 at once.

**Caddy:** `handle /lobby/* { reverse_proxy lobby:3001 }` sits before the catch-all (already in the Caddyfile). No WebSocket for the lobby.

**CloudFront:** add a behaviour `/lobby/api/*` -> the origin (cache policy CachingDisabled, origin request policy AllViewerExceptHostHeader so
all headers, cookies and query strings reach the lobby, all methods allowed because of POST). The page path `/lobby/*` stays on the S3
behaviour and must return `index.html` like `/w/<id>/` (extend the viewer-request CloudFront Function: URIs under `/lobby/` without a file
extension, and not `/lobby/api/`, rewrite to `/index.html`). Same CloudFront domain as the worlds, so cookies, CSP and the Origin check
need no change. The lobby also needs `X-Origin-Verify` like the worlds (Caddy checks it for everything).

## Security notes
- `no-new-privileges`: a process cannot gain more rights than it started with.
- `cap_drop: ALL`: no special Linux powers (Caddy gets only "bind ports 80/443").
- `read_only` + `tmpfs /tmp`: the container's files cannot be changed; only `/data` is writable.
- `pids_limit`, `mem_limit`: one runaway process cannot take the host down.
- `game.env` vs `.env`: the CloudFront origin secret is only given to Caddy, never to the game.
- `lobby.env` holds the entry-pass signing key (a secret): only the lobby container reads it; worlds get the public key only.
- No published game port; only Caddy (80/443, CloudFront-only security group) is reachable.
- Logs rotate (10 MB x 5). Caddy is pinned to `2.10-alpine`; bump it deliberately.

## Scaling later
1. **Bigger instance**: stop, resize the EC2 type, start. Same setup, same data folders.
2. **More worlds**: see "Several worlds" above; give `mem_limit` real thought when several share one machine.
3. **Later still**: run the same image on ECS on EC2, one task per world with a persistent EBS volume, and move
   accounts into a shared Postgres (RDS) service used by all worlds. No load balancer is needed until there is more
   than one instance.
