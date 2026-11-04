#!/usr/bin/env bash
# Backup: consistent SQLite copy inside the container; uploaded to S3 when BACKUP_BUCKET is set (env or deploy/.env).
# Usage: ./backup.sh [world]   (default w1). One run per world; files are clanfire-*.sqlite in that world's data/backups.
# Prints the host path of the backup file on the last stdout line. Also used by update.sh.
# Example crontab: 17 3 * * * /opt/clanfire/deploy/backup.sh >> /var/log/clanfire-backup.log 2>&1
#                  19 3 * * * /opt/clanfire/deploy/backup.sh w2 >> /var/log/clanfire-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
. ./lib.sh
load_bucket_from_env
set_world "${1:-}"

file="$(make_backup)"
upload_backup "$file"
echo "$file"
