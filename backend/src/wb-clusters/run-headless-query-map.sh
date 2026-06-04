#!/bin/bash
# Ежедневное фоновое обновление карты запросов кластеров (cmp words-clusters).
#   SSH-туннель к проду → headless-выгрузка состава кластеров по РК → запись в БД.
# Login-on-demand для cmp: если cmp-cookie протухла, ensureWbSession откроет
# видимое окно и silent-SSO восстановит сессию по seller-passport (без пароля);
# если истёк и passport — ждёт ручного входа. Расписание: 09:40 ежедневно.
set -e
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_PREFIX="[wb-headless-qm]"
TUNNEL_PORT=15432
REMOTE_HOST="root@95.163.226.154"
TUNNEL_PID_FILE="/tmp/wb-headless-qm-ssh-tunnel.pid"

ROOT_ENV="${BACKEND_DIR}/../.env"
if [ -f "${ROOT_ENV}" ]; then set -a; . "${ROOT_ENV}"; set +a; fi
: "${DATABASE_URL:?DATABASE_URL must be set in ${ROOT_ENV} (gitignored)}"

log() { echo "${LOG_PREFIX} $*"; }

start_tunnel() {
  if lsof -i ":${TUNNEL_PORT}" -sTCP:LISTEN &>/dev/null; then
    log "SSH tunnel already running on port ${TUNNEL_PORT}"
    return 0
  fi
  log "Starting SSH tunnel on port ${TUNNEL_PORT}..."
  ssh -N \
      -o ConnectTimeout=10 \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=6 \
      -L "${TUNNEL_PORT}:127.0.0.1:5432" \
      "${REMOTE_HOST}" &
  echo $! > "${TUNNEL_PID_FILE}" 2>/dev/null || true

  for i in $(seq 1 15); do
    if lsof -i ":${TUNNEL_PORT}" -sTCP:LISTEN &>/dev/null; then
      log "Tunnel ready after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "ERROR: SSH tunnel did not start within 15s" >&2
  exit 1
}

stop_tunnel() {
  if [ -f "${TUNNEL_PID_FILE}" ]; then
    local pid
    pid=$(cat "${TUNNEL_PID_FILE}")
    kill "${pid}" 2>/dev/null || true
    rm "${TUNNEL_PID_FILE}" 2>/dev/null || true
    log "Stopped SSH tunnel (pid ${pid})"
  fi
}

trap stop_tunnel EXIT
start_tunnel

log "Running headless query-map update..."
cd "${BACKEND_DIR}"

export DATABASE_URL
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export WB_CABINET_STORAGE_STATE_PATH="${WB_CABINET_STORAGE_STATE_PATH:-${BACKEND_DIR}/data/wb-cabinet-storage-state.json}"
export WB_QM_BATCH_SIZE="${WB_QM_BATCH_SIZE:-15}"
export WB_QM_CONCURRENCY="${WB_QM_CONCURRENCY:-10}"

npx ts-node \
  --project tsconfig.json \
  src/wb-clusters/run-headless-query-map.ts

log "Done."
