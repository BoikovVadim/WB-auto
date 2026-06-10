#!/usr/bin/env bash
set -euo pipefail

# Снятие дампа БД WB-автоматизации с боевого сервера для переноса в Oqqi.
#
# Два режима (та же операция, разный объём исключений):
#   initial  — первичная поставка: схема ВСЕХ таблиц + данные бизнес-ядра; 5 крупных
#              регенерируемых таблиц идут СО СХЕМОЙ, но БЕЗ данных (--exclude-table-data),
#              чтобы пустая БД Oqqi поднялась и наполнилась синком. (~205 МБ)
#   cutover  — догоняющий рефреш бизнес-данных в день переключения: 5 крупных таблиц
#              исключены ЦЕЛИКОМ (--exclude-table), чтобы при доливе НЕ затереть то, что
#              экземпляр Oqqi накопил в них за shadow-фазу. Восстанавливать в существующую
#              БД через `pg_restore --clean --if-exists` — обновятся только бизнес-таблицы.
#
# Дамп СТРИМИТСЯ напрямую с прода к нам (диск прода забит ~79%) в custom-формате (-Fc,
# сжатый), с --no-owner --no-privileges → разворачивается в любую роль/БД Oqqi.
#
# Использование:
#   scripts/oqqi-db-transfer.sh initial   [out_dir]
#   scripts/oqqi-db-transfer.sh cutover   [out_dir]
# Deploy-таргет берётся из .env.deploy.local (как у deploy-prod.sh) или из env.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_DEPLOY_ENV="${DEPLOY_ENV_FILE:-$REPO_ROOT/.env.deploy.local}"

if [[ -f "$LOCAL_DEPLOY_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$LOCAL_DEPLOY_ENV"
  set +a
fi

MODE="${1:-}"
OUT_DIR="${2:-$HOME/Downloads}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-95.163.226.154}"
REMOTE_USER="${DEPLOY_REMOTE_USER:-root}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/wb-automation}"
REMOTE_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-${HOME}/.ssh/id_ed25519_reg_ru_deploy}"

# Крупные регенерируемые таблицы — не переносим их данные (наполняются синком/скрапом).
BIG_TABLES=(
  wb_cluster_raw_archive
  wb_cabinet_cluster_queries
  wb_product_workspace_cluster_queries
  wb_query_frequency_history
  wb_product_advertising_sheet_snapshots
)

log() { printf '[oqqi-db][%s] %s\n' "$1" "${*:2}"; }
die() { printf '[oqqi-db][error] %s\n' "$*" >&2; exit 1; }

case "$MODE" in
  initial) EXCLUDE_FLAG="--exclude-table-data" ;;
  cutover) EXCLUDE_FLAG="--exclude-table" ;;
  *) die "режим обязателен: initial | cutover (см. шапку скрипта)" ;;
esac

[[ -f "$REMOTE_SSH_KEY_PATH" ]] || die "нет SSH-ключа: $REMOTE_SSH_KEY_PATH (задай DEPLOY_SSH_KEY_PATH)"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/oqqi-db-${MODE}-${STAMP}.dump"

# Собираем строку исключений для pg_dump.
EXCLUDES=""
for t in "${BIG_TABLES[@]}"; do
  EXCLUDES+=" ${EXCLUDE_FLAG}=${t}"
done

log run "режим=$MODE → $OUT_FILE"
log run "таргет=${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"

# Удалённая команда: читаем боевой DATABASE_URL из .env сервера и стримим дамп в stdout.
REMOTE_CMD="set -euo pipefail
DBURL=\$(grep '^DATABASE_URL' ${REMOTE_DIR}/.env | cut -d= -f2-)
[[ -n \"\$DBURL\" ]] || { echo 'no DATABASE_URL on server' >&2; exit 1; }
pg_dump \"\$DBURL\" -Fc --no-owner --no-privileges${EXCLUDES}"

ssh -i "$REMOTE_SSH_KEY_PATH" -o BatchMode=yes "${REMOTE_USER}@${REMOTE_HOST}" "$REMOTE_CMD" > "$OUT_FILE"

# Контроль целостности: сигнатура PGDMP + ненулевой размер.
[[ -s "$OUT_FILE" ]] || die "пустой дамп — проверь доступ к серверной БД"
SIG="$(head -c 5 "$OUT_FILE")"
[[ "$SIG" == "PGDMP" ]] || die "неверная сигнатура дампа ('$SIG' вместо PGDMP)"
SIZE="$(ls -lh "$OUT_FILE" | awk '{print $5}')"

log ok "готов: $OUT_FILE ($SIZE), сигнатура PGDMP — валиден"
echo
echo "Восстановление в БД Oqqi (по защищённому каналу, ПД/152-ФЗ):"
if [[ "$MODE" == "initial" ]]; then
  echo "  createdb wb_automation"
  echo "  pg_restore --no-owner --no-privileges -d wb_automation '$OUT_FILE'"
else
  echo "  # рефреш бизнес-таблиц в уже работающей БД Oqqi (5 крупных таблиц не тронуты):"
  echo "  pg_restore --clean --if-exists --no-owner --no-privileges -d wb_automation '$OUT_FILE'"
fi
