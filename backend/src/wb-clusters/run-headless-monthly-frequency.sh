#!/bin/bash
# Ежедневный фоновый загрузчик частот WB (headless Playwright, без Safari).
#   SSH-туннель к проду → headless-выгрузка по категориям → импорт в БД → закрыть туннель.
# Login-on-demand: если сессия мертва, раннер сам откроет ВИДИМОЕ окно входа и ждёт.
# Расписание: com.wb-automation.headless-frequency.plist в 09:00 ежедневно.
set -e
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_PREFIX="[wb-headless-freq]"
TUNNEL_PORT=15432
# SSH-хост БД, к которой агент туннелирует и пишет результат. Дефолт — боевой прод; на
# cutover перенаправляется на Oqqi одной env-переменной (WB_HEADLESS_DB_SSH_HOST в корневом
# .env) + сменой DATABASE_URL на креды Oqqi — без правки кода под давлением переключения.
REMOTE_HOST="${WB_HEADLESS_DB_SSH_HOST:-root@95.163.226.154}"
TUNNEL_PID_FILE="/tmp/wb-headless-freq-ssh-tunnel.pid"

# DATABASE_URL — из gitignored .env в корне проекта (НЕ коммитится).
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

# ── Main ───────────────────────────────────────────────────────────────────────
trap stop_tunnel EXIT

start_tunnel

log "Running headless frequency import..."
cd "${BACKEND_DIR}"

export DATABASE_URL
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
# storageState сессии WB — рядом с проектом, gitignored (содержит куки кабинета).
export WB_CABINET_STORAGE_STATE_PATH="${WB_CABINET_STORAGE_STATE_PATH:-${BACKEND_DIR}/data/wb-cabinet-storage-state.json}"
# Все 93 категории дают ~3.7M+ уникальных строк в памяти (дедуп по identity) —
# дефолтный heap Node (~2 ГБ) переполняется (OOM). Поднимаем лимит.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"

npx ts-node \
  --project tsconfig.json \
  src/wb-clusters/run-headless-monthly-frequency.ts

log "Done."
