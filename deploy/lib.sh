# Shared helpers for deploy scripts (sourced, not run). Callers cd to this folder first.
DATA_DIR="${DATA_DIR:-/srv/clanfire/data}"

game_cid() { docker compose ps -q game 2>/dev/null | head -n 1; }

# wait_healthy [seconds]: 0 when the game container reports healthy, 1 on timeout/unhealthy/exit.
wait_healthy() {
  local limit="${1:-90}" waited=0 cid status
  while [ "$waited" -lt "$limit" ]; do
    cid="$(game_cid)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}{{else}}stopped{{end}}' "$cid" 2>/dev/null || echo unknown)"
      [ "$status" = healthy ] && return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# Online backup inside the running container (consistent). Prints the HOST path of the new file on stdout.
make_backup() {
  local file
  file="$(docker compose exec -T game node backup.js | tail -n 1 | tr -d '\r')"
  case "$file" in /data/backups/clanfire-*.sqlite) ;; *) echo "Unexpected backup output: $file" >&2; return 1 ;; esac
  echo "${DATA_DIR}/${file#/data/}"
}

# Upload to S3 when BACKUP_BUCKET is set (env or deploy/.env); otherwise a no-op.
upload_backup() {
  [ -n "${BACKUP_BUCKET:-}" ] || return 0
  aws s3 cp "$1" "s3://${BACKUP_BUCKET}/$(basename "$1")" >&2
  echo "Uploaded $(basename "$1") to s3://${BACKUP_BUCKET}/" >&2
}

load_bucket_from_env() {
  if [ -z "${BACKUP_BUCKET:-}" ] && [ -f .env ]; then
    BACKUP_BUCKET="$(grep -E '^BACKUP_BUCKET=' .env | tail -n 1 | cut -d= -f2- || true)"
    export BACKUP_BUCKET
  fi
}
