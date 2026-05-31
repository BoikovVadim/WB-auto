#!/bin/bash
# Refresh wb_cabinet_cluster_queries via Safari cmp.wildberries.ru automation.
# Processes all campaign-product pairs ordered by: active first, missing first, oldest first.
#
# Usage:
#   ./run-query-map-update.sh              # all pairs, batch 50 per run
#   WB_CMP_BATCH_SIZE=200 ./run-query-map-update.sh   # custom batch size
set -e
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_PREFIX="[wb-query-map-update]"
TUNNEL_PORT=15432
REMOTE_HOST="root@95.163.226.154"

# DATABASE_URL берётся из gitignored .env в корне проекта (НЕ коммитится).
# Пример строки в .env:
#   DATABASE_URL=postgres://wb_admin:****@127.0.0.1:15432/wb_automation
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
  ssh -f -N \
      -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=6 \
      -L "${TUNNEL_PORT}:127.0.0.1:5432" \
      "${REMOTE_HOST}"
  for i in $(seq 1 15); do
    if lsof -i ":${TUNNEL_PORT}" -sTCP:LISTEN &>/dev/null; then
      log "Tunnel ready after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "ERROR: SSH tunnel did not start" >&2; exit 1
}

stop_tunnel() {
  pkill -f "ssh.*${TUNNEL_PORT}:127.0.0.1:5432" 2>/dev/null || true
  log "SSH tunnel closed."
}

trap stop_tunnel EXIT
start_tunnel

log "Starting fast query-map update (concurrency: ${WB_CMP_CONCURRENCY:-10})..."
cd "${BACKEND_DIR}"

export DATABASE_URL
export WB_CMP_CONCURRENCY="${WB_CMP_CONCURRENCY:-10}"
export WB_CMP_POLL_MS="${WB_CMP_POLL_MS:-2000}"
export WB_CMP_RESULTS_BATCH="${WB_CMP_RESULTS_BATCH:-5}"
# Меньший батч, чтобы успевать в короткую жизнь cmp-токена (перед каждым батчем
# скрипт ещё и проактивно обновляет сессию).
export WB_CMP_BATCH_SIZE="${WB_CMP_BATCH_SIZE:-15}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

npx ts-node \
  --project tsconfig.json \
  src/wb-clusters/fill-query-map-from-cmp-api.ts

log "Done."
