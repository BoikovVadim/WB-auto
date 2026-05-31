#!/bin/bash
# Daily runner: start SSH tunnel → import WB search frequency data → close tunnel.
# Scheduled via com.wb-automation.monthly-frequency-import.plist at 09:00 daily.
set -e
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_PREFIX="[wb-freq-import]"
TUNNEL_PORT=15432
REMOTE_HOST="root@95.163.226.154"
TUNNEL_PID_FILE="/tmp/wb-freq-ssh-tunnel.pid"

# DATABASE_URL берётся из gitignored .env в корне проекта (НЕ коммитится).
# Пример строки в .env:
#   DATABASE_URL=postgres://wb_admin:****@127.0.0.1:15432/wb_automation
ROOT_ENV="${BACKEND_DIR}/../.env"
if [ -f "${ROOT_ENV}" ]; then set -a; . "${ROOT_ENV}"; set +a; fi
: "${DATABASE_URL:?DATABASE_URL must be set in ${ROOT_ENV} (gitignored)}"

# ── Helpers ────────────────────────────────────────────────────────────────────
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
  echo $! > "${TUNNEL_PID_FILE}" 2>/dev/null || true

  # Wait until port is reachable
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
    rm -f "${TUNNEL_PID_FILE}"
    log "Stopped SSH tunnel (pid ${pid})"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────────
trap stop_tunnel EXIT

start_tunnel

log "Running frequency import..."
cd "${BACKEND_DIR}"

export DATABASE_URL
export WB_CLUSTERS_WRITE_API_KEY="0bf0490b634fd6576824c23ad7b6adc0b0f3fd5fbe667c51b21265bb43d7ba2f"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

npx ts-node \
  --project tsconfig.json \
  src/wb-clusters/fill-monthly-frequency-download-and-import.ts

log "Done."
