# Deploying Clanfire (one EC2 host, Docker Compose)

Files: `docker-compose.yml` (one game service per world + Caddy), `Caddyfile`, `.env` (Caddy secrets), `game.env`
(settings of world w1; `game-w2.env` for w2, ...), `update.sh`, `rollback.sh`, `restore.sh`, `backup.sh`.
All commands run from this folder on the server. Every script takes an optional world id first (default `w1`).

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

## Security notes
- `no-new-privileges`: a process cannot gain more rights than it started with.
- `cap_drop: ALL`: no special Linux powers (Caddy gets only "bind ports 80/443").
- `read_only` + `tmpfs /tmp`: the container's files cannot be changed; only `/data` is writable.
- `pids_limit`, `mem_limit`: one runaway process cannot take the host down.
- `game.env` vs `.env`: the CloudFront origin secret is only given to Caddy, never to the game.
- No published game port; only Caddy (80/443, CloudFront-only security group) is reachable.
- Logs rotate (10 MB x 5). Caddy is pinned to `2.10-alpine`; bump it deliberately.

## Scaling later
1. **Bigger instance**: stop, resize the EC2 type, start. Same setup, same data folders.
2. **More worlds**: see "Several worlds" above; give `mem_limit` real thought when several share one machine.
3. **Later still**: run the same image on ECS on EC2, one task per world with a persistent EBS volume, and move
   accounts into a shared Postgres (RDS) service used by all worlds. No load balancer is needed until there is more
   than one instance.
