#!/usr/bin/env bash
# Restore the database from a backup file. The current database is moved aside, never deleted.
# Usage: ./restore.sh /srv/clanfire/data/backups/clanfire-XXXX.sqlite   (or a file downloaded from S3)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh

backup="${1:-}"
[ -n "$backup" ] && [ -f "$backup" ] || { echo "Usage: $0 <backup-file> (file must exist)" >&2; exit 1; }
[ "$(head -c 15 "$backup")" = "SQLite format 3" ] || { echo "Not a SQLite database file: $backup" >&2; exit 1; }

stamp="$(date +%Y%m%d-%H%M%S)"
aside="${DATA_DIR}/replaced-${stamp}"

echo "== Stopping game"
docker compose stop game
sudo mkdir -p "$aside"
for f in clanfire.sqlite clanfire.sqlite-wal clanfire.sqlite-shm; do
  if [ -e "${DATA_DIR}/${f}" ]; then sudo mv "${DATA_DIR}/${f}" "$aside/"; fi
done
sudo cp "$backup" "${DATA_DIR}/clanfire.sqlite"
sudo chown 1000:1000 "${DATA_DIR}/clanfire.sqlite"
echo "Previous database kept in $aside"

echo "== Starting game"
docker compose up -d --no-deps game
if wait_healthy 90; then
  echo "Restored from $backup; game is healthy."
else
  echo "Game did not become healthy after restore:" >&2
  docker compose logs --tail 50 game >&2 || true
  exit 1
fi
