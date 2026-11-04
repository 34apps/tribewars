#!/usr/bin/env bash
# Backup: consistent SQLite copy inside the container; uploaded to S3 when BACKUP_BUCKET is set (env or deploy/.env).
# Usage: ./backup.sh [world|lobby|all]   (default w1). One run per target; world files are clanfire-*.sqlite in that
# world's data/backups, the lobby's are clanfire-lobby-*.sqlite in /srv/clanfire/lobby/backups (S3 prefix lobby/).
# `all` = the lobby, then every world service (game-*); a failure of one does not stop the others, the exit status is 1 then.
# Prints the host path of the backup file on the last stdout line (`all`: one line per target). Also used by update.sh.
# Example crontab: 17 3 * * * /opt/clanfire/deploy/backup.sh all >> /var/log/clanfire-backup.log 2>&1
#   or one line per target: backup.sh, backup.sh w2, backup.sh lobby
set -euo pipefail
cd "$(dirname "$0")"
self="$(pwd -P)/$(basename "$0")"   # absolute, so re-running ourselves works from any starting folder
# shellcheck source=lib.sh
. ./lib.sh
load_bucket_from_env

if [ "${1:-}" = all ]; then
  no_data_dir_override_for_all
  targets="$(list_targets)"
  [ -n "$targets" ] || { echo "No lobby or world service found in docker-compose.yml." >&2; exit 1; }
  failed=0
  while IFS= read -r target; do
    echo "== Backup of ${target}" >&2
    bash "$self" "$target" || { echo "Backup of '${target}' FAILED." >&2; failed=1; }
  done <<<"$targets"
  exit "$failed"
fi

set_world "${1:-}"

file="$(make_backup)"
upload_backup "$file"
echo "$file"
