# Shared helpers for deploy scripts (sourced, not run). Callers cd to this folder first, then `set_world "<id or empty>"`.
# One game container per world: service game-<id> (old installs: `game` for w1), data in DATA_DIR.
# `lobby` is a pseudo world id: the lobby service (account service, own image and database file), data in /srv/clanfire/lobby.
WORLD="w1"
SERVICE=""
IMAGE="clanfire-game"       # image name without tag (latest/previous); the lobby has its own: clanfire-lobby
DB_FILE="clanfire.sqlite"   # database file name inside the data folder; the lobby uses lobby.sqlite
BACKUP_GLOB="clanfire-"     # prefix of the backup file names backup.js writes (lobby: clanfire-lobby-)
DATA_DIR="${DATA_DIR:-}"   # optional override from the environment; set_world fills it in

# env_or_dotenv NAME: the variable from the environment, else from deploy/.env, else empty.
env_or_dotenv() {
  local name="$1"
  if [ -n "${!name:-}" ]; then
    printf '%s\n' "${!name}"
  elif [ -f .env ]; then
    { grep -E "^${name}=" .env | tail -n 1 | cut -d= -f2-; } || true
  fi
}

# set_world [id]: validates the id (default w1), finds the compose service and the data folder
# (DATA_DIR env > DATA_<ID> in env/.env > /srv/clanfire/<id>) and exports DATA_<ID> so compose mounts the same folder.
set_world() {
  WORLD="${1:-w1}"
  [[ "$WORLD" =~ ^[A-Za-z0-9-]+$ ]] || { echo "Invalid world id '$WORLD' (letters, digits and dash only)." >&2; return 1; }

  local services
  services="$(docker compose config --services)" || { echo "'docker compose config' failed (is .env / game.env missing?)." >&2; return 1; }
  if [ "$WORLD" = lobby ]; then
    grep -qx "lobby" <<<"$services" || { echo "No service 'lobby' in docker-compose.yml." >&2; return 1; }
    SERVICE="lobby"
    IMAGE="clanfire-lobby"
    DB_FILE="lobby.sqlite"
    BACKUP_GLOB="clanfire-lobby-"
  elif grep -qx "game-${WORLD}" <<<"$services"; then
    SERVICE="game-${WORLD}"
  elif [ "$WORLD" = w1 ] && grep -qx "game" <<<"$services"; then
    SERVICE="game"   # old compose file; never used as a stand-in for any other world
  else
    echo "No service 'game-${WORLD}' in docker-compose.yml (uncomment or add it first)." >&2
    return 1
  fi

  local var
  var="DATA_$(printf '%s' "$WORLD" | tr 'a-z-' 'A-Z_')"
  if [ -z "$DATA_DIR" ]; then DATA_DIR="$(env_or_dotenv "$var")"; fi
  if [ -z "$DATA_DIR" ]; then
    DATA_DIR="/srv/clanfire/${WORLD}"   # lobby: /srv/clanfire/lobby (override with DATA_LOBBY)
    if [ "$WORLD" = w1 ] && [ ! -d "$DATA_DIR" ] && [ -d /srv/clanfire/data ]; then
      echo "WARNING: /srv/clanfire/w1 does not exist; using the old data folder /srv/clanfire/data (see deploy/README.md to move it)." >&2
      DATA_DIR=/srv/clanfire/data
    fi
  fi
  export "${var}=${DATA_DIR}"

  # A leftover container of the old `game` service on the same data as game-w1 would be a second writer.
  if [ "$SERVICE" = game-w1 ]; then
    local old
    old="$(docker ps -q --filter "label=com.docker.compose.project.working_dir=$(pwd -P)" --filter "label=com.docker.compose.service=game" | head -n 1)"
    if [ -n "$old" ]; then
      echo "The old 'game' container ($old) is still running. Two containers must never share a world's data." >&2
      echo "Stop and remove it first: docker stop $old && docker rm $old   (see deploy/README.md, 'Several worlds')." >&2
      return 1
    fi
  fi
}

# list_targets: the ids that `all` stands for, one per line: `lobby` first (when defined), then every world service
# (game-<id> gives <id>; an old compose file's `game` counts as w1). Used by update.sh and backup.sh.
list_targets() {
  local services s
  services="$(docker compose config --services)" || { echo "'docker compose config' failed (is .env / game.env missing?)." >&2; return 1; }
  if grep -qx "lobby" <<<"$services"; then echo lobby; fi
  if grep -qx "game" <<<"$services" && ! grep -qx "game-w1" <<<"$services"; then echo w1; fi
  while IFS= read -r s; do
    case "$s" in game-*) echo "${s#game-}" ;; esac
  done <<<"$services"
}

# no_data_dir_override_for_all: a DATA_DIR from the environment would point every target at one folder.
no_data_dir_override_for_all() {
  if [ -n "${DATA_DIR:-}" ]; then
    echo "DATA_DIR is set in the environment; with 'all' use DATA_<ID> (e.g. DATA_W1, DATA_LOBBY) in deploy/.env instead." >&2
    return 1
  fi
}

game_cid() { docker compose ps -q "$SERVICE" 2>/dev/null | head -n 1; }

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
  file="$(docker compose exec -T "$SERVICE" node backup.js | tail -n 1 | tr -d '\r')"
  case "$file" in "/data/backups/${BACKUP_GLOB}"*.sqlite) ;; *) echo "Unexpected backup output: $file" >&2; return 1 ;; esac
  echo "${DATA_DIR}/${file#/data/}"
}

# Upload to S3 when BACKUP_BUCKET is set (env or deploy/.env); otherwise a no-op.
# Worlds share one bucket: w1 stays at the bucket root (as before), every other world uses a <world>/ prefix,
# and the lobby uses lobby/ (WORLD is "lobby" there).
upload_backup() {
  [ -n "${BACKUP_BUCKET:-}" ] || return 0
  local prefix=""
  if [ "$WORLD" != w1 ]; then prefix="${WORLD}/"; fi
  aws s3 cp "$1" "s3://${BACKUP_BUCKET}/${prefix}$(basename "$1")" >&2
  echo "Uploaded $(basename "$1") to s3://${BACKUP_BUCKET}/${prefix}" >&2
}

load_bucket_from_env() {
  if [ -z "${BACKUP_BUCKET:-}" ] && [ -f .env ]; then
    BACKUP_BUCKET="$(grep -E '^BACKUP_BUCKET=' .env | tail -n 1 | cut -d= -f2- || true)"
    export BACKUP_BUCKET
  fi
}
