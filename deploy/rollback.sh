#!/usr/bin/env bash
# Manual rollback of an IMAGE to its :previous tag. Does not touch the database (see restore.sh for that).
# Usage: ./rollback.sh [world|lobby]   (default w1). Restarts only that service. The game image tag (clanfire-game) is
# shared by all worlds, so other worlds pick the rolled-back image up at their next restart; the lobby has its own
# image (clanfire-lobby:previous).
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
set_world "${1:-}"

docker image inspect "${IMAGE}:previous" >/dev/null 2>&1 || { echo "No ${IMAGE}:previous image to roll back to." >&2; exit 1; }
docker tag "${IMAGE}:previous" "${IMAGE}:latest"
docker compose up -d --no-deps "$SERVICE"
if wait_healthy 90; then
  echo "Rolled back ${WORLD}; it is healthy."
else
  echo "${WORLD} did not become healthy after rollback:" >&2
  docker compose logs --tail 50 "$SERVICE" >&2 || true
  exit 1
fi
