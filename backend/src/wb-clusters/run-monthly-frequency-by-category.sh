#!/bin/bash
# Download WB search frequency data category by category (2-pass for large categories).
# Start SSH tunnel → run fill-monthly-frequency-by-category.ts → close tunnel.
#
# Usage:
#   ./run-monthly-frequency-by-category.sh
#
#   # Download specific categories only:
#   CATEGORY_FILTER="Мебель корпусная и мебель для хранения" \
#     ./run-monthly-frequency-by-category.sh
#
# Requires: macOS + Safari open at seller.wildberries.ru
set -e
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_PREFIX="[wb-freq-by-category]"
TUNNEL_PORT=15432
REMOTE_HOST="root@95.163.226.154"
DB_URL="postgres://wb_admin:99OKeJPaQFUfIfGdpfMEX5Z2dRekUoRa@127.0.0.1:${TUNNEL_PORT}/wb_automation"
TUNNEL_PID_FILE="/tmp/wb-freq-category-ssh-tunnel.pid"

log() { echo "${LOG_PREFIX} $*"; }

start_tunnel() {
  if lsof -i ":${TUNNEL_PORT}" -sTCP:LISTEN &>/dev/null; then
    log "SSH tunnel already running on port ${TUNNEL_PORT}"
    return 0
  fi
  log "Starting SSH tunnel on port ${TUNNEL_PORT}..."
  ssh -f -N \
      -o ConnectTimeout=10 \
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
  log "ERROR: SSH tunnel did not start within 15s" >&2
  exit 1
}

stop_tunnel() {
  pkill -f "ssh.*${TUNNEL_PORT}:127.0.0.1:5432" 2>/dev/null || true
  log "SSH tunnel closed."
}

trap stop_tunnel EXIT

start_tunnel

log "Running by-category frequency import..."
cd "${BACKEND_DIR}"

export DATABASE_URL="${DB_URL}"
export WB_CLUSTERS_WRITE_API_KEY="0bf0490b634fd6576824c23ad7b6adc0b0f3fd5fbe667c51b21265bb43d7ba2f"
export CATEGORY_MODE="1"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

npx ts-node \
  --project tsconfig.json \
  src/wb-clusters/fill-monthly-frequency-download-and-import.ts

log "Done."
