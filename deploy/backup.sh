#!/usr/bin/env bash
# Daily backup (host cron): consistent SQLite copy inside the container, then upload the newest file to S3.
# Example crontab: 17 3 * * * BACKUP_BUCKET=my-bucket /opt/clanfire/deploy/backup.sh >> /var/log/clanfire-backup.log 2>&1
set -euo pipefail
: "${BACKUP_BUCKET:?Set BACKUP_BUCKET to the S3 bucket name}"
cd "$(dirname "$0")"

file="$(docker compose exec -T game node backup.js | tail -n 1 | tr -d '\r')"
case "$file" in /data/backups/clanfire-*.sqlite) ;; *) echo "Unexpected backup output: $file" >&2; exit 1 ;; esac

# /data in the container is /srv/clanfire/data on the host.
aws s3 cp "/srv/clanfire/data/${file#/data/}" "s3://${BACKUP_BUCKET}/$(basename "$file")"
echo "Uploaded $(basename "$file") to s3://${BACKUP_BUCKET}/"
