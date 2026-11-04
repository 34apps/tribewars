#!/usr/bin/env bash
# Manual rollback of the game IMAGE to clanfire-game:previous. Does not touch the database (see restore.sh for that).
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

docker image inspect clanfire-game:previous >/dev/null 2>&1 || { echo "No clanfire-game:previous image to roll back to." >&2; exit 1; }
docker tag clanfire-game:previous clanfire-game:latest
docker compose up -d --no-deps game
if wait_healthy 90; then
  echo "Rolled back; game is healthy."
else
  echo "Game did not become healthy after rollback:" >&2
  docker compose logs --tail 50 game >&2 || true
  exit 1
fi
