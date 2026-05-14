#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_TAG="${1:-${TARGET_TAG:-v0.12.3}}"
SECRETS_FILE="${SECRETS_FILE:-.secrets.uat.local}"
EVIDENCE_ROOT="${EVIDENCE_ROOT:-artifacts/local-uat-deploy}"

log_step() {
  echo
  echo "==> $*"
}

fail() {
  echo "[FAIL][local-uat-deploy-only] $*" >&2
  exit 1
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Required environment variable is missing: $name"
}

write_secret_file() {
  local value_name="$1"
  local file_name="$2"
  local destination="$3"
  local value="${!value_name:-}"
  local source_file="${!file_name:-}"

  if [[ -n "$source_file" ]]; then
    [[ -f "$source_file" ]] || fail "$file_name points to a missing file: $source_file"
    cp "$source_file" "$destination"
    return 0
  fi

  [[ -n "$value" ]] || fail "Set $value_name or $file_name"
  printf '%s\n' "$value" >"$destination"
}

load_env_file "$SECRETS_FILE"

[[ "$TARGET_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]] || fail "Invalid release tag: $TARGET_TAG"

export TARGET_TAG
export REMOTE_HOST="${REMOTE_HOST:-${UAT_SSH_HOST:-}}"
export REMOTE_PORT="${REMOTE_PORT:-${UAT_SSH_PORT:-22}}"
export REMOTE_USER="${REMOTE_USER:-${UAT_SSH_USER:-deploy}}"
export CLOUDFLARE_ACCESS_CLIENT_ID="${CLOUDFLARE_ACCESS_CLIENT_ID:-${UAT_CLOUDFLARE_ACCESS_CLIENT_ID:-}}"
export CLOUDFLARE_ACCESS_CLIENT_SECRET="${CLOUDFLARE_ACCESS_CLIENT_SECRET:-${UAT_CLOUDFLARE_ACCESS_CLIENT_SECRET:-}}"
export APP_DIR="${APP_DIR:-${UAT_APP_DIR:-/var/www/bookmyclass}}"
export HOMESITE_PUBLISH_DIR="${HOMESITE_PUBLISH_DIR:-${UAT_HOMESITE_DIR:-/var/www/bookmyclass-homesite}}"
export UAT_BASE_URL="${UAT_BASE_URL:-${BASE_URL:-https://demo.bookmyclass.app}}"
export BASE_URL="${BASE_URL:-$UAT_BASE_URL}"
export HOMESITE_BASE_URL="${HOMESITE_BASE_URL:-${UAT_HOMESITE_URL:-${UAT_HOMESITE_BASE_URL:-https://bookmyclass.app}}}"
export APP_NAME="${APP_NAME:-${UAT_PM2_APP_NAME:-bookmyclass-app}}"
export PROD_DEMO_SSH_HOST="${PROD_DEMO_SSH_HOST:-ssh-prod.bookmyclass.app}"
export EVIDENCE_ROOT

require_env REMOTE_HOST
require_env REMOTE_PORT
require_env REMOTE_USER
require_env CLOUDFLARE_ACCESS_CLIENT_ID
require_env CLOUDFLARE_ACCESS_CLIENT_SECRET

cloudflared_bin="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
[[ -n "$cloudflared_bin" ]] || fail "cloudflared was not found on PATH; set CLOUDFLARED_BIN"

mkdir -p "$EVIDENCE_ROOT"
temp_home="$(mktemp -d)"
cleanup() {
  rm -rf "$temp_home"
}
trap cleanup EXIT

ssh_dir="$temp_home/.ssh"
mkdir -p "$ssh_dir"
chmod 700 "$ssh_dir"
write_secret_file UAT_SSH_PRIVATE_KEY UAT_SSH_PRIVATE_KEY_FILE "$ssh_dir/id_ed25519"
write_secret_file UAT_SSH_KNOWN_HOSTS UAT_SSH_KNOWN_HOSTS_FILE "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/id_ed25519" "$ssh_dir/known_hosts"

cat >"$ssh_dir/config" <<EOF
Host deploy-target
  HostName $REMOTE_HOST
  Port $REMOTE_PORT
  User $REMOTE_USER
  IdentityFile $ssh_dir/id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $ssh_dir/known_hosts
  ServerAliveInterval 30
  ServerAliveCountMax 6
  ProxyCommand "$cloudflared_bin" access ssh --hostname %h
EOF
chmod 600 "$ssh_dir/config"

export GIT_SSH_COMMAND="ssh -F $ssh_dir/config"
export HOME="$temp_home"

log_step "local deploy-only context"
echo "target_tag=$TARGET_TAG"
echo "remote_host=$REMOTE_HOST"
echo "remote_port=$REMOTE_PORT"
echo "remote_user=$REMOTE_USER"
echo "app_dir=$APP_DIR"
echo "homesite_publish_dir=$HOMESITE_PUBLISH_DIR"
echo "app_name=$APP_NAME"
echo "app_base_url=$BASE_URL"
echo "homesite_base_url=$HOMESITE_BASE_URL"
echo "evidence_root=$EVIDENCE_ROOT"
echo "cloudflared_bin=$cloudflared_bin"
if [[ "$REMOTE_HOST" == "$PROD_DEMO_SSH_HOST" || "$APP_DIR" == "/var/www/bookmyclass" || "$BASE_URL" == "https://demo.bookmyclass.app" ]]; then
  echo "[warn] UAT deploy is targeting the production/demo topology by UAT_* configuration."
fi

log_step "test SSH connectivity via Cloudflare Access"
ssh -F "$ssh_dir/config" deploy-target 'hostname && whoami && pm2 status'

log_step "run deploy_uat logic only"
bash scripts/uat-deploy-tag.sh "$TARGET_TAG"
