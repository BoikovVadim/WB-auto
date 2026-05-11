#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${DEPLOY_REMOTE_HOST:-95.163.226.154}"
REMOTE_USER="${DEPLOY_REMOTE_USER:-root}"
REMOTE_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-${HOME}/.ssh/id_ed25519_reg_ru_deploy}"
LOCAL_HEALTHCHECK_URL="${DEPLOY_LOCAL_HEALTHCHECK_URL:-http://localhost:3300/api/health}"
PUBLIC_HEALTHCHECK_URL="${DEPLOY_HEALTHCHECK_URL:-https://legendgames.space/wb/api/health}"
PUBLIC_FRONTEND_URL="${DEPLOY_FRONTEND_URL:-https://legendgames.space/wb/}"

assert_health_payload() {
  local health_url="$1"
  local body

  body="$(curl --fail --show-error --silent "$health_url")"
  HEALTH_PAYLOAD="$body" node <<'EOF'
const payload = JSON.parse(process.env.HEALTH_PAYLOAD ?? "null");

if (!payload || typeof payload !== "object") {
  throw new Error("health payload is not an object");
}

if (payload.status !== "ok") {
  throw new Error(`health status must be ok, got ${String(payload.status)}`);
}

if (payload.service !== "wb-automation-backend") {
  throw new Error(`unexpected health service ${String(payload.service)}`);
}

if (!payload.checks || typeof payload.checks !== "object") {
  throw new Error("health payload is missing checks");
}

for (const key of [
  "wbApiConfigured",
  "wbPromotionApiConfigured",
  "postgresConfigured",
  "writeGuardConfigured",
]) {
  if (typeof payload.checks[key] !== "boolean") {
    throw new Error(`health check ${key} must be boolean`);
  }
}

if (!Number.isFinite(Date.parse(String(payload.timestamp ?? "")))) {
  throw new Error("health timestamp is invalid");
}
EOF
}

assert_frontend_shell() {
  local frontend_url="$1"
  local body

  body="$(curl --fail --show-error --silent "$frontend_url")"
  if [[ "$body" != *"<html"* || "$body" != *"</html>"* ]]; then
    echo "Frontend shell check failed for $frontend_url" >&2
    exit 1
  fi
}

REMOTE_HEALTH_NODE_CHECK="$(cat <<'EOF'
const payload = JSON.parse(process.env.HEALTH_PAYLOAD ?? "null");
if (!payload || payload.status !== "ok" || payload.service !== "wb-automation-backend") {
  throw new Error("remote health payload is invalid");
}
if (!payload.checks || typeof payload.checks !== "object") {
  throw new Error("remote health checks are missing");
}
EOF
)"

REMOTE_HEALTH_VERIFY_COMMAND="$(cat <<EOF
set -euo pipefail
for attempt in \$(seq 1 20); do
  if HEALTH_PAYLOAD="\$(curl --fail --show-error --silent "$LOCAL_HEALTHCHECK_URL")"; then
    export HEALTH_PAYLOAD
    node -e '$REMOTE_HEALTH_NODE_CHECK'
    exit 0
  fi
  sleep 2
done
exit 1
EOF
)"

if [[ -n "$REMOTE_SSH_KEY_PATH" && -f "$REMOTE_SSH_KEY_PATH" ]]; then
  ssh -T -i "$REMOTE_SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new -- "$REMOTE_USER@$REMOTE_HOST" \
    "$REMOTE_HEALTH_VERIFY_COMMAND" >/dev/null
fi

assert_health_payload "$PUBLIC_HEALTHCHECK_URL"
assert_frontend_shell "$PUBLIC_FRONTEND_URL"

printf 'WB production checks passed.\n'
