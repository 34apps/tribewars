#!/usr/bin/env bash
# Ship a backend update safely: build beside the running game, back up, switch, wait for healthy, roll back on failure.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
load_bucket_from_env

# Pull first, then re-run the (possibly updated) script, so bash never reads a file that changed under it.
if [ -z "${UPDATE_REEXEC:-}" ]; then
  git pull --ff-only
  UPDATE_REEXEC=1 exec bash "$0" "$@"
fi

echo "== Building new image (old container keeps serving)"
docker tag clanfire-game:latest clanfire-game:previous 2>/dev/null || echo "(no previous image; first deploy)"
docker compose build game

backup_file=""
if [ -n "$(game_cid)" ] && docker inspect --format '{{.State.Running}}' "$(game_cid)" 2>/dev/null | grep -q true; then
  echo "== Backing up before switching"
  backup_file="$(make_backup)"
  upload_backup "$backup_file"
  echo "Backup: $backup_file"
else
  echo "== Game container not running; skipping backup (first deploy?)"
fi

echo "== Switching to the new version"
docker compose up -d --no-deps game

if wait_healthy 90; then
  echo "== Healthy. Update done."
  docker image prune -f >/dev/null
  exit 0
fi

echo "== New version did NOT become healthy. Last 50 log lines:" >&2
docker compose logs --tail 50 game >&2 || true
if docker image inspect clanfire-game:previous >/dev/null 2>&1; then
  echo "== Rolling back to the previous image" >&2
  docker tag clanfire-game:previous clanfire-game:latest
  docker compose up -d --no-deps game
  wait_healthy 90 && echo "== Previous version is running again." >&2 || echo "== Previous version is not healthy either; see logs." >&2
fi
{
  echo "UPDATE FAILED. The database was backed up to: ${backup_file:-<no backup: game was not running>}"
  echo "It is untouched unless the new version migrated it; if the old version refuses to start on it, restore with"
  echo "  ./restore.sh <that file>   (see deploy/README.md)."
} >&2
exit 1
