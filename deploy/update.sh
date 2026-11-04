#!/usr/bin/env bash
# Ship a backend update safely: build beside the running game, back up, switch, wait for healthy, roll back on failure.
# Usage: ./update.sh [world|lobby|all]   (default w1). Restarts ONLY that service.
#   ./update.sh lobby   updates the lobby (own image clanfire-lobby, own database lobby.sqlite).
#   ./update.sh all     the lobby first, then every world service (game-*), one after another; stops at the first failure.
# Several worlds also work one by one: ./update.sh w1; ./update.sh w2
# (the game image is shared, so the first run builds it and the next runs just switch their world over).
set -euo pipefail
cd "$(dirname "$0")"
self="$(pwd -P)/$(basename "$0")"   # absolute, so re-running ourselves works from any starting folder
# shellcheck source=lib.sh
. ./lib.sh
load_bucket_from_env

[[ "${1:-w1}" =~ ^[A-Za-z0-9-]+$ ]] || { echo "Invalid world id '${1:-}' (letters, digits and dash only)." >&2; exit 1; }

# Pull first, then re-run the (possibly updated) script, so bash never reads a file that changed under it.
if [ -z "${UPDATE_REEXEC:-}" ]; then
  git pull --ff-only
  UPDATE_REEXEC=1 exec bash "$self" "$@"
fi

if [ "${1:-}" = all ]; then
  no_data_dir_override_for_all
  targets="$(list_targets)"
  [ -n "$targets" ] || { echo "No lobby or world service found in docker-compose.yml." >&2; exit 1; }
  while IFS= read -r target; do
    echo "######## Updating ${target}"
    # A fresh process per target: set_world keeps its settings in variables. UPDATE_REEXEC is set, so no second git pull.
    bash "$self" "$target" || { echo "Update of '${target}' failed; the remaining targets were NOT updated." >&2; exit 1; }
  done <<<"$targets"
  echo "== All updated."
  exit 0
fi

set_world "${1:-}"
echo "== ${WORLD} (service ${SERVICE}, data ${DATA_DIR})"

echo "== Building new image (old container keeps serving)"
docker tag "${IMAGE}:latest" "${IMAGE}:previous" 2>/dev/null || echo "(no previous image; first deploy)"
docker compose build "$SERVICE"

backup_file=""
if [ -n "$(game_cid)" ] && docker inspect --format '{{.State.Running}}' "$(game_cid)" 2>/dev/null | grep -q true; then
  echo "== Backing up before switching"
  backup_file="$(make_backup)"
  upload_backup "$backup_file"
  echo "Backup: $backup_file"
else
  echo "== Container not running; skipping backup (first deploy?)"
fi

echo "== Switching to the new version"
docker compose up -d --no-deps "$SERVICE"

if wait_healthy 90; then
  echo "== Healthy. Update done."
  docker image prune -f >/dev/null
  exit 0
fi

echo "== New version did NOT become healthy. Last 50 log lines:" >&2
docker compose logs --tail 50 "$SERVICE" >&2 || true
if docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
  echo "== Rolling back to the previous image" >&2
  docker tag "${IMAGE}:previous" "${IMAGE}:latest"
  docker compose up -d --no-deps "$SERVICE"
  wait_healthy 90 && echo "== Previous version is running again." >&2 || echo "== Previous version is not healthy either; see logs." >&2
fi
{
  echo "UPDATE FAILED. The database was backed up to: ${backup_file:-<no backup: it was not running>}"
  echo "It is untouched unless the new version migrated it; if the old version refuses to start on it, restore with"
  echo "  ./restore.sh ${WORLD} <that file>   (see deploy/README.md)."
} >&2
exit 1
