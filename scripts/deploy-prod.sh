#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_DEPLOY_ENV="${DEPLOY_ENV_FILE:-$REPO_ROOT/.env.deploy.local}"

if [[ -f "$LOCAL_DEPLOY_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$LOCAL_DEPLOY_ENV"
  set +a
fi

MODE="${1:-auto}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-}"
REMOTE_USER="${DEPLOY_REMOTE_USER:-}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/wb-automation}"
REMOTE_PM2_APP="${DEPLOY_PM2_APP:-wb-automation-backend}"
REMOTE_HEALTHCHECK_URL="${DEPLOY_HEALTHCHECK_URL:-https://legendgames.space/wb/api/health}"
REMOTE_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-}"
ALLOW_CROSS_PROJECT_DEPLOY_TARGET="${DEPLOY_ALLOW_CROSS_PROJECT_TARGET:-0}"
SKIP_VERIFY_BEFORE_DEPLOY="${DEPLOY_SKIP_VERIFY:-0}"
SKIP_VERIFY_REASON="${DEPLOY_SKIP_VERIFY_REASON:-}"

EXPECTED_REMOTE_DIR="/var/www/wb-automation"
EXPECTED_PM2_APP="wb-automation-backend"
EXPECTED_HEALTHCHECK_URL="https://legendgames.space/wb/api/health"

log() {
  local phase="$1"
  shift
  printf '[deploy][%s] %s\n' "$phase" "$*"
}

wait_for_healthcheck() {
  local command="$1"
  local attempts="${2:-20}"
  local sleep_seconds="${3:-2}"
  local attempt=1

  while (( attempt <= attempts )); do
    if eval "$command" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  return 1
}

require_env() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    echo "Missing required deploy setting: $name" >&2
    exit 1
  fi
}

validate_target() {
  local mismatches=()

  if [[ "$REMOTE_DIR" != "$EXPECTED_REMOTE_DIR" ]]; then
    mismatches+=("DEPLOY_REMOTE_DIR=$REMOTE_DIR (expected $EXPECTED_REMOTE_DIR)")
  fi

  if [[ "$REMOTE_PM2_APP" != "$EXPECTED_PM2_APP" ]]; then
    mismatches+=("DEPLOY_PM2_APP=$REMOTE_PM2_APP (expected $EXPECTED_PM2_APP)")
  fi

  if [[ "$REMOTE_HEALTHCHECK_URL" != "$EXPECTED_HEALTHCHECK_URL" ]]; then
    mismatches+=("DEPLOY_HEALTHCHECK_URL=$REMOTE_HEALTHCHECK_URL (expected $EXPECTED_HEALTHCHECK_URL)")
  fi

  if [[ "${#mismatches[@]}" -eq 0 || "$ALLOW_CROSS_PROJECT_DEPLOY_TARGET" == "1" ]]; then
    return 0
  fi

  {
    echo "Refusing deploy because the current target looks non-canonical for wb-automation."
    echo "Expected:"
    echo "  DEPLOY_REMOTE_DIR=$EXPECTED_REMOTE_DIR"
    echo "  DEPLOY_PM2_APP=$EXPECTED_PM2_APP"
    echo "  DEPLOY_HEALTHCHECK_URL=$EXPECTED_HEALTHCHECK_URL"
    echo "Got:"
    printf '  %s\n' "${mismatches[@]}"
    echo "Set DEPLOY_ALLOW_CROSS_PROJECT_DEPLOY_TARGET=1 only if you intentionally target another server."
  } >&2
  exit 1
}

require_skip_verify_reason() {
  if [[ "$SKIP_VERIFY_BEFORE_DEPLOY" != "1" ]]; then
    return 0
  fi

  if [[ -n "$SKIP_VERIFY_REASON" ]]; then
    log verify "DEPLOY_SKIP_VERIFY=1 reason: $SKIP_VERIFY_REASON"
    return 0
  fi

  {
    echo "Refusing deploy with DEPLOY_SKIP_VERIFY=1 without DEPLOY_SKIP_VERIFY_REASON."
    echo "Use this exception-only path only when reusing already-verified artifacts."
  } >&2
  exit 1
}

run_ssh() {
  local remote_command="$1"

  if [[ -n "$REMOTE_SSH_KEY_PATH" ]]; then
    ssh -T -i "$REMOTE_SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new -- "$REMOTE_USER@$REMOTE_HOST" "$remote_command"
    return 0
  fi

  ssh -T -o StrictHostKeyChecking=accept-new -- "$REMOTE_USER@$REMOTE_HOST" "$remote_command"
}

run_scp() {
  local local_path="$1"
  local remote_path="$2"

  if [[ -n "$REMOTE_SSH_KEY_PATH" ]]; then
    scp -i "$REMOTE_SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new "$local_path" "$REMOTE_USER@$REMOTE_HOST:$remote_path"
    return 0
  fi

  scp -o StrictHostKeyChecking=accept-new "$local_path" "$REMOTE_USER@$REMOTE_HOST:$remote_path"
}

case "$MODE" in
  auto|full|backend-only|frontend-only|sync-only)
    ;;
  *)
    echo "Usage: $0 [auto|full|backend-only|frontend-only|sync-only]" >&2
    exit 1
    ;;
esac

require_env "DEPLOY_REMOTE_HOST" "$REMOTE_HOST"
require_env "DEPLOY_REMOTE_USER" "$REMOTE_USER"
validate_target
require_skip_verify_reason

if [[ "$SKIP_VERIFY_BEFORE_DEPLOY" != "1" ]]; then
  log verify "npm run verify:ci"
  (
    cd "$REPO_ROOT"
    npm run verify:ci
  )
fi

DEPLOY_BACKEND=0
DEPLOY_FRONTEND=0

case "$MODE" in
  auto|full|sync-only)
    DEPLOY_BACKEND=1
    DEPLOY_FRONTEND=1
    ;;
  backend-only)
    DEPLOY_BACKEND=1
    ;;
  frontend-only)
    DEPLOY_FRONTEND=1
    ;;
esac

if [[ "$DEPLOY_BACKEND" == "1" ]]; then
  log build "backend -> npm run build:release:backend"
  (
    cd "$REPO_ROOT"
    npm run build:release:backend
  )
fi

if [[ "$DEPLOY_FRONTEND" == "1" ]]; then
  log build "frontend -> npm run build:release:frontend"
  (
    cd "$REPO_ROOT"
    npm run build:release:frontend
  )
fi

TMP_DIR="$(mktemp -d)"
STAGE_DIR="$TMP_DIR/stage"
BUNDLE_PATH="$TMP_DIR/wb-automation-deploy.tgz"
REMOTE_BUNDLE_PATH="/tmp/wb-automation-deploy-$$.tgz"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

mkdir -p "$STAGE_DIR/backend" "$STAGE_DIR/Frontend"

cp "$REPO_ROOT/package.json" "$STAGE_DIR/package.json"
cp "$REPO_ROOT/package-lock.json" "$STAGE_DIR/package-lock.json"
cp "$REPO_ROOT/backend/package.json" "$STAGE_DIR/backend/package.json"
cp "$REPO_ROOT/ecosystem.config.js" "$STAGE_DIR/ecosystem.config.js"

if [[ "$DEPLOY_BACKEND" == "1" ]]; then
  cp -R "$REPO_ROOT/backend/dist" "$STAGE_DIR/backend/dist"
fi

if [[ "$DEPLOY_FRONTEND" == "1" ]]; then
  cp -R "$REPO_ROOT/Frontend/build" "$STAGE_DIR/Frontend/build"
fi

COPYFILE_DISABLE=1 tar -C "$STAGE_DIR" -czf "$BUNDLE_PATH" .

log upload "bundle -> $REMOTE_USER@$REMOTE_HOST:$REMOTE_BUNDLE_PATH"
run_scp "$BUNDLE_PATH" "$REMOTE_BUNDLE_PATH"

REMOTE_COMMAND="$(cat <<EOF
set -euo pipefail
mkdir -p "$REMOTE_DIR" "$REMOTE_DIR/shared" "$REMOTE_DIR/shared/archives/search-queries" "$REMOTE_DIR/backend" "$REMOTE_DIR/Frontend"
TMP_EXTRACT_DIR="\$(mktemp -d)"
trap 'rm -rf "\$TMP_EXTRACT_DIR" "$REMOTE_BUNDLE_PATH"' EXIT
tar -xzf "$REMOTE_BUNDLE_PATH" -C "\$TMP_EXTRACT_DIR"
cp "\$TMP_EXTRACT_DIR/package.json" "$REMOTE_DIR/package.json"
cp "\$TMP_EXTRACT_DIR/package-lock.json" "$REMOTE_DIR/package-lock.json"
cp "\$TMP_EXTRACT_DIR/ecosystem.config.js" "$REMOTE_DIR/ecosystem.config.js"
cp "\$TMP_EXTRACT_DIR/backend/package.json" "$REMOTE_DIR/backend/package.json"
if [[ -d "\$TMP_EXTRACT_DIR/backend/dist" ]]; then
  rm -rf "$REMOTE_DIR/backend/dist"
  cp -R "\$TMP_EXTRACT_DIR/backend/dist" "$REMOTE_DIR/backend/dist"
fi
if [[ -f "$REMOTE_DIR/shared/.env" ]]; then
  cp "$REMOTE_DIR/shared/.env" "$REMOTE_DIR/.env"
fi
cd "$REMOTE_DIR"
npm ci --include=dev --omit=optional
# Ensure PostgreSQL is running before reloading the app.
# If the cluster is down (happens after OOM kills or host reboots),
# start it silently so the backend connects successfully on first try.
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
fi
pm2 startOrReload ecosystem.config.js --only "$REMOTE_PM2_APP" --update-env
# Wait for the backend to be healthy, then copy the new frontend bundle.
# Copying frontend only after the backend is ready ensures the browser
# detects the new bundle hash only when the API is already serving the
# matching backend version — eliminating the race where the browser
# auto-reloads into a restarting server and sees empty product data.
for attempt in \$(seq 1 20); do
  if curl --fail --show-error --silent http://localhost:3300/api/health >/dev/null 2>&1; then
    if [[ -d "\$TMP_EXTRACT_DIR/Frontend/build" ]]; then
      rm -rf "$REMOTE_DIR/Frontend/build"
      cp -R "\$TMP_EXTRACT_DIR/Frontend/build" "$REMOTE_DIR/Frontend/build"
    fi
    exit 0
  fi
  sleep 2
done
exit 1
EOF
)"

log remote "extract, install, reload pm2"
run_ssh "$REMOTE_COMMAND"

log verify "health -> $REMOTE_HEALTHCHECK_URL"
if ! wait_for_healthcheck "curl --fail --show-error --silent \"$REMOTE_HEALTHCHECK_URL\"" 20 2; then
  echo "Public healthcheck did not become ready: $REMOTE_HEALTHCHECK_URL" >&2
  exit 1
fi

log verify "npm run verify:prod"
(
  cd "$REPO_ROOT"
  npm run verify:prod
)

log done "deploy completed"
