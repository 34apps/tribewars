# Deploying Clanfire (one EC2 host, Docker Compose)

Files: `docker-compose.yml` (game + Caddy), `Caddyfile`, `.env` (Caddy secrets), `game.env` (game settings),
`update.sh`, `rollback.sh`, `restore.sh`, `backup.sh`. All commands run from this folder on the server.

## First install
Follow `docs/DEPLOYMENT_PLAN.md` section 5. In short: `cp .env.example .env; cp game.env.example game.env`, edit both,
create `/srv/clanfire/data` owned by `1000:1000`, then `docker compose up -d --build`.

## Update (the one command)
`./update.sh` pulls, builds the new image while the old game keeps running, backs up (and uploads to S3 if
`BACKUP_BUCKET` is set), switches, and waits up to 90 s for "healthy". If it never gets healthy it prints the logs,
puts the previous image back and exits 1. The game stops for a few seconds only while switching.

## Rollback
`./rollback.sh` returns to the previous image (`clanfire-game:previous`). It does not touch the database.

## Restore a backup
`./restore.sh /srv/clanfire/data/backups/clanfire-XXXX.sqlite` (or a file downloaded from S3). It stops the game,
moves the current database to `/srv/clanfire/data/replaced-<time>/` (never deleted), puts the backup in place, starts
the game and waits for healthy. Use it if a new version migrated the database and the old image cannot read it.

## Backups
`backup.sh` makes a consistent copy in `/srv/clanfire/data/backups` and uploads to S3 when `BACKUP_BUCKET` is set
(environment or `.env`). Cron daily: `17 3 * * * /opt/clanfire/deploy/backup.sh >> /var/log/clanfire-backup.log 2>&1`.
The game also backs itself up before a migration on startup.

## What survives an update
Everything is in `/srv/clanfire/data` (database, backups). Containers are disposable. Never run `docker compose down -v`
on caddy volumes casually (they hold the TLS certificate), and never run two game containers on one data folder.

## Security notes
- `no-new-privileges`: a process cannot gain more rights than it started with.
- `cap_drop: ALL`: no special Linux powers (Caddy gets only "bind ports 80/443").
- `read_only` + `tmpfs /tmp`: the container's files cannot be changed; only `/data` is writable.
- `pids_limit`, `mem_limit`: one runaway process cannot take the host down.
- `game.env` vs `.env`: the CloudFront origin secret is only given to Caddy, never to the game.
- No published game port; only Caddy (80/443, CloudFront-only security group) is reachable.
- Logs rotate (10 MB x 5). Caddy is pinned to `2.10-alpine`; bump it deliberately.

## Scaling later
1. **Bigger instance**: stop, resize the EC2 type, start. Same setup, same data folder.
2. **More worlds**: one more game service per world, each with its own data folder, and a route in Caddy.
   Never two containers on one world.
   ```yaml
   game-w2:
     image: clanfire-game:latest
     env_file: game-w2.env          # own WORLD_* settings
     volumes: ["/srv/clanfire/data-w2:/data"]
     read_only: true
     security_opt: ["no-new-privileges:true"]
     cap_drop: [ALL]
   ```
   Caddyfile (inside the origin site block): `handle_path /w2/api/* { reverse_proxy game-w2:3000 }`
   (route `/w2/api/*` to the origin in CloudFront too) or a separate subdomain block per world.
3. **Later still**: run the same image on ECS on EC2, one task per world with a persistent EBS volume, and move
   accounts into a shared Postgres (RDS) service used by all worlds. No load balancer is needed until there is more
   than one instance.
