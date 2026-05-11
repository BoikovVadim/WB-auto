#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-auto}"
DEFAULT_SSH_KEY_PATH="${HOME}/.ssh/id_ed25519_reg_ru_deploy"

export DEPLOY_REMOTE_HOST="${DEPLOY_REMOTE_HOST:-95.163.226.154}"
export DEPLOY_REMOTE_USER="${DEPLOY_REMOTE_USER:-root}"
export DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/wb-automation}"
export DEPLOY_PM2_APP="${DEPLOY_PM2_APP:-wb-automation-backend}"
export DEPLOY_HEALTHCHECK_URL="${DEPLOY_HEALTHCHECK_URL:-https://legendgames.space/wb/api/health}"

if [[ -z "${DEPLOY_SSH_KEY_PATH:-}" && -f "$DEFAULT_SSH_KEY_PATH" ]]; then
  export DEPLOY_SSH_KEY_PATH="$DEFAULT_SSH_KEY_PATH"
fi

exec bash "$REPO_ROOT/scripts/deploy-prod.sh" "$MODE"
