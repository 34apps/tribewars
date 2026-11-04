#!/usr/bin/env bash
# Restore a world's (or the lobby's) database from a backup file. The current database is moved aside, never deleted.
# Usage: ./restore.sh [world|lobby] <backup-file>      (world defaults to w1, so `./restore.sh <file>` still works)
#   e.g. ./restore.sh /srv/clanfire/w1/backups/clanfire-XXXX.sqlite   or   ./restore.sh w2 clanfire-XXXX.sqlite (from S3)
#        ./restore.sh lobby /srv/clanfire/lobby/backups/clanfire-lobby-XXXX.sqlite   (replaces lobby.sqlite, not clanfire.sqlite)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

case "$#" in
  1) world="" backup="$1" ;;
  2) world="$1" backup="$2" ;;
  *) echo "Usage: $0 [world|lobby] <backup-file> (file must exist)" >&2; exit 1 ;;
esac
[ -n "$backup" ] && [ -f "$backup" ] || { echo "Usage: $0 [world|lobby] <backup-file> (file must exist)" >&2; exit 1; }
[ "$(head -c 15 "$backup")" = "SQLite format 3" ] || { echo "Not a SQLite database file: $backup" >&2; exit 1; }
set_world "$world"

stamp="$(date +%Y%m%d-%H%M%S)"
aside="${DATA_DIR}/replaced-${stamp}"

echo "== Stopping ${WORLD} (service ${SERVICE}, data ${DATA_DIR})"
docker compose stop "$SERVICE"
sudo mkdir -p "$aside"
for f in "$DB_FILE" "${DB_FILE}-wal" "${DB_FILE}-shm"; do
  if [ -e "${DATA_DIR}/${f}" ]; then sudo mv "${DATA_DIR}/${f}" "$aside/"; fi
done
sudo cp "$backup" "${DATA_DIR}/${DB_FILE}"
sudo chown 1000:1000 "${DATA_DIR}/${DB_FILE}"
echo "Previous database kept in $aside"

echo "== Starting ${WORLD}"
docker compose up -d --no-deps "$SERVICE"
if wait_healthy 90; then
  echo "Restored ${WORLD} from $backup; it is healthy."
else
  echo "${WORLD} did not become healthy after restore:" >&2
  docker compose logs --tail 50 "$SERVICE" >&2 || true
  exit 1
fi
